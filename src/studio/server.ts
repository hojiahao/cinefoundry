import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runHarness } from '../agent/harness.js'
import { memoryStatus } from '../lib/memory.js'
import { loadProject, projectsRoot } from '../lib/project.js'

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4', '.md': 'text/markdown; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}

interface Job {
  brief: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'done' | 'failed'
  log: string[]
  projectId?: string
  error?: string
}

// One GPU, one film at a time: a second brief is refused while a job is running.
let job: Job | undefined

function startJob(input: { brief: string; ratio?: string; durationSeconds?: number; videoModel?: string }): Job {
  const current: Job = { brief: input.brief, startedAt: new Date().toISOString(), status: 'running', log: [] }
  job = current
  runHarness({
    brief: input.brief,
    ratio: input.ratio,
    durationSeconds: input.durationSeconds,
    videoModel: input.videoModel as never,
    log: (line) => current.log.push(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${line}`),
  })
    .then((result) => Object.assign(current, { status: 'done', projectId: result.projectId, finishedAt: new Date().toISOString() }))
    .catch((error: Error) => Object.assign(current, { status: 'failed', error: error.message, finishedAt: new Date().toISOString() }))
  return current
}

async function readJson(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
    if (chunks.reduce((size, part) => size + part.length, 0) > 64_000) throw new Error('request body too large')
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

/** Board over the projects folder: pipeline stages, assets, memory. The agent writes, the studio shows. */
export async function startStudio(port: number, host: string): Promise<void> {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://studio')
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      if (url.pathname === '/api/projects') {
        const ids = await readdir(projectsRoot()).catch(() => [])
        const states = await Promise.all(ids.map((id) => loadProject(id).catch(() => undefined)))
        return send(200, states.filter(Boolean).sort((a, b) => b!.updatedAt.localeCompare(a!.updatedAt)))
      }
      if (url.pathname === '/api/memory') return send(200, await memoryStatus())
      if (url.pathname === '/api/job' && request.method === 'GET') return send(200, job ?? null)
      if (url.pathname === '/api/harness' && request.method === 'POST') {
        // The studio binds to localhost; refuse cross-site form posts all the same.
        if (!(request.headers['content-type'] ?? '').includes('application/json')) return send(415, { error: 'send application/json' })
        // Optional shared secret so the studio can sit on a LAN / Tailscale address without letting anyone start GPU jobs.
        const token = process.env.SPOTFOUNDRY_STUDIO_TOKEN
        if (token && request.headers['x-spotfoundry-token'] !== token) return send(401, { error: '服务端设置了 SPOTFOUNDRY_STUDIO_TOKEN，请求需带 x-spotfoundry-token 头。' })
        if (job?.status === 'running') return send(409, { error: '已有一支片子在制作中，请等它完成。' })
        const body = await readJson(request)
        const brief = String(body.brief ?? '').trim()
        if (brief.length < 6 || brief.length > 600) return send(400, { error: '请用 6–600 个字描述你的创意。' })
        const duration = Number(body.durationSeconds)
        return send(202, startJob({
          brief,
          ratio: ['9:16', '16:9', '1:1'].includes(String(body.ratio)) ? String(body.ratio) : undefined,
          durationSeconds: [5, 10, 15, 20, 30].includes(duration) ? duration : undefined,
          videoModel: ['wan22-5b', 'wan22-14b', 'ltx25-fast', 'ltx25-fast-nvfp4', 'seedance'].includes(String(body.videoModel)) ? String(body.videoModel) : undefined,
        }))
      }

      const isFile = url.pathname.startsWith('/files/')
      const root = isFile ? projectsRoot() : PUBLIC_DIR
      const requested = isFile ? decodeURIComponent(url.pathname.slice('/files/'.length)) : url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const path = resolve(root, normalize(requested))
      if (path !== root && !path.startsWith(root + sep)) return send(403, { error: 'forbidden' })
      const info = await stat(path).catch(() => undefined)
      if (!info?.isFile()) return send(404, { error: 'not found' })
      response.writeHead(200, { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': info.size })
      createReadStream(path).pipe(response)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: (error as Error).message }))
    }
  })
  await new Promise<void>((done) => server.listen(port, host, done))
  console.log(`Spotfoundry studio: http://${host}:${port}`)
}

