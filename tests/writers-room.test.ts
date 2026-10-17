import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The docker calls the room makes; a restart or start brings the fake writer back awake and serving. */
const docker: string[][] = []
let onDocker: (args: string[]) => void = () => {}
vi.mock('../src/lib/exec.js', () => ({
  exec: async (command: string, args: string[]) => {
    if (command === 'docker') { docker.push(args); onDocker(args) }
    return { stdout: '', stderr: '' }
  },
}))

const { closeWritersRoom, hasWritersRoom, openWritersRoom } = await import('../src/lib/writers-room.js')
const { ensureAwake } = await import('../src/lib/rest.js')

/** A vLLM server with sleep mode that can also be down (not serving /v1/models). */
async function fakeVllm(state: { asleep: boolean; up?: boolean }) {
  const calls: string[] = []
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fake').pathname
    calls.push(path)
    if (state.up === false) return response.writeHead(503).end()
    if (path === '/v1/models') return response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}')
    if (path === '/is_sleeping') return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ is_sleeping: state.asleep }))
    if (path === '/sleep') { state.asleep = true; return response.writeHead(200).end() }
    response.writeHead(404).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  servers.push(server)
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  return { endpoint: { name: 'm', baseUrl, model: 'm', apiKey: 'local', execution: 'local-dgx-spark' as const }, state, calls }
}
const servers: Server[] = []
afterEach(() => { for (const server of servers.splice(0)) server.close(); docker.length = 0; onDocker = () => {} })

const room = (author: { baseUrl: string }, others: Array<{ baseUrl: string }>, records: unknown[] = []) => ({
  author: author as never, others: others as never[], log: () => {}, record: async (detail: unknown) => { records.push(detail) }, freeDiffusion: async () => {},
})

describe("writers' room", () => {
  it('is no room at all when the story is written on the planner', async () => {
    const planner = await fakeVllm({ asleep: false })
    expect(hasWritersRoom({ author: planner.endpoint, others: [planner.endpoint] })).toBe(false)
    await openWritersRoom(room(planner.endpoint, [planner.endpoint]))
    expect(planner.calls).toEqual([])
  })

  it('puts the other models to sleep and uses an awake author as it is', async () => {
    const author = await fakeVllm({ asleep: false })
    const planner = await fakeVllm({ asleep: false })
    const records: Array<Record<string, unknown>> = []
    await openWritersRoom(room(author.endpoint, [planner.endpoint], records))
    expect(planner.state.asleep).toBe(true)
    expect(docker).toEqual([])
    expect(records[0]).toMatchObject({ event: 'open', action: 'ready' })
  })

  it('restarts an author left asleep - its weights do not survive a reload - and starts one that is down', async () => {
    const asleep = await fakeVllm({ asleep: true })
    onDocker = () => { asleep.state.asleep = false }
    await openWritersRoom(room(asleep.endpoint, []))
    expect(docker).toEqual([['restart', 'cinefoundry-nemotron-super-1']])
    expect(asleep.calls).not.toContain('/wake_up')

    const down = await fakeVllm({ asleep: false, up: false })
    onDocker = () => { down.state.up = true }
    await openWritersRoom(room(down.endpoint, []))
    expect(docker.at(-1)).toEqual(['start', 'cinefoundry-nemotron-super-1'])
  })

  it('releases the author for the rest of the run: nothing can wake it into a reload', async () => {
    const author = await fakeVllm({ asleep: false })
    const planner = await fakeVllm({ asleep: false })
    await closeWritersRoom(room(author.endpoint, [planner.endpoint]))
    expect(author.state.asleep).toBe(true)
    await expect(ensureAwake(author.endpoint.baseUrl)).rejects.toThrow(/released for this run/)
  })
})
