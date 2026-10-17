import { createServer, type Server } from 'node:http'
import { appendFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Brief, Script, Storyboard } from '../src/agent/checks.js'
import { checkScript } from '../src/agent/checks.js'
import { finishMaster } from '../src/agent/finish.js'
import { writeDeliveryReport } from '../src/agent/delivery.js'
import type { ModelEndpoint } from '../src/agent/llm.js'
import type { ComfyClient } from '../src/comfy/client.js'
import { checkVersion, checkVersionCopy, checkVersionPlan, CUTDOWNS, cutdownsFor, maxVoWords, shotSecondsFor, versionLength, type VersionPlan } from '../src/crafts/versions.js'
import { exec } from '../src/lib/exec.js'
import { probeDuration } from '../src/lib/ffmpeg.js'
import { createProject, loadProject, projectDir } from '../src/lib/project.js'
import { reviewCopy } from '../src/pipelines/ad/compliance.js'
import type { AdContext } from '../src/pipelines/ad/context.js'
import { adQcStage } from '../src/pipelines/ad/qc.js'
import { versionsStage } from '../src/pipelines/ad/versions.js'

const [V15, V06] = CUTDOWNS as [typeof CUTDOWNS[number], typeof CUTDOWNS[number]]

const brief: Brief = {
  id: 'versions-test', title: '拾豆·冷萃咖啡', product: 'cold brew coffee in a can', category: 'food', audience: '城市上班族', message: '一口慢下来',
  ratio: '16:9', durationSeconds: 30, tone: 'warm, cinematic', brandText: '拾豆', industry: 'drink', resolution: '720p', fps: 24,
}
const storyboard: Storyboard = {
  style: 'warm backlit morning light, deep brown and cream, fine film grain', product: 'a slim silver aluminium can with a dark brown band that reads "拾豆"',
  shots: [1, 2, 3, 4, 5, 6].map((shot) => ({ shot, seconds: 5, framing: ['macro', 'medium', 'wide', 'close-up', 'medium', 'macro'][shot - 1]!, camera: ['slow push-in', 'orbit', 'pull-back', 'tilt', 'dolly', 'static'][shot - 1]!, image_prompt: `shot ${shot}`, video_prompt: 'Mist drifts.', on_screen_text: '', must_show: `the can, moment ${shot}` })),
}
const masterScript: Script = {
  structure: 'sensory -> proof -> hero',
  beats: [1, 2, 3, 4, 5, 6].map((beat) => ({ beat, job: beat === 1 ? 'hook' : beat === 6 ? 'hero' : 'build', see: `moment ${beat}`, vo: 'Ice cracks and the morning slows right down.', zh: '冰块轻响 清晨慢下来', text: '慢下来' })),
}

const plan15: VersionPlan = {
  version: '15s', target_seconds: 15,
  shots: [{ shot: 1, seconds: 4, why: 'hook' }, { shot: 3, seconds: 4, why: 'proof' }, { shot: 6, seconds: 4.5, why: 'product hero' }],
  script: { structure: 'hook -> proof -> hero', beats: [
    { beat: 1, job: 'hook', see: 'ice', vo: 'Ice cracks and the morning slows down.', zh: '冰块轻响 清晨慢下来', text: '慢下来' },
    { beat: 2, job: 'proof', see: 'the pour', vo: 'Steeped cold for twelve quiet hours.', zh: '冷萃十二小时', text: '冷萃' },
    { beat: 3, job: 'hero', see: 'the can', vo: 'Shidou cold brew, one slow sip at a time.', zh: '拾豆冷萃 慢慢喝', text: '拾豆' },
  ] },
}
const plan06: VersionPlan = {
  version: '06s', target_seconds: 6, shots: [{ shot: 6, seconds: 3.5, why: 'hero: the proposition in one image' }],
  script: { structure: 'hero', beats: [{ beat: 1, job: 'hero', see: 'the can', vo: 'Cold brew, slowed right down.', zh: '冷萃 慢慢来', text: '拾豆' }] },
}

