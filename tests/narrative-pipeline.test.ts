import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPipeline } from '../src/engine/run.js'
import { dramaPipeline } from '../src/pipelines/drama/index.js'
import { shortPipeline } from '../src/pipelines/short/index.js'
import type { NarrativeOptions } from '../src/crafts/narrative/context.js'
import type { CharacterRecord } from '../src/crafts/narrative/casting.js'
import type { NarrativeShot, Screenplay, SeriesBible } from '../src/crafts/narrative/types.js'
import { audioCalls } from './fake-audio.js'
import { startFakeComfy } from './fake-comfy.js'

/**
 * The micro-drama and the creator short end to end against a scripted planner and reviewer, a fake ComfyUI and fake
 * audio containers (Docker is never started): every stage runs its real code, validators and ffmpeg steps. 720p,
 * ten-second episodes (two 5-second shots) and one frame per shot keep it fast.
 */

/** Docker is never called for real: the writers' room's container stops and starts are recorded here. */
const dockerCalls: string[][] = []
/** Containers the fake docker has stopped: their fake server stops answering /models. */
const down = new Set<string>()
vi.mock('../src/lib/exec.js', async (original) => {
  const real = await original<typeof import('../src/lib/exec.js')>()
  return {
    ...real,
    exec: (command: string, args: string[], ...rest: unknown[]) => {
      if (command !== 'docker') return (real.exec as (...a: unknown[]) => unknown)(command, args, ...rest)
      if (args[0] !== 'start' && args[0] !== 'stop') return Promise.resolve({ stdout: '', stderr: '' })
      dockerCalls.push(args)
      if (args[0] === 'stop') down.add(args[1]!)
      else down.delete(args[1]!)
      return Promise.resolve({ stdout: '', stderr: '' })
    },
  }
})
/** Which fake service a /models path belongs to, by its container. */
const containerOf = (url: string) => (url.startsWith('/writer/') ? 'cinefoundry-nemotron-super-1' : url.startsWith('/vision/') ? 'cinefoundry-stepvl-1' : 'cinefoundry-nemotron-1')

vi.mock('../src/lib/containers.js', async (original) => ({
  ...(await original<typeof import('../src/lib/containers.js')>()),
  runContainer: (await import('./fake-audio.js')).fakeRunContainer,
}))

// ---- Fixtures: what each agent answers -----------------------------------------------------------------------------

const DRAMA_REQUEST = '一部都市爱情微短剧：调香师林夏在旧城的香水店，重逢回来卖老宅的陆川。'
const SHORT_REQUEST = '一条竖版短视频：调香师林夏和老朋友陆川在香水店斗嘴，聊怎么挑一瓶适合自己的香水。'

const bible: SeriesBible & { id: string; title: string; clientNames: string[] } = {
  id: 'model-chose-this', title: '旧城香水店', clientNames: ['林夏', '陆川'],
  logline: '调香师林夏想守住旧城的香水店 却重逢了回来卖老宅的陆川', genre: 'urban romance, warm and witty',
  world: 'a quiet old quarter of Shanghai in early spring, narrow lanes and wooden shopfronts', look: 'soft window light, warm amber and sage, gentle film grain',
  characters: [
    { id: 'lin-xia', name: 'Lin Xia / 林夏', role: 'lead', age: 29, gender: 'female', look: 'a woman in her late twenties with shoulder-length dark hair and a calm gaze', wardrobe: 'cream linen shirt and a canvas apron', arc: '她想重开香水店。她要先原谅自己。', voice: 'warm low alto, unhurried and gentle' },
    { id: 'lu-chuan', name: 'Lu Chuan / 陆川', role: 'love interest', age: 31, gender: 'male', look: 'a man in his early thirties with short black hair and soft stubble', wardrobe: 'navy wool coat over a grey sweater', arc: '他回来卖掉老宅。他留了下来。', voice: 'clear baritone with dry humour' },
  ],
  episodes: [{ episode: 1, title: '碎掉的香水', synopsis: '林夏在店里打碎一瓶香水时 陆川推门进来。', hook: '一瓶摔碎的香水', cliffhanger: '他说他要卖掉这条街' }],
}
/** The writer's first draft renames the client's 林夏: the bible check sends it back. */
const renamedBible = { ...bible, characters: [{ ...bible.characters[0]!, name: 'Mia / 米娅' }, bible.characters[1]!] }

