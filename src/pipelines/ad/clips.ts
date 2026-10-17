import { join } from 'node:path'
import { composeVideoNegative, composeVideoPrompt } from '../../agent/checks.js'
import { enterPhase } from '../../agent/finish.js'
import { generateVideo, interpolateVideo, interpolationMultiplier, videoFps, VIDEO_NEGATIVE } from '../../lib/media.js'
import { DEFAULT_FPS, generationResolution } from '../../lib/formats.js'
import { addAsset } from '../../lib/project.js'
import { need, type AdContext } from './context.js'

/** Clips: every shot animated from its approved frame, then interpolated (RIFE) to a high-frame-rate master. */
export async function clipsStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const storyboard = need(ctx.storyboard, 'storyboard')
  const comfy = need(ctx.comfy, 'comfy')
  const industry = brief.industry!
  const { planner, reviewer, frames } = ctx
  const dir = ctx.dir!
  const videoModel = ctx.options.videoModel ?? 'ltx25-fast-nvfp4'
  const clipsPhase = `clips (${videoModel.startsWith('ltx25') ? 'LTX-2.5 Fast' : videoModel === 'seedance' ? 'Seedance' : 'Wan2.2'})`
  await ctx.rest(clipsPhase, [planner, reviewer])
  await enterPhase(comfy, clipsPhase, ctx.record)
  for (const [index, shot] of storyboard.shots.entries()) {
    const output = join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}.mp4`)
    const clip = await generateVideo(comfy, {
      prompt: composeVideoPrompt(shot, industry), negative: composeVideoNegative(VIDEO_NEGATIVE, industry), output, resolution: generationResolution(brief.resolution!), ratio: brief.ratio, durationSeconds: shot.seconds || 5,
      firstFrame: frames.get(shot.shot), freeAfter: index === storyboard.shots.length - 1, model: videoModel,
    })
    ctx.log(`▸ clip ${shot.shot}       ${clip.seconds.toFixed(1)}s`)
    await ctx.record('clips', 'video', undefined, { shot: shot.shot, seconds: clip.seconds })
    await addAsset(brief.id, { id: `clip-${shot.shot}`, kind: 'video', stage: 'clips', path: `clips/shot_${String(shot.shot).padStart(3, '0')}.mp4`, shot: shot.shot, execution: clip.workflow.startsWith('cloud:') ? 'cloud' : 'local-dgx-spark', model: clip.workflow, seconds: clip.seconds })
  }
  // Frame rate: RIFE turns the clips into ~120 fps masters (24 fps x5, Wan2.2 14B's 16 fps x8) while both language models still sleep
  // (601 frames at 1080p is about 15 GB); the cut conforms them to the delivery rate by dropping frames evenly.
  if ((brief.fps ?? DEFAULT_FPS) > 24 && !videoModel.startsWith('seedance')) {
    await enterPhase(comfy, 'interpolate (RIFE)', ctx.record)
    for (const shot of storyboard.shots) {
      const base = join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}`)
      // The clip's own frame rate decides the multiplier: Wan2.2 14B renders at 16 fps, and treating it as 24 played it 1.5x fast.
      const sourceFps = videoFps(videoModel)
      const hfr = await interpolateVideo(comfy, { input: `${base}.mp4`, output: `${base}.hfr.mp4`, multiplier: interpolationMultiplier(sourceFps), sourceFps })
      ctx.log(`▸ interpolate ${shot.shot}  ${hfr.seconds.toFixed(1)}s · ${hfr.fps} fps master`)
      await ctx.record('clips', 'interpolate', undefined, { shot: shot.shot, seconds: hfr.seconds, fps: hfr.fps, model: 'rife-4.26' })
    }
    await comfy.free()
  }
  return `${storyboard.shots.length} clips · ${videoModel}`
}