describe('cutdown specs', () => {
  it('cuts 15 s and 6 s from a 30 s master, only versions at most half the master', () => {
    expect(cutdownsFor(30, 6).map((v) => v.id)).toEqual(['15s', '06s'])
    expect(cutdownsFor(20, 4).map((v) => v.id)).toEqual(['06s'])
    expect(cutdownsFor(10, 2)).toEqual([])
    // Not enough shots to choose from.
    expect(cutdownsFor(30, 2).map((v) => v.id)).toEqual(['06s'])
  })

  it('adds up to the frame: shots + 3 s end card - 0.5 s dissolve', () => {
    expect(shotSecondsFor(V15)).toBe(12.5)
    expect(shotSecondsFor(V06)).toBe(3.5)
    expect(versionLength(plan15.shots)).toBe(15)
    expect(versionLength(plan06.shots)).toBe(6)
  })

  it('scales the voiceover word limit to the shot', () => {
    expect([5, 4.5, 4, 3.5, 3].map(maxVoWords)).toEqual([13, 11, 9, 8, 6])
  })
})

describe('version plan validator', () => {
  const fps = 60
  it('accepts plans that follow the skill', () => {
    expect(checkVersionPlan(plan15, V15, storyboard, fps)).toEqual([])
    expect(checkVersionPlan(plan06, V06, storyboard, fps)).toEqual([])
    expect(checkVersion(plan15, V15, storyboard, brief, fps)).toEqual([])
    expect(checkVersion(plan06, V06, storyboard, brief, fps)).toEqual([])
  })

  it('rejects shots that do not exist or are used twice', () => {
    const problems = checkVersionPlan({ ...plan15, shots: [{ shot: 9, seconds: 4, why: 'hook' }, { shot: 3, seconds: 4, why: 'proof' }, { shot: 3, seconds: 4.5, why: 'hero' }] }, V15, storyboard, fps).join(' | ')
    expect(problems).toMatch(/shot 9 is not a shot of the master/)
    expect(problems).toMatch(/shot 3 is used twice/)
  })

  it('rejects durations that do not add up, overrun the clip, are too short or fall between frames', () => {
    expect(checkVersionPlan({ ...plan15, shots: plan15.shots.map((s) => ({ ...s, seconds: 5 })) }, V15, storyboard, fps).join(' ')).toMatch(/runs 17\.500 s, not 15 s.*exactly 12\.5 s/)
    expect(checkVersionPlan({ ...plan15, shots: [{ shot: 1, seconds: 5.5, why: 'hook' }, { shot: 3, seconds: 4, why: 'proof' }, { shot: 6, seconds: 3, why: 'hero' }] }, V15, storyboard, fps).join(' ')).toMatch(/longer than the 5 s clip/)
    expect(checkVersionPlan({ ...plan06, shots: [{ shot: 6, seconds: 2.5, why: 'hero' }] }, V06, storyboard, fps).join(' ')).toMatch(/shorter than 3 s/)
    expect(checkVersionPlan({ ...plan15, shots: [{ shot: 1, seconds: 4.01, why: 'hook' }, { shot: 3, seconds: 3.99, why: 'proof' }, { shot: 6, seconds: 4.5, why: 'hero' }] }, V15, storyboard, fps).join(' ')).toMatch(/does not land on a frame at 60 fps/)
  })

  it('rejects the wrong shot count, version id or a missing reason', () => {
    const problems = checkVersionPlan({ ...plan06, version: '15s' as never, target_seconds: 5, shots: [{ shot: 6, seconds: 3.5, why: '' }, { shot: 5, seconds: 3, why: 'x' }] }, V06, storyboard, fps).join(' | ')
    expect(problems).toMatch(/"version" must be "06s"/)
    expect(problems).toMatch(/"target_seconds" must be 6/)
    expect(problems).toMatch(/exactly 1 shot before the end card/)
    expect(problems).toMatch(/"why" is empty/)
  })
})

