import { env } from './config.js'

/**
 * Putting the language models to sleep while the diffusion models work.
 *
 * On a DGX Spark every model shares one 121.7 GB pool. The two vLLM services claim 45 % of it at
 * start-up and keep it, so during the frame and clip phases ComfyUI has ~54 GB and must evict
 * and reload Qwen-Image-Edit / Wan2.2 weights on every frame and every clip. Measured on this
 * machine: a 5-second Wan clip is ~200 s of compute plus ~150 s of weight traffic.
 *
 * vLLM's sleep mode (`--enable-sleep-mode`) fixes that: level 2 discards the weights and the KV
 * cache; `wake_up` plus a `reload_weights` RPC brings them back from NVMe. The harness sleeps the planner during frames, both
 * services during clips, and every request wakes its endpoint first, so a caller never sees a
 * sleeping model. Servers started without the flag answer 404 and are simply left alone.
 */

/** Per service: 'awake', 'asleep', or 'none' for a server without sleep mode (asked once). */
const state = new Map<string, 'awake' | 'asleep' | 'none' | 'retired'>()
/** The sleep level each service was put to by us: level 2 discards the weights and they must be reloaded after wake_up. */
const level = new Map<string, 1 | 2>()
/** The wake in flight per service: every caller that needs the model while it wakes waits for this one wake. */
const waking = new Map<string, Promise<{ wokeSeconds?: number }>>()
/** Per service, the tail of its transitions: a sleep and a wake never interleave their HTTP calls. */
const transitions = new Map<string, Promise<unknown>>()

function serially<T>(baseUrl: string, task: () => Promise<T>): Promise<T> {
  const run = (transitions.get(baseUrl) ?? Promise.resolve()).then(task, task)
  transitions.set(baseUrl, run.catch(() => undefined))
  return run
}

/** 2 (default): release weights and KV cache, reload from disk on wake. 1: keep the weights in host memory (frees nothing on a unified-memory machine). */
export const sleepLevel = (): 1 | 2 => (env('CINEFOUNDRY_SLEEP_LEVEL') === '1' ? 1 : 2)

/** `http://host:port/v1` -> `http://host:port` */
export const serviceRoot = (baseUrl: string) => baseUrl.replace(/\/v1\/?$/, '')

export const sleepEnabled = () => env('CINEFOUNDRY_SLEEP_LLMS') !== '0'

/** Whether the service is asleep; `undefined` when it has no sleep mode (or is not a vLLM server). */
export async function isSleeping(baseUrl: string): Promise<boolean | undefined> {
  try {
    const response = await fetch(`${serviceRoot(baseUrl)}/is_sleeping`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return undefined
    return Boolean(((await response.json()) as { is_sleeping?: boolean }).is_sleeping)
  } catch {
    return undefined
  }
}

/**
 * Wake the service if it sleeps. Cheap after the first call: the state is remembered until we sleep it ourselves.
 * Concurrent callers share one wake; only the caller that started it gets `wokeSeconds`, so the time is recorded once.
 */
export async function ensureAwake(baseUrl: string): Promise<{ wokeSeconds?: number }> {
  if (!baseUrl.startsWith('http://127.0.0.1') && !baseUrl.startsWith('http://localhost')) return {}
  const known = state.get(baseUrl)
  if (known === 'awake' || known === 'none') return {}
  if (known === 'retired') throw new Error(`${baseUrl} was released for this run (its weights do not survive a reload); it is restarted at the next run`)
  const inFlight = waking.get(baseUrl)
  if (inFlight) {
    await inFlight
    return {}
  }
  const wake = serially(baseUrl, () => wakeNow(baseUrl)).finally(() => waking.delete(baseUrl))
  waking.set(baseUrl, wake)
  return wake
}

async function wakeNow(baseUrl: string): Promise<{ wokeSeconds?: number }> {
  const known = state.get(baseUrl)
  if (known === 'awake' || known === 'none') return {}
  const sleeping = await isSleeping(baseUrl)
  if (sleeping === undefined) {
    state.set(baseUrl, 'none')
    return {}
  }
  if (!sleeping) {
    state.set(baseUrl, 'awake')
    return {}
  }
  const started = Date.now()
  const response = await fetch(`${serviceRoot(baseUrl)}/wake_up`, { method: 'POST', signal: AbortSignal.timeout(600000) })
  if (!response.ok) throw new Error(`could not wake ${baseUrl}: ${response.status}`)
  // After a level-2 sleep the weight buffers are allocated but empty: a model that answers "后汉书后汉书…"
  // is one that was woken without this step. The reload is the price of the freed memory (~90 s here).
  if ((level.get(baseUrl) ?? sleepLevel()) === 2) {
    const reload = await fetch(`${serviceRoot(baseUrl)}/collective_rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'reload_weights' }), signal: AbortSignal.timeout(900000) })
    if (!reload.ok) throw new Error(`could not reload weights on ${baseUrl}: ${reload.status}`)
  }
  state.set(baseUrl, 'awake')
  return { wokeSeconds: (Date.now() - started) / 1000 }
}

/**
 * Level 2: weights and KV cache are released; the next request reloads them. Returns false when the server has no sleep
 * mode, and when a wake is in flight or queued: whoever asked for it needs the model now (the cut wakes both models
 * underneath finishing), so a sleep that arrives during the wake is a late call and is not carried out.
 */
export async function sleepService(baseUrl: string): Promise<boolean> {
  if (!sleepEnabled() || state.get(baseUrl) === 'none' || waking.has(baseUrl)) return false
  return serially(baseUrl, async () => {
    if (waking.has(baseUrl) || state.get(baseUrl) === 'none') return false
    const sleeping = await isSleeping(baseUrl)
    if (sleeping === undefined) {
      state.set(baseUrl, 'none')
      return false
    }
    if (!sleeping) {
      const response = await fetch(`${serviceRoot(baseUrl)}/sleep?level=${sleepLevel()}`, { method: 'POST', signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error(`could not sleep ${baseUrl}: ${response.status}`)
      level.set(baseUrl, sleepLevel())
    }
    state.set(baseUrl, 'asleep')
    return true
  })
}

/** Wake the service whatever we last recorded (it may have been slept from outside); joins a wake already in flight. */
export async function wakeService(baseUrl: string): Promise<{ wokeSeconds?: number }> {
  if (state.get(baseUrl) !== 'none' && !waking.has(baseUrl)) state.delete(baseUrl)
  return ensureAwake(baseUrl)
}

/** Wake the language models a GPU phase put to sleep, underneath whatever runs next (finishing needs neither). */
export function wakeAll(targets: Array<{ baseUrl: string }>): Promise<unknown> {
  return Promise.all(targets.map((target) => wakeService(target.baseUrl).catch(() => undefined)))
}

/**
 * Sleep a model for the rest of this run and refuse to wake it: Nemotron 3.5 Super answers nonsense after a level-2
 * sleep and weight reload on this vLLM build (measured: "The perfume shop in the rain, where the rain is the perfume
 * shop."), so a released writers' room is restarted by the next run instead of reloaded.
 */
export async function retireService(baseUrl: string): Promise<boolean> {
  const slept = await sleepService(baseUrl)
  if (slept) state.set(baseUrl, 'retired')
  return slept
}

/** Record a service as released for the rest of this run (its container was stopped): nothing may wake it. */
export function markRetired(baseUrl: string): void {
  state.set(baseUrl, 'retired')
}

/** Forget what we recorded about a service (after it was restarted from outside). */
export function forgetService(baseUrl: string): void {
  state.delete(baseUrl)
  level.delete(baseUrl)
}
