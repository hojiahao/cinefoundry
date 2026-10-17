import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ComfyClient } from '../../comfy/client.js'
import { composeImagePrompt, composeProductPrompt, type Shot } from '../../agent/checks.js'
import { enterPhase } from '../../agent/finish.js'
import { qualityGate, type QaVerdict } from '../../agent/gate.js'
import { generateImage, videoSize } from '../../lib/media.js'
import { generationResolution } from '../../lib/formats.js'
import { addAsset } from '../../lib/project.js'
import { MAX_QA_REGENERATIONS, repairPrompt } from '../../crafts/repair.js'
import { need, type AdContext } from './context.js'

/** Frames are generated at the video model's working size: the clip is made at that size, so a larger still only costs time (1920x1080 took 77 s a frame; 1280x704 about half). */
const frameSize = (resolution: string, ratio: string) => videoSize(resolution, ratio).join('x')

/**
 * Frames + quality gate: one approved hero still of the product, then every shot's first frame edited from it, each
 * judged by the vision model and regenerated (new seeds, then repaired prompts) until it passes or the limit is spent.
 */
export async function framesStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const storyboard = need(ctx.storyboard, 'storyboard')
  const industry = brief.industry!
  const { planner, reviewer } = ctx
  const dir = ctx.dir!
  const photoPath = join(dir, 'refs', 'product.png')
  const comfy = (ctx.comfy ??= new ComfyClient())
  const frames = ctx.frames
  // The planner is not needed while pictures are made (a prompt repair wakes it on demand);
  // releasing its memory lets ComfyUI keep the image model resident between frames.
  await ctx.rest('product hero (Qwen-Image)', [planner])
  await enterPhase(comfy, 'product hero (Qwen-Image)', ctx.record)
  // The hero still: one approved picture of the product that every shot is generated from,
  // so the can in shot 3 is the can in shot 1. A text description alone let it drift.
  await mkdir(join(dir, 'refs'), { recursive: true })
  const heroShot: Shot = { shot: 0, seconds: 0, framing: 'product', camera: 'static', image_prompt: '', video_prompt: '', on_screen_text: '', must_show: `exactly one ${brief.product}, fully visible and centred, matching this description: ${storyboard.product}. Its brand lettering reads "${brief.brandText}" clearly and correctly. Finish, proportions and size are not judged here` }
  let hero: { path: string; verdict: QaVerdict } | undefined
  let heroPrompt = composeProductPrompt(storyboard, industry, brief.brandText)
  if (ctx.options.productImage) {
    // The user's photo is the ground truth for the product: the gate is run and recorded, but a
    // reject (a brand name that is not printed on the real product, say) does not replace the photo.
    const path = photoPath
    const verdict = await qualityGate(reviewer, path, heroShot, undefined, industry)
    ctx.log(`▸ product hero user photo · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
    await ctx.record('frames', 'product-hero', reviewer, { source: 'user photo', input: ctx.options.productImage, ...verdict })
    hero = { path, verdict: { ...verdict, pass: true } }
  }
  for (let attempt = 0; !ctx.options.productImage && attempt <= MAX_QA_REGENERATIONS; attempt++) {
    const path = join(dir, 'refs', `product${attempt ? `_r${attempt}` : ''}.png`)
    const image = await generateImage(comfy, { prompt: heroPrompt, size: '1328x1328', output: path })
    const verdict = await qualityGate(reviewer, path, heroShot, undefined, industry)
    ctx.log(`▸ product hero ${image.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
    await ctx.record('frames', 'product-hero', reviewer, { attempt, imageSeconds: image.seconds, ...verdict })
    if (!hero || verdict.score > hero.verdict.score) hero = { path, verdict }
    if (verdict.pass) break
    if (attempt < MAX_QA_REGENERATIONS) heroPrompt = await repairPrompt(planner, await ctx.agentPrompt('storyboard artist', 'shot-quality-gate'), heroShot, heroPrompt, verdict.issues)
  }
  // Every frame is anchored to this picture; a wrong product here makes the whole film wrong.
  if (!hero!.verdict.pass && hero!.verdict.score >= 0) {
    throw new Error(`The product hero still never passed the gate: ${hero!.verdict.issues.join('; ')}`)
  }
  if (!hero!.verdict.pass) {
    throw new Error(`The product hero still failed the gate ${MAX_QA_REGENERATIONS + 1} times (${hero!.verdict.issues.join('; ')}). Every frame is anchored to it, so the film cannot continue with the wrong product.`)
  }
  await addAsset(brief.id, { id: 'product-hero', kind: 'image', stage: 'frames', path: hero!.path.slice(dir.length + 1), execution: ctx.options.productImage ? 'user-supplied' : 'local-dgx-spark', model: ctx.options.productImage ? 'user photo' : 'qwen_image_lightning', note: `gate ${hero!.verdict.score}` })

  await enterPhase(comfy, 'frames (Qwen-Image-Edit)', ctx.record)
  const frameSizeFor = frameSize(generationResolution(brief.resolution!), brief.ratio)
  const framePath = (shot: Shot, suffix: string) => join(dir, 'frames', `shot_${String(shot.shot).padStart(3, '0')}${suffix}.png`)
  const render = (shot: Shot, prompt: string, suffix: string) => {
    const path = framePath(shot, suffix)
    // imageSeconds counts from the request, so it includes any wait in ComfyUI's queue.
    const renderStartedAt = new Date().toISOString()
    return generateImage(comfy, { prompt, size: frameSizeFor, output: path, references: [hero!.path] }).then((image) => ({ path, image, renderStartedAt }))
  }
  type Rendered = { path: string; image: { seconds: number }; renderStartedAt: string }
  /** One shot's whole gate loop: first candidate, further seeds, then prompt repairs. */
  const makeFrame = async (shot: Shot, first: Promise<Rendered>, onFirstJudging?: () => void) => {
    let prompt = composeImagePrompt(shot, storyboard, true, industry)
    let best: { path: string; verdict: QaVerdict; attempt: number } | undefined
    // On a tied score the later repair wins: it was written against the gate's issues, and the
    // gate's coarse scores (most rejects land on 30) used to keep the untouched first frame.
    const consider = (path: string, verdict: QaVerdict, attempt: number) => {
      const better = (top: NonNullable<typeof best>) => verdict.score > top.verdict.score || (verdict.score === top.verdict.score && attempt > top.attempt)
      if (!best || (verdict.pass && !best.verdict.pass) || (verdict.pass === best.verdict.pass && better(best))) best = { path, verdict, attempt }
    }
    const judge = async (rendered: Rendered, suffix: string, attempt: number) => {
      const gateStarted = Date.now()
      const verdict = await qualityGate(reviewer, rendered.path, shot, hero!.path, industry)
      const gateSeconds = (Date.now() - gateStarted) / 1000
      ctx.log(`▸ frame ${shot.shot}${suffix.padEnd(5)} ${rendered.image.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
      await ctx.record('qa', 'quality-gate', reviewer, { shot: shot.shot, attempt, candidate: suffix || '_a', renderStartedAt: rendered.renderStartedAt, imageSeconds: rendered.image.seconds, gateSeconds, ...verdict })
      consider(rendered.path, verdict, attempt)
    }
    const shoot = async (suffix: string, attempt: number) => judge(await render(shot, prompt, suffix), suffix, attempt)
    const judging = judge(await first, '', 0)
    onFirstJudging?.()
    await judging
    // Best of N: the same prompt with different seeds. A diffusion model's spread between
    // seeds is often larger than what a prompt edit buys, and the gate can rank the results.
    // By default the next seed is only spent when the previous one failed the gate (a frame that
    // passed is a frame); `bestOf` generates every candidate and keeps the highest score.
    const candidates = Math.max(1, ctx.options.candidates ?? 2)
    for (let candidate = 1; candidate < candidates; candidate++) {
      if (!ctx.options.bestOf && best?.verdict.pass) break
      await shoot(`_c${candidate + 1}`, 0)
    }
    for (let attempt = 1; attempt <= MAX_QA_REGENERATIONS && !best!.verdict.pass; attempt++) {
      ctx.qaRegenerations++
      prompt = await repairPrompt(planner, await ctx.agentPrompt('storyboard artist', 'shot-quality-gate'), shot, prompt, best!.verdict.issues)
      await shoot(`_r${attempt}`, attempt)
    }
    frames.set(shot.shot, best!.path)
    await addAsset(brief.id, {
      id: `frame-${shot.shot}`, kind: 'image', stage: 'frames', path: best!.path.slice(dir.length + 1), shot: shot.shot,
      execution: 'local-dgx-spark', model: 'qwen_image_edit_lightning', note: best!.verdict.score < 0 ? 'unverified: the reviewer never concluded' : `gate ${best!.verdict.score}${best!.verdict.pass ? '' : ' (kept after failed gate)'}`,
    })
  }
  const firstRender = (shot: Shot) => render(shot, composeImagePrompt(shot, storyboard, true, industry), '')
  if ((ctx.options.frameScheduling ?? 'queue') === 'queue') {
    // Every shot runs its own gate loop at once. ComfyUI renders its queue in order and the
    // reviewer judges whatever is ready, so a shot that keeps failing no longer holds the image
    // model idle while the others wait their turn. Same prompts, gate, seeds rule and limits.
    await Promise.all(storyboard.shots.map((shot) => makeFrame(shot, firstRender(shot))))
  } else {
    // Serial: while the reviewer judges this shot's first candidate, the next shot's first
    // candidate is already rendering.
    let prefetched: Promise<Rendered> | undefined
    for (const [index, shot] of storyboard.shots.entries()) {
      const next = storyboard.shots[index + 1]
      const first = prefetched ?? firstRender(shot)
      prefetched = undefined
      await makeFrame(shot, first, () => {
        if (next && ctx.options.prefetch !== false) {
          prefetched = firstRender(next)
          // If this shot fails, the loop ends and nobody awaits the prefetch: a rejection there would exit the process.
          prefetched.catch(() => undefined)
        }
      })
    }
  }
  ctx.hero = hero!
  return `${ctx.qaRegenerations} regenerations`
}
