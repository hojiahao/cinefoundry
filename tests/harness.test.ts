import { createServer, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeComfy } from './fake-comfy.js'

/**
 * The harness end to end against a scripted model server and a fake ComfyUI: stage order,
 * a rejected script being rewritten, a rejected frame being regenerated, the end card and
 * the final cut. ffmpeg is real. Voice and music are skipped (silent) so no model is needed.
 */

const STYLE = 'warm backlit morning light, deep brown and cream, fine film grain'
/** Shot 1's gate prompt carries this, so the fake gate can reject shot 1 whatever order the queued frames reach it in. */
const SHOT_1_MUST_SHOW = 'the can upright on crushed ice with its label readable'
const replies = {
  brief: { id: 'model-chose-this', title: '拾豆·冷萃咖啡', product: 'cold brew coffee in a can', category: 'food', audience: '大学生', message: '一口慢下来', ratio: '9:16', durationSeconds: 10, tone: 'warm, cinematic', brandText: '拾豆', industry: 'drink' },
  badScript: { structure: 'sensory -> reveal', beats: [{ beat: 1, job: 'hook', see: 'ice', vo: 'The number one cold brew is here.', zh: '全网第一的冷萃来了', text: '第一' }, { beat: 2, job: 'payoff', see: 'can', vo: 'Smooth.', zh: '醇', text: '醇' }] },
  script: { structure: 'sensory -> reveal', beats: [{ beat: 1, job: 'hook', see: 'ice cracking', vo: 'Ice cracks, and the morning opens with a hiss.', zh: '冰块轻响 清晨开罐', text: '开罐' }, { beat: 2, job: 'payoff', see: 'the can', vo: 'Steeped overnight, every note still there.', zh: '冷萃一夜 风味一点不少', text: '冷萃' }] },
  review: { approve: true, issues: [] },
  storyboard: {
    style: STYLE, product: 'a slim silver aluminium can with a dark brown band that reads "拾豆"',
    shots: [1, 2].map((shot) => ({ shot, seconds: 5, framing: shot === 1 ? 'macro' : 'medium', camera: 'slow push-in', image_prompt: `Shot ${shot}: the product on crushed ice, backlit mist`, video_prompt: 'Slow push-in. Mist drifts. No people and no hands enter the frame.', on_screen_text: '', must_show: shot === 1 ? SHOT_1_MUST_SHOW : 'the can upright with its label readable' })),
  },
}

let llm: Server
let llmUrl = ''
let comfy: Awaited<ReturnType<typeof startFakeComfy>>
const seen: string[] = []
const prompts: string[] = []
let scriptCalls = 0
let shot1Rejected = false
let storyboardBroken = false
let photoLetteringReply = '拾豆'

