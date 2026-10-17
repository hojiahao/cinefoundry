import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseArgs } from '../src/lib/args.js'
import { revisionRequest } from '../src/commands/index.js'
import { runRevision, RevisionRefused, versionedName, type RevisionRecord, type RevisionRequest } from '../src/engine/revise.js'
import { REVISIONS } from '../src/pipelines/index.js'
import { startFakeComfy } from './fake-comfy.js'
import { changedFiles, installFakeDocker, installVoiceLibrary, narrativeFixture, snapshot } from './fixtures.js'

/**
 * Revisions on finished projects, against the scripted model server and the fake ComfyUI of the harness test and a fake
 * `docker` for the voice containers; ffmpeg is real. The ad is produced end to end by the ad pipeline (a voiced 30 s
 * master with its 15 s and 6 s cutdowns); the micro-drama episode is built on disk and cut by the pipeline's cutEpisode.
 * Each revision is checked for what it must change, what it must leave byte for byte, the lock, and its records.
 */

const STYLE = 'warm backlit morning light, deep brown and cream, fine film grain'
const BEATS = ['Ice cracks and the morning slows right down.', 'Steeped cold for twelve quiet hours, nothing rushed.', 'A slow pour, and the room goes quiet.', 'Every note of the bean still in the glass.', 'Cold, smooth, and made for slow mornings.', 'Shidou cold brew. One slow sip at a time.']
const replies = {
  brief: { id: 'model-chose-this', title: '拾豆·冷萃咖啡', product: 'cold brew coffee in a can', category: 'food', audience: '城市上班族', message: '一口慢下来', ratio: '16:9', durationSeconds: 30, tone: 'warm, cinematic', brandText: '拾豆', industry: 'drink' },
  treatment: {
    insight: '忙碌的人想要片刻安静', proposition: '一口醇香', concept: '喧闹中打开罐子，世界安静下来', brandVoice: 'restrained and premium',
    visual: { concept: 'a cold can of coffee glowing in a dark quiet room', light: 'night, warm backlight from behind, soft fill', palette: ['deep brown', 'silver', 'cream'], texture: 'condensation, brushed metal' },
    rhythm: 'quiet hook, build, hero', sound: { voice: 'test-announcer', voiceDirection: 'unhurried and warm', music: 'sparse piano, slow, resolves softly', ambience: 'a quiet room at night' },
  },
  script: { structure: 'sensory -> proof -> hero', beats: BEATS.map((vo, i) => ({ beat: i + 1, job: i === 0 ? 'hook' : i === 5 ? 'hero' : 'build', see: `moment ${i + 1}`, vo, zh: ['冰块轻响 清晨慢下来', '冷萃十二小时', '慢慢倒 屋里安静了', '豆香都在杯里', '冰凉顺滑 慢慢来', '拾豆冷萃 慢慢喝'][i]!, text: ['慢下来', '冷萃', '慢倒', '豆香', '顺滑', '拾豆'][i]! })) },
  storyboard: {
    style: STYLE, product: 'a slim silver aluminium can with a dark brown band that reads "拾豆"',
    shots: [1, 2, 3, 4, 5, 6].map((shot) => ({ shot, seconds: 5, framing: ['macro', 'medium', 'wide', 'close-up', 'medium', 'macro'][shot - 1]!, camera: ['slow push-in', 'orbit', 'pull-back', 'tilt', 'dolly', 'static'][shot - 1]!, image_prompt: `Shot ${shot}: the product on crushed ice, backlit mist`, video_prompt: 'Mist drifts. No people and no hands enter the frame.', on_screen_text: '', must_show: `the can upright with its label readable, moment ${shot}` })),
  },
  plan15: { version: '15s', target_seconds: 15, shots: [{ shot: 1, seconds: 4, why: 'hook' }, { shot: 3, seconds: 4, why: 'proof' }, { shot: 6, seconds: 4.5, why: 'product hero' }], script: { structure: 'hook -> proof -> hero', beats: [
    { beat: 1, job: 'hook', see: 'ice', vo: 'Ice cracks and the morning slows down.', zh: '冰块轻响 清晨慢下来', text: '慢下来' },
    { beat: 2, job: 'proof', see: 'the pour', vo: 'Steeped cold for twelve quiet hours.', zh: '冷萃十二小时', text: '冷萃' },
    { beat: 3, job: 'hero', see: 'the can', vo: 'Shidou cold brew, one slow sip at a time.', zh: '拾豆冷萃 慢慢喝', text: '拾豆' },
  ] } },
  plan06: { version: '06s', target_seconds: 6, shots: [{ shot: 6, seconds: 3.5, why: 'hero: the proposition in one image' }], script: { structure: 'hero', beats: [{ beat: 1, job: 'hero', see: 'the can', vo: 'Cold brew, slowed right down.', zh: '冷萃 慢慢来', text: '拾豆' }] } },
}
const REVISED_PROMPT = 'Shot 2: the product on crushed ice at golden hour, low warm sun raking across the mist'

