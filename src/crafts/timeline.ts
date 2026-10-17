import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { mixSoundtrack } from '../lib/audio.js'
import { exec } from '../lib/exec.js'
import { mixNarrative } from './narrative/mix.js'

/**
 * The edit decision record of one finished cut, written by the cut itself (cut/<label>.timeline.json): which clip plays
 * where and from which second of its source, every sound on its bus, every subtitle, the end card and the shot
 * markers. Revisions re-cut from it and `cinefoundry export` turns it into EDL, FCPXML and OpenTimelineIO.
 * Paths are relative to the project folder when the file lives inside it.
 */
export interface TimelineClip {
  kind: 'shot' | 'endcard'
  /** Storyboard shot number (an episode's shot number in a narrative film). */
  shot?: number
  episode?: number
  scene?: number
  source: string
  /** Where the clip starts on the record (film) timeline, s. */
  start: number
  /** The second of the source the clip starts at. */
  in: number
  /** Seconds the clip occupies on the record timeline until the next clip starts. */
  duration: number
  /**
   * A dissolve from the previous clip that starts on this clip's first frame: the previous clip's media continues under
   * it for `seconds` past its out point (it has that handle: shots are used from their head and are never shorter).
   */
  transitionIn?: { seconds: number }
}

export type AudioBus = 'dialogue' | 'music' | 'effects' | 'ambience'
export const AUDIO_BUSES: AudioBus[] = ['dialogue', 'music', 'effects', 'ambience']

export interface TimelineAudio {
  source: string
  start: number
  /** The second of the source the sound starts at (a back-timed score starts late). */
  in: number
  duration: number
  /** A bed shorter than its scene loops (narrative ambience). */
  loop?: boolean
  /** Line key ("episode:scene:line") or beat number of a voice. */
  line?: string
  beat?: number
}

export interface TimelineSubtitle { start: number; end: number; zh?: string; en?: string }
export interface TimelineMarker { at: number; name: string; kind: 'shot' | 'endcard' }

export interface Timeline {
  version: 1
  /** The deliverable: "master", "15s", "06s", "ep01". */
  label: string
  format: string
  projectId: string
  title: string
  fps: number
  width: number
  height: number
  /** Length of the edit, s. */
  seconds: number
  /** The delivered file. */
  file: string
  /** The ASS burned into the picture (titles, subtitles, the explicit AI label). */
  ass: string
  /** The finished soundtrack laid under the picture (before delivery loudness), when the film has sound. */
  mix?: { file: string; kind: 'voice-over-music' | 'four-bus' }
  picture: TimelineClip[]
  audio: Record<AudioBus, TimelineAudio[]>
  subtitles: TimelineSubtitle[]
  endCard?: { start: number; end: number; text: string }
  markers: TimelineMarker[]
  /** The grade adjustment the cut was finished with (cut/finishing.json). */
  grade?: string
}

export const timelinePath = (dir: string, label: string) => join(dir, 'cut', `${label}.timeline.json`)
/** A path as the timeline stores it: relative inside the project, absolute outside it. */
export const stored = (dir: string, path: string) => (path.startsWith(`${dir}/`) ? relative(dir, path) : path)
/** A stored path back to an absolute one. */
export const resolved = (dir: string, path: string) => (isAbsolute(path) ? path : join(dir, path))

export async function writeTimeline(dir: string, timeline: Timeline): Promise<string> {
  const path = timelinePath(dir, timeline.label)
  await mkdir(join(dir, 'cut'), { recursive: true })
  await writeFile(path, `${JSON.stringify(timeline, null, 2)}\n`)
  return path
}

export async function readTimeline(dir: string, label: string): Promise<Timeline | undefined> {
  const path = timelinePath(dir, label)
  if (!existsSync(path)) return undefined
  return JSON.parse(await readFile(path, 'utf8')) as Timeline
}

/** Picture clips from an edit decision list: clip i starts where the assembler starts it; a dissolve into it is its transitionIn. */
export function pictureTrack(clips: Array<Omit<TimelineClip, 'start' | 'duration' | 'in' | 'transitionIn'>>, durations: number[], overlaps: number[]): TimelineClip[] {
  const starts: number[] = []
  let at = 0
  for (const [index, duration] of durations.entries()) {
    starts.push(round6(at))
    at += duration - (overlaps[index] ?? 0)
  }
  const total = starts.at(-1)! + durations.at(-1)!
  return clips.map((clip, index) => ({
    ...clip, start: starts[index]!, in: 0, duration: round6((starts[index + 1] ?? total) - starts[index]!),
    ...(index > 0 && (overlaps[index - 1] ?? 0) > 0 ? { transitionIn: { seconds: overlaps[index - 1]! } } : {}),
  }))
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6

/**
 * Render the cut's stems - one WAV per bus, each the film's length - and the mix they sum to, from the timeline's
 * sources and in the same ffmpeg pass as the original mix. A bus the film does not use is written as silence, so a
 * stem delivery always has its four files. Returns undefined for a silent film.
 */
export async function renderStems(dir: string, timeline: Timeline, out: { mix: string } & Record<AudioBus, string>): Promise<Record<AudioBus, string> & { mix: string } | undefined> {
  if (!timeline.mix) return undefined
  const { audio, seconds } = timeline
  const abs = (path: string) => resolved(dir, path)
  if (timeline.mix.kind === 'voice-over-music') {
    await mixSoundtrack({
      voices: audio.dialogue.map((line) => ({ path: abs(line.source), start: line.start })),
      music: audio.music[0] ? abs(audio.music[0].source) : undefined, musicOffset: audio.music[0]?.in ?? 0,
      totalSeconds: seconds, output: out.mix, stems: { ...(audio.dialogue.length ? { dialogue: out.dialogue } : {}), ...(audio.music.length ? { music: out.music } : {}) },
    })
  } else {
    await mixNarrative({
      totalSeconds: seconds,
      dialogue: audio.dialogue.map((line) => ({ path: abs(line.source), start: line.start })),
      ambience: audio.ambience.map((bed) => ({ path: abs(bed.source), start: bed.start, seconds: bed.duration })),
      effects: audio.effects.map((fx) => ({ path: abs(fx.source), start: fx.start })),
      music: audio.music[0] ? abs(audio.music[0].source) : undefined,
      output: out.mix,
      stems: Object.fromEntries(AUDIO_BUSES.filter((bus) => audio[bus].length).map((bus) => [bus, out[bus]])),
    })
  }
  for (const bus of AUDIO_BUSES) {
    if (audio[bus].length) continue
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(seconds), '-c:a', 'pcm_s24le', out[bus]])
  }
  return out
}
