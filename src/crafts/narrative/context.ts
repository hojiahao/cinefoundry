import { env } from '../../lib/config.js'
import { modelRoots, releaseFileCache } from '../../lib/memory.js'
import type { WritersRoom } from '../../lib/writers-room.js'
import { ComfyClient } from '../../comfy/client.js'
import type { ModelEndpoint } from '../../agent/llm.js'
import type { EngineContext } from '../../engine/pipeline.js'
import type { EngineOptions } from '../../engine/run.js'
import type { VideoModel } from '../../lib/media.js'
import type { CastMember } from './casting.js'
import type { SoundPlan } from './production.js'
import type { Packaging } from './packaging.js'
import type { NarrativeShot, Screenplay, SeriesBible } from './types.js'
import type { BrandProduct, LoadedBrand } from '../brand.js'

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
  /** A cast folder of an earlier run (projects/<id>/cast): characters recorded there are reused, not recast. */
  castDir?: string
  /** Stop after the shot breakdown, before any GPU time. */
  planOnly?: boolean
  /** The brand kit (brands/<id>/) the film is made under; checked in preflight, refused when the check fails. */
  brand?: string
  /** The kit's product the film features, by id; by default the one the request names, else the kit's first. */
  product?: string
  /** Set by preflight: the checked kit, so the run uses exactly what was checked. */
  brandKit?: LoadedBrand
}

/** The working state of a narrative film. Keys of `frames`, `clips` and `lines` are "episode:shot" / "episode:scene:line". */
export interface NarrativeContext extends EngineContext {
  options: NarrativeOptions
  planner: ModelEndpoint
  /** The writers' room: development, screenplay, script notes, shot list and casting briefs (the planner when none is configured). */
  author: ModelEndpoint
  reviewer: ModelEndpoint
  editor: ModelEndpoint
  /** Which writing skill frames the story: series-development for dramas, short-video-scripting for shorts. */
  writer: { role: string; skill: string }
  episodeSeconds: number
  ratio: '9:16' | '16:9' | '1:1'
  bible?: SeriesBible
  /** Character id -> the cast record and reference pack (cast/<id>/). */
  cast: Map<string, CastMember>
  /** Character id -> locked master portrait, the identity of record. */
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
  /** Per episode: the sound designer's plan, written in the writers' room when there is one. */
  soundPlans: Map<number, SoundPlan>
  /** A short's packaging copy, drafted in the writers' room when there is one. */
  packagingDraft?: Packaging
  /** The brand kit and the product the film features, when it is made under one. */
  brand?: LoadedBrand & { product: BrandProduct; presenters: CastMember[] }
}

export const key = (...parts: number[]) => parts.join(':')
export const produced = (ctx: NarrativeContext) => (ctx.bible?.episodes ?? []).slice(0, ctx.options.produce ?? ctx.bible?.episodes.length ?? 1).map((e) => e.episode)

/** This run's writers' room: the author works while the planner and the vision reviewer sleep. */
export function writersRoom(ctx: NarrativeContext): WritersRoom {
  return {
    author: { endpoint: ctx.author, container: env('CINEFOUNDRY_WRITER_CONTAINER') },
    others: [{ endpoint: ctx.planner, container: env('CINEFOUNDRY_PLANNER_CONTAINER') }, { endpoint: ctx.reviewer, container: env('CINEFOUNDRY_VISION_CONTAINER') }],
    log: ctx.log,
    record: (detail) => ctx.record('run', 'writers-room', ctx.author, detail),
    // CUDA here allocates only truly free memory: the page cache of model files read earlier must go, not just ComfyUI.
    freeDiffusion: async () => {
      await (ctx.comfy ??= new ComfyClient()).free()
      await releaseFileCache(modelRoots())
    },
  }
}