let llm: Server
let comfy: Awaited<ReturnType<typeof startFakeComfy>>
const calls: Array<{ role: string; user: string }> = []
/** The lock file as seen when the storyboard artist was asked to apply a note: the revision must hold it. */
let lockDuringRevision = ''
const root = mkdtempSync(join(tmpdir(), 'cinefoundry-revise-'))
const dockerLog = join(root, 'docker.jsonl')
const dockerCalls = () => (existsSync(dockerLog) ? readFileSync(dockerLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { script: string; jobs: any }) : [])

beforeAll(async () => {
  Object.assign(process.env, {
    CINEFOUNDRY_PROJECTS: join(root, 'projects'), CINEFOUNDRY_STEP_AUDIO_DIR: join(root, 'audio-work'), CINEFOUNDRY_VOICE_LIBRARY: join(root, 'voices.json'),
    CINEFOUNDRY_RELEASE_CACHE: '0', PATH: `${join(root, 'bin')}:${process.env.PATH}`,
  })
  delete process.env.STEPFUN_API_KEY
  delete process.env.TYPESAFE_API_KEY
  installFakeDocker(join(root, 'bin'), dockerLog)
  comfy = await startFakeComfy()
  llm = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      if (!request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return }
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const system: string = body.messages[0].content
      const role = /^You are the (.+?) of Cinefoundry/.exec(system)?.[1] ?? ''
      const user = body.messages[1].content
      const text = typeof user === 'string' ? user : JSON.stringify(user)
      calls.push({ role, user: text })
      let reply: unknown
      if (Array.isArray(user)) reply = { pass: true, score: 92, craft: { light: 8, composition: 8, realism: 8 }, issues: [] }
      else if (role.startsWith('intake producer')) reply = replies.brief
      else if (role.startsWith('creative director')) reply = replies.treatment
      else if (role.startsWith('copywriter')) reply = replies.script
      else if (role.startsWith('compliance reviewer')) reply = { approve: true, issues: [] }
      else if (role.startsWith('versioning editor')) reply = text.includes('Cut the 15-second version') ? replies.plan15 : replies.plan06
      else if (text.includes('The client asked for a change to shot')) {
        lockDuringRevision = readFileSync(join(root, 'projects', '.harness.lock'), 'utf8')
        reply = { change: 'golden-hour light instead of night', image_prompt: text.includes('perfume') ? 'a man in a navy coat in the doorway of a small perfume shop, warm golden-hour sun behind him' : REVISED_PROMPT }
      } else if (role.startsWith('storyboard')) reply = replies.storyboard
      else reply = {}
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { completion_tokens: 10 } }))
    })
  })
  await new Promise<void>((done) => llm.listen(0, '127.0.0.1', done))
  const llmUrl = `http://127.0.0.1:${(llm.address() as { port: number }).port}/v1`
  Object.assign(process.env, { COMFYUI_URL: comfy.url, CINEFOUNDRY_PLANNER_URL: llmUrl, CINEFOUNDRY_VISION_URL: llmUrl, CINEFOUNDRY_EDITOR_URL: llmUrl })
}, 60_000)
afterAll(() => { llm?.close(); comfy?.close() })

