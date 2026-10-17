import { runPipeline } from '../engine/run.js'
import { adPipeline, preflight } from '../pipelines/ad/index.js'
import type { AdOptions, AdResult } from '../pipelines/ad/context.js'

/**
 * Compatibility entry for the ad film: the CLI, the evals and the DSH workspace call runHarness. The film itself is the
 * `ad` pipeline (src/pipelines/ad) running on the Cinefoundry Engine (src/engine).
 */
export type HarnessOptions = AdOptions
export type HarnessResult = AdResult

export async function runHarness(options: HarnessOptions): Promise<HarnessResult> {
  return runPipeline(adPipeline, options)
}

export { preflight }
export { statedTagline, statedFormat, faithfulLabel, flaggedBeats } from '../pipelines/ad/request.js'
