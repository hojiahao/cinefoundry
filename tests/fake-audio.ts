import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ContainerCall } from '../src/lib/containers.js'

/**
 * Stand-in for the audio containers (src/lib/containers.ts): runs each script's contract on the host - the job file in,
 * the files and the JSON result line out - with ffmpeg tones in place of speech and effects. Paths are mapped through
 * the same /work mount the real containers see. Install with
 *   vi.mock('../src/lib/containers.js', async (original) => ({ ...(await original()), runContainer: (await import('./fake-audio.js')).fakeRunContainer }))
 */

export interface AudioCall { script: string; image: string; jobs: any }
/** Every container call, in order. */
export const audioCalls: AudioCall[] = []

const work = () => resolve(process.env.CINEFOUNDRY_STEP_AUDIO_DIR ?? 'runtime-data/step-audio')
const host = (path: string) => join(work(), path.replace(/^\/work\//, ''))
const arg = (args: string[], name: string) => args[args.indexOf(name) + 1]!

function tone(path: string, seconds: number, frequency = 330): void {
  mkdirSync(dirname(path), { recursive: true })
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}`, '-ar', '48000', '-ac', '1', path])
}

export async function fakeRunContainer(call: ContainerCall): Promise<string> {
  const jobs = JSON.parse(readFileSync(host(arg(call.args, '--jobs')), 'utf8'))
  audioCalls.push({ script: call.script, image: call.image, jobs })
  switch (call.script) {
    case 'voice-cast.py': {
      const takes = Number(arg(call.args, '--takes'))
      const results = (jobs as Array<{ id: string; text: string; out: string }>).flatMap((job) =>
        Array.from({ length: takes }, (_, n) => {
          const path = `${job.out}/${job.id}_take${n + 1}.wav`
          tone(host(path), 3, 200 + 40 * n)
          return { id: job.id, path, text: job.text, seconds: 3 }
        }))
      return JSON.stringify({ results })
    }
    case 'qwen-clone.py': {
      for (const line of jobs.lines as Array<{ output: string }>) tone(host(line.output), 2.5)
      return JSON.stringify({ lines: jobs.lines.length })
    }
    case 'asr-score.py': {
      const results = (jobs as Array<{ path: string; text: string }>).map((job) => ({ path: job.path, heard: job.text, cer: 0.02 }))
      return JSON.stringify({ results })
    }
    case 'sfx.py': {
      for (const job of jobs as Array<{ output: string; seconds: number }>) tone(host(job.output), job.seconds, 120)
      return JSON.stringify({ made: jobs.length })
    }
    default:
      throw new Error(`fake audio container: no script ${call.script}`)
  }
}
