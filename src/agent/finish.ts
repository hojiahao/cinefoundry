import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ComfyClient } from '../comfy/client.js'
import { generateMusic, mixSoundtrack, synthesizeVoices } from '../lib/audio.js'
import { existsSync } from 'node:fs'
import { assembleFilm, clipStart, filmLength, fontCovers, GRADES, stillToClip } from '../lib/ffmpeg.js'
import { DEFAULT_FPS, DEFAULT_RESOLUTION, deliverySize, isUpscaled } from '../lib/formats.js'
import { memoryStatus, modelRoots, releaseFileCache } from '../lib/memory.js'
import { buildAss, type TitleCue } from '../lib/titles.js'
import { env } from '../lib/config.js'
import { industryOf, type Brief, type Script, type Storyboard } from './checks.js'
import type { Treatment } from '../crafts/treatment.js'
import { castableVoices, voiceReference } from '../lib/voices.js'
import { writeDeliveryReport } from './delivery.js'

/** Overlap into the end card. Between shots the film cuts hard: commercials cut on action and dissolve only to close. */
export const END_DISSOLVE_SECONDS = 0.5
/** Kept for hand-assembled projects (`cinefoundry cut` without a script), which still crossfade every join. */
export const CROSSFADE_SECONDS = 0.4
/** Explicit label required for AI-generated video (人工智能生成合成内容标识办法, in force 2025-09-01). */
export const AI_LABEL = '内容由 AI 生成'
/** The opening seconds that carry the label besides the end card. */
const AI_LABEL_OPENING_SECONDS = 3
export const END_CARD_SECONDS = 3
export const TITLE_FONT = 'Noto Sans CJK SC'
/** Integrated loudness of every ad deliverable (the web profile of the delivery-qc skill); true peak is held at -1.5 dBTP. */
export const AD_LOUDNESS_LUFS = -16
/** The voice line starts this long into its shot: a breath before the announcer speaks. */
export const VOICE_LEAD_SECONDS = 0.45
/** A voice line must end this long before its shot does (the lead plus a breath after it). */
export const VOICE_SLOT_MARGIN_SECONDS = 0.9

export type Recorder = (stage: string, agent: string, endpoint: undefined, detail: Record<string, unknown>) => Promise<void>

/**
 * Phase boundary on a machine with one memory pool: the two LLM services stay resident, but
 * only one diffusion family should. Unload whatever the previous phase left in ComfyUI and
 * record memory, which is the spark-model-scheduler skill carried out by the harness.
 */
export async function enterPhase(comfy: ComfyClient, phase: string, record: Recorder): Promise<void> {
  const before = await memoryStatus()
  await comfy.free()
  // Weights already loaded stay in the page cache, which CUDA on DGX Spark cannot allocate from: release them too.
  const cache = await releaseFileCache(modelRoots())
  const settle = Number(env('CINEFOUNDRY_PHASE_SETTLE_MS'))
  await new Promise((resolve) => setTimeout(resolve, Number.isFinite(settle) ? settle : 3000))
  await record('run', 'scheduler', undefined, { phase, availableBeforeGb: before.availableGb, availableAfterFreeGb: (await memoryStatus()).availableGb, freeBeforeCacheReleaseGb: cache.freeBeforeGb, freeAfterCacheReleaseGb: cache.freeAfterGb })
}

export interface FinishInput {
  dir: string
  brief: Brief
  script: Script
  storyboard: Storyboard
  heroPath: string
  /** Background of the end card instead of the hero still, e.g. the last frame of the last shot. */
  endStill?: string
  comfy: ComfyClient
  audio?: string
  silent?: boolean
  record: Recorder
  log: (line: string) => void
  /** The creative director's treatment: the cast voice and the score direction. */
  treatment?: Treatment
}

/** One shot of an edit: the clip file and the seconds it occupies, taken from the clip's head. */
export interface CutShot { clip: string; seconds: number }

/** Where the score of a cut comes from: generated for this edit, or an existing bed starting `offset` seconds in. */
export type CutMusic = { kind: 'generate' } | { kind: 'file'; path: string; offset: number }

