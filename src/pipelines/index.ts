import { adPipeline } from './ad/index.js'
import { dramaPipeline } from './drama/index.js'
import { shortPipeline } from './short/index.js'

/** Every format the engine can make. A new format is a new pipeline registered here. */
export const PIPELINES = { ad: adPipeline, short: shortPipeline, drama: dramaPipeline } as const
export type Format = keyof typeof PIPELINES
export const isFormat = (value: string): value is Format => value in PIPELINES
