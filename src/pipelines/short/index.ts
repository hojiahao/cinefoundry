import { writeNarrativeDeliveryReport } from '../../crafts/narrative/delivery.js'
import type { PipelineDef } from '../../engine/pipeline.js'
import type { NarrativeContext, NarrativeOptions } from '../../crafts/narrative/context.js'
import { NARRATIVE_FOLDERS, narrativeContext, narrativePreflight, narrativeStages } from '../../crafts/narrative/pipeline.js'
import { packagingStage } from '../../crafts/narrative/packaging.js'

export interface ShortResult { projectId: string; dir: string; video?: string; wallSeconds: number }

/**
 * The creator short for Douyin, Bilibili and YouTube Shorts: hook in the first three seconds, a presenter or a skit
 * with lip-synced English and bilingual subtitles, then the packaging the feed needs (titles to test, cover, description).
 * Vertical 9:16, 30 fps by default.
 */
export const shortPipeline: PipelineDef<NarrativeOptions, NarrativeContext, ShortResult> = {
  id: 'short',
  title: 'Short video',
  folders: NARRATIVE_FOLDERS,
  stages: [
    ...narrativeStages.map((stage) => (stage.id === 'development' ? { ...stage, label: '选题' } : stage)),
    { id: 'packaging', label: '平台包装', when: (ctx) => !ctx.options.planOnly, run: packagingStage },
  ],
  preflight: async (options) => { options.brandKit = await narrativePreflight({ fps: 30, ...options, episodes: 1 }, { maxSeconds: 180, maxEpisodes: 1 }) },
  init: async (options, engine) => narrativeContext({ fps: 30, ...options, episodes: 1, produce: 1 }, engine, { writer: { role: 'creator-content writer', skill: 'short-video-scripting' }, seconds: 60, ratio: '9:16' }),
  finish: async (ctx) => {
    if (ctx.outputs.size) await writeNarrativeDeliveryReport(ctx)
    const wallSeconds = (Date.now() - ctx.started) / 1000
    await ctx.record('run', 'director', undefined, { wallSeconds, qaRegenerations: ctx.qaRegenerations })
    return { projectId: ctx.projectId!, dir: ctx.dir!, video: ctx.outputs.get(1), wallSeconds }
  },
}
