import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline } from '../engine/run.js'
import { runLockHolder } from '../engine/lock.js'
import { FRAME_RATES, RATIOS } from '../lib/formats.js'
import { memoryStatus } from '../lib/memory.js'
import { projectsRoot } from '../lib/project.js'
import { PIPELINES, isFormat, type Format } from '../pipelines/index.js'
import type { AdOptions } from '../pipelines/ad/context.js'
import type { NarrativeOptions } from '../crafts/narrative/context.js'
import { FORMAT_NAMES, listProjects, projectDetail, stageLabels } from './projects.js'
import { env } from '../lib/config.js'

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jsonl': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.md': 'text/markdown; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.ass': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}

/** Options the studio form offers, per format: the same values the CLI accepts. */
export const STUDIO_OPTIONS = {
  ad: {
    ratio: RATIOS as readonly string[],
    durationSeconds: [5, 10, 15, 20, 25, 30],
    resolution: ['1080p', '2k', '4k', '6k'],
    fps: FRAME_RATES as readonly number[],
    videoModel: ['ltx25-fast-nvfp4', 'ltx25-fast', 'wan22-14b', 'wan22-5b', 'seedance'],
  },
  short: { episodeSeconds: { min: 10, max: 180, step: 5 }, ratio: RATIOS as readonly string[], fps: [30, 24, 60] },
  drama: { episodes: { min: 1, max: 30 }, episodeSeconds: { min: 10, max: 180, step: 5 } },
} as const

export type RunRequest = { format: 'ad'; options: AdOptions } | { format: 'short' | 'drama'; options: NarrativeOptions }

/** Starts a film. The studio's default runs the format's pipeline on the engine; tests pass their own. */
export type Starter = (request: RunRequest & { options: { log: (line: string) => void } }) => Promise<{ projectId: string }>

export const startPipeline: Starter = (request) =>
  request.format === 'ad' ? runPipeline(PIPELINES.ad, request.options)
    : request.format === 'short' ? runPipeline(PIPELINES.short, request.options)
    : runPipeline(PIPELINES.drama, request.options)

export interface Job {
  format: Format
  brief: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'done' | 'failed'
  log: string[]
  projectId?: string
  error?: string
}

/** Product photos posted by the form wait here (projects/.uploads/<random>.<ext>) until a run uses them. */
const uploadsDir = () => join(projectsRoot(), '.uploads')
const UPLOAD_ID = /^[a-f0-9]{24}\.(png|jpg|webp)$/
const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
}

class BadRequest extends Error {}

