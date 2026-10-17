import type { ComfyClient } from '../../comfy/client.js'
import type { Brief, Script, Storyboard } from '../../agent/checks.js'
import type { QaVerdict } from '../../agent/gate.js'
import type { jevConfig } from '../../agent/jev.js'
import type { ModelEndpoint } from '../../agent/llm.js'
import type { Treatment } from '../../crafts/treatment.js'
import type { VideoModel } from '../../lib/media.js'
import type { EngineContext } from '../../engine/pipeline.js'
import type { EngineOptions } from '../../engine/run.js'

export interface AdOptions extends EngineOptions {
  id?: string
  ratio?: string
  durationSeconds?: number
  /** Stop after the storyboard; useful for evals and for reviewing the plan before spending GPU time. */
  planOnly?: boolean
  /** Delivery resolution preset: 1080p (default), 2k, 4k, 6k; generation runs at most at native 1080p. */
  resolution?: string
  /** Delivery frame rate: 60 (default, RIFE-interpolated from 24), 24, 30 or 120. */
  fps?: number
  videoModel?: VideoModel
  /** Use this music file instead of generating a bed. Only a file the user supplied or has rights to. */
  audio?: string
  /** Leave the film silent (no voiceover, no music). */
  silent?: boolean
  /** A photo of the real product, used as the hero still instead of generating one from text. Only a photo the user has rights to. */
  productImage?: string
  /** Facts the client can substantiate (specs, figures, sources). The copy may claim these and nothing stronger. */
  proof?: string
  /** Frames generated per shot before the gate picks one. */
  candidates?: number
  /** Generate every candidate even after one passed, and keep the best score. Default: stop at the first pass. */
  bestOf?: boolean
  /** Serial scheduling only: render the next shot's first candidate while the current one is judged (default true). */
  prefetch?: boolean
  /** 'queue' (default): every shot's gate loop runs at once. 'serial': one shot after another, as before. */
  frameScheduling?: 'queue' | 'serial'
}

export interface AdResult {
  projectId: string
  dir: string
  finalCut?: string
  rejectedAttempts: Record<string, number>
  qaRegenerations: number
  wallSeconds: number
}

/** The ad film's working state: each stage reads what the earlier ones wrote. */
export interface AdContext extends EngineContext {
  options: AdOptions
  planner: ModelEndpoint
  reviewer: ModelEndpoint
  editor: ModelEndpoint
  /** The optional cloud copy judge; switched off for the run when it cannot be reached. */
  jev: ReturnType<typeof jevConfig>
  jevReview: Array<{ beat: number; line: string; issue: string; probability: number }>
  rejectedAttempts: Record<string, number>
  qaRegenerations: number
  brief?: Brief
  treatment?: Treatment
  script?: Script
  storyboard?: Storyboard
  comfy?: ComfyClient
  hero?: { path: string; verdict: QaVerdict }
  frames: Map<number, string>
  finalCut?: string
  /** The language models waking under the cut; awaited before the run returns. */
  waking?: Promise<unknown>
}

/** A field an earlier stage must have set; reaching a stage without it is a pipeline bug, not a user error. */
export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`internal: ${what} is not set before this stage`)
  return value
}

/**
 * The judge is an optional cloud service. When it cannot be reached (HTTP 451 "not available in your region" once spent
 * all six script attempts) it is switched off for this run and the local checks and the reviewer agent carry on; an
 * outage is not a reason to rewrite the copy.
 */
export async function judgeWith<T>(ctx: AdContext, judge: (config: NonNullable<AdContext['jev']>) => Promise<T>, stage: string): Promise<T | undefined> {
  if (!ctx.jev) return undefined
  try {
    return await judge(ctx.jev)
  } catch (error) {
    ctx.jev = undefined
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200)
    ctx.log(`  jev unavailable, continuing without it: ${reason}`)
    await ctx.record(stage, 'jev', undefined, { execution: 'cloud', unavailable: reason })
    return undefined
  }
}