const revisions = (dir: string) => JSON.parse(readFileSync(join(dir, 'reports', 'revisions.json'), 'utf8')) as RevisionRecord[]
const runRows = (dir: string) => readFileSync(join(dir, 'reports', 'run.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, any>)
const state = (dir: string) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
const revise = (id: string, request: RevisionRequest) => runRevision(REVISIONS[state(join(root, 'projects', id)).format as 'ad'], { id, request, log: () => undefined })

describe('revision requests from the command line', () => {
  it('takes exactly one of --shot, --line, --grade, --music', () => {
    expect(revisionRequest(parseArgs(['p', '--shot', '3', '--note', 'make it warmer']))).toEqual({ kind: 'shot', shot: 3, note: 'make it warmer' })
    expect(revisionRequest(parseArgs(['p', '--line', '2.1', '--text', 'Hello there.', '--zh', '你好', '--episode', '2']))).toEqual({ kind: 'line', line: '2.1', text: 'Hello there.', zh: '你好', episode: 2 })
    expect(revisionRequest(parseArgs(['p', '--grade', 'warmer']))).toEqual({ kind: 'grade', grade: 'warmer' })
    expect(() => revisionRequest(parseArgs(['p', '--shot', '2', '--grade', 'warmer']))).toThrow(/one revision at a time/)
    expect(() => revisionRequest(parseArgs(['p']))).toThrow(/say what to revise/)
    expect(() => revisionRequest(parseArgs(['p', '--line', '2']))).toThrow(/--text/)
    expect(versionedName('/p/clips/shot_003.hfr.mp4', 2)).toBe('/p/clips/shot_003.hfr.v2.mp4')
  })
})

describe('revising a finished ad', () => {
  const id = 'revise-ad'
  const dir = join(root, 'projects', id)

  beforeAll(async () => {
    await installVoiceLibrary(process.env.CINEFOUNDRY_VOICE_LIBRARY!, [{ id: 'test-announcer', gender: 'male', age: 40, uses: ['announcer'] }])
    const { runHarness } = await import('../src/agent/harness.js')
    const result = await runHarness({ brief: '给“拾豆”冷萃咖啡做一条 30 秒横版广告', id, durationSeconds: 30, ratio: '16:9', candidates: 1, resolution: '720p', fps: 24, log: () => undefined })
    expect(Object.keys(result.versions)).toEqual(['15s', '06s'])
  }, 300_000)

  it('refuses to start while another film holds the lock, and records nothing', async () => {
    const lock = join(root, 'projects', '.harness.lock')
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString(), brief: 'another film' }))
    try {
      await expect(revise(id, { kind: 'grade', grade: 'warmer' })).rejects.toThrow(/Another film is generating/)
    } finally { rmSync(lock, { force: true }) }
    expect(existsSync(join(dir, 'reports', 'revisions.json'))).toBe(false)
  })

  it('redoes a shot with the client\'s note: only that shot and the master change, under the lock, recorded as a revision', async () => {
    const before = snapshot(dir)
    const voicesBefore = dockerCalls().length
    const record = await revise(id, { kind: 'shot', shot: 2, note: 'make the light warmer, golden hour' })
    const { changed, added } = changedFiles(before, snapshot(dir))
    // The new frame, the clip, the master and the storyboard that now carries the note; the replaced files kept as versions.
    expect(changed).toEqual(expect.arrayContaining(['clips/shot_002.mp4', 'cut/final.mp4', 'storyboard/storyboard.json']))
    expect(changed.filter((path) => !['clips/shot_002.mp4', 'cut/final.mp4', 'storyboard/storyboard.json', 'state.json', 'audio/soundtrack.wav'].includes(path))).toEqual([])
    // The gate's review copy of the new frame sits beside it.
    expect(added.filter((path) => !/\.v1\./.test(path) && !path.endsWith('.review.jpg'))).toEqual(['frames/shot_002.rev1.png'])
    expect(added).toEqual(expect.arrayContaining(['clips/shot_002.v1.mp4', 'cut/final.v1.mp4', 'storyboard/storyboard.v1.json']))
    // Nothing that does not depend on shot 2 was touched: no cutdown uses it, no line was re-voiced.
    for (const path of ['cut/final_15s.mp4', 'cut/final_06s.mp4', 'clips/shot_001.mp4', 'clips/shot_003.mp4', 'clips/endcard.mp4', 'audio/vo_1.wav', 'audio/vo_2.wav', 'audio/music.mp3', 'refs/product.png']) expect(changed).not.toContain(path)
    expect(dockerCalls().length).toBe(voicesBefore)
    // The storyboard artist applied the note while the revision held the lock; the lock is released after.
    expect(JSON.parse(lockDuringRevision).brief).toBe(`revise ${id}: redo shot 2: make the light warmer, golden hour`)
    expect(existsSync(join(root, 'projects', '.harness.lock'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'storyboard', 'storyboard.json'), 'utf8')).shots[1].image_prompt).toBe(REVISED_PROMPT)
    expect(state(dir).assets.find((a: any) => a.id === 'frame-2').path).toBe('frames/shot_002.rev1.png')
    expect(state(dir).stages.frames).toMatchObject({ status: 'done', note: expect.stringContaining('revision 1') })
    // The record: revisions.json, and every run.jsonl row of the revision tagged with its own runId.
    expect(record).toMatchObject({ revision: 1, status: 'done', deliverables: ['master'], request: { kind: 'shot', shot: 2 } })
    expect(record.changed).toEqual(expect.arrayContaining([{ path: 'clips/shot_002.mp4', previous: 'clips/shot_002.v1.mp4' }, { path: 'frames/shot_002.rev1.png' }]))
    expect(revisions(dir)).toHaveLength(1)
    const rows = runRows(dir).filter((row) => row.runId === record.runId)
    expect(rows.every((row) => row.kind === 'revision' && row.revision === 1 && row.baseRunId === state(dir).runId)).toBe(true)
    expect(rows.map((row) => `${row.stage}:${row.agent}`)).toEqual(expect.arrayContaining(['revision:revision', 'storyboard:storyboard', 'qa:quality-gate', 'clips:video', 'qc:delivery-qc']))
    expect(record.runId).not.toBe(state(dir).runId)
    const delivery = readFileSync(join(dir, 'reports', 'delivery.md'), 'utf8')
    expect(delivery).toMatch(/## 修订记录[\s\S]*\| 1 \| .* \| 重做镜头 2：“make the light warmer, golden hour” \| 完成/)
  }, 180_000)

  it('redoes a shot a cutdown uses: the master and that cutdown are re-cut, the other cutdown is not', async () => {
    const before = snapshot(dir)
    const record = await revise(id, { kind: 'shot', shot: 3 })
    const { changed } = changedFiles(before, snapshot(dir))
    expect(record.deliverables).toEqual(['master', '15s'])
    expect(changed).toEqual(expect.arrayContaining(['clips/shot_003.mp4', 'cut/final.mp4', 'cut/final_15s.mp4']))
    for (const path of ['cut/final_06s.mp4', 'audio/v15s_vo_1.wav', 'audio/v06s_vo_1.wav', 'clips/shot_006.mp4', 'storyboard/storyboard.json']) expect(changed).not.toContain(path)
    expect(state(dir).stages.versions.note).toContain('revision 2')
    const qc = JSON.parse(readFileSync(join(dir, 'reports', 'qc.json'), 'utf8'))
    expect(qc.map((r: any) => r.label)).toEqual(['master', '15s', '06s'])
  }, 180_000)

  it('refuses a line that fails compliance and changes nothing', async () => {
    const before = snapshot(dir)
    const stages = state(dir).stages
    const error = await revise(id, { kind: 'line', line: '2', text: 'The number one cold brew, guaranteed.', zh: '全网最好的冷萃' }).catch((e: Error) => e)
    expect(error).toBeInstanceOf(RevisionRefused)
    expect((error as Error).message).toMatch(/line 2 does not pass the script checks: .*restricted wording/)
    const { changed, added } = changedFiles(before, snapshot(dir))
    expect([...changed, ...added]).toEqual([])
    expect(state(dir).stages).toEqual(stages)
    expect(revisions(dir).at(-1)).toMatchObject({ revision: 3, status: 'refused', reason: expect.stringContaining('restricted wording') })
    expect(runRows(dir).at(-1)).toMatchObject({ kind: 'revision', revision: 3, stage: 'revision', status: 'refused' })
    expect(readFileSync(join(dir, 'reports', 'delivery.md'), 'utf8')).toMatch(/\| 3 \| .* \| 拒绝：line 2 does not pass/)
  })

  it('changes a line: cleared by compliance, re-voiced in the cast voice with the Whisper check, master re-cut, cutdowns kept', async () => {
    const before = snapshot(dir)
    const voicesBefore = dockerCalls().length
    const record = await revise(id, { kind: 'line', line: '2', text: 'Steeped cold all night, every note still there.', zh: '冷萃一夜 风味都在' })
    expect(record.status).toBe('done')
    // Only beat 2 was spoken again, by the cast announcer, and heard back by Whisper.
    const voiced = dockerCalls().slice(voicesBefore)
    expect(voiced.map((call) => call.script)).toEqual(['qwen-clone.py', 'asr-score.py'])
    expect(voiced[0]!.jobs.prompt_audio).toBe('/work/voices/test-announcer.wav')
    expect(voiced[0]!.jobs.lines.map((l: any) => l.text)).toEqual(['Steeped cold all night, every note still there.'])
    const { changed } = changedFiles(before, snapshot(dir))
    expect(changed).toEqual(expect.arrayContaining(['script/script.json', 'audio/vo_2.wav', 'cut/final.mp4', 'cut/titles.ass']))
    for (const path of ['audio/vo_1.wav', 'audio/vo_3.wav', 'cut/final_15s.mp4', 'cut/final_06s.mp4', 'clips/shot_002.mp4']) expect(changed).not.toContain(path)
    expect(readFileSync(join(dir, 'cut', 'titles.ass'), 'utf8')).toContain('冷萃一夜 风味都在')
    expect(JSON.parse(readFileSync(join(dir, 'script', 'script.v1.json'), 'utf8')).beats[1].vo).toBe(BEATS[1])
    expect(calls.filter((call) => call.role.startsWith('compliance reviewer')).at(-1)!.user).toContain('Steeped cold all night')
  }, 180_000)

  it('regrades: finishing only, the master and both cutdowns, every clip and voice kept', async () => {
    const before = snapshot(dir)
    const record = await revise(id, { kind: 'grade', grade: 'warmer' })
    expect(record.deliverables).toEqual(['master', '15s', '06s'])
    const { changed, added } = changedFiles(before, snapshot(dir))
    expect(changed).toEqual(expect.arrayContaining(['cut/final.mp4', 'cut/final_15s.mp4', 'cut/final_06s.mp4']))
    expect(added).toContain('cut/finishing.json')
    expect(changed.filter((path) => path.startsWith('clips/') || path.startsWith('frames/') || /vo_\d+\.wav$/.test(path) || path === 'audio/music.mp3')).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, 'cut', 'master.timeline.json'), 'utf8')).grade).toBe('warmer')
    await expect(revise(id, { kind: 'grade', grade: 'sepia' })).rejects.toThrow(/--grade sepia: use neutral, warmer/)
    await expect(revise(id, { kind: 'shot', shot: 9 })).rejects.toThrow(/--shot 9: the master has shots 1 to 6/)
  }, 180_000)

  it('rescores: a new bed in the client\'s direction, the master and both cutdowns back-timed to it, every voice kept', async () => {
    const before = snapshot(dir)
    const graphs = comfy.graphs.length
    const record = await revise(id, { kind: 'music', music: 'solo piano, slower, resolves warmly' })
    expect(record.deliverables).toEqual(['master', '15s', '06s'])
    const { changed } = changedFiles(before, snapshot(dir))
    expect(changed).toEqual(expect.arrayContaining(['audio/music.mp3', 'audio/soundtrack.wav', 'cut/final.mp4', 'cut/final_15s.mp4', 'cut/final_06s.mp4']))
    expect(changed.filter((path) => /vo_\d+\.wav$/.test(path) || path.startsWith('clips/') || path.startsWith('frames/'))).toEqual([])
    const bed = comfy.graphs.slice(graphs).filter((graph) => Object.values(graph).some((node: any) => node.class_type === 'TextEncodeAceStepAudio'))
    expect(bed).toHaveLength(1)
    expect(JSON.stringify(bed[0])).toContain('solo piano, slower, resolves warmly')
    expect(JSON.parse(readFileSync(join(dir, 'cut', 'finishing.json'), 'utf8'))).toEqual({ grade: 'warmer', music: 'solo piano, slower, resolves warmly' })
    expect(JSON.parse(readFileSync(join(dir, 'cut', 'master.timeline.json'), 'utf8')).grade).toBe('warmer')
  }, 180_000)
})