/** The run a form submission asks for, validated against the options above. Empty fields take the format's defaults. */
export async function parseRunRequest(body: Record<string, unknown>): Promise<RunRequest> {
  const format = String(body.format ?? 'ad')
  if (!isFormat(format)) throw new BadRequest('未知的片种。')
  const brief = String(body.brief ?? '').trim()
  if ([...brief].length < 6 || [...brief].length > 600) throw new BadRequest(format === 'ad' ? '请用 6–600 个字描述你的创意。' : '请用 6–600 个字讲出你的故事。')
  const given = (key: string) => body[key] !== undefined && body[key] !== null && body[key] !== ''
  const pick = <T extends string | number>(key: string, allowed: readonly T[], message: string): T | undefined => {
    if (!given(key)) return undefined
    const value = (typeof allowed[0] === 'number' ? Number(body[key]) : String(body[key])) as T
    if (!allowed.includes(value)) throw new BadRequest(message)
    return value
  }
  const range = (key: string, limits: { min: number; max: number; step?: number }, message: string): number | undefined => {
    if (!given(key)) return undefined
    const value = Number(body[key])
    if (!Number.isInteger(value) || value < limits.min || value > limits.max || (limits.step && value % limits.step !== 0)) throw new BadRequest(message)
    return value
  }
  if (format === 'ad') {
    const o = STUDIO_OPTIONS.ad
    let productImage: string | undefined
    if (given('productImage')) {
      const id = String(body.productImage)
      if (!UPLOAD_ID.test(id) || !(await stat(join(uploadsDir(), id)).then((info) => info.isFile(), () => false))) throw new BadRequest('产品照片已失效，请重新上传。')
      productImage = join(uploadsDir(), id)
    }
    const proof = given('proof') ? String(body.proof).trim() : ''
    if ([...proof].length > 1000) throw new BadRequest('可证实的事实请控制在 1000 字以内。')
    return {
      format,
      options: {
        brief,
        ratio: pick('ratio', o.ratio, '画幅只能是 16:9、9:16 或 1:1。'),
        durationSeconds: pick('durationSeconds', o.durationSeconds, '时长须为 5–30 秒、5 的倍数。'),
        resolution: pick('resolution', o.resolution, '分辨率只能是 1080p、2K、4K 或 6K。'),
        fps: pick('fps', o.fps, '帧率只能是 24、30、60 或 120。'),
        videoModel: pick('videoModel', o.videoModel, '未知的视频模型。') as AdOptions['videoModel'],
        ...(productImage ? { productImage } : {}),
        ...(proof ? { proof } : {}),
      },
    }
  }
  if (format === 'short') {
    const o = STUDIO_OPTIONS.short
    return {
      format,
      options: {
        brief,
        episodeSeconds: range('episodeSeconds', o.episodeSeconds, '时长须为 10–180 秒、5 的倍数。'),
        ratio: pick('ratio', o.ratio, '画幅只能是 9:16、16:9 或 1:1。'),
        fps: pick('fps', o.fps, '帧率只能是 24、30 或 60。'),
      },
    }
  }
  const o = STUDIO_OPTIONS.drama
  const episodes = range('episodes', o.episodes, '集数须为 1–30。')
  const produce = range('produce', { min: 1, max: episodes ?? 1 }, '本次制作的集数须在 1 到总集数之间。')
  return { format, options: { brief, episodes, produce, episodeSeconds: range('episodeSeconds', o.episodeSeconds, '单集时长须为 10–180 秒、5 的倍数。') } }
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > limit) throw new BadRequest(limit > 1e6 ? `文件不能超过 ${Math.round(limit / 1e6)} MB。` : '请求过大。')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

const timestamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

/**
 * The studio: a board over the projects folder (every format's stages and deliverables) and a form that starts a film.
 * One GPU, one film at a time: a run is refused while this studio's job runs or another process holds the run lock.
 */
