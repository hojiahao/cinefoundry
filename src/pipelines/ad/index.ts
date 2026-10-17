import { access } from 'node:fs/promises'
import { exec } from '../../lib/exec.js'
import { cloudVideoConfig } from '../../lib/cloudvideo.js'
import { DEFAULT_FPS, DEFAULT_RESOLUTION, RATIOS, checkFps, generationResolution, isRatio } from '../../lib/formats.js'
import type { VideoModel } from '../../lib/media.js'
import { castableVoices } from '../../lib/voices.js'
import { memoryStatus } from '../../lib/memory.js'
import { endpoints } from '../../agent/llm.js'
import { jevConfig } from '../../agent/jev.js'
import { TITLE_FONT } from '../../agent/finish.js'
import { writeDeliveryReport } from '../../agent/delivery.js'
import type { PipelineDef } from '../../engine/pipeline.js'
import type { AdContext, AdOptions, AdResult } from './context.js'
import { intakeStage } from './intake.js'
import { creativeStage } from './creative.js'
import { scriptStage } from './script.js'
import { complianceStage } from './compliance.js'
import { storyboardStage } from './storyboard.js'
import { framesStage } from './frames.js'
import { clipsStage } from './clips.js'
import { cutStage } from './cut.js'
import { versionsStage } from './versions.js'
import { adQcStage } from './qc.js'

const VIDEO_MODEL_IDS: VideoModel[] = ['ltx25-fast-nvfp4', 'ltx25-fast', 'wan22-14b', 'wan22-5b', 'seedance']

/**
 * Everything that can be checked before the first model call is checked here: a typo in --video-model or a 12-second
 * duration used to surface only after the frames, or after six script attempts, had spent their GPU time.
 */
export async function preflight(options: AdOptions): Promise<void> {
  const problems: string[] = []
  if (options.ratio && !isRatio(options.ratio)) problems.push(`--ratio ${options.ratio}: use ${RATIOS.join(', ')}`)
  if (options.durationSeconds !== undefined && !(options.durationSeconds % 5 === 0 && options.durationSeconds >= 5 && options.durationSeconds <= 30)) problems.push(`--duration ${options.durationSeconds}: a multiple of 5 from 5 to 30 (clips are 5 s)`)
  try { generationResolution(options.resolution ?? DEFAULT_RESOLUTION) } catch (error) { problems.push((error as Error).message) }
  try { checkFps(options.fps ?? DEFAULT_FPS) } catch (error) { problems.push((error as Error).message) }
  if (options.videoModel && !VIDEO_MODEL_IDS.includes(options.videoModel)) problems.push(`--video-model ${options.videoModel}: use ${VIDEO_MODEL_IDS.join(', ')}`)
  if (options.videoModel === 'seedance' && !cloudVideoConfig()) problems.push('--video-model seedance needs ARK_API_KEY')
  if (options.frameScheduling && !['queue', 'serial'].includes(options.frameScheduling)) problems.push(`--frame-scheduling ${options.frameScheduling}: use queue or serial`)
  if (options.productImage) await access(options.productImage).catch(() => problems.push(`Product image not found: ${options.productImage}`))
  if (options.audio) await access(options.audio).catch(() => problems.push(`Music file not found: ${options.audio}`))
  // The announcer reads English: without an English announcer that passed voice QC there is nobody to cast, and the
  // fallback engine would read English copy in a Mandarin voice. Refuse before any model time is spent.
  if (!options.silent && !options.planOnly && castableVoices({ language: 'English', use: 'announcer' }).length === 0) {
    problems.push('no English announcer in the casting library has passed voice QC on this machine: run scripts/voice-design.py and scripts/voice-qc.py (deploy/voices/library.json), or pass --silent')
  }
  if (!options.planOnly) {
    const fonts = await exec('fc-list', [':', 'family']).then((r) => r.stdout).catch(() => '')
    if (fonts && !fonts.includes(TITLE_FONT)) problems.push(`title font "${TITLE_FONT}" is not installed (fc-list)`)
  }
  if (problems.length) throw new Error(`Cannot start: ${problems.join('; ')}`)
}

const media = (ctx: AdContext) => !ctx.options.planOnly

/**
 * The ad film: brief -> creative -> script -> compliance -> storyboard -> frames + gate -> clips -> cut -> versions -> qc.
 * A 30-second master by default (six 5-second shots and an end card), 16:9, native 1080p, 60 fps, with its 15- and
 * 6-second cutdowns, every deliverable measured by delivery QC.
 */
export const adPipeline: PipelineDef<AdOptions, AdContext, AdResult> = {
  id: 'ad',
  title: 'Ad film',
  folders: ['creative', 'script', 'storyboard', 'frames', 'clips', 'cut', 'reports'],
  preflight,
  stages: [
    { id: 'brief', label: '需求', run: intakeStage },
    { id: 'creative', label: '创意', run: creativeStage },
    { id: 'script', label: '脚本', run: scriptStage },
    { id: 'compliance', label: '合规', run: complianceStage },
    { id: 'storyboard', label: '分镜', run: storyboardStage },
    { id: 'frames', label: '生图', alsoMarks: ['qa'], when: media, run: framesStage },
    { id: 'clips', label: '生视频', when: media, run: clipsStage },
    { id: 'cut', label: '成片', when: media, run: cutStage },
    { id: 'versions', label: '版本', when: media, run: versionsStage },
    { id: 'qc', label: '技术质检', when: media, run: adQcStage },
  ],
  init: async (options, engine) => {
    const { planner, reviewer, editor } = endpoints()
    return Object.assign(engine, { options, planner, reviewer, editor, jev: jevConfig(), jevReview: [], rejectedAttempts: {}, qaRegenerations: 0, frames: new Map<number, string>(), versions: [] }) as AdContext
  },
  finish: async (ctx) => {
    const result: AdResult = { projectId: ctx.projectId!, dir: ctx.dir!, finalCut: ctx.finalCut, versions: Object.fromEntries(ctx.versions.map((v) => [v.spec.id, v.cut.path])), ...(ctx.qc ? { qc: ctx.qc } : {}), rejectedAttempts: ctx.rejectedAttempts, qaRegenerations: ctx.qaRegenerations, wallSeconds: 0 }
    if (ctx.finalCut) {
      // The language models were woken while the film was being finished; make sure both are back before we return.
      await ctx.waking
      result.wallSeconds = (Date.now() - ctx.started) / 1000
      await ctx.record('run', 'director', undefined, { wallSeconds: result.wallSeconds, frameScheduling: ctx.options.frameScheduling ?? 'queue', qaRegenerations: ctx.qaRegenerations, rejectedAttempts: ctx.rejectedAttempts, memoryAtEnd: await memoryStatus() })
      // The report written inside finishFilm predates this final record; write it again so it carries the total.
      await writeDeliveryReport(ctx.dir!, ctx.brief!, ctx.script!, ctx.storyboard!, ctx.finalCut)
      ctx.log(`▸ cut          ${ctx.finalCut}`)
    } else result.wallSeconds = (Date.now() - ctx.started) / 1000
    return result
  },
}