describe('version copy validator', () => {
  it('runs the master beat checks for the version beat count', () => {
    expect(checkVersionCopy(plan15, V15, brief)).toEqual([])
    expect(checkVersionCopy({ ...plan06, script: plan15.script }, V06, brief).join(' ')).toMatch(/exactly 1 beat, one per shot; it has 3/)
    expect(checkVersionCopy({ ...plan06, script: { ...plan06.script, beats: [{ ...plan06.script.beats[0]!, zh: '全网最好的冷萃' }] } }, V06, brief).join(' ')).toMatch(/restricted wording "最好"/)
    expect(checkVersionCopy({ ...plan06, script: { ...plan06.script, beats: [{ ...plan06.script.beats[0]!, vo: 'Simply the best cold brew.' }] } }, V06, brief).join(' ')).toMatch(/"the best"/)
  })

  it('holds each line to what its shot can carry, beats numbered in shot order', () => {
    const long = { ...plan06, script: { ...plan06.script, beats: [{ ...plan06.script.beats[0]!, vo: 'Cold brew steeped slowly overnight, ready when you are.' }] } }
    expect(checkVersionCopy(long, V06, brief).join(' ')).toMatch(/9 words; a 3\.5 s shot holds at most 8/)
    const numbered = { ...plan15, script: { ...plan15.script, beats: plan15.script.beats.map((b, i) => ({ ...b, beat: i + 2 })) } }
    expect(checkVersionCopy(numbered, V15, brief).join(' ')).toMatch(/numbered 1 to 3 in shot order/)
  })

  it('leaves the master checkScript unchanged without the beats option', () => {
    expect(checkScript(masterScript, brief)).toEqual([])
    expect(checkScript(plan15.script, brief).join(' ')).toMatch(/exactly 6 beats of 5 seconds/)
  })
})

// ---------------------------------------------------------------- the stage, against a scripted model server and real ffmpeg

let llm: Server
let endpoint: ModelEndpoint
const calls: Array<{ system: string; user: string }> = []
let reviewMode: 'approve' | 'revise-badly' = 'approve'
let versionCalls = 0

beforeAll(async () => {
  llm = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      if (!request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return }
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const system: string = body.messages[0].content
      const user: string = body.messages[1].content
      calls.push({ system, user })
      let reply: unknown
      if (system.includes('compliance reviewer')) {
        if (reviewMode === 'approve') reply = { approve: true, issues: [] }
        // First an implied comparison with a rewrite too long for its 3.5 s shot, then a rewrite that fits.
        else if (user.includes('They fail the script checks')) reply = { revised: [{ beat: 1, vo: 'Cold brew, taken slowly.', zh: '冷萃 慢慢品', text: '拾豆' }] }
        else reply = { approve: false, issues: ['Beat 1 implies other coffees are rushed'], revised: [{ beat: 1, vo: 'Unlike the rest, this cold brew takes its time with you.', zh: '冷萃 慢慢品', text: '拾豆' }] }
      } else if (system.includes('versioning editor')) {
        versionCalls++
        if (user.includes('Cut the 15-second version')) {
          // The first 15 s plan leaves every shot at 5 s (17.5 s): it must come back with the arithmetic fixed.
          reply = user.includes('It was rejected') ? plan15 : { ...plan15, shots: plan15.shots.map((s) => ({ ...s, seconds: 5 })) }
        } else reply = plan06
      } else reply = {}
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { completion_tokens: 10 } }))
    })
  })
  await new Promise<void>((done) => llm.listen(0, '127.0.0.1', done))
  endpoint = { name: 'fake', baseUrl: `http://127.0.0.1:${(llm.address() as { port: number }).port}/v1`, model: 'fake', apiKey: 'local', execution: 'local-dgx-spark' }
})
afterAll(() => llm.close())

const agentPrompt = async (role: string, skills: string | string[]) => `You are the ${role}. Skills: ${[skills].flat().join(', ')}`

describe('reviewCopy (the master compliance path, reused)', () => {
  it('keeps a reviewer rewrite only once it passes the version checks', async () => {
    reviewMode = 'revise-badly'
    const log: string[] = []
    const review = await reviewCopy({ editor: endpoint, agentPrompt, log: (line) => log.push(line) }, {
      brief, script: plan06.script, check: (copy) => checkVersion({ ...plan06, script: copy }, V06, storyboard, brief, 24), subject: 'Copy of the 6-second cutdown',
    })
    reviewMode = 'approve'
    expect(calls.some((call) => call.user.includes('Copy of the 6-second cutdown'))).toBe(true)
    // The first rewrite had 11 words for a 3.5 s shot; it went back with the failure and the fitting rewrite was kept.
    expect(calls.find((call) => call.user.includes('They fail the script checks'))!.user).toMatch(/11 words; a 3\.5 s shot holds at most 8/)
    expect(review.script.beats[0]!.vo).toBe('Cold brew, taken slowly.')
    expect(review.revisedBeats).toEqual([1])
    expect(review.blocked).toEqual([])
    expect(review.openItems).toEqual([])
  })

  it('reports block findings in the copy instead of passing them', async () => {
    const review = await reviewCopy({ editor: endpoint, agentPrompt, log: () => undefined }, { brief, script: { ...plan06.script, beats: [{ ...plan06.script.beats[0]!, text: '销量第一' }] }, check: () => [] })
    expect(review.blocked.map((f) => f.text)).toEqual(['销量第一'])
  })
})