export function createStudio(options: { start?: Starter } = {}): Server {
  const start = options.start ?? startPipeline
  let job: Job | undefined

  const startJob = (request: RunRequest): Job => {
    const current: Job = { format: request.format, brief: request.options.brief, startedAt: new Date().toISOString(), status: 'running', log: [] }
    job = current
    const log = (line: string) => { current.log.push(`${timestamp()}  ${line}`) }
    // A starter that throws synchronously must fail the job, not the request.
    Promise.resolve()
      .then(() => start({ ...request, options: { ...request.options, log } } as Parameters<Starter>[0]))
      .then((result) => Object.assign(current, { status: 'done', projectId: result.projectId, finishedAt: new Date().toISOString() }))
      .catch((error: Error) => Object.assign(current, { status: 'failed', error: error?.message ?? String(error), finishedAt: new Date().toISOString() }))
    return current
  }

  return createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    try {
      const url = new URL(request.url ?? '/', 'http://studio')
      const path = url.pathname

      if (path === '/api/formats' && request.method === 'GET') {
        return send(200, (Object.keys(PIPELINES) as Format[]).map((id) => ({ id, name: FORMAT_NAMES[id], title: PIPELINES[id].title, stages: stageLabels(id), options: STUDIO_OPTIONS[id] })))
      }
      if (path === '/api/projects' && request.method === 'GET') return send(200, await listProjects())
      const one = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,63})$/.exec(path)
      if (one && request.method === 'GET') {
        const detail = await projectDetail(one[1]!)
        return detail ? send(200, detail) : send(404, { error: '没有这个项目。' })
      }
      if (path === '/api/memory' && request.method === 'GET') return send(200, await memoryStatus())
      if (path === '/api/job' && request.method === 'GET') return send(200, job ?? null)

      const isRun = (path === '/api/run' || path === '/api/harness') && request.method === 'POST'
      const isUpload = path === '/api/upload' && request.method === 'POST'
      if (isRun || isUpload) {
        // Optional shared secret so the studio can sit on a LAN / Tailscale address without letting anyone start GPU jobs.
        const token = env('CINEFOUNDRY_STUDIO_TOKEN')
        if (token && request.headers['x-cinefoundry-token'] !== token) return send(401, { error: '服务端设置了 CINEFOUNDRY_STUDIO_TOKEN，请求需带 x-cinefoundry-token 头。' })
        const type = String(request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
        if (isUpload) {
          // Image content types are not "simple": a cross-site page cannot post one without a CORS preflight.
          const image = IMAGE_TYPES[type]
          if (!image) return send(415, { error: '请上传 PNG、JPEG 或 WebP 图片。' })
          const data = await readBody(request, 20e6)
          if (!image.magic(data)) return send(400, { error: '文件内容不是有效的图片。' })
          const id = `${randomBytes(12).toString('hex')}.${image.ext}`
          await mkdir(uploadsDir(), { recursive: true })
          await writeFile(join(uploadsDir(), id), data)
          return send(201, { id, bytes: data.length })
        }
        // The studio binds to localhost; refuse cross-site form posts all the same.
        if (type !== 'application/json') return send(415, { error: 'send application/json' })
        const body = JSON.parse((await readBody(request, 64_000)).toString('utf8') || '{}') as Record<string, unknown>
        // The old endpoint is the ad film's: scripts post a bare brief to it.
        const run = await parseRunRequest(path === '/api/harness' ? { ...body, format: 'ad' } : body)
        if (job?.status === 'running') return send(409, { error: '已有一支片子在制作中，请等它完成。' })
        const holder = await runLockHolder()
        if (holder) return send(409, { error: `另一支片子正在 GPU 上制作（进程 ${holder.pid}，${new Date(holder.startedAt).toLocaleString('zh-CN', { hour12: false })} 开始），请等它完成。` })
        return send(202, startJob(run))
      }
      if (path.startsWith('/api/')) return send(404, { error: 'not found' })
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, { error: 'method not allowed' })

      const isFile = path.startsWith('/files/')
      const root = isFile ? projectsRoot() : PUBLIC_DIR
      const requested = isFile ? decodeURIComponent(path.slice('/files/'.length)) : path === '/' ? 'index.html' : decodeURIComponent(path.slice(1))
      const target = resolve(root, normalize(requested))
      if (target !== root && !target.startsWith(root + sep)) return send(403, { error: 'forbidden' })
      const info = await stat(target).catch(() => undefined)
      if (!info?.isFile()) return send(404, { error: 'not found' })
      const contentType = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream'
      // Players seek, so video and audio answer byte ranges.
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ''))
      if (range && (range[1] || range[2])) {
        const startByte = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
        const endByte = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
        if (startByte > endByte || startByte >= info.size) {
          response.writeHead(416, { 'content-range': `bytes */${info.size}` })
          return response.end()
        }
        response.writeHead(206, { 'content-type': contentType, 'content-length': endByte - startByte + 1, 'content-range': `bytes ${startByte}-${endByte}/${info.size}`, 'accept-ranges': 'bytes' })
        if (request.method === 'HEAD') return response.end()
        return createReadStream(target, { start: startByte, end: endByte }).pipe(response)
      }
      response.writeHead(200, { 'content-type': contentType, 'content-length': info.size, 'accept-ranges': 'bytes', ...(isFile ? {} : { 'cache-control': 'no-cache' }) })
      if (request.method === 'HEAD') return response.end()
      createReadStream(target).pipe(response)
    } catch (error) {
      if (response.headersSent) return response.destroy()
      if (error instanceof BadRequest || error instanceof SyntaxError) return send(400, { error: error instanceof SyntaxError ? '请求不是有效的 JSON。' : error.message })
      send(500, { error: (error as Error).message })
    }
  })
}

export async function startStudio(port: number, host: string): Promise<void> {
  const server = createStudio()
  await new Promise<void>((done) => server.listen(port, host, done))
  console.log(`Cinefoundry studio: http://${host}:${port}`)
}