/** Everything one finished film needs: the master and every cutdown go through the same finishing pass. */
export interface CutInput {
  dir: string
  brief: Brief
  /** One beat per shot, in shot order. */
  script: Script
  shots: CutShot[]
  /** The end card clip (END_CARD_SECONDS long), joined with a dissolve of END_DISSOLVE_SECONDS. */
  endCard: string
  /** Absolute paths of the film and of its burned-in ASS. */
  output: string
  ass: string
  /** Voice lines are written to audio/<voicePrefix>_<n>.wav. */
  voicePrefix: string
  music?: CutMusic
  silent?: boolean
  comfy: ComfyClient
  record: Recorder
  log: (line: string) => void
  treatment?: Treatment
  /** The run-log stage of this cut, and fields every record of it carries (e.g. the version). */
  stage: string
  recordTags?: Record<string, unknown>
  /** ProduceID of the implicit AIGC label. */
  produceId: string
}

export interface CutResult {
  path: string
  ass: string
  /** Length of the edit: the sum of durations minus the sum of overlaps. */
  seconds: number
  durations: number[]
  overlaps: number[]
  /** Where each voice line sits on the timeline (empty when silent). */
  speech: Array<{ start: number; end: number }>
  /** The end card on the timeline. */
  endCard: { start: number; end: number }
  /** The score under this cut and the second of the bed it starts at, when there is one. */
  music?: { path: string; offset: number }
  /** The cast voice, when the treatment's voice is designed on this machine. */
  voice?: string
  /** ProduceID written into the implicit AIGC label. */
  produceId: string
}

