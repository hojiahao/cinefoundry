import { closeWritersRoom } from '../../lib/writers-room.js'
import { writersRoom } from '../../crafts/narrative/context.js'
import { writeNarrativeDeliveryReport } from '../../crafts/narrative/delivery.js'
import type { PipelineDef } from '../../engine/pipeline.js'
import type { NarrativeContext, NarrativeOptions } from '../../crafts/narrative/context.js'
import { NARRATIVE_FOLDERS, narrativeContext, narrativePreflight, narrativeStages } from '../../crafts/narrative/pipeline.js'

export interface DramaResult { projectId: string; dir: string; episodes: Record<number, string>; wallSeconds: number }

/**
 * The micro-drama: a series bible, a cast with locked faces and designed voices, then episode after episode -
 * screenplay, compliance, shots, frames, lip-synced dialogue, sound, cut. Vertical 9:16 at 24 fps by default:
 * a higher rate reads as soap opera.
 */
export const dramaPipeline: PipelineDef<NarrativeOptions, NarrativeContext, DramaResult> = {
  id: 'drama',
  title: 'Micro-drama',
  folders: NARRATIVE_FOLDERS,
  stages: narrativeStages,
  preflight: async (options) => { options.brandKit = await narrativePreflight({ fps: 24, ...options }, { maxSeconds: 180, maxEpisodes: 30 }) },
  init: async (options, engine) => narrativeContext({ fps: 24, ...options }, engine, { writer: { role: 'showrunner and head writer', skill: 'series-development' }, seconds: 120, ratio: '9:16' }),
  // A run that fails or is stopped inside the writers' room gives the planner and the vision model their memory back.
  cleanup: (ctx) => closeWritersRoom(writersRoom(ctx)),
  finish: async (ctx) => {
    if (ctx.outputs.size) await writeNarrativeDeliveryReport(ctx)
    const wallSeconds = (Date.now() - ctx.started) / 1000
    await ctx.record('run', 'director', undefined, { wallSeconds, episodes: [...ctx.outputs.keys()], qaRegenerations: ctx.qaRegenerations })
    return { projectId: ctx.projectId!, dir: ctx.dir!, episodes: Object.fromEntries(ctx.outputs), wallSeconds }
  },
}
