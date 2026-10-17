import { resolve } from 'node:path'
import { env } from './config.js'
import { exec } from './exec.js'

/**
 * The audio containers' boundary: one call runs one script of this repository (scripts/<name>) in a GPU container and
 * returns the JSON result line it printed last. The repository is mounted read-only at /repo and the step-audio work
 * folder read-write at /work - the only host folder a container can write to. Everything that decides what to run
 * (src/lib/speech.ts) stays on the host side of this call; tests replace this module to run without Docker.
 */

/** The host folder mounted as /work in every audio container. */
export const audioWork = () => resolve(env('CINEFOUNDRY_STEP_AUDIO_DIR')!)

export interface ContainerCall {
  image: string
  /** Extra `host:container[:ro]` mounts, e.g. the model weights. */
  mounts: string[]
  /** File name under scripts/. */
  script: string
  args: string[]
}

export async function runContainer(call: ContainerCall): Promise<string> {
  const { stdout } = await exec('docker', ['run', '--rm', '--device', 'nvidia.com/gpu=all', '--ipc=host', '-v', `${resolve('.')}:/repo:ro`, '-v', `${audioWork()}:/work`, ...call.mounts.flatMap((m) => ['-v', m]), call.image, `/repo/scripts/${call.script}`, ...call.args])
  const last = stdout.trim().split('\n').reverse().find((line) => line.startsWith('{'))
  if (!last) throw new Error(`${call.script} printed no result`)
  return last
}
