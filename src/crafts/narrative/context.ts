import type { ComfyClient } from '../../comfy/client.js'
import type { ModelEndpoint } from '../../agent/llm.js'
import type { EngineContext } from '../../engine/pipeline.js'
import type { EngineOptions } from '../../engine/run.js'
import type { VideoModel } from '../../lib/media.js'
import type { NarrativeShot, Screenplay, SeriesBible } from './types.js'

export interface NarrativeOptions extends EngineOptions {
  id?: string
  /** Episodes in the series plan (a short is one). */
  episodes?: number
  /** How many of the planned episodes to make in this run, from episode 1 (default: all). */
  produce?: number
  /** Running time of one episode in seconds, a multiple of 5 (each shot is 5 s). */
  episodeSeconds?: number
  ratio?: string
  resolution?: string
  /** Drama is 24 fps (a higher rate reads as soap opera); creator shorts may run 30 or 60. */
  fps?: number
  videoModel?: VideoModel
  /** Frames generated per shot before the gate picks one. */
  candidates?: number
  /** Stop after the shot breakdown, before any GPU time. */
  planOnly?: boolean
}

/** The working state of a narrative film. Keys of `frames`, `clips` and `lines` are "episode:shot" / "episode:scene:line". */
export interface NarrativeContext extends EngineContext {
  options: NarrativeOptions
  planner: ModelEndpoint
  reviewer: ModelEndpoint
  editor: ModelEndpoint
  /** Which writing skill frames the story: series-development for dramas, short-video-scripting for shorts. */
  writer: { role: string; skill: string }
  episodeSeconds: number
  ratio: '9:16' | '16:9' | '1:1'
  bible?: SeriesBible
  /** Character id -> locked reference portrait. */
  sheets: Map<string, string>
  /** Character id (and "vo") -> the designed voice every line is cloned from. */
  voices: Map<string, { wav: string; text: string }>
  plays: Screenplay[]
  shots: Map<number, NarrativeShot[]>
  frames: Map<string, string>
  clips: Map<string, string>
  lines: Map<string, { wav: string; seconds: number; cer: number }>
  /** Per episode: ambience per scene, effects per shot, the score. */
  sound: Map<number, { ambience: Map<number, string>; sfx: Map<number, string>; music?: string }>
  comfy?: ComfyClient
  /** Episode number -> finished file. */
  outputs: Map<number, string>
  qaRegenerations: number
}

export const key = (...parts: number[]) => parts.join(':')
export const produced = (ctx: NarrativeContext) => (ctx.bible?.episodes ?? []).slice(0, ctx.options.produce ?? ctx.bible?.episodes.length ?? 1).map((e) => e.episode)