beforeAll(async () => {
  // The casting library on this machine must not decide what the fake creative director may cast.
  process.env.CINEFOUNDRY_VOICE_LIBRARY = join(tmpdir(), 'no-voice-library.json')
  comfy = await startFakeComfy()
  llm = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      // The structured judge, when a test points TYPESAFE_ENDPOINT here: refused, as from a blocked region.
      if (request.url?.endsWith('/jev')) { response.writeHead(451, { 'content-type': 'application/json' }).end('{"title":"Typesafe is not available in your region.","status":451}'); return }
      // Sleep and wake calls carry no body; a vLLM started without sleep mode answers them 404.
      if (!request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return }
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const system: string = body.messages[0].content
      const user = body.messages[1].content
      prompts.push(typeof user === 'string' ? user : JSON.stringify(user))
      const hasImage = Array.isArray(user)
      let reply: unknown
      if (hasImage && system.includes('describe product photos')) {
        seen.push('photo')
        reply = { description: `A slim silver aluminium can with a brushed finish and a dark brown band printed with "${photoLetteringReply}".` }
      } else if (hasImage) {
        seen.push('gate')
        // Reject shot 1's first frame once, to exercise the regeneration loop. Frames are gated as
        // they finish (queued scheduling), so "the second gate call" was shot 1 or shot 2 by chance.
        const rejectNow = !shot1Rejected && JSON.stringify(user).includes(SHOT_1_MUST_SHOW)
        if (rejectNow) shot1Rejected = true
        reply = rejectNow ? { pass: false, score: 40, issues: ['a hand appears although the shot does not call for one'] } : { pass: true, score: 92, issues: [] }
      } else if (system.includes('intake producer')) { seen.push('brief'); reply = replies.brief }
      else if (system.includes('You are the creative director')) { seen.push('creative'); reply = TREATMENT }
      else if (system.includes('compliance reviewer')) { seen.push('review'); reply = replies.review }
      else if (system.includes('copywriter')) { seen.push('script'); reply = ++scriptCalls === 1 ? replies.badScript : replies.script }
      else if (String(user).includes('quality gate rejected')) { seen.push('repair'); reply = { fixes: [{ issue: 'hands', change: 'product-only' }], delete: ['Shot 1: the product on crushed ice'], scene: String(/Current scene description: (.*)/.exec(String(user))?.[1]).replace(/^[^,]*/, 'Product-only macro of the product on crushed ice') } }
      else {
        seen.push('storyboard')
        reply = storyboardBroken ? { ...replies.storyboard, shots: replies.storyboard.shots.map((shot) => ({ ...shot, camera: 'slow push-in with handheld float' })) } : replies.storyboard
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { completion_tokens: 10 } }))
    })
  })
  await new Promise<void>((done) => llm.listen(0, '127.0.0.1', done))
  llmUrl = `http://127.0.0.1:${(llm.address() as { port: number }).port}/v1`
})
afterAll(() => { llm.close(); comfy.close() })

const TREATMENT = {
  insight: '忙碌的人想要片刻安静', proposition: '一口醇香', concept: '喧闹中打开罐子，世界安静下来', brandVoice: 'restrained and premium',
  visual: { concept: 'a cold can of coffee glowing in a dark quiet room', light: 'night, warm backlight from behind, soft fill', palette: ['deep brown', 'silver', 'cream'], texture: 'condensation, brushed metal' },
  rhythm: 'quiet hook, build, hero',
  sound: { voice: 'default', voiceDirection: 'unhurried and warm', music: 'sparse piano, slow, resolves softly', ambience: 'a quiet room at night' },
}