/** Clip paths of the storyboard's shots: above 24 fps the RIFE-interpolated masters, when the clips stage wrote them. */
export function shotClipPaths(dir: string, storyboard: Storyboard, fps: number): string[] {
  return storyboard.shots.map((shot) => {
    const base = join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}`)
    return fps > 24 && existsSync(`${base}.hfr.mp4`) ? `${base}.hfr.mp4` : `${base}.mp4`
  })
}

/** Where the end card clip of a project lives; the cutdowns reuse the master's. */
export const endCardPath = (dir: string) => join(dir, 'clips', 'endcard.mp4')

/** The end card: the approved hero still (or another still) with a slow push-in, at the delivery size and rate. */
export async function makeEndCard(dir: string, brief: Brief, still: string): Promise<string> {
  const [width, height] = deliverySize(brief.resolution ?? DEFAULT_RESOLUTION, brief.ratio)
  const endCard = endCardPath(dir)
  await stillToClip(still, endCard, { width, height, fps: brief.fps ?? DEFAULT_FPS, seconds: END_CARD_SECONDS })
  return endCard
}

/** The cut stage: end card, typography, sound and the finishing pass. Used by `cinefoundry cut`. */
export async function finishFilm(input: FinishInput): Promise<string> {
  const result = await finishMaster(input)
  await writeDeliveryReport(input.dir, input.brief, input.storyboard, result.path)
  return result.path
}

/** The master: every storyboard shot at its full 5 s, hard cuts, a dissolve into the end card. */
export async function finishMaster(input: FinishInput): Promise<CutResult> {
  const { dir, brief, storyboard } = input
  await mkdir(join(dir, 'cut'), { recursive: true })
  // The end card guarantees the film closes on the product, and that the brand text on screen is typeset, not generated.
  const endCard = await makeEndCard(dir, brief, input.endStill ?? input.heroPath)
  return cutFilm({
    dir, brief, script: input.script, shots: shotClipPaths(dir, storyboard, brief.fps ?? DEFAULT_FPS).map((clip) => ({ clip, seconds: 5 })), endCard,
    output: join(dir, 'cut', 'final.mp4'), ass: join(dir, 'cut', 'titles.ass'), voicePrefix: 'vo',
    music: input.audio ? { kind: 'file', path: input.audio, offset: 0 } : { kind: 'generate' }, silent: input.silent,
    comfy: input.comfy, record: input.record, log: input.log, treatment: input.treatment, stage: 'cut', produceId: brief.id,
  })
}

/**
 * One finished film from an edit decision list: titles and bilingual subtitles typeset in a checked font, the explicit
 * AI label on the opening and the end card, offline voiceover in the cast voice over a ducked score, one grade, the
 * loudness target and the implicit AIGC metadata. The master and every cutdown go through it, so they are finished alike.
 */
export async function cutFilm(input: CutInput): Promise<CutResult> {
  const { dir, brief, script, comfy, record, log, stage } = input
  const tags = input.recordTags ?? {}
  if (script.beats.length !== input.shots.length) throw new Error(`internal: ${script.beats.length} beats for ${input.shots.length} shots`)
  await mkdir(join(dir, 'cut'), { recursive: true })
  const resolution = brief.resolution ?? DEFAULT_RESOLUTION
  const fps = brief.fps ?? DEFAULT_FPS
  const [width, height] = deliverySize(resolution, brief.ratio)
  const clipPaths = [...input.shots.map((shot) => shot.clip), input.endCard]
  const durations = [...input.shots.map((shot) => shot.seconds), END_CARD_SECONDS]
  // Hard cuts between shots, one dissolve into the end card.
  const overlaps = [...input.shots.slice(1).map(() => 0), END_DISSOLVE_SECONDS]
  const total = filmLength(durations, overlaps)

  // Titles and subtitles are typeset here in a real font; the image model is never asked to draw them.
  const cues: TitleCue[] = script.beats.map((beat, index) => ({
    start: clipStart(index, durations, overlaps),
    end: clipStart(index, durations, overlaps) + durations[index]!,
    title: beat.text,
    subtitle: beat.zh,
    subtitleEn: beat.vo,
  }))
  const endStart = clipStart(durations.length - 1, durations, overlaps)
  // The hero still already carries the brand on its label, so the end card adds only the message,
  // or the client's own closing line when the request quoted one.
  const closing = brief.tagline?.trim() || brief.message
  cues.push({ start: endStart, end: endStart + END_CARD_SECONDS, title: '', subtitle: '', closing })
  // The explicit AI label: on the opening seconds and on the end card.
  cues.push({ start: 0, end: AI_LABEL_OPENING_SECONDS, title: '', subtitle: '', label: AI_LABEL })
  cues.push({ start: endStart, end: endStart + END_CARD_SECONDS, title: '', subtitle: '', label: AI_LABEL })
  const onScreen = cues.map((cue) => `${cue.title ?? ''}${cue.subtitle ?? ''}`).join('') + closing + AI_LABEL
  const coverage = await fontCovers(TITLE_FONT, onScreen)
  if (!coverage.ok) throw new Error(`The title font ${TITLE_FONT} has no glyph for: ${coverage.missing.join(' ')}. Refusing to render boxes on screen.`)

  // Sound: offline voiceover per beat over an instrumental bed that ducks under the voice.
  let soundtrack: string | undefined
  const speech: CutResult['speech'] = []
  let music: CutResult['music']
  let voice: string | undefined
  if (!input.silent) {
    const voices: Array<{ path: string; start: number }> = []
    const lines = script.beats.map((beat, index) => ({ text: beat.vo, output: join(dir, 'audio', `${input.voicePrefix}_${index + 1}.wav`), maxSeconds: durations[index]! - VOICE_SLOT_MARGIN_SECONDS }))
    // The voice model runs in its own container on the same memory pool. Free what the video phase left in ComfyUI
    // first: the nuts film died here with "CUDA error: out of memory" after all three clips were done. One retry
    // after another free covers a model that was still releasing.
    await enterPhase(comfy, 'voiceover (TTS)', record)
    // The announcer the creative director cast, when that voice has been designed on this machine.
    const cast = input.treatment && castableVoices().some((v) => v.id === input.treatment!.sound.voice) ? voiceReference(input.treatment.sound.voice) : undefined
    if (cast) {
      voice = input.treatment!.sound.voice
      log(`  voice        ${voice} (cast by the creative director)`)
    }
    const spoken = await synthesizeVoices(lines, cast).catch(async (error: Error) => {
      if (!/out of memory|CUDA error/i.test(error.message)) throw error
      log('  voiceover ran out of memory; freeing ComfyUI and retrying once')
      await comfy.free()
      await new Promise((resolve) => setTimeout(resolve, 20000))
      await record('run', 'scheduler', undefined, { phase: 'voiceover retry', availableBeforeGb: (await memoryStatus()).availableGb })
      return synthesizeVoices(lines, cast)
    })
    for (const [index, beat] of script.beats.entries()) {
      const voiceStart = clipStart(index, durations, overlaps) + VOICE_LEAD_SECONDS
      voices.push({ path: lines[index]!.output, start: voiceStart })
      speech.push({ start: voiceStart, end: voiceStart + spoken[index]!.seconds })
      // Subtitles follow the voice: on when the line starts, off a breath after it ends - never on screen in silence.
      const cue = cues[index]!
      cue.subtitleStart = voiceStart
      cue.subtitleEnd = Math.min(voiceStart + spoken[index]!.seconds + 0.25, cue.end - 0.1)
      await record(stage, 'voiceover', undefined, { ...tags, beat: beat.beat, seconds: spoken[index]!.seconds, speed: spoken[index]!.speed, model: spoken[index]!.model, ...(voice ? { voice } : {}) })
    }
    const source: CutMusic = input.music ?? { kind: 'generate' }
    if (source.kind === 'file') music = { path: source.path, offset: source.offset }
    else {
      await enterPhase(comfy, 'music (ACE-Step)', record)
      const path = join(dir, 'audio', 'music.mp3')
      const direction = input.treatment?.sound.music ?? `advertising underscore, ${brief.tone}`
      const bed = await generateMusic(comfy, { tags: `instrumental, ${direction}, high-end commercial score, clean modern production, no vocals`, seconds: total, output: path })
      log(`▸ music        ${bed.seconds.toFixed(1)}s`)
      await record(stage, 'music', undefined, { ...tags, seconds: bed.seconds, model: 'ace_step_v1_3.5b' })
      await comfy.free()
      music = { path, offset: 0 }
    }
    soundtrack = join(dir, 'audio', input.voicePrefix === 'vo' ? 'soundtrack.wav' : `${input.voicePrefix}_soundtrack.wav`)
    await mixSoundtrack({ voices, music: music.path, musicOffset: music.offset, totalSeconds: total, output: soundtrack })
  }

  await writeFile(input.ass, buildAss(cues, width, height, TITLE_FONT))
  const industry = brief.industry ?? industryOf(`${brief.product} ${brief.title}`)
  // Implicit label (GB 45438-2025 style AIGC metadata) next to the explicit one burned into the picture.
  const aigc = JSON.stringify({ Label: '1', ContentProducer: 'Cinefoundry', ProduceID: input.produceId, ReservedCode1: '', ContentPropagator: '', PropagateID: '', ReservedCode2: '' })
  await assembleFilm(clipPaths, input.output, {
    width, height, fps, durations, crossfadeSeconds: overlaps, ass: input.ass, audio: soundtrack, grade: GRADES[industry] ?? GRADES.neutral, loudness: AD_LOUDNESS_LUFS,
    metadata: { AIGC: aigc, comment: `${AI_LABEL} · Cinefoundry · ${input.produceId}`, title: brief.title },
  })
  if (isUpscaled(resolution)) await record(stage, 'conform', undefined, { ...tags, resolution, width, height, upscaled: true, note: 'generated at native 1080p, upscaled to the delivery size' })
  return { path: input.output, ass: input.ass, produceId: input.produceId, seconds: total, durations, overlaps, speech, endCard: { start: endStart, end: endStart + END_CARD_SECONDS }, ...(music ? { music } : {}), ...(voice ? { voice } : {}) }
}