const screenplay: Screenplay = {
  episode: 1, title: '碎掉的香水',
  scenes: [{
    scene: 1, heading: 'INT. PERFUME SHOP - MORNING', characters: ['lin-xia', 'lu-chuan'], action: 'A glass bottle shatters on the tiled floor and Lin Xia looks up at the door.',
    lines: [
      { speaker: 'lu-chuan', en: 'I guess some things never change.', zh: '有些事真是一点没变', delivery: 'dry, half smiling' },
      { speaker: 'lin-xia', en: 'You still knock on the wrong door.', zh: '你还是敲错了门' },
    ],
  }],
}

const shots: Array<Omit<NarrativeShot, 'seconds'> & { seconds: number }> = [
  // One shot without dialogue per scene (the establishing view), then one per line: 15 seconds for one scene and two lines.
  { shot: 1, scene: 1, framing: 'wide', camera: 'locked-off', characters: [], image_prompt: 'a small perfume shop at dawn, amber bottles on wooden shelves, rain on the window', video_prompt: 'rain runs down the glass', seconds: 5 },
  { shot: 2, scene: 1, framing: 'medium', camera: 'slow push-in', characters: ['lu-chuan'], image_prompt: 'a man in a navy coat in the doorway of a small perfume shop, morning light behind him', video_prompt: 'he leans on the door frame and smiles faintly', line: 0, seconds: 5 },
  { shot: 3, scene: 1, framing: 'close-up', camera: 'locked-off', characters: ['lin-xia'], image_prompt: 'a woman behind a wooden counter lined with amber bottles, window light on her face', video_prompt: 'she looks up from the broken glass', line: 1, seconds: 5 },
]

const briefs = {
  characters: [
    { id: 'lin-xia', brief: { face: 'oval face, soft brow, high cheekbones, narrow chin', features: 'almond dark brown eyes set wide, straight nose, full lower lip', ethnicity: 'Han Chinese', skin: 'warm light olive skin with faint freckles across the nose', hair: 'shoulder-length straight black hair parted on the left', build: 'slender, medium height, upright posture', distinctive: 'a small mole under the right eye', wardrobe: 'loose cream linen shirt with rolled sleeves under a canvas apron', palette: 'cream, sage and ivory' } },
    { id: 'lu-chuan', brief: { face: 'square face, heavy straight brow, strong jaw', features: 'hooded dark eyes, broad nose, thin lips', ethnicity: 'Han Chinese', skin: 'tan skin with light stubble and laugh lines', hair: 'short black hair swept back, side part on the right', build: 'tall, broad shoulders, relaxed stance', distinctive: 'a thin scar through the left eyebrow', wardrobe: 'navy wool overcoat over a charcoal crew-neck sweater', palette: 'navy, charcoal and rust' } },
  ],
}

const sound = { ambience: [{ scene: 1, prompt: 'quiet shop room tone, a distant street outside' }], effects: [{ shot: 2, prompt: 'a glass bottle shattering on tile' }], music: 'sparse piano and cello, slow, ends unresolved' }
const packaging = { titles: ['旧城香水店的重逢', 'She Came Back for the Shop', '一瓶香水碎了 故事开始了'], cover: { shot: 3, text: '他回来了' }, description: '一段关于重逢的短视频。本视频由 AI 生成。', hashtags: ['#短视频', '#AI短剧', '#都市爱情'] }
const pass = { pass: true, score: 90, craft: { light: 8, composition: 8, realism: 8 }, casting: { realism: 8, brief: 8, distinct: 8 }, issues: [] }

// ---- The scripted model server ---------------------------------------------------------------------------------------

/** How the episode reviewer behaves in a run: approves, rejects with a quoted finding, or cannot be reached. */
let episodeReview: 'approve' | 'reject' | 'unreachable' = 'approve'
/** Every chat call, in order: the role it was routed by (or "gate" for an image) and the user prompt. */
const calls: Array<{ role: string; user: string; writer?: boolean }> = []
let developmentCalls = 0
let editorCalls = 0

let llm: Server
let comfy: Awaited<ReturnType<typeof startFakeComfy>>

