import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { craftFloor, reviewProxy } from '../src/agent/gate.js'
import { ensureAwake, sleepService, wakeService } from '../src/lib/rest.js'

/** A vLLM server with sleep mode: counts every transition call, and wakes or sleeps after `delayMs`. */
async function fakeVllm(options: { asleep: boolean; delayMs?: number }) {
  const calls: string[] = []
  let asleep = options.asleep
  const delay = () => new Promise((done) => setTimeout(done, options.delayMs ?? 0))
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://fake').pathname
    calls.push(path)
    if (path === '/is_sleeping') return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ is_sleeping: asleep }))
    if (path === '/wake_up') { await delay(); asleep = false; return response.writeHead(200).end() }
    if (path === '/collective_rpc') { await delay(); return response.writeHead(200).end() }
    if (path === '/sleep') { await delay(); asleep = true; return response.writeHead(200).end() }
    response.writeHead(404).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  servers.push(server)
  return { baseUrl, calls, isAsleep: () => asleep, transitions: () => calls.filter((c) => c !== '/is_sleeping') }
}
const servers: Server[] = []
afterEach(() => { for (const server of servers.splice(0)) server.close() })

describe('language-model sleep and wake', () => {
  it('shares one wake among concurrent requests to the same service', async () => {
    const vllm = await fakeVllm({ asleep: true, delayMs: 100 })
    const results = await Promise.all([ensureAwake(vllm.baseUrl), ensureAwake(vllm.baseUrl), wakeService(vllm.baseUrl), ensureAwake(vllm.baseUrl)])
    expect(vllm.transitions()).toEqual(['/wake_up', '/collective_rpc'])
    // The wake is timed once, by the caller that started it.
    expect(results.filter((r) => r.wokeSeconds !== undefined)).toHaveLength(1)
    expect(vllm.isAsleep()).toBe(false)
    await ensureAwake(vllm.baseUrl)
    expect(vllm.calls.filter((c) => c === '/is_sleeping')).toHaveLength(1)
  })

  it('does not put a service back to sleep while it is being woken for the cut', async () => {
    const vllm = await fakeVllm({ asleep: true, delayMs: 100 })
    const wake = wakeService(vllm.baseUrl)
    // A late sleep (an earlier phase's rest) arrives while the wake is under way.
    expect(await sleepService(vllm.baseUrl)).toBe(false)
    await wake
    expect(vllm.transitions()).toEqual(['/wake_up', '/collective_rpc'])
    expect(vllm.isAsleep()).toBe(false)
  })

  it('waits for a sleep under way before waking, and drops a sleep that arrives after the wake was asked for', async () => {
    const vllm = await fakeVllm({ asleep: false, delayMs: 100 })
    const first = sleepService(vllm.baseUrl)
    while (!vllm.calls.includes('/sleep')) await new Promise((done) => setTimeout(done, 5))
    const wake = ensureAwake(vllm.baseUrl)
    const late = sleepService(vllm.baseUrl)
    expect(await first).toBe(true)
    expect(await late).toBe(false)
    await wake
    // Never interleaved: the sleep finished before wake_up started, and the service ends awake.
    expect(vllm.transitions()).toEqual(['/sleep', '/wake_up', '/collective_rpc'])
    expect(vllm.isAsleep()).toBe(false)
  })

  it('sleeps a woken service again at the next phase', async () => {
    const vllm = await fakeVllm({ asleep: true })
    await wakeService(vllm.baseUrl)
    expect(await sleepService(vllm.baseUrl)).toBe(true)
    expect(vllm.isAsleep()).toBe(true)
  })
})

describe('review proxies', () => {
  it('makes one complete proxy when several gates judge the same still at once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cinefoundry-proxy-'))
    const still = join(dir, 'hero.png')
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=2048x1152', '-frames:v', '1', still])
    const calls = Array.from({ length: 6 }, () => reviewProxy(still))
    expect(new Set(calls).size).toBe(1)
    const paths = await Promise.all(calls)
    expect(new Set(paths)).toEqual(new Set([`${still}.review.jpg`]))
    expect(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width', '-of', 'csv=p=0', paths[0]!]).toString().trim()).toBe('mjpeg,1024')
    // Nothing half-written is left beside the still.
    expect(readdirSync(dir).sort()).toEqual(['hero.png', 'hero.png.review.jpg'])
    // A later gate (a regenerated still at the same path) gets a fresh proxy.
    expect(reviewProxy(still)).not.toBe(calls[0])
  })
})

describe('craft floor', () => {
  it('reads a number and keeps 6 for anything else', () => {
    expect(craftFloor('7')).toBe(7)
    expect(craftFloor(undefined)).toBe(6)
    expect(craftFloor('')).toBe(6)
    expect(craftFloor('high')).toBe(6)
  })
})
