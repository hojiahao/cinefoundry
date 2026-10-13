import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ComfyClient } from '../comfy/client.js'
import { generateMusic, mixSoundtrack, synthesizeVoices } from '../lib/audio.js'
import { assembleFilm, clipStart, filmLength, fontCovers, stillToClip } from '../lib/ffmpeg.js'
import { memoryStatus } from '../lib/memory.js'
import { buildAss } from '../lib/titles.js'
import type { Brief, Script, Storyboard } from './checks.js'
import { writeDeliveryReport } from './delivery.js'

export const FINAL_SIZE: Record<string, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] }
export const CROSSFADE_SECONDS = 0.4
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
}

/** The cut stage: end card, typography, sound and the finishing pass. Used by the harness and by `cineloom cut`. */
export async function finishFilm(input: FinishInput): Promise<string> {
  const { dir, brief, script, storyboard, comfy, record, log } = input
  const hero = { path: input.heroPath }
  const options = { audio: input.audio, silent: input.silent }
  await mkdir(join(dir, 'cut'), { recursive: true })
  const [width, height] = FINAL_SIZE[brief.ratio]!
  const clipPaths = storyboard.shots.map((shot) => join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}.mp4`))
  const durations = storyboard.shots.map(() => 5)

  // End card: the approved hero still with the brand and the single message. It guarantees the
  // film closes on the product, and that the brand text on screen is typeset, not generated.
  const endCard = join(dir, 'clips', 'endcard.mp4')
  await stillToClip(input.endStill ?? hero.path, endCard, { width, height, fps: 24, seconds: END_CARD_SECONDS })
  clipPaths.push(endCard)
  durations.push(END_CARD_SECONDS)

  // Titles and subtitles are typeset here in a real font; the image model is never asked to draw them.
  const cues = script.beats.map((beat, index) => ({
    start: clipStart(index, durations, CROSSFADE_SECONDS),
    end: clipStart(index, durations, CROSSFADE_SECONDS) + durations[index]!,
    title: beat.text,
    subtitle: beat.vo,
  }))
  const endStart = clipStart(durations.length - 1, durations, CROSSFADE_SECONDS)
  // The hero still already carries the brand on its label, so the end card adds only the message,
  // or the client's own closing line when the request quoted one.
  const closing = brief.tagline?.trim() || brief.message
  cues.push({ start: endStart, end: endStart + END_CARD_SECONDS, title: '', subtitle: '', closing } as (typeof cues)[number] & { closing: string })
  const onScreen = cues.map((cue) => `${cue.title ?? ''}${cue.subtitle ?? ''}`).join('') + closing
  const coverage = await fontCovers(TITLE_FONT, onScreen)
  if (!coverage.ok) throw new Error(`The title font ${TITLE_FONT} has no glyph for: ${coverage.missing.join(' ')}. Refusing to render boxes on screen.`)
  const ass = join(dir, 'cut', 'titles.ass')
  await writeFile(ass, buildAss(cues, width, height, TITLE_FONT))

  // Sound: offline voiceover per beat over a generated instrumental bed that ducks under the voice.
  let soundtrack: string | undefined
  if (!options.silent) {
    const total = filmLength(durations, CROSSFADE_SECONDS)
    const voices: Array<{ path: string; start: number }> = []
    const lines = script.beats.map((beat, index) => ({ text: beat.vo, output: join(dir, 'audio', `vo_${index + 1}.wav`), maxSeconds: durations[index]! - 0.9 }))
    const spoken = await synthesizeVoices(lines)
    for (const [index, beat] of script.beats.entries()) {
      voices.push({ path: lines[index]!.output, start: clipStart(index, durations, CROSSFADE_SECONDS) + 0.45 })
      await record('cut', 'voiceover', undefined, { beat: beat.beat, seconds: spoken[index]!.seconds, speed: spoken[index]!.speed, model: spoken[index]!.model })
    }
    let music = options.audio
    if (!music) {
      await enterPhase(comfy, 'music (ACE-Step)', record)
      music = join(dir, 'audio', 'music.mp3')
      const bed = await generateMusic(comfy, { tags: `instrumental, advertising underscore, ${brief.tone}, clean modern production, no vocals`, seconds: total, output: music })
      log(`▸ music        ${bed.seconds.toFixed(1)}s`)
      await record('cut', 'music', undefined, { seconds: bed.seconds, model: 'ace_step_v1_3.5b' })
      await comfy.free()
    }
    soundtrack = join(dir, 'audio', 'soundtrack.wav')
    await mixSoundtrack({ voices, music, totalSeconds: total, output: soundtrack })
  }

  const finalCut = join(dir, 'cut', 'final.mp4')
  await assembleFilm(clipPaths, finalCut, { width, height, fps: 24, durations, crossfadeSeconds: CROSSFADE_SECONDS, ass, audio: soundtrack })
  await writeDeliveryReport(dir, brief, script, storyboard, finalCut)
  return finalCut
}