describe('revising a finished micro-drama episode', () => {
  const id = 'revise-drama'
  const dir = join(root, 'projects', id)

  beforeAll(async () => {
    await narrativeFixture(id)
  }, 120_000)

  it('redoes a dialogue shot with a note: identity gate, a lip-synced clip, the episode re-cut, the other shots kept', async () => {
    const before = snapshot(dir)
    const graphs = comfy.graphs.length
    const record = await revise(id, { kind: 'shot', shot: 2, episode: 1, note: 'warmer, golden-hour light' })
    expect(record).toMatchObject({ status: 'done', deliverables: ['ep01'] })
    const made = comfy.graphs.slice(graphs)
    expect(made.some((graph) => Object.values(graph).some((node: any) => node.class_type === 'LTXVAudioVAEEncode'))).toBe(true)
    expect(calls.filter((call) => Array.isArray(call.user) || call.user.startsWith('[')).length).toBeGreaterThan(0)
    const { changed, added } = changedFiles(before, snapshot(dir))
    expect(changed).toEqual(expect.arrayContaining(['clips/ep01_shot_002.mp4', 'cut/ep01.mp4', 'storyboard/ep01.shots.json']))
    expect(added).toContain('frames/ep01_shot_002.rev1.png')
    for (const path of ['clips/ep01_shot_001.mp4', 'clips/ep01_shot_003.mp4', 'story/ep01.screenplay.json']) expect(changed).not.toContain(path)
    expect(JSON.parse(readFileSync(join(dir, 'storyboard', 'ep01.shots.json'), 'utf8'))[1].image_prompt).toContain('golden-hour')
    expect(readFileSync(join(dir, 'reports', 'delivery.md'), 'utf8')).toMatch(/## 修订记录[\s\S]*第 1 集重做镜头 2/)
  }, 180_000)

  it('refuses a line with an absolute claim before anything is voiced', async () => {
    const before = snapshot(dir)
    const voicesBefore = dockerCalls().length
    await expect(revise(id, { kind: 'line', line: '1.2', episode: 1, text: 'You are the best perfumer in the world.', zh: '你是最好的调香师' })).rejects.toThrow(/scene 1 line 2 does not pass compliance: .*(最好|the best)/)
    expect(dockerCalls().length).toBe(voicesBefore)
    expect([...Object.values(changedFiles(before, snapshot(dir))).flat()]).toEqual([])
  })

  it('changes a line: the same cast voice with the Whisper check, its lip-sync shot regenerated, the episode re-cut', async () => {
    const before = snapshot(dir)
    const voicesBefore = dockerCalls().length
    const record = await revise(id, { kind: 'line', line: '1.1', episode: 1, text: 'I guess some things stay the same.', zh: '有些事还是老样子' })
    expect(record.status).toBe('done')
    const voiced = dockerCalls().slice(voicesBefore)
    expect(voiced.map((call) => call.script)).toEqual(['qwen-clone.py', 'asr-score.py'])
    expect(voiced[0]!.jobs.prompt_audio).toBe('/work/voices/test-leo.wav')
    expect(voiced[0]!.jobs.lines.map((l: any) => l.text)).toEqual(['I guess some things stay the same.'])
    const { changed } = changedFiles(before, snapshot(dir))
    expect(changed).toEqual(expect.arrayContaining(['story/ep01.screenplay.json', 'clips/ep01_shot_002.mp4', 'cut/ep01.mp4', 'cut/ep01.ass']))
    for (const path of ['clips/ep01_shot_001.mp4', 'clips/ep01_shot_003.mp4']) expect(changed).not.toContain(path)
    expect(readFileSync(join(dir, 'cut', 'ep01.ass'), 'utf8')).toContain('有些事还是老样子')
    expect(record.stages).toEqual(['compliance', 'dialogue', 'clips', 'cut'])
    expect(JSON.parse(readFileSync(join(dir, 'cut', 'ep01.timeline.json'), 'utf8')).subtitles[0].en).toBe('I guess some things stay the same.')
  }, 180_000)
})
