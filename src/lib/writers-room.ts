import { env } from './config.js'
import { exec } from './exec.js'
import { forgetService, isSleeping, retireService, sleepService } from './rest.js'
import type { ModelEndpoint } from '../agent/llm.js'

/**
 * The writers' room: the story of a film is written on the flagship model, which needs most of the memory pool, so it
 * works while every other model sleeps and is released for good before the first picture is made.
 *
 * Measured on this machine (Nemotron 3.5 Super VL NVFP4, vLLM nightly): 85 GB while awake, 3.7 s to sleep, a restart
 * 537 s. A wake with weight reload took 232 s and left the model answering nonsense, so a room left asleep by an
 * earlier run is restarted, never reloaded.
 */
export interface WritersRoom {
  author: ModelEndpoint
  /** The models that sleep while the room works: the planner, the vision reviewer. */
  others: ModelEndpoint[]
  log: (line: string) => void
  record: (detail: Record<string, unknown>) => Promise<void>
  /** Frees the diffusion models before the room needs the memory. */
  freeDiffusion: () => Promise<void>
}

/** Whether a separate writers' room is configured: the author is not one of the other endpoints. */
export const hasWritersRoom = (room: Pick<WritersRoom, 'author' | 'others'>) => room.others.every((o) => o.baseUrl !== room.author.baseUrl)

async function ready(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) })
    return response.ok
  } catch {
    return false
  }
}

/** Waits for the room's model to serve, up to `seconds`. */
async function waitReady(baseUrl: string, seconds: number): Promise<boolean> {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    if (await ready(baseUrl)) return true
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  return false
}

/** Opens the room: the other models sleep, and the author is started or restarted if it is not awake and fresh. */
export async function openWritersRoom(room: WritersRoom): Promise<void> {
  if (!hasWritersRoom(room)) return
  const started = Date.now()
  const slept: string[] = []
  for (const other of room.others) if (await sleepService(other.baseUrl).catch(() => false)) slept.push(other.name)
  await room.freeDiffusion().catch(() => undefined)
  const asleep = await isSleeping(room.author.baseUrl)
  let action: 'ready' | 'restarted' | 'started' = 'ready'
  if (asleep === true || !(await ready(room.author.baseUrl))) {
    const container = env('CINEFOUNDRY_WRITER_CONTAINER')!
    action = asleep === true ? 'restarted' : 'started'
    room.log(`  writers' room: ${action === 'restarted' ? 'restarting' : 'starting'} ${room.author.model} (${container})`)
    await exec('docker', [action === 'restarted' ? 'restart' : 'start', container]).catch((error: Error) => { throw new Error(`the writers' room model could not be ${action} (docker ${container}): ${error.message.slice(0, 200)}`) })
    forgetService(room.author.baseUrl)
    if (!(await waitReady(room.author.baseUrl, 1200))) throw new Error(`the writers' room model (${room.author.baseUrl}) did not come up within 20 minutes`)
  }
  const seconds = (Date.now() - started) / 1000
  room.log(`  writers' room: ${room.author.model} ${action}${action === 'ready' ? '' : ` in ${seconds.toFixed(0)}s`}${slept.length ? ` · sleeping ${slept.join(', ')}` : ''}`)
  await room.record({ event: 'open', action, seconds, sleeping: slept })
}

/** Closes the room before the first picture: the author sleeps for the rest of the run, and the memory goes to production. */
export async function closeWritersRoom(room: WritersRoom): Promise<void> {
  if (!hasWritersRoom(room)) return
  const released = await retireService(room.author.baseUrl).catch(() => false)
  room.log(`  writers' room: ${room.author.model} ${released ? 'released for production' : 'could not be put to sleep'}`)
  await room.record({ event: 'close', released })
}
