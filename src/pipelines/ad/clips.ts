import { join } from 'node:path'
import { composeVideoNegative, composeVideoPrompt, type Shot } from '../../agent/checks.js'
import { enterPhase } from '../../agent/finish.js'
import { generateVideo, interpolateVideo, interpolationMultiplier, videoFps, VIDEO_NEGATIVE } from '../../lib/media.js'
import { DEFAULT_FPS, generationResolution } from '../../lib/formats.js'
import { addAsset } from '../../lib/project.js'
import { need, type AdContext } from './context.js'

const clipBase = (dir: string, shot: Shot) => join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}`)
const videoModelOf = (ctx: AdContext) => ctx.options.videoModel ?? 'ltx25-fast-nvfp4'
export const clipsPhase = (ctx: AdContext) => { const model = videoModelOf(ctx); return `clips (${model.startsWith('ltx25') ? 'LTX-2.5 Fast' : model === 'seedance' ? 'Seedance' : 'Wan2.2'})` }
/** Above 24 fps the clips are interpolated to a high-frame-rate master (not for the cloud route). */
export const interpolates = (ctx: AdContext) => (need(ctx.brief, 'brief').fps ?? DEFAULT_FPS) > 24 && !videoModelOf(ctx).startsWith('seedance')

/** Clips: every shot animated from its approved frame, then interpolated (RIFE) to a high-frame-rate master. */
export async function clipsStage(ctx: AdContext): Promise<string> {
  const storyboard = need(ctx.storyboard, 'storyboard')
  const comfy = need(ctx.comfy, 'comfy')
  await ctx.rest(clipsPhase(ctx), [ctx.planner, ctx.reviewer])
  await enterPhase(comfy, clipsPhase(ctx), ctx.record)
  for (const [index, shot] of storyboard.shots.entries()) await shotClip(ctx, shot, { freeAfter: index === storyboard.shots.length - 1 })
  // Frame rate: RIFE turns the clips into ~120 fps masters (24 fps x5, Wan2.2 14B's 16 fps x8) while both language models still sleep
  // (601 frames at 1080p is about 15 GB); the cut conforms them to the delivery rate by dropping frames evenly.
  if (interpolates(ctx)) {
    await enterPhase(comfy, 'interpolate (RIFE)', ctx.record)
    for (const shot of storyboard.shots) await interpolateShot(ctx, shot)
    await comfy.free()
  }
  return `${storyboard.shots.length} clips · ${videoModelOf(ctx)}`
}

/** One shot animated from its approved first frame (clips/shot_NNN.mp4), recorded as the shot's clip. */
export async function shotClip(ctx: AdContext, shot: Shot, options: { freeAfter?: boolean } = {}): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const industry = brief.industry!
  const output = `${clipBase(ctx.dir!, shot)}.mp4`
  const clip = await generateVideo(need(ctx.comfy, 'comfy'), {
    prompt: composeVideoPrompt(shot, industry), negative: composeVideoNegative(VIDEO_NEGATIVE, industry), output, resolution: generationResolution(brief.resolution!), ratio: brief.ratio, durationSeconds: shot.seconds || 5,
    firstFrame: ctx.frames.get(shot.shot), freeAfter: options.freeAfter ?? false, model: videoModelOf(ctx),
  })
  ctx.log(`▸ clip ${shot.shot}       ${clip.seconds.toFixed(1)}s`)
  await ctx.record('clips', 'video', undefined, { shot: shot.shot, seconds: clip.seconds })
  await addAsset(brief.id, { id: `clip-${shot.shot}`, kind: 'video', stage: 'clips', path: `clips/shot_${String(shot.shot).padStart(3, '0')}.mp4`, shot: shot.shot, execution: clip.workflow.startsWith('cloud:') ? 'cloud' : 'local-dgx-spark', model: clip.workflow, seconds: clip.seconds })
  return output
}

/** One clip to its RIFE high-frame-rate master (clips/shot_NNN.hfr.mp4). */
export async function interpolateShot(ctx: AdContext, shot: Shot): Promise<string> {
  const base = clipBase(ctx.dir!, shot)
  // The clip's own frame rate decides the multiplier: Wan2.2 14B renders at 16 fps, and treating it as 24 played it 1.5x fast.
  const sourceFps = videoFps(videoModelOf(ctx))
  const hfr = await interpolateVideo(need(ctx.comfy, 'comfy'), { input: `${base}.mp4`, output: `${base}.hfr.mp4`, multiplier: interpolationMultiplier(sourceFps), sourceFps })
  ctx.log(`▸ interpolate ${shot.shot}  ${hfr.seconds.toFixed(1)}s · ${hfr.fps} fps master`)
  await ctx.record('clips', 'interpolate', undefined, { shot: shot.shot, seconds: hfr.seconds, fps: hfr.fps, model: 'rife-4.26' })
  return `${base}.hfr.mp4`
}