describe('versions and delivery QC stages', () => {
  const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-versions-'))
  let ctx: AdContext
  const log: string[] = []

  beforeAll(async () => {
    process.env.CINEFOUNDRY_PROJECTS = projects
    // The casting library on this machine must not decide the voice of a silent test film.
    process.env.CINEFOUNDRY_VOICE_LIBRARY = join(tmpdir(), 'no-voice-library.json')
    await createProject({ id: brief.id, title: brief.title, brief: 'test', ratio: brief.ratio, durationSeconds: 30, runId: 'run-1', format: 'ad', stages: ['brief', 'cut', 'versions', 'qc'] })
    const dir = projectDir(brief.id)
    const ff = (...args: string[]) => exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
    await ff('-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24:d=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'clips', 'shot_001.mp4'))
    for (const shot of [2, 3, 4, 5, 6]) await exec('cp', [join(dir, 'clips', 'shot_001.mp4'), join(dir, 'clips', `shot_00${shot}.mp4`)])
    await ff('-f', 'lavfi', '-i', 'testsrc=s=1280x720', '-frames:v', '1', join(dir, 'frames', 'hero.png'))
    const record: AdContext['record'] = async (stage, agent, model, detail) =>
      appendFile(join(dir, 'reports', 'run.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), runId: 'run-1', format: 'ad', stage, agent, model: model?.model, execution: model?.execution ?? 'local-dgx-spark', ...detail })}\n`)
    await record('brief', 'intake', undefined, {})
    for (const shot of [1, 2, 3, 4, 5, 6]) await record('frames', 'quality-gate', undefined, { shot, score: shot === 6 ? 95 : 80, pass: true })
    ctx = {
      format: 'ad', request: 'test', runId: 'run-1', started: Date.now(), log: (line: string) => log.push(line), record, agentPrompt, rest: async () => undefined, openProject: async () => dir,
      projectId: brief.id, dir, options: { brief: 'test', silent: true }, planner: endpoint, reviewer: endpoint, editor: endpoint, jev: undefined, jevReview: [], rejectedAttempts: {}, qaRegenerations: 0,
      brief, script: masterScript, storyboard, frames: new Map(), versions: [], comfy: {} as ComfyClient, hero: { path: join(dir, 'frames', 'hero.png'), verdict: { pass: true, score: 95, issues: [] } },
    } as unknown as AdContext
    ctx.masterCut = await finishMaster({ dir, brief, script: masterScript, storyboard, heroPath: ctx.hero!.path, comfy: ctx.comfy!, silent: true, record, log: ctx.log })
    ctx.finalCut = ctx.masterCut.path
  }, 180_000)

  it('cuts the 15 s and 6 s versions from the master clips, exact to the frame, and records every step', async () => {
    const note = await versionsStage(ctx)
    expect(note).toBe('15s · 06s cut')
    const dir = ctx.dir!
    // The editor works under its skill; the 15 s plan was sent back once for its arithmetic.
    expect(calls.filter((call) => call.system.includes('versioning editor')).every((call) => call.system.includes('editing-and-versioning'))).toBe(true)
    expect(versionCalls).toBe(3)
    expect(calls.find((call) => call.user.includes('Cut the 15-second version') && call.user.includes('It was rejected'))!.user).toMatch(/runs 17\.500 s, not 15 s/)
    // Gate scores reach the editor so it can pick the strongest frames.
    expect(calls.find((call) => call.user.includes('Cut the 6-second version'))!.user).toContain('Gate score 95')
    for (const [id, seconds] of [['15s', 15], ['06s', 6]] as const) {
      const file = join(dir, 'cut', `final_${id}.mp4`)
      expect(existsSync(file)).toBe(true)
      expect(Math.abs((await probeDuration(file)) - seconds)).toBeLessThan(1 / 24 + 1e-3)
      const ass = readFileSync(join(dir, 'cut', `titles_${id}.ass`), 'utf8')
      expect(ass).toMatch(/Label,,0,0,0,,内容由 AI 生成/)
      expect(ass).toMatch(/Closing,,0,0,0,,.*一口慢下来/)
      const plan = JSON.parse(readFileSync(join(dir, 'cut', `version_${id}.json`), 'utf8'))
      expect(plan.compliance.reviewer.approve).toBe(true)
      const tags = JSON.parse((await exec('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=AIGC', '-of', 'csv=p=0', file])).stdout.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
      expect(tags).toMatchObject({ Label: '1', ProduceID: `${brief.id}-${id}` })
    }
    expect(readFileSync(join(dir, 'cut', 'titles_15s.ass'), 'utf8')).toContain('冷萃十二小时')
    const state = await loadProject(brief.id)
    expect(state.assets.filter((a) => a.stage === 'versions').map((a) => [a.id, a.path])).toEqual([['final-15s', 'cut/final_15s.mp4'], ['final-06s', 'cut/final_06s.mp4']])
    const rows = readFileSync(join(dir, 'reports', 'run.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(rows.filter((r) => r.stage === 'versions').map((r) => `${r.version}:${r.agent}`)).toEqual(['15s:versioning-editor', '15s:reviewer', '15s:cut', '06s:versioning-editor', '06s:reviewer', '06s:cut'])
    expect(rows.find((r) => r.stage === 'versions' && r.agent === 'versioning-editor' && r.version === '15s').rejected).toHaveLength(1)
  }, 180_000)

  it('measures master and versions, writes reports/qc.json and lists both in the delivery report', async () => {
    const note = await adQcStage(ctx)
    expect(note).toMatch(/^3 file\(s\) · /)
    const dir = ctx.dir!
    const qc = JSON.parse(readFileSync(join(dir, 'reports', 'qc.json'), 'utf8'))
    expect(qc.map((r: { label: string }) => r.label)).toEqual(['master', '15s', '06s'])
    for (const report of qc) {
      const failed = report.results.filter((r: { status: string }) => r.status === 'fail')
      expect(failed, `${report.label}: ${JSON.stringify(failed)}`).toEqual([])
      expect(report.measured.probe.video.width).toBe(1280)
    }
    expect(qc[1].spec.seconds).toBe(15)
    await writeDeliveryReport(dir, brief, storyboard, ctx.finalCut!)
    const delivery = readFileSync(join(dir, 'reports', 'delivery.md'), 'utf8')
    expect(delivery).toMatch(/\| 15s \| `cut\/final_15s\.mp4` \| 15\.0 s \| 1（4 s，hook） · 3（4 s，proof） · 6（4\.5 s，product hero） \|/)
    expect(delivery).toMatch(/\| 06s \| `cut\/final_06s\.mp4` \| 6\.0 s \|/)
    expect(delivery).toMatch(/## 技术质检[\s\S]*\| master \| (pass|pass-with-warnings) \|/)
  }, 120_000)

  it('reports a version that cannot be made as an open item instead of failing the film', async () => {
    const before = ctx.versions.length
    const failing = { ...ctx, versions: [], planner: { ...endpoint, baseUrl: 'http://127.0.0.1:9/v1', name: 'down' } } as AdContext
    const note = await versionsStage(failing)
    expect(note).toBe('no version cut (see open items)')
    expect(ctx.versions.length).toBe(before)
    expect(log.some((line) => /open item: 15s version not cut - the editor returned no usable plan/.test(line))).toBe(true)
    await writeDeliveryReport(ctx.dir!, brief, storyboard, ctx.finalCut!)
    expect(readFileSync(join(ctx.dir!, 'reports', 'delivery.md'), 'utf8')).toMatch(/- 15s 版本未剪出：the editor returned no usable plan/)
  }, 60_000)
})