describe('Cinefoundry Harness', () => {
  it('takes a brief to a finished film, rewriting a bad script and regenerating a rejected frame', async () => {
    const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-harness-'))
    Object.assign(process.env, { CINEFOUNDRY_PROJECTS: projects, COMFYUI_URL: comfy.url, CINEFOUNDRY_PLANNER_URL: llmUrl, CINEFOUNDRY_VISION_URL: llmUrl })
    delete process.env.STEPFUN_API_KEY
    const { runHarness } = await import('../src/agent/harness.js')
    const log: string[] = []
    // 720p keeps the real ffmpeg steps fast in tests; 60 fps exercises the RIFE interpolation path.
    const result = await runHarness({ brief: '给“拾豆”冷萃咖啡做一条 10 秒竖版广告', id: 'coffee-test', silent: true, candidates: 1, resolution: '720p', fps: 60, log: (line) => log.push(line) })

    // Stage order, and the first script (absolute claim, 1-character voiceover) was sent back.
    expect(seen.filter((name) => name !== 'gate' && name !== 'repair')).toEqual(['brief', 'creative', 'script', 'script', 'review', 'storyboard'])
    expect(result.rejectedAttempts.script).toBe(1)
    expect(readFileSync(join(projects, 'coffee-test', 'script', 'copy.txt'), 'utf8')).not.toContain('全网第一')

    // Gate: hero passes, shot 1 is rejected once and repaired, shot 2 passes.
    expect(seen.filter((name) => name === 'repair')).toHaveLength(1)
    expect(result.qaRegenerations).toBe(1)
    // 60 fps: every clip is interpolated by RIFE (x5) after the video model is freed.
    expect(comfy.graphs.filter((graph) => Object.values(graph).some((node: any) => node.class_type === 'FrameInterpolate'))).toHaveLength(2)
    expect(log.some((line) => line.startsWith('▸ interpolate'))).toBe(true)

    // The hero still is generated first without references; every frame after it is anchored to it.
    const graphs = comfy.graphs
    expect(graphs[0]!['6'].class_type).toBe('CLIPTextEncode')
    expect(graphs[0]!['6'].inputs.text).toMatch(/^Studio product photograph of a slim silver aluminium can/)
    expect(graphs[1]!['6'].class_type).toBe('TextEncodeQwenImageEditPlus')
    expect(graphs[1]!['6'].inputs.prompt).toContain('exactly as in image 1')
    expect(graphs[1]!['6'].inputs.prompt).toContain(STYLE)
    // Clips come from the default LTX-2.5 Fast image-to-video graph, one per shot, and memory is released between phases.
    expect(graphs.filter((graph) => Object.values(graph).some((node: any) => node.class_type === 'LTXVImgToVideoInplace'))).toHaveLength(2)
    expect(comfy.freed()).toBeGreaterThanOrEqual(3)

    // Final cut: two 5 s shots plus a 3 s end card, crossfaded, with typeset titles.
    expect(existsSync(result.finalCut!)).toBe(true)
    const ass = readFileSync(join(projects, 'coffee-test', 'cut', 'titles.ass'), 'utf8')
    expect(ass).toContain('开罐')
    expect(ass).toMatch(/Closing,,0,0,0,,.*一口慢下来/)
    const state = JSON.parse(readFileSync(join(projects, 'coffee-test', 'state.json'), 'utf8'))
    expect(Object.values(state.stages).every((stage: any) => stage.status === 'done')).toBe(true)
    const delivery = readFileSync(join(projects, 'coffee-test', 'reports', 'delivery.md'), 'utf8')
    expect(delivery).toContain('# 交付报告')
    expect(delivery).toMatch(/\| 1 \| macro · slow push-in \| 2 \| pass 92/)
    expect(state.assets.map((asset: any) => asset.id).sort()).toEqual(['clip-1', 'clip-2', 'final-cut', 'frame-1', 'frame-2', 'product-hero'])
  })

  it('uses a supplied product photo as the hero still instead of generating one', async () => {
    const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-photo-'))
    Object.assign(process.env, { CINEFOUNDRY_PROJECTS: projects })
    const photo = join(projects, 'photo.jpg')
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gold:s=2000x1500', '-frames:v', '1', photo])
    const { runHarness } = await import('../src/agent/harness.js')
    const before = comfy.graphs.length
    const log: string[] = []
    await runHarness({ brief: '给“拾豆”冷萃咖啡做一条 10 秒竖版广告', id: 'photo-test', silent: true, candidates: 1, productImage: photo, resolution: '720p', fps: 24, log: (line) => log.push(line) })

    // No text-to-image graph: the first picture job is already an edit anchored to the photo.
    const graphs = comfy.graphs.slice(before)
    const pictures = graphs.filter((graph) => !Object.values(graph).some((node: any) => node.class_type === 'LTXVImgToVideoInplace'))
    expect(pictures.length).toBeGreaterThan(0)
    expect(pictures.every((graph) => graph['6'].class_type === 'TextEncodeQwenImageEditPlus')).toBe(true)
    expect(graphs[0]!['6'].class_type).toBe('TextEncodeQwenImageEditPlus')
    expect(log.some((line) => line.includes('product hero user photo'))).toBe(true)
    // The photo is read before the writers start, and what it shows reaches them.
    expect(seen.slice(seen.indexOf('photo'))).toEqual(expect.arrayContaining(['photo', 'script', 'storyboard']))
    expect(seen.indexOf('photo')).toBeLessThan(seen.lastIndexOf('script'))
    const brief = JSON.parse(readFileSync(join(projects, 'photo-test', 'brief.json'), 'utf8'))
    expect(brief.photo.description).toContain('brushed finish')
    // The look is the photo's, not the storyboard artist's paraphrase.
    expect(JSON.parse(readFileSync(join(projects, 'photo-test', 'storyboard', 'storyboard.json'), 'utf8')).product).toBe(brief.photo.description)
    expect(prompts.some((prompt) => prompt.includes('brushed finish and a dark brown band') && prompt.includes('Approved script'))).toBe(true)
    // Normalised to PNG, longest side capped at 1328 px.
    const hero = join(projects, 'photo-test', 'refs', 'product.png')
    expect(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', hero]).toString().trim()).toBe('1328,996')
    const state = JSON.parse(readFileSync(join(projects, 'photo-test', 'state.json'), 'utf8'))
    expect(state.assets.find((asset: any) => asset.id === 'product-hero')).toMatchObject({ path: 'refs/product.png', execution: 'user-supplied' })
    expect(readFileSync(join(projects, 'photo-test', 'reports', 'delivery.md'), 'utf8')).toContain('用户提供的产品照片')
  })

  it('stops before any model call when the product photo does not exist', async () => {
    const { runHarness } = await import('../src/agent/harness.js')
    const calls = seen.length
    await expect(runHarness({ brief: '给“拾豆”冷萃咖啡做一条广告', productImage: '/nonexistent/photo.jpg', log: () => {} })).rejects.toThrow('Product image not found')
    expect(seen.length).toBe(calls)
  })

  it('takes the brand lettering printed on the photo over the intake agent\'s', async () => {
    const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-lettering-'))
    Object.assign(process.env, { CINEFOUNDRY_PROJECTS: projects })
    const photo = join(projects, 'photo.jpg')
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gold:s=800x600', '-frames:v', '1', photo])
    const { runHarness } = await import('../src/agent/harness.js')
    photoLetteringReply = 'SHIDOU'
    // The scripted storyboard still says "拾豆", so the run stops there; the brief is written before that.
    await runHarness({ brief: '给“拾豆”冷萃咖啡做一条 10 秒竖版广告', id: 'lettering-test', silent: true, candidates: 1, productImage: photo, log: () => {} }).catch(() => undefined)
    photoLetteringReply = '拾豆'
    const brief = JSON.parse(readFileSync(join(projects, 'lettering-test', 'brief.json'), 'utf8'))
    expect(brief.brandText).toBe('SHIDOU')
    expect(brief.industry).toBe('drink')
    expect(readFileSync(join(projects, 'lettering-test', 'reports', 'run.jsonl'), 'utf8')).toContain('"from":"拾豆","to":"SHIDOU"')
  })

  it('carries on without the judge when it cannot be reached, instead of rewriting the copy', async () => {
    const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-jev-'))
    Object.assign(process.env, { CINEFOUNDRY_PROJECTS: projects, TYPESAFE_API_KEY: 'test', TYPESAFE_ENDPOINT: `${llmUrl}/jev` })
    const { runHarness } = await import('../src/agent/harness.js')
    scriptCalls = 1
    try {
      const result = await runHarness({ brief: '给“拾豆”冷萃咖啡做一条 10 秒竖版广告', id: 'jev-test', silent: true, candidates: 1, planOnly: true, log: () => {} })
      expect(result.rejectedAttempts.script).toBe(0)
      expect(result.rejectedAttempts.storyboard).toBe(0)
    } finally {
      delete process.env.TYPESAFE_API_KEY
      delete process.env.TYPESAFE_ENDPOINT
    }
    const run = readFileSync(join(projects, 'jev-test', 'reports', 'run.jsonl'), 'utf8')
    expect(run.match(/"unavailable"/g)).toHaveLength(1)
  })

  it('marks the stage that was running as failed when a run stops', async () => {
    const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-failed-'))
    Object.assign(process.env, { CINEFOUNDRY_PROJECTS: projects })
    const { runHarness } = await import('../src/agent/harness.js')
    storyboardBroken = true
    try {
      await expect(runHarness({ brief: '给“拾豆”冷萃咖啡做一条 10 秒竖版广告', id: 'broken-test', silent: true, candidates: 1, log: () => {} })).rejects.toThrow('storyboard still fails its checks')
    } finally {
      storyboardBroken = false
    }
    const state = JSON.parse(readFileSync(join(projects, 'broken-test', 'state.json'), 'utf8'))
    expect(state.stages.storyboard.status).toBe('failed')
    expect(state.stages.storyboard.note).toContain('camera must be exactly one move')
    expect(state.stages.compliance.status).toBe('done')
    expect(state.stages.frames.status).toBe('pending')
  })
})
