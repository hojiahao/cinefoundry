import { exec } from './exec.js'
import { forgetService, isSleeping, markRetired, retireService, sleepService } from './rest.js'
import type { ModelEndpoint } from '../agent/llm.js'

/**
 * The writers' room: the story of a film is written on the flagship model, which needs most of the memory pool, so it
 * works while every other model is out of memory and is gone again before the first picture is made.
 *
 * Measured on this machine (Nemotron 3.5 Super VL NVFP4, vLLM nightly): 85 GB while awake, a restart 537 s. A level-2
 * wake with weight reload took 232 s and left it answering nonsense, so the room never reloads it: it starts the
 * container when it opens and stops it when it closes. The other models are slept when their server has sleep mode
 * and their containers stopped otherwise - a sleep request to a server without it frees nothing (measured: Super
 * then found 40 GB free and could not start) - and started again when the room closes.
 */
export interface RoomModel {
  endpoint: ModelEndpoint
  /** Its Docker container, used when the server has no sleep mode. */
  container?: string
}

export interface WritersRoom {
  author: RoomModel
  /** The models that make way while the room works: the planner, the vision reviewer. */
  others: RoomModel[]
  log: (line: string) => void
  record: (detail: Record<string, unknown>) => Promise<void>
  /** Frees the diffusion models and the model page cache before the room needs the memory. */
  freeDiffusion: () => Promise<void>
}

/** Whether a separate writers' room is configured: the author is not one of the other endpoints. */
export const hasWritersRoom = (room: { author: RoomModel; others: RoomModel[] }) => room.others.every((o) => o.endpoint.baseUrl !== room.author.endpoint.baseUrl)

async function ready(baseUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) })).ok
  } catch {
    return false
  }
}

async function waitReady(baseUrl: string, seconds: number): Promise<boolean> {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) {
    if (await ready(baseUrl)) return true
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  return false
}

const docker = (action: 'start' | 'stop', container: string) =>
  exec('docker', [action, container]).catch((error: Error) => { throw new Error(`docker ${action} ${container} failed: ${error.message.slice(0, 200)}`) })

/** Containers the room stopped, started again when it closes (one room per process at a time). */
const stopped: RoomModel[] = []

/** Opens the room: the other models make way, and the author's container is started fresh. */
export async function openWritersRoom(room: WritersRoom): Promise<void> {
  if (!hasWritersRoom(room)) return
  const started = Date.now()
  const madeWay: string[] = []
  for (const other of room.others) {
    if (await sleepService(other.endpoint.baseUrl).catch(() => false)) { madeWay.push(`${other.endpoint.name} asleep`); continue }
    if (!other.container || !(await ready(other.endpoint.baseUrl))) continue
    await docker('stop', other.container)
    forgetService(other.endpoint.baseUrl)
    stopped.push(other)
    madeWay.push(`${other.endpoint.name} stopped`)
  }
  await room.freeDiffusion().catch(() => undefined)
  const author = room.author
  let action: 'ready' | 'started' = 'ready'
  // An author left asleep would need a reload, which breaks it: it is stopped and started instead.
  if ((await isSleeping(author.endpoint.baseUrl)) === true && author.container) await docker('stop', author.container)
  if (!(await ready(author.endpoint.baseUrl))) {
    if (!author.container) throw new Error(`the writers' room model (${author.endpoint.baseUrl}) is not serving and has no container to start`)
    action = 'started'
    room.log(`  writers' room: starting ${author.endpoint.model} (${author.container})`)
    await docker('start', author.container)
    forgetService(author.endpoint.baseUrl)
    if (!(await waitReady(author.endpoint.baseUrl, 1200))) throw new Error(`the writers' room model (${author.endpoint.baseUrl}) did not come up within 20 minutes`)
  }
  const seconds = (Date.now() - started) / 1000
  room.log(`  writers' room: ${author.endpoint.model} ${action}${action === 'ready' ? '' : ` in ${seconds.toFixed(0)}s`}${madeWay.length ? ` · ${madeWay.join(', ')}` : ''}`)
  await room.record({ event: 'open', action, seconds, madeWay })
}

/** Closes the room before the first picture: the author is stopped (or slept and never woken), the others come back. */
export async function closeWritersRoom(room: WritersRoom): Promise<void> {
  if (!hasWritersRoom(room)) return
  const started = Date.now()
  let released: 'stopped' | 'asleep' | 'kept' = 'kept'
  if (room.author.container && (await docker('stop', room.author.container).then(() => true, () => false))) released = 'stopped'
  else if (await retireService(room.author.endpoint.baseUrl).catch(() => false)) released = 'asleep'
  if (released === 'stopped') markRetired(room.author.endpoint.baseUrl)
  const back: string[] = []
  for (const other of stopped.splice(0)) {
    await docker('start', other.container!)
    if (!(await waitReady(other.endpoint.baseUrl, 1200))) throw new Error(`${other.endpoint.name} (${other.container}) did not come back within 20 minutes after the writers' room`)
    back.push(other.endpoint.name)
  }
  const seconds = (Date.now() - started) / 1000
  room.log(`  writers' room: ${room.author.endpoint.model} ${released === 'kept' ? 'could not be released' : released}${back.length ? ` · ${back.join(', ')} back in ${seconds.toFixed(0)}s` : ''}`)
  await room.record({ event: 'close', released, back, seconds })
}