function reply(role: string, user: string): unknown {
  if (role === 'showrunner and head writer' || role === 'creator-content writer') return ++developmentCalls === 1 ? renamedBible : bible
  if (role === 'compliance reviewer. You did not write this series') return { approve: true, issues: [] }
  if (role === 'compliance reviewer. You did not write this screenplay') {
    return episodeReview === 'reject' ? { approve: false, issues: ['scene 1 line 1: "some things never change" - read as mocking the lead in this test'] } : { approve: true, issues: [] }
  }
  if (role === 'screenwriter') return screenplay
  // The script editor sends the first draft back with a quoted note and approves the rewrite.
  if (role.startsWith('script editor')) {
    return ++editorCalls === 1
      ? { approve: false, scores: { story: 8, hook: 6, structure: 7, dialogue: 7 }, issues: ['"I guess some things never change." - open on the shattering bottle before the first line'] }
      : { approve: true, scores: { story: 8, hook: 8, structure: 8, dialogue: 8 }, issues: [] }
  }
  if (role.startsWith('director working with')) return { shots }
  if (role === 'character designer and casting director') return briefs
  if (role === 'sound designer and composer') return sound
  if (role === 'packaging editor') return packaging
  throw new Error(`no scripted reply for role "${role}" (${user.slice(0, 80)})`)
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'cinefoundry-narrative-'))
  const audio = join(root, 'step-audio')
  // The casting library: one English baritone fits Lu Chuan; nobody fits Lin Xia, so her voice is designed.
  mkdirSync(join(audio, 'voices'), { recursive: true })
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=150:duration=3', join(audio, 'voices', 'en-m-baritone.wav')])
  writeFileSync(join(root, 'library.json'), JSON.stringify({
    referenceText: { English: 'A reference line in English.', Chinese: '一句中文参考。' }, pitchHz: { female: [160, 260], male: [85, 160] },
    voices: [{ id: 'en-m-baritone', language: 'English', accent: 'General American', gender: 'male', ageBand: '26-35', age: 33, timbre: 'clear baritone, dry humour', uses: ['character'], design: 'A clear male baritone with dry humour.', description: 'Clear baritone.' }],
  }))
  comfy = await startFakeComfy({ clipSeconds: 5 })
  llm = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      // The writers' room checks its model serves; sleep and wake calls get 404 (no sleep mode) and are left alone.
      if (request.url?.endsWith('/v1/models')) return down.has(containerOf(request.url)) ? response.writeHead(503).end() : response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}')
      if (!request.url?.endsWith('/chat/completions')) return response.writeHead(404).end()
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const system: string = body.messages[0].content
      const user = body.messages[1].content
      // Route by the agent's role line ("You are the <role> of Cinefoundry"), never by words a skill's text may contain.
      const role = Array.isArray(user) ? 'gate' : (/^You are the (.+?) of Cinefoundry/.exec(system)?.[1] ?? '')
      calls.push({ role, user: typeof user === 'string' ? user : JSON.stringify(user[0]), writer: request.url.startsWith('/writer/') })
      if (role === 'compliance reviewer. You did not write this screenplay' && episodeReview === 'unreachable') return response.writeHead(503).end('reviewer down')
      const content = JSON.stringify(role === 'gate' ? pass : reply(role, user))
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { completion_tokens: 10 } }))
    })
  })
  await new Promise<void>((done) => llm.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(llm.address() as { port: number }).port}/v1`
  Object.assign(process.env, {
    CINEFOUNDRY_PROJECTS: join(root, 'projects'), COMFYUI_URL: comfy.url, CINEFOUNDRY_PLANNER_URL: url, CINEFOUNDRY_VISION_URL: url.replace(/\/v1$/, '/vision/v1'),
    CINEFOUNDRY_STEP_AUDIO_DIR: audio, CINEFOUNDRY_VOICE_LIBRARY: join(root, 'library.json'),
    // The fake ComfyUI holds no weights: do not walk the machine's model folder at every phase.
    CINEFOUNDRY_RELEASE_CACHE: '0',
    // Nothing to settle after freeing a fake ComfyUI.
    CINEFOUNDRY_PHASE_SETTLE_MS: '0',
  })
  delete process.env.STEPFUN_API_KEY
})
afterAll(() => { llm.close(); comfy.close() })
beforeEach(() => { calls.length = 0; audioCalls.length = 0; logs = []; developmentCalls = 0; editorCalls = 0; episodeReview = 'approve' })

const options = (brief: string, id: string, extra: Partial<NarrativeOptions> = {}): NarrativeOptions => ({ brief, id, resolution: '720p', episodeSeconds: 15, candidates: 1, log: (line) => logs.push(line), ...extra })
let logs: string[] = []
const projectDir = (id: string) => join(process.env.CINEFOUNDRY_PROJECTS!, id)
const state = (id: string) => JSON.parse(readFileSync(join(projectDir(id), 'state.json'), 'utf8'))
const roles = () => calls.map((c) => c.role).filter((role, i, all) => role !== all[i - 1])
const isCastingCall = (graph: Record<string, any>) => { const text = JSON.stringify(graph); return text.includes('qwen_image_2512_fp8') && text.includes('Casting photograph of') }
const probe = (file: string, entries: string) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()
/** The first log line of each kind, in the order they appeared. */
const firstAt = (prefix: string) => logs.findIndex((line) => line.startsWith(prefix))

describe('micro-drama end to end', () => {
  let firstRunGraphs = 0

  it('runs development to the cut: casting, frames, dialogue, clips, sound, mix and delivery QC', async () => {
    const before = comfy.graphs.length
    const result = await runPipeline(dramaPipeline, options(DRAMA_REQUEST, 'drama-test', { episodes: 1 }))
    firstRunGraphs = comfy.graphs.length - before
    const dir = projectDir('drama-test')

    // Stage order: every agent in production order, each stage recorded done.
    expect(roles()).toEqual(['showrunner and head writer', 'compliance reviewer. You did not write this series', 'screenwriter', 'script editor of a top streaming studio. You did not write this draft', 'screenwriter', 'script editor of a top streaming studio. You did not write this draft', 'compliance reviewer. You did not write this screenplay', 'director working with the director of photography and the script supervisor', 'character designer and casting director', 'gate', 'sound designer and composer'])
    const order = ['▸ development', '▸ compliance   series premise', '▸ screenplay', '▸ compliance   episode 1', '▸ shots', '▸ cast lin-xia', '▸ pack lin-xia', '▸ voice', '▸ frame 1.1', '▸ clip 1.1', '▸ cut']
    expect(order.map(firstAt).every((index, i, all) => index >= 0 && (i === 0 || index > all[i - 1]!))).toBe(true)
    const project = state('drama-test')
    expect(project.format).toBe('drama')
    expect(Object.keys(project.stages)).toEqual(['development', 'screenplay', 'compliance', 'shots', 'casting', 'frames', 'dialogue', 'clips', 'sound', 'cut'])
    expect(Object.values(project.stages).every((stage: any) => stage.status === 'done')).toBe(true)
    expect(project.stages.casting.note).toBe('2 characters · 2 cast · 0 reused')

    // The client's names were enforced: the renamed draft was sent back with the reason, and the bible keeps 林夏.
    // The script editor's note goes back to the screenwriter, and the rewrite is read again before compliance.
    expect(calls.filter((c) => c.role.startsWith('script editor'))).toHaveLength(2)
    const rewrite = calls.filter((c) => c.role === 'screenwriter')[1]
    expect(rewrite?.user).toContain('open on the shattering bottle')
    const development = calls.filter((c) => c.role === 'showrunner and head writer')
    expect(development).toHaveLength(2)
    expect(development[1]!.user).toContain('the client named a character "林夏"')
    const written: SeriesBible = JSON.parse(readFileSync(join(dir, 'story', 'bible.json'), 'utf8'))
    expect(written.characters.map((c) => c.name)).toEqual(['Lin Xia / 林夏', 'Lu Chuan / 陆川'])
    expect(written).not.toHaveProperty('clientNames')

    // Casting: a gated casting call of four per role, a reference pack, and a record a later run can reuse.
    expect(comfy.graphs.slice(before).filter(isCastingCall)).toHaveLength(8)
    for (const id of ['lin-xia', 'lu-chuan']) {
      const record: CharacterRecord = JSON.parse(readFileSync(join(dir, 'cast', id, 'character.json'), 'utf8'))
      expect(record).toMatchObject({ version: 1, id, images: { master: { path: 'master.png', pass: true } } })
      expect(record.candidates).toHaveLength(4)
      for (const view of ['master', 'profile', 'full-body']) expect(existsSync(join(dir, 'cast', id, `${view}.png`))).toBe(true)
    }
    // Voices: Lu Chuan from the casting library; Lin Xia's voice designed for her alone and kept with her record.
    const linXia: CharacterRecord = JSON.parse(readFileSync(join(dir, 'cast', 'lin-xia', 'character.json'), 'utf8'))
    const luChuan: CharacterRecord = JSON.parse(readFileSync(join(dir, 'cast', 'lu-chuan', 'character.json'), 'utf8'))
    expect(luChuan.voice).toMatchObject({ library: 'en-m-baritone' })
    expect(linXia.voice).toMatchObject({ wav: 'voice.wav' })
    expect(existsSync(join(dir, 'cast', 'lin-xia', 'voice.wav'))).toBe(true)
    expect(audioCalls.map((c) => c.script)).toEqual(['voice-cast.py', 'asr-score.py', 'qwen-clone.py', 'asr-score.py', 'qwen-clone.py', 'asr-score.py', 'sfx.py'])
    expect(audioCalls[0]!.jobs.map((j: { id: string }) => j.id)).toEqual(['lin-xia'])

    // Frames are edits from the cast's references; dialogue shots are lip-synced to their line.
    for (const shot of ['001', '002']) {
      expect(existsSync(join(dir, 'frames', `ep01_shot_${shot}.png`))).toBe(true)
      expect(existsSync(join(dir, 'clips', `ep01_shot_${shot}.mp4`))).toBe(true)
    }
    expect(comfy.graphs.slice(before).filter((g) => Object.values(g).some((node: any) => node.class_type === 'LoadAudio'))).toHaveLength(2)
    expect(comfy.graphs.slice(before).filter((g) => Object.values(g).some((node: any) => String(node.class_type).startsWith('SaveAudio')))).toHaveLength(1)

    // The cut: 15 s at 720p 9:16, 24 fps, with sound, subtitles and the implicit AI label; QC report written.
    const cut = join(dir, 'cut', 'ep01.mp4')
    expect(result.episodes[1]).toBe(cut)
    expect(probe(cut, 'stream=codec_type,width,height').split('\n')).toEqual(['video,720,1280', 'audio'])
    expect(Number(probe(cut, 'format=duration'))).toBeCloseTo(15, 0)
    const aigc = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=AIGC', '-of', 'default=nw=1:nk=1', cut]).toString())
    expect(aigc).toMatchObject({ Label: '1', ProduceID: 'drama-test-ep01' })
    const ass = readFileSync(join(dir, 'cut', 'ep01.ass'), 'utf8')
    expect(ass).toContain('有些事真是一点没变')
    expect(ass).toContain('内容由 AI 生成')
    const qc = JSON.parse(readFileSync(join(dir, 'reports', 'qc.json'), 'utf8'))
    // Delivery QC measured the episode against its spec (size, rate, length, loudness, subtitles, AIGC label). The fixture's
    // tones over digital silence widen the loudness range past any real mix; that warning is the only one allowed.
    expect(qc.map((r: { label: string }) => r.label)).toEqual(['ep01'])
    expect(qc[0].results.filter((r: { status: string }) => r.status !== 'pass').map((r: { check: string }) => r.check).filter((c: string) => c !== 'loudness_range')).toEqual([])
    expect(project.stages.cut.note).toMatch(/^1 episode\(s\) · qc pass/)
    expect(project.assets.map((a: any) => a.id)).toEqual(expect.arrayContaining(['cast-lin-xia', 'cast-lu-chuan', 'frame-1-1', 'frame-1-2', 'episode-1']))
  })

  // Casts with the record the first test wrote.
  it('reuses a recorded cast instead of casting again', async () => {
    const source = join(projectDir('drama-test'), 'cast')
    const before = comfy.graphs.length
    const recorded = readFileSync(join(source, 'lin-xia', 'character.json'), 'utf8')
    await runPipeline(dramaPipeline, options(DRAMA_REQUEST, 'drama-reuse', { episodes: 1, castDir: source }))
    const dir = projectDir('drama-reuse')

    // No casting brief, no casting call, no reference pack and no voice design: the same people, the same voices.
    expect(calls.some((c) => c.role === 'character designer and casting director')).toBe(false)
    const graphs = comfy.graphs.slice(before)
    expect(graphs.filter(isCastingCall)).toEqual([])
    expect(graphs.length).toBeLessThan(firstRunGraphs)
    expect(audioCalls.some((c) => c.script === 'voice-cast.py')).toBe(false)
    expect(state('drama-reuse').stages.casting.note).toBe('2 characters · 0 cast · 2 reused')
    expect(logs.filter((line) => line.includes('reused from'))).toHaveLength(2)
    // Copied into the project so it stays self-contained, record untouched.
    expect(readFileSync(join(dir, 'cast', 'lin-xia', 'character.json'), 'utf8')).toBe(recorded)
    // Lin Xia speaks with her designed voice from the record (staged into the audio work folder for the container),
    // Lu Chuan with his library voice.
    const spokenWith = (opening: string) => audioCalls.find((c) => c.script === 'qwen-clone.py' && c.jobs.lines.some((l: { text: string }) => l.text.startsWith(opening)))!.jobs.prompt_audio as string
    const staged = join(process.env.CINEFOUNDRY_STEP_AUDIO_DIR!, spokenWith('You still').replace(/^\/work\//, ''))
    expect(readFileSync(staged).equals(readFileSync(join(dir, 'cast', 'lin-xia', 'voice.wav')))).toBe(true)
    expect(spokenWith('I guess')).toBe('/work/voices/en-m-baritone.wav')
  })

  it.each([
    ['reject', 'episode 1 did not pass compliance'],
    ['unreachable', 'compliance review of episode 1 could not be completed'],
  ] as const)('stops before casting when the episode review fails closed (%s)', async (mode, message) => {
    episodeReview = mode
    const before = comfy.graphs.length
    const id = `drama-${mode}`
    await expect(runPipeline(dramaPipeline, options(DRAMA_REQUEST, id, { episodes: 1 }))).rejects.toThrow(message)
    const project = state(id)
    expect(project.stages.compliance.status).toBe('failed')
    expect(project.stages.compliance.note).toContain(message)
    for (const stage of ['shots', 'casting', 'frames', 'dialogue', 'clips', 'sound', 'cut']) expect(project.stages[stage].status).toBe('pending')
    // Nothing reached media generation: no picture job, no voice, no casting, no shot list.
    expect(comfy.graphs.length).toBe(before)
    expect(audioCalls).toEqual([])
    expect(readdirSync(join(projectDir(id), 'cast'))).toEqual([])
    expect(calls.some((c) => c.role.startsWith('director') || c.role.startsWith('character designer'))).toBe(false)
    if (mode === 'reject') expect(JSON.parse(readFileSync(join(projectDir(id), 'reports', 'compliance.ep01.json'), 'utf8')).at(-1).approve).toBe(false)
  })
})

describe('creator short end to end', () => {
  it('runs topic to packaging: one episode at 30 fps, the cover from the chosen shot', async () => {
    const result = await runPipeline(shortPipeline, options(SHORT_REQUEST, 'short-test'))
    const dir = projectDir('short-test')

    expect(roles()).toEqual(['creator-content writer', 'compliance reviewer. You did not write this series', 'screenwriter', 'script editor of a top streaming studio. You did not write this draft', 'screenwriter', 'script editor of a top streaming studio. You did not write this draft', 'compliance reviewer. You did not write this screenplay', 'director working with the director of photography and the script supervisor', 'character designer and casting director', 'gate', 'sound designer and composer', 'packaging editor'])
    const project = state('short-test')
    expect(project.format).toBe('short')
    expect(Object.keys(project.stages)).toEqual(['development', 'screenplay', 'compliance', 'shots', 'casting', 'frames', 'dialogue', 'clips', 'sound', 'cut', 'packaging'])
    expect(Object.values(project.stages).every((stage: any) => stage.status === 'done')).toBe(true)
    expect(project.stages.packaging.note).toBe(packaging.titles[0])
    expect(calls.filter((c) => c.role === 'creator-content writer')[1]!.user).toContain('the client named a character "林夏"')

    expect(existsSync(join(dir, 'story', 'bible.json'))).toBe(true)
    for (const id of ['lin-xia', 'lu-chuan']) expect(existsSync(join(dir, 'cast', id, 'character.json'))).toBe(true)
    // 30 fps: every clip is interpolated with RIFE after the video model is released.
    expect(existsSync(join(dir, 'clips', 'ep01_shot_001.hfr.mp4'))).toBe(true)
    expect(result.video).toBe(join(dir, 'cut', 'ep01.mp4'))
    expect(probe(result.video!, 'stream=r_frame_rate').split('\n')[0]).toBe('30/1')
    expect(JSON.parse(readFileSync(join(dir, 'reports', 'packaging.json'), 'utf8'))).toEqual(packaging)
    expect(probe(join(dir, 'cut', 'cover.jpg'), 'stream=width,height')).toBe('704,1280')
    // The fixture's soundtrack is tones over digital silence, so its loudness range is wider than any real mix: that warning is
    // allowed here, nothing else is, and the integrated loudness must land on the target.
    const qc = JSON.parse(readFileSync(join(dir, 'reports', 'qc.json'), 'utf8'))[0]
    expect(qc).toMatchObject({ label: 'ep01', spec: { fps: 30, width: 720, height: 1280 } })
    expect(qc.results.filter((r: { status: string; check: string }) => r.status !== 'pass').map((r: { check: string }) => r.check).filter((c: string) => c !== 'loudness_range')).toEqual([])
    expect(Math.abs(qc.measured.loudness.integrated - (-14))).toBeLessThanOrEqual(1)
  })
})

describe("writers' room end to end", () => {
  it('gives the planner and the vision model back when the run fails inside the room', async () => {
    process.env.CINEFOUNDRY_WRITER_URL = process.env.CINEFOUNDRY_PLANNER_URL!.replace(/\/v1$/, '/writer/v1')
    dockerCalls.length = 0
    down.clear()
    episodeReview = 'reject'
    try {
      await expect(runPipeline(shortPipeline, options(SHORT_REQUEST, 'short-room-fail'))).rejects.toThrow()
    } finally {
      delete process.env.CINEFOUNDRY_WRITER_URL
    }
    expect(dockerCalls).toEqual([['stop', 'cinefoundry-nemotron-1'], ['stop', 'cinefoundry-stepvl-1'], ['stop', 'cinefoundry-nemotron-super-1'], ['start', 'cinefoundry-nemotron-1'], ['start', 'cinefoundry-stepvl-1']])
  })

  it('writes the whole story, the sound plan and the packaging on the author, and nothing on it after the first picture', async () => {
    process.env.CINEFOUNDRY_WRITER_URL = process.env.CINEFOUNDRY_PLANNER_URL!.replace(/\/v1$/, '/writer/v1')
    dockerCalls.length = 0
    down.clear()
    try {
      await runPipeline(shortPipeline, options(SHORT_REQUEST, 'short-room'))
    } finally {
      delete process.env.CINEFOUNDRY_WRITER_URL
    }
    const firstPicture = calls.findIndex((c) => c.role === 'gate')
    const written = calls.slice(0, firstPicture)
    expect(written.every((c) => c.writer)).toBe(true)
    expect(written.map((c) => c.role)).toEqual(expect.arrayContaining(['creator-content writer', 'screenwriter', 'script editor of a top streaming studio. You did not write this draft', 'director working with the director of photography and the script supervisor', 'character designer and casting director', 'sound designer and composer', 'packaging editor']))
    expect(calls.slice(firstPicture).some((c) => c.writer)).toBe(false)
    // The planner and the vision reviewer (no sleep mode here) are stopped while the room works and started after it;
    // the author's container is stopped when the room closes.
    expect(dockerCalls).toEqual([['stop', 'cinefoundry-nemotron-1'], ['stop', 'cinefoundry-stepvl-1'], ['stop', 'cinefoundry-nemotron-super-1'], ['start', 'cinefoundry-nemotron-1'], ['start', 'cinefoundry-stepvl-1']])
  })
})
