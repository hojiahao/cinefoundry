import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createStudio, type Job, type RunRequest, type Starter } from '../src/studio/server.js'
import { stageLabels } from '../src/studio/projects.js'
import { writeStudioFixtures } from './studio-fixtures.js'

/**
 * The studio's routes over fixture projects of every format: the board, each format's project page, starting a film
 * of each format (the engine is replaced by a recording starter: no GPU, no models), one film at a time, uploads and
 * the file server.
 */

const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-studio-'))
const previous = process.env.CINEFOUNDRY_PROJECTS
let server: Server
let base = ''
const started: RunRequest[] = []
let release: (() => void) | undefined
let failNext: string | undefined

const starter: Starter = (request) => {
  started.push(request)
  request.options.log('▸ brief        mocked')
  if (failNext) {
    const message = failNext
    failNext = undefined
    return Promise.reject(new Error(message))
  }
  return new Promise((done) => { release = () => done({ projectId: `${request.format}-made` }) })
}

const get = async (path: string, headers: Record<string, string> = {}) => {
  const response = await fetch(base + path, { headers })
  return { status: response.status, type: response.headers.get('content-type') ?? '', body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text(), headers: response.headers }
}
const post = async (path: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) => {
  const response = await fetch(base + path, { method: 'POST', headers, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
const waitForJob = async (status: Job['status']) => {
  for (let i = 0; i < 100; i++) {
    const { body } = await get('/api/job')
    if (body?.status === status) return body as Job
    await new Promise((done) => setTimeout(done, 10))
  }
  throw new Error(`job never reached ${status}`)
}
/** Lets the mocked film finish so the next test may start one. */
const finishRunning = async () => {
  if (!release) return
  release()
  release = undefined
  await waitForJob('done')
}

beforeAll(async () => {
  process.env.CINEFOUNDRY_PROJECTS = projects
  await writeStudioFixtures(projects)
  server = createStudio({ start: starter })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await finishRunning()
  await new Promise((done) => server.close(done))
  if (previous === undefined) delete process.env.CINEFOUNDRY_PROJECTS
  else process.env.CINEFOUNDRY_PROJECTS = previous
  await rm(projects, { recursive: true, force: true })
})

describe('stage labels come from the pipelines', () => {
  it('every stage of every format has its Chinese label', async () => {
    const { body } = await get('/api/formats')
    const labels = Object.fromEntries((body as Array<{ id: string; name: string; stages: Array<{ label: string }> }>).map((f) => [f.id, f.stages.map((s) => s.label).join(' ')]))
    expect(labels).toEqual({
      ad: '需求 创意 脚本 合规 分镜 生图 质检 生视频 成片 版本 技术质检',
      short: '选题 剧本 合规 分镜 选角定妆 生图质检 对白 生视频 声音 成片 平台包装',
      drama: '剧本开发 剧本 合规 分镜 选角定妆 生图质检 对白 生视频 声音 成片',
    })
    expect((body as Array<{ name: string }>).map((f) => f.name)).toEqual(['广告片', '短视频', '微短剧'])
    expect(stageLabels('ad').map((s) => s.id)).toContain('qa')
  })
})

describe('board', () => {
  it('lists every project with its format, its own stage list and labels, newest first', async () => {
    const { status, body } = await get('/api/projects')
    expect(status).toBe(200)
    const byId = Object.fromEntries((body as Array<{ id: string }>).map((p) => [p.id, p])) as Record<string, { format: string; formatName: string; status: string; cover?: string; film?: string; stages: Array<{ id: string; label: string; status: string }> }>
    expect(Object.keys(byId).sort()).toEqual(['barista-pour-over', 'leng-soda-30s', 'scent-contract', 'summer-soda'])
    expect((body as Array<{ id: string }>)[0]!.id).toBe('barista-pour-over')
    expect(byId['leng-soda-30s']).toMatchObject({ format: 'ad', formatName: '广告片', status: 'done', cover: 'frames/shot_001.png', film: 'cut/final.mp4' })
    expect(byId['leng-soda-30s']!.stages.map((s) => s.label)).toEqual(['需求', '创意', '脚本', '合规', '分镜', '生图', '质检', '生视频', '成片', '版本', '技术质检'])
    expect(byId['barista-pour-over']).toMatchObject({ format: 'short', formatName: '短视频', status: 'done', cover: 'cut/cover.jpg', film: 'cut/ep01.mp4' })
    expect(byId['barista-pour-over']!.stages.at(0)!.label).toBe('选题')
    expect(byId['barista-pour-over']!.stages.at(-1)!.label).toBe('平台包装')
    expect(byId['scent-contract']).toMatchObject({ format: 'drama', formatName: '微短剧', status: 'running', cover: 'frames/ep01_shot_001.png' })
    expect(byId['scent-contract']!.stages.find((s) => s.id === 'development')!.label).toBe('剧本开发')
    expect(byId['scent-contract']!.stages.find((s) => s.id === 'clips')!.status).toBe('running')
  })

  it('shows a project made before formats existed as an ad, with the stages it recorded', async () => {
    const { body } = await get('/api/projects')
    const legacy = (body as Array<{ id: string; format: string; stages: Array<{ id: string; label: string }> }>).find((p) => p.id === 'summer-soda')!
    expect(legacy.format).toBe('ad')
    expect(legacy.stages.map((s) => s.label)).toEqual(['需求', '脚本', '合规', '分镜', '生图', '质检', '生视频', '成片'])
  })

  it('skips folders that are not projects', async () => {
    await writeFile(join(projects, '.harness.lock.bak'), '{}')
    const { body } = await get('/api/projects')
    expect((body as unknown[]).length).toBe(4)
  })
})

describe('project pages', () => {
  it('ad: master and both cutdowns with QC, frames per shot, brief, treatment and hero', async () => {
    const { status, body } = await get('/api/projects/leng-soda-30s')
    expect(status).toBe(200)
    expect(body.detail.format).toBe('ad')
    expect(body.detail.deliverables.map((d: { id: string; label: string; path: string; qc?: { verdict: string } }) => [d.id, d.label, d.path, d.qc?.verdict])).toEqual([
      ['master', '主片', 'cut/final.mp4', 'pass'], ['15s', '15 秒版', 'cut/final_15s.mp4', 'pass-with-warnings'], ['06s', '6 秒版', 'cut/final_06s.mp4', 'pass'],
    ])
    expect(body.detail.deliverables[0].qc).toMatchObject({ width: 1920, height: 1080, fps: 60, seconds: 31.2, loudness: -16.1 })
    expect(body.detail.shots).toHaveLength(6)
    expect(body.detail.shots[3]).toMatchObject({ shot: 4, framing: 'wide', frame: 'frames/shot_004.png', clip: 'clips/shot_004.mp4', onScreenText: '一口安静', voiceover: '第 4 句旁白', gate: 'gate 71 (kept after failed gate)' })
    expect(body.detail.hero).toMatchObject({ path: 'refs/product.png', gate: 'gate 92' })
    expect(body.detail.brief).toMatchObject({ product: '无糖气泡水“冷”', audience: '大学生', message: '夏日清爽' })
    expect(body.detail.treatment.proposition).toBe('一口下去，整个夏天安静了')
    expect(body.qc.map((r: { label: string }) => r.label)).toEqual(['master', '15s', '06s'])
    expect(body.links.map((l: { label: string }) => l.label)).toEqual(['交付报告', '创意', '脚本', '分镜', '技术质检', '运行记录'])
  })

  it('short: the episode with its player, shots with dialogue, cast, and the packaging', async () => {
    const { body } = await get('/api/projects/barista-pour-over')
    expect(body.detail.format).toBe('short')
    expect(body.detail.packaging).toMatchObject({ titles: ['咖啡师一分钟讲透手冲', '手冲和美式，差的不只是价格', 'Pour-over vs Americano in 60s'], cover: { shot: 1, text: '手冲 vs 美式' }, hashtags: ['#咖啡', '#手冲咖啡', '#涨知识'], coverImage: 'cut/cover.jpg' })
    expect(body.detail.packaging.description).toContain('AI')
    const episode = body.detail.episodes[0]
    expect(episode).toMatchObject({ episode: 1, title: '手冲还是美式', cut: 'cut/ep01.mp4', scenes: 2, lines: 6 })
    expect(episode.qc).toMatchObject({ label: 'ep01', verdict: 'pass', fps: 30 })
    expect(episode.shots[1]).toMatchObject({ shot: 2, frame: 'frames/ep01_shot_002.png', clip: 'clips/ep01_shot_002.mp4', line: { speaker: 'An Ran / 安然', zh: '这店是外婆的记忆' } })
    expect(body.detail.cast).toEqual([expect.objectContaining({ id: 'barista-an', portrait: 'cast/barista-an/master.png', voice: 'en-f-bright-02', gate: 88 })])
    expect(body.links.map((l: { label: string }) => l.label)).toContain('平台包装')
  })

  it('drama: the bible, the cast with portraits and voice ids, made and planned episodes', async () => {
    const { body } = await get('/api/projects/scent-contract')
    expect(body.detail.format).toBe('drama')
    expect(body.detail.bible.logline).toContain('老香水店')
    expect(body.detail.cast.map((c: { name: string; portrait?: string; voice?: string; role: string }) => [c.name, c.portrait, c.voice, c.role])).toEqual([
      ['Lin Xia / 林夏', 'cast/lin-xia/master.png', 'en-f-warm-01', 'lead'], ['Gu Yan / 顾言', 'cast/gu-yan/master.png', 'designed', 'love interest'],
    ])
    expect(body.detail.episodes.map((e: { episode: number; title: string; shots: unknown[] }) => [e.episode, e.title, e.shots.length])).toEqual([[1, '签约', 12], [2, '对立', 0], [3, '动心', 0]])
    const first = body.detail.episodes[0]
    expect(first.cut).toBeUndefined()
    expect(first.qc).toBeUndefined()
    expect(first.hook).toContain('雨夜')
    // The frame the gate kept is the asset's, not the default file name.
    expect(first.shots[4]).toMatchObject({ shot: 5, frame: 'frames/ep01_shot_005_r1.png', gate: 'gate 74 (kept after failed gate)' })
    expect(first.shots[4].clip).toBeUndefined()
    expect(first.shots[3].clip).toBe('clips/ep01_shot_004.mp4')
    expect(first.shots[3].line).toMatchObject({ speaker: 'Gu Yan / 顾言', zh: '三个月，就三个月' })
    expect(body.detail.packaging).toBeUndefined()
    expect(body.qc).toEqual([])
  })

  it('a project of the old format still has a page', async () => {
    const { status, body } = await get('/api/projects/summer-soda')
    expect(status).toBe(200)
    expect(body.format).toBe('ad')
    expect(body.detail.deliverables).toEqual([expect.objectContaining({ id: 'master', path: 'cut/final.mp4' })])
    expect(body.detail.shots).toEqual([expect.objectContaining({ shot: 1, frame: 'frames/shot_001.png', clip: 'clips/shot_001.mp4' })])
    expect(body.detail.hero).toBeUndefined()
  })

  it('answers 404 for a project that does not exist or an invalid id', async () => {
    expect((await get('/api/projects/no-such-film')).status).toBe(404)
    expect((await get('/api/projects/..%2Fetc')).status).toBe(404)
  })
})

describe('starting a film', () => {
  afterEach(finishRunning)

  it('ad: runs the ad pipeline with the form options', async () => {
    const { status, body } = await post('/api/run', { format: 'ad', brief: '给一款叫“冷”的无糖气泡水做一支广告', ratio: '16:9', durationSeconds: '30', resolution: '4k', fps: '60', videoModel: 'wan22-14b', proof: '每罐 0 糖 0 卡（配料表）' })
    expect(status).toBe(202)
    expect(body).toMatchObject({ format: 'ad', status: 'running' })
    expect(started.at(-1)).toMatchObject({ format: 'ad', options: { brief: '给一款叫“冷”的无糖气泡水做一支广告', ratio: '16:9', durationSeconds: 30, resolution: '4k', fps: 60, videoModel: 'wan22-14b', proof: '每罐 0 糖 0 卡（配料表）' } })
    const job = await waitForJob('running')
    expect(job.log.at(-1)).toContain('▸ brief')
  })

  it('short: runs the short pipeline with seconds, ratio and fps', async () => {
    expect((await post('/api/run', { format: 'short', brief: '一位咖啡师用一分钟讲清手冲和美式的区别', episodeSeconds: '60', ratio: '9:16', fps: '30' })).status).toBe(202)
    expect(started.at(-1)).toEqual({ format: 'short', options: { brief: '一位咖啡师用一分钟讲清手冲和美式的区别', episodeSeconds: 60, ratio: '9:16', fps: 30, log: expect.any(Function) } })
  })

  it('drama: runs the drama pipeline with episodes, produce and seconds', async () => {
    expect((await post('/api/run', { format: 'drama', brief: '年轻调香师和地产继承人签下三个月的假恋爱协议', episodes: '10', produce: '2', episodeSeconds: '120' })).status).toBe(202)
    expect(started.at(-1)).toEqual({ format: 'drama', options: { brief: '年轻调香师和地产继承人签下三个月的假恋爱协议', episodes: 10, produce: 2, episodeSeconds: 120, log: expect.any(Function) } })
    await finishRunning()
    expect((await get('/api/job')).body).toMatchObject({ status: 'done', projectId: 'drama-made', format: 'drama' })
  })

  it('empty fields take the format defaults; the old endpoint starts an ad', async () => {
    expect((await post('/api/harness', { brief: '给一款冷萃咖啡做一支广告', ratio: '' })).status).toBe(202)
    expect(started.at(-1)).toMatchObject({ format: 'ad', options: { brief: '给一款冷萃咖啡做一支广告', ratio: undefined, durationSeconds: undefined } })
  })

  it('one film at a time: a second run is refused while one is in progress', async () => {
    expect((await post('/api/run', { format: 'short', brief: '一位咖啡师讲清手冲和美式' })).status).toBe(202)
    const second = await post('/api/run', { format: 'drama', brief: '另一个故事，另一个前提' })
    expect(second.status).toBe(409)
    expect(second.body.error).toContain('制作中')
  })

  it('refuses while another process holds the run lock', async () => {
    await writeFile(join(projects, '.harness.lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), brief: 'cli run' }))
    try {
      const { status, body } = await post('/api/run', { format: 'ad', brief: '给一款冷萃咖啡做一支广告' })
      expect(status).toBe(409)
      expect(body.error).toContain(String(process.pid))
    } finally {
      await rm(join(projects, '.harness.lock'), { force: true })
    }
  })

  it('a failed run is reported on the job', async () => {
    failNext = 'Cannot start: --seconds 7'
    expect((await post('/api/run', { format: 'short', brief: '一位咖啡师讲清手冲和美式' })).status).toBe(202)
    expect(await waitForJob('failed')).toMatchObject({ error: 'Cannot start: --seconds 7' })
  })

  it('validates every option against its format', async () => {
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ format: 'ad', brief: '短' }, '6–600'],
      [{ format: 'opera', brief: '一部六幕的歌剧' }, '片种'],
      [{ format: 'ad', brief: '给冷萃咖啡做广告', durationSeconds: 12 }, '时长'],
      [{ format: 'ad', brief: '给冷萃咖啡做广告', fps: 50 }, '帧率'],
      [{ format: 'ad', brief: '给冷萃咖啡做广告', videoModel: 'sora' }, '视频模型'],
      [{ format: 'ad', brief: '给冷萃咖啡做广告', productImage: '../../etc/passwd' }, '产品照片'],
      [{ format: 'short', brief: '咖啡师讲手冲和美式', episodeSeconds: 7 }, '时长'],
      [{ format: 'short', brief: '咖啡师讲手冲和美式', episodeSeconds: 600 }, '时长'],
      [{ format: 'drama', brief: '调香师和继承人的假恋爱', episodes: 31 }, '集数'],
      [{ format: 'drama', brief: '调香师和继承人的假恋爱', episodes: 3, produce: 4 }, '本次制作'],
    ]
    for (const [body, message] of bad) {
      const response = await post('/api/run', body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.body.error).toContain(message)
    }
    expect((await post('/api/run', 'brief=x', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415)
    expect(started.length).toBeGreaterThan(0)
  })

  it('a product photo is uploaded once and handed to the ad run', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    const uploaded = await post('/api/upload', png, { 'content-type': 'image/png' })
    expect(uploaded.status).toBe(201)
    expect(uploaded.body.id).toMatch(/^[a-f0-9]{24}\.png$/)
    expect((await post('/api/upload', Buffer.from('not an image'), { 'content-type': 'image/png' })).status).toBe(400)
    expect((await post('/api/upload', png, { 'content-type': 'application/pdf' })).status).toBe(415)
    expect((await post('/api/run', { format: 'ad', brief: '给这款保温杯做一支广告', productImage: uploaded.body.id })).status).toBe(202)
    expect(started.at(-1)!.options).toMatchObject({ productImage: join(projects, '.uploads', uploaded.body.id) })
  })

  it('with a studio token set, starting a film needs it', async () => {
    process.env.CINEFOUNDRY_STUDIO_TOKEN = 'secret'
    try {
      expect((await post('/api/run', { format: 'ad', brief: '给冷萃咖啡做一支广告' })).status).toBe(401)
      expect((await post('/api/upload', Buffer.from('x'), { 'content-type': 'image/png' })).status).toBe(401)
      expect((await post('/api/run', { format: 'ad', brief: '给冷萃咖啡做一支广告' }, { 'content-type': 'application/json', 'x-cinefoundry-token': 'secret' })).status).toBe(202)
    } finally {
      delete process.env.CINEFOUNDRY_STUDIO_TOKEN
    }
  })
})

describe('files', () => {
  it('serves the page, project files with byte ranges, and nothing outside the projects folder', async () => {
    const page = await get('/')
    expect(page.status).toBe(200)
    expect(page.body).toContain('Cinefoundry')
    const frame = await get('/files/leng-soda-30s/frames/shot_001.png')
    expect(frame.status).toBe(200)
    expect(frame.type).toBe('image/png')
    const ranged = await fetch(`${base}/files/leng-soda-30s/cut/final.mp4`, { headers: { range: 'bytes=0-3' } })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-3\/\d+$/)
    expect((await ranged.arrayBuffer()).byteLength).toBe(4)
    expect((await get('/files/..%2F..%2Fetc%2Fpasswd')).status).toBe(403)
    expect((await get('/files/leng-soda-30s/missing.mp4')).status).toBe(404)
    expect((await get('/api/nothing')).status).toBe(404)
  })
})
