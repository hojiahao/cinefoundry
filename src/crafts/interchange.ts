import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AUDIO_BUSES, type AudioBus, type Timeline, type TimelineClip, type TimelineSubtitle } from './timeline.js'

/**
 * Interchange: a finished cut as an online editor or a colourist opens it - CMX 3600 EDL, Final Cut Pro XML (FCPXML 1.10
 * for Final Cut Pro and DaVinci Resolve, and FCP 7 XML, which Premiere Pro and Resolve import), OpenTimelineIO JSON -
 * and its subtitles as SRT. Pure functions of a Timeline (src/crafts/timeline.ts); every time is converted to whole
 * frames at the cut's rate and a time that does not land on a frame is an error, not a rounding.
 *
 * Conventions shared by every format: the record timeline starts at 01:00:00:00 (non-drop); picture is one track;
 * a dissolve begins on the edit (the outgoing clip's tail handle plays under it, which is how the cut was rendered);
 * audio is four tracks, one per stem - dialogue, music, effects, ambience - each a WAV of the cut's length.
 */

export interface Rate {
  fps: number
  /** One frame is num/den seconds. */
  num: number
  den: number
  /** Frames per timecode second. */
  timebase: number
  ntsc: boolean
}

const NTSC: Record<string, [number, number]> = { '23.976': [1001, 24000], '29.97': [1001, 30000], '59.94': [1001, 60000], '119.88': [1001, 120000] }

