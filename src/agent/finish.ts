import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ComfyClient } from '../comfy/client.js'
import { generateMusic, mixSoundtrack, synthesizeVoices } from '../lib/audio.js'
import { existsSync } from 'node:fs'
import { assembleFilm, clipStart, filmLength, fontCovers, GRADES, stillToClip } from '../lib/ffmpeg.js'
import { DEFAULT_FPS, DEFAULT_RESOLUTION, deliverySize, isUpscaled } from '../lib/formats.js'
import { memoryStatus } from '../lib/memory.js'
import { buildAss } from '../lib/titles.js'
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

export type Recorder = (stage: 'run' | 'cut', agent: string, endpoint: undefined, detail: Record<string, unknown>) => Promise<void>

/**
 * Phase boundary on a machine with one memory pool: the two LLM services stay resident, but
 * only one diffusion family should. Unload whatever the previous phase left in ComfyUI and
 * record memory, which is the spark-model-scheduler skill carried out by the harness.
 */
export async function enterPhase(comfy: ComfyClient, phase: string, record: Recorder): Promise<void> {
  const before = await memoryStatus()
  await comfy.free()
  await new Promise((resolve) => setTimeout(resolve, 3000))
  await record('run', 'scheduler', undefined, { phase, availableBeforeGb: before.availableGb, availableAfterFreeGb: (await memoryStatus()).availableGb })
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

/** The cut stage: end card, typography, sound and the finishing pass. Used by the harness and by `cinefoundry cut`. */
export async function finishFilm(input: FinishInput): Promise<string> {
  const { dir, brief, script, storyboard, comfy, record, log } = input
  const hero = { path: input.heroPath }
  const options = { audio: input.audio, silent: input.silent }
  await mkdir(join(dir, 'cut'), { recursive: true })
  const resolution = brief.resolution ?? DEFAULT_RESOLUTION
  const fps = brief.fps ?? DEFAULT_FPS
  const [width, height] = deliverySize(resolution, brief.ratio)
  // Above 24 fps the clips stage has written RIFE-interpolated 120 fps masters next to the 24 fps clips.
  const clipPaths = storyboard.shots.map((shot) => {
    const base = join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}`)
    return fps > 24 && existsSync(`${base}.hfr.mp4`) ? `${base}.hfr.mp4` : `${base}.mp4`
  })
  const durations = storyboard.shots.map(() => 5)
  // Hard cuts between shots, one dissolve into the end card.
  const overlaps = [...storyboard.shots.slice(1).map(() => 0), END_DISSOLVE_SECONDS]

  // End card: the approved hero still with the brand and the single message. It guarantees the
  // film closes on the product, and that the brand text on screen is typeset, not generated.
  const endCard = join(dir, 'clips', 'endcard.mp4')
  await stillToClip(input.endStill ?? hero.path, endCard, { width, height, fps, seconds: END_CARD_SECONDS })
  clipPaths.push(endCard)
  durations.push(END_CARD_SECONDS)

  // Titles and subtitles are typeset here in a real font; the image model is never asked to draw them.
  const cues = script.beats.map((beat, index) => ({
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
  cues.push({ start: endStart, end: endStart + END_CARD_SECONDS, title: '', subtitle: '', closing } as (typeof cues)[number] & { closing: string })
  // The explicit AI label: on the opening seconds and on the end card.
  cues.push({ start: 0, end: AI_LABEL_OPENING_SECONDS, title: '', subtitle: '', label: AI_LABEL } as (typeof cues)[number] & { label: string })
  cues.push({ start: endStart, end: endStart + END_CARD_SECONDS, title: '', subtitle: '', label: AI_LABEL } as (typeof cues)[number] & { label: string })
  const onScreen = cues.map((cue) => `${cue.title ?? ''}${cue.subtitle ?? ''}`).join('') + closing + AI_LABEL
  const coverage = await fontCovers(TITLE_FONT, onScreen)
  if (!coverage.ok) throw new Error(`The title font ${TITLE_FONT} has no glyph for: ${coverage.missing.join(' ')}. Refusing to render boxes on screen.`)

  // Sound: offline voiceover per beat over a generated instrumental bed that ducks under the voice.
  let soundtrack: string | undefined
  if (!options.silent) {
    const total = filmLength(durations, overlaps)
    const voices: Array<{ path: string; start: number }> = []
    const lines = script.beats.map((beat, index) => ({ text: beat.vo, output: join(dir, 'audio', `vo_${index + 1}.wav`), maxSeconds: durations[index]! - 0.9 }))
    // The voice model runs in its own container on the same memory pool. Free what the video phase left in ComfyUI
    // first: the nuts film died here with "CUDA error: out of memory" after all three clips were done. One retry
    // after another free covers a model that was still releasing.
    await enterPhase(comfy, 'voiceover (TTS)', record)
    // The announcer the creative director cast, when that voice has been designed on this machine.
    const cast = input.treatment && castableVoices().some((v) => v.id === input.treatment!.sound.voice) ? voiceReference(input.treatment.sound.voice) : undefined
    if (cast) log(`  voice        ${input.treatment!.sound.voice} (cast by the creative director)`)
    const spoken = await synthesizeVoices(lines, cast).catch(async (error: Error) => {
      if (!/out of memory|CUDA error/i.test(error.message)) throw error
      log('  voiceover ran out of memory; freeing ComfyUI and retrying once')
      await comfy.free()
      await new Promise((resolve) => setTimeout(resolve, 20000))
      await record('run', 'scheduler', undefined, { phase: 'voiceover retry', availableBeforeGb: (await memoryStatus()).availableGb })
      return synthesizeVoices(lines, cast)
    })
    for (const [index, beat] of script.beats.entries()) {
      const voiceStart = clipStart(index, durations, overlaps) + 0.45
      voices.push({ path: lines[index]!.output, start: voiceStart })
      // Subtitles follow the voice: on when the line starts, off a breath after it ends - never on screen in silence.
      const cue = cues[index] as (typeof cues)[number] & { subtitleStart?: number; subtitleEnd?: number }
      cue.subtitleStart = voiceStart
      cue.subtitleEnd = Math.min(voiceStart + spoken[index]!.seconds + 0.25, cue.end - 0.1)
      await record('cut', 'voiceover', undefined, { beat: beat.beat, seconds: spoken[index]!.seconds, speed: spoken[index]!.speed, model: spoken[index]!.model })
    }
    let music = options.audio
    if (!music) {
      await enterPhase(comfy, 'music (ACE-Step)', record)
      music = join(dir, 'audio', 'music.mp3')
      const direction = input.treatment?.sound.music ?? `advertising underscore, ${brief.tone}`
      const bed = await generateMusic(comfy, { tags: `instrumental, ${direction}, high-end commercial score, clean modern production, no vocals`, seconds: total, output: music })
      log(`▸ music        ${bed.seconds.toFixed(1)}s`)
      await record('cut', 'music', undefined, { seconds: bed.seconds, model: 'ace_step_v1_3.5b' })
      await comfy.free()
    }
    soundtrack = join(dir, 'audio', 'soundtrack.wav')
    await mixSoundtrack({ voices, music, totalSeconds: total, output: soundtrack })
  }

  const ass = join(dir, 'cut', 'titles.ass')
  await writeFile(ass, buildAss(cues, width, height, TITLE_FONT))

  const finalCut = join(dir, 'cut', 'final.mp4')
  const industry = brief.industry ?? industryOf(`${brief.product} ${brief.title}`)
  // Implicit label (GB 45438-2025 style AIGC metadata) next to the explicit one burned into the picture.
  const aigc = JSON.stringify({ Label: '1', ContentProducer: 'Cinefoundry', ProduceID: brief.id, ReservedCode1: '', ContentPropagator: '', PropagateID: '', ReservedCode2: '' })
  await assembleFilm(clipPaths, finalCut, {
    width, height, fps, durations, crossfadeSeconds: overlaps, ass, audio: soundtrack, grade: GRADES[industry] ?? GRADES.neutral,
    metadata: { AIGC: aigc, comment: `${AI_LABEL} · Cinefoundry · ${brief.id}`, title: brief.title },
  })
  if (isUpscaled(resolution)) await record('cut', 'conform', undefined, { resolution, width, height, upscaled: true, note: 'generated at native 1080p, upscaled to the delivery size' })
  await writeDeliveryReport(dir, brief, script, storyboard, finalCut)
  return finalCut
}
