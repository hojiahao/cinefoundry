import type { EngineContext } from '../engine/pipeline.js'
import type { RevisionDef } from '../engine/revise.js'
import { narrativeRevision } from '../crafts/narrative/revise.js'
import { adPipeline } from './ad/index.js'
import { adRevision } from './ad/revise.js'
import { dramaPipeline } from './drama/index.js'
import { shortPipeline } from './short/index.js'

/** Every format the engine can make. A new format is a new pipeline registered here. */
export const PIPELINES = { ad: adPipeline, short: shortPipeline, drama: dramaPipeline } as const
export type Format = keyof typeof PIPELINES
export const isFormat = (value: string): value is Format => value in PIPELINES

/** How each format revises a finished project (`cinefoundry revise`), on its own stage functions. */
export const REVISIONS: Record<Format, RevisionDef<EngineContext>> = {
  ad: adRevision as unknown as RevisionDef<EngineContext>,
  short: narrativeRevision as unknown as RevisionDef<EngineContext>,
  drama: narrativeRevision as unknown as RevisionDef<EngineContext>,
}