export function rateOf(fps: number): Rate {
  const ntsc = NTSC[fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')] ?? NTSC[String(fps)]
  if (ntsc) return { fps, num: ntsc[0], den: ntsc[1], timebase: Math.round(fps), ntsc: true }
  if (!Number.isInteger(fps) || fps <= 0) throw new Error(`unsupported frame rate ${fps}`)
  return { fps, num: 1, den: fps, timebase: fps, ntsc: false }
}

/** Seconds to whole frames; throws when the time falls between frames. */
export function toFrames(seconds: number, rate: Rate, what = 'time'): number {
  const exact = (seconds * rate.den) / rate.num
  const frames = Math.round(exact)
  if (Math.abs(exact - frames) > 1e-6) throw new Error(`${what}: ${seconds} s does not land on a frame at ${rate.fps} fps`)
  return frames
}

/** An FCPXML time: a rational number of seconds, in frames of the rate ("300/60s"). */
export const fcpTime = (frames: number, rate: Rate) => (frames === 0 ? '0s' : `${frames * rate.num}/${rate.den}s`)

/** HH:MM:SS:FF, non-drop, at the rate's timebase. */
export function timecode(frames: number, rate: Rate): string {
  const tb = rate.timebase
  const ff = frames % tb
  const total = Math.floor(frames / tb)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(Math.floor(total / 3600))}:${two(Math.floor(total / 60) % 60)}:${two(total % 60)}:${String(ff).padStart(String(tb - 1).length, '0')}`
}

/** The record timeline's first frame: one hour. */
export const recordStart = (rate: Rate) => 3600 * rate.timebase

export const fileUrl = (path: string) => pathToFileURL(path).href

const xml = (text: string | number) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** What an interchange file needs beyond the timeline: absolute paths, the stems, and what each source file is. */
export interface InterchangeInput {
  timeline: Timeline
  /** Absolute path of each picture source as the timeline stores it. */
  resolve: (stored: string) => string
  /** Absolute paths of the four stems, when the cut has sound. */
  stems?: Record<AudioBus, string>
  /** Measured length and picture format of each source, by absolute path. */
  media: Map<string, { seconds: number; width?: number; height?: number; fps?: number }>
}

const STEM_NAMES: Record<AudioBus, string> = { dialogue: 'Dialogue', music: 'Music', effects: 'Effects', ambience: 'Ambience' }
const clipName = (clip: TimelineClip) => (clip.kind === 'endcard' ? 'End card' : `${clip.episode !== undefined ? `Ep ${clip.episode} · ` : ''}Shot ${clip.shot}`)

interface FramedClip { clip: TimelineClip; source: string; recIn: number; recOut: number; srcIn: number; srcOut: number; transition?: number }

/** The picture track in frames, checked: contiguous, each clip inside its source, the edit's length exact. */
export function framedPicture(input: InterchangeInput): FramedClip[] {
  const { timeline } = input
  const rate = rateOf(timeline.fps)
  let at = 0
  const clips = timeline.picture.map((clip, index) => {
    const recIn = toFrames(clip.start, rate, `clip ${index + 1} start`)
    const length = toFrames(clip.duration, rate, `clip ${index + 1} duration`)
    if (recIn !== at) throw new Error(`clip ${index + 1} starts at frame ${recIn}, not where the previous clip ends (${at})`)
    at = recIn + length
    const srcIn = toFrames(clip.in, rate, `clip ${index + 1} source in`)
    const transition = clip.transitionIn ? toFrames(clip.transitionIn.seconds, rate, `dissolve into clip ${index + 1}`) : undefined
    return { clip, source: input.resolve(clip.source), recIn, recOut: at, srcIn, srcOut: srcIn + length, ...(transition ? { transition } : {}) }
  })
  if (at !== toFrames(timeline.seconds, rate, 'edit length')) throw new Error(`the picture runs ${at} frames, the edit ${toFrames(timeline.seconds, rate)}`)
  // The outgoing clip of a dissolve plays its tail handle under it: the source must have it.
  for (const [index, framed] of clips.entries()) {
    if (!framed.transition) continue
    const previous = clips[index - 1]!
    const media = input.media.get(previous.source)
    if (media && previous.srcOut + framed.transition > Math.floor(media.seconds * rate.fps + 1e-6)) throw new Error(`${basename(previous.source)} has no ${framed.transition}-frame handle for the dissolve into ${clipName(framed.clip)}`)
  }
  return clips
}

const edlLine = (event: number, reel: string, track: string, type: string, duration: string, tcs: string[]) =>
  `${String(event).padStart(3, '0')}  ${reel.padEnd(8)} ${track.padEnd(5)} ${type.padEnd(4)} ${duration.padStart(3)} ${tcs.join(' ')}`

/**
 * CMX 3600. EDL carries one picture track and two audio channels, so a cut with stems is two lists: `tracks: 'main'`
 * is the picture with the dialogue (A) and music (A2) stems, `tracks: 'effects'` the effects (A) and ambience (A2) stems.
 * Clip names and source files travel in the comments every NLE reads (FROM CLIP NAME, SOURCE FILE); shot markers as LOC.
 */
export function toEdl(input: InterchangeInput, tracks: 'main' | 'effects' = 'main'): string {
  const { timeline } = input
  const rate = rateOf(timeline.fps)
  const start = recordStart(rate)
  const tc = (frames: number) => timecode(frames, rate)
  const lines = [`TITLE: ${timeline.title} · ${timeline.label}`.slice(0, 70), 'FCM: NON-DROP FRAME', '']
  let event = 0
  if (tracks === 'main') {
    const picture = framedPicture(input)
    for (const [index, framed] of picture.entries()) {
      event++
      const name = basename(framed.source)
      if (framed.transition) {
        const previous = picture[index - 1]!
        lines.push(edlLine(event, 'AX', 'V', 'C', '', [tc(previous.srcOut), tc(previous.srcOut), tc(start + framed.recIn), tc(start + framed.recIn)]))
        lines.push(edlLine(event, 'AX', 'V', 'D', String(framed.transition).padStart(3, '0'), [tc(framed.srcIn), tc(framed.srcOut), tc(start + framed.recIn), tc(start + framed.recOut)]))
        lines.push(`* FROM CLIP NAME: ${basename(previous.source)}`, `* TO CLIP NAME: ${name}`, `* SOURCE FILE: ${framed.source}`)
      } else {
        lines.push(edlLine(event, 'AX', 'V', 'C', '', [tc(framed.srcIn), tc(framed.srcOut), tc(start + framed.recIn), tc(start + framed.recOut)]))
        lines.push(`* FROM CLIP NAME: ${name}`, `* SOURCE FILE: ${framed.source}`)
      }
      for (const marker of timeline.markers.filter((m) => toFrames(m.at, rate, `marker ${m.name}`) === framed.recIn)) lines.push(`* LOC: ${tc(start + framed.recIn)} ${marker.kind === 'endcard' ? 'YELLOW ' : 'RED    '} ${marker.name}`)
      lines.push('')
    }
  }
  if (input.stems) {
    const total = toFrames(timeline.seconds, rate, 'edit length')
    const pair: AudioBus[] = tracks === 'main' ? ['dialogue', 'music'] : ['effects', 'ambience']
    for (const [channel, bus] of pair.entries()) {
      event++
      lines.push(edlLine(event, 'AX', channel === 0 ? 'A' : 'A2', 'C', '', [tc(0), tc(total), tc(start), tc(start + total)]))
      lines.push(`* FROM CLIP NAME: ${basename(input.stems[bus])}`, `* SOURCE FILE: ${input.stems[bus]}`, `* COMMENT: ${STEM_NAMES[bus]} stem`, '')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/** The FCPXML 1.10 effect id of Final Cut Pro's Cross Dissolve. */
const CROSS_DISSOLVE_UID = 'FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265'

/**
 * FCPXML 1.10: one project in one event; the picture on the primary storyline, the dissolve as a transition on the edit,
 * the four stems as connected clips on lanes -1 to -4 with their audio roles, shot markers on their clips. Every time
 * is a rational in frames of the sequence rate.
 */
export function toFcpxml(input: InterchangeInput): string {
  const { timeline } = input
  const rate = rateOf(timeline.fps)
  const t = (frames: number) => fcpTime(frames, rate)
  const start = recordStart(rate)
  const picture = framedPicture(input)
  const total = toFrames(timeline.seconds, rate, 'edit length')
  const formats = new Map<string, string>()
  const resources: string[] = [`<format id="r1" name="Cinefoundry ${timeline.width}x${timeline.height} ${timeline.fps}" frameDuration="${fcpTime(1, rate)}" width="${timeline.width}" height="${timeline.height}" colorSpace="1-1-1 (Rec. 709)"/>`]
  const formatOf = (media: { width?: number; height?: number; fps?: number }) => {
    if (!media.width || !media.height || !media.fps) return 'r1'
    const signature = `${media.width}x${media.height}@${media.fps}`
    if (!formats.has(signature)) {
      const id = `r${2 + formats.size}`
      formats.set(signature, id)
      const source = rateOf(media.fps)
      resources.push(`<format id="${id}" name="${signature}" frameDuration="${fcpTime(1, source)}" width="${media.width}" height="${media.height}" colorSpace="1-1-1 (Rec. 709)"/>`)
    }
    return formats.get(signature)!
  }
  const assets = new Map<string, string>()
  const assetOf = (path: string, kind: 'video' | 'audio') => {
    if (assets.has(path)) return assets.get(path)!
    const id = `a${assets.size + 1}`
    assets.set(path, id)
    const media = input.media.get(path) ?? { seconds: timeline.seconds }
    const duration = t(Math.floor(media.seconds * (rate.den / rate.num) + 1e-6))
    resources.push(kind === 'video'
      ? `<asset id="${id}" name="${xml(basename(path))}" start="0s" duration="${duration}" hasVideo="1" videoSources="1" format="${formatOf(media)}"><media-rep kind="original-media" src="${xml(fileUrl(path))}"/></asset>`
      : `<asset id="${id}" name="${xml(basename(path))}" start="0s" duration="${duration}" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"><media-rep kind="original-media" src="${xml(fileUrl(path))}"/></asset>`)
    return id
  }
  const hasDissolve = picture.some((p) => p.transition)
  if (hasDissolve) resources.push(`<effect id="rx" name="Cross Dissolve" uid="${CROSS_DISSOLVE_UID}"/>`)
  const roles: Record<AudioBus, string> = { dialogue: 'dialogue', music: 'music', effects: 'effects', ambience: 'effects.ambience' }
  const stems = input.stems ? AUDIO_BUSES.map((bus, index) => `<asset-clip ref="${assetOf(input.stems![bus], 'audio')}" lane="${-(index + 1)}" offset="${t(picture[0]!.srcIn)}" name="${STEM_NAMES[bus]} stem" start="0s" duration="${t(total)}" audioRole="${roles[bus]}"/>`) : []
  const spine: string[] = []
  for (const [index, framed] of picture.entries()) {
    if (framed.transition) spine.push(`<transition name="Cross Dissolve" offset="${t(start + framed.recIn)}" duration="${t(framed.transition)}"><filter-video ref="rx" name="Cross Dissolve"/></transition>`)
    const markers = timeline.markers.filter((m) => toFrames(m.at, rate, `marker ${m.name}`) === framed.recIn).map((m) => `<marker start="${t(framed.srcIn)}" duration="${t(1)}" value="${xml(m.name)}"/>`)
    const children = [...markers, ...(index === 0 ? stems : [])]
    const open = `<asset-clip ref="${assetOf(framed.source, 'video')}" offset="${t(start + framed.recIn)}" name="${xml(clipName(framed.clip))}" start="${t(framed.srcIn)}" duration="${t(framed.recOut - framed.recIn)}" tcFormat="NDF"`
    spine.push(children.length ? `${open}>\n${children.map((c) => `              ${c}`).join('\n')}\n            </asset-clip>` : `${open}/>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
${resources.map((r) => `    ${r}`).join('\n')}
  </resources>
  <library>
    <event name="${xml(`Cinefoundry · ${timeline.projectId}`)}">
      <project name="${xml(`${timeline.title} · ${timeline.label}`)}">
        <sequence format="r1" duration="${t(total)}" tcStart="${t(start)}" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine.map((s) => `            ${s}`).join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`
}

/**
 * Final Cut Pro 7 XML (xmeml 5), the "Final Cut Pro XML" Premiere Pro imports (and Resolve): one video track, the
 * dissolve as a transition item starting on the edit, one audio track per stem, shot markers on the sequence.
 */
export function toXmeml(input: InterchangeInput): string {
  const { timeline } = input
  const rate = rateOf(timeline.fps)
  const rateXml = `<rate><timebase>${rate.timebase}</timebase><ntsc>${rate.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`
  const picture = framedPicture(input)
  const total = toFrames(timeline.seconds, rate, 'edit length')
  const files = new Map<string, string>()
  const fileXml = (path: string, kind: 'video' | 'audio') => {
    if (files.has(path)) return `<file id="${files.get(path)}"/>`
    const id = `file-${files.size + 1}`
    files.set(path, id)
    const media = input.media.get(path) ?? { seconds: timeline.seconds }
    const characteristics = kind === 'video'
      ? `<video><samplecharacteristics>${rateXml}<width>${media.width ?? timeline.width}</width><height>${media.height ?? timeline.height}</height></samplecharacteristics></video>`
      : '<audio><samplecharacteristics><depth>24</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>'
    return `<file id="${id}"><name>${xml(basename(path))}</name><pathurl>${xml(fileUrl(path))}</pathurl>${rateXml}<duration>${Math.floor(media.seconds * rate.fps + 1e-6)}</duration><media>${characteristics}</media></file>`
  }
  const video: string[] = []
  for (const [index, framed] of picture.entries()) {
    if (framed.transition) {
      video.push(`<transitionitem><start>${framed.recIn}</start><end>${framed.recIn + framed.transition}</end><alignment>start</alignment>${rateXml}<effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype></effect></transitionitem>`)
    }
    const media = input.media.get(framed.source)
    video.push(`<clipitem id="clipitem-${index + 1}"><name>${xml(clipName(framed.clip))}</name><enabled>TRUE</enabled><duration>${media ? Math.floor(media.seconds * rate.fps + 1e-6) : framed.srcOut}</duration>${rateXml}<start>${framed.recIn}</start><end>${framed.recOut}</end><in>${framed.srcIn}</in><out>${framed.srcOut}</out>${fileXml(framed.source, 'video')}</clipitem>`)
  }
  const audio = input.stems
    ? AUDIO_BUSES.map((bus, index) => `<track><clipitem id="clipitem-a${index + 1}"><name>${STEM_NAMES[bus]} stem</name><enabled>TRUE</enabled><duration>${total}</duration>${rateXml}<start>0</start><end>${total}</end><in>0</in><out>${total}</out>${fileXml(input.stems![bus], 'audio')}<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack></clipitem></track>`)
    : []
  const markers = timeline.markers.map((m) => `<marker><name>${xml(m.name)}</name><comment>${m.kind}</comment><in>${toFrames(m.at, rate, `marker ${m.name}`)}</in><out>-1</out></marker>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${xml(`${timeline.title} · ${timeline.label}`)}</name>
    <duration>${total}</duration>
    ${rateXml}
    <timecode>${rateXml}<string>${timecode(recordStart(rate), rate)}</string><frame>${recordStart(rate)}</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics>${rateXml}<width>${timeline.width}</width><height>${timeline.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>
        <track>
${video.map((v) => `          ${v}`).join('\n')}
        </track>
      </video>
      <audio>
        <numOutputChannels>2</numOutputChannels>
${audio.map((a) => `        ${a}`).join('\n')}
      </audio>
    </media>
${markers.map((m) => `    ${m}`).join('\n')}
  </sequence>
</xmeml>
`
}

const rational = (frames: number, rate: Rate) => ({ OTIO_SCHEMA: 'RationalTime.1', rate: rate.fps, value: frames })
const range = (start: number, duration: number, rate: Rate) => ({ OTIO_SCHEMA: 'TimeRange.1', duration: rational(duration, rate), start_time: rational(start, rate) })

/**
 * OpenTimelineIO (Timeline.1): a Stack of one video track and four audio tracks. Clips are Clip.2 with an
 * ExternalReference to their file and its available range; the dissolve is a SMPTE_Dissolve Transition whose out_offset
 * is its length (it begins on the cut); shot markers are Marker.2 on their clips.
 */
export function toOtio(input: InterchangeInput): Record<string, unknown> {
  const { timeline } = input
  const rate = rateOf(timeline.fps)
  const picture = framedPicture(input)
  const total = toFrames(timeline.seconds, rate, 'edit length')
  const reference = (path: string) => {
    const media = input.media.get(path)
    return { OTIO_SCHEMA: 'ExternalReference.1', metadata: {}, name: basename(path), available_range: media ? range(0, Math.floor(media.seconds * (rate.den / rate.num) + 1e-6), rate) : null, available_image_bounds: null, target_url: fileUrl(path) }
  }
  const clip = (name: string, path: string, source: { start: number; duration: number }, markers: unknown[] = [], metadata: Record<string, unknown> = {}) => ({
    OTIO_SCHEMA: 'Clip.2', metadata: { cinefoundry: metadata }, name, source_range: range(source.start, source.duration, rate), effects: [], markers, enabled: true,
    media_references: { DEFAULT_MEDIA: reference(path) }, active_media_reference_key: 'DEFAULT_MEDIA',
  })
  const track = (name: string, kind: 'Video' | 'Audio', children: unknown[]) => ({ OTIO_SCHEMA: 'Track.1', metadata: {}, name, source_range: null, effects: [], markers: [], enabled: true, children, kind })
  const video: unknown[] = []
  for (const framed of picture) {
    if (framed.transition) video.push({ OTIO_SCHEMA: 'Transition.1', metadata: {}, name: 'Cross Dissolve', transition_type: 'SMPTE_Dissolve', in_offset: rational(0, rate), out_offset: rational(framed.transition, rate) })
    const markers = timeline.markers.filter((m) => toFrames(m.at, rate, `marker ${m.name}`) === framed.recIn).map((m) => ({ OTIO_SCHEMA: 'Marker.2', metadata: { cinefoundry: { kind: m.kind } }, name: m.name, color: m.kind === 'endcard' ? 'YELLOW' : 'RED', marked_range: range(framed.srcIn, 1, rate), comment: '' }))
    video.push(clip(clipName(framed.clip), framed.source, { start: framed.srcIn, duration: framed.recOut - framed.recIn }, markers, { kind: framed.clip.kind, shot: framed.clip.shot ?? null, episode: framed.clip.episode ?? null, scene: framed.clip.scene ?? null }))
  }
  const audio = input.stems ? AUDIO_BUSES.map((bus) => track(STEM_NAMES[bus], 'Audio', [clip(`${STEM_NAMES[bus]} stem`, input.stems![bus], { start: 0, duration: total }, [], { stem: bus })])) : []
  return {
    OTIO_SCHEMA: 'Timeline.1',
    metadata: { cinefoundry: { project: timeline.projectId, label: timeline.label, format: timeline.format, fps: timeline.fps, width: timeline.width, height: timeline.height, ass: timeline.ass, endCard: timeline.endCard ?? null } },
    name: `${timeline.title} · ${timeline.label}`,
    global_start_time: rational(recordStart(rate), rate),
    tracks: { OTIO_SCHEMA: 'Stack.1', metadata: {}, name: 'tracks', source_range: null, effects: [], markers: [], enabled: true, children: [track('V1', 'Video', video), ...audio] },
  }
}

/** SubRip: one language of the bilingual subtitles, times to the millisecond from the start of the cut. */
export function toSrt(subtitles: TimelineSubtitle[], language: 'zh' | 'en'): string {
  const time = (seconds: number) => {
    const ms = Math.max(0, Math.round(seconds * 1000))
    const two = (n: number) => String(n).padStart(2, '0')
    return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`
  }
  return subtitles.filter((s) => s[language]?.trim()).map((s, index) => `${index + 1}\n${time(s.start)} --> ${time(s.end)}\n${s[language]!.trim()}\n`).join('\n')
}
