import { existsSync } from 'node:fs'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from '../lib/exec.js'
import { bitrateCeilingMbps } from '../lib/ffmpeg.js'
import { AI_LABEL } from '../agent/finish.js'

/**
 * Delivery QC (skill `delivery-qc`): every deliverable is measured with ffprobe and ffmpeg against its spec, and the
 * measurements, not just the verdicts, are written into reports/qc.json. Parsers and the verdict logic are pure
 * functions; `measure` is the only part that runs a program.
 */

export interface Interval { start: number; end: number }

export interface LoudnessTarget {
  profile: 'web' | 'web-platform'
  /** Integrated loudness, LUFS. */
  integrated: number
  /** Allowed deviation from `integrated`, LU. */
  tolerance: number
  /** Maximum true peak, dBTP. */
  truePeak: number
}

/** Loudness profiles from the delivery-qc skill: the cut writes -16 LUFS for ads, -14 for shorts and dramas. */
export const LOUDNESS: Record<LoudnessTarget['profile'], LoudnessTarget> = {
  web: { profile: 'web', integrated: -16, tolerance: 1, truePeak: -1.5 },
  'web-platform': { profile: 'web-platform', integrated: -14, tolerance: 1, truePeak: -1.0 },
}
export type QcFormat = 'ad' | 'short' | 'drama'
export const loudnessFor = (format: QcFormat): LoudnessTarget => (format === 'ad' ? LOUDNESS.web : LOUDNESS['web-platform'])

/** Fades the cut writes (assembleFilm): picture in 0.35 s / out 0.5 s, sound in 0.3 s / out 0.8 s. */
export const FADES = { pictureIn: 0.35, pictureOut: 0.5, soundIn: 0.3, soundOut: 0.8 } as const
/** YouTube's 1080p SDR upload reference, Mb/s: 8 at standard frame rates, 12 at high frame rates (research 4.3). */
export const youtubeReferenceMbps = (fps: number) => (fps > 30 ? 12 : 8)

/** What a deliverable must be. */
export interface QcSpec {
  /** Which deliverable: "master", "15s", "06s", "ep01". */
  label: string
  /** Absolute path of the file as delivered. */
  file: string
  width: number
  height: number
  fps: number
  /** The edit's computed length in seconds; the file must match it to a frame. */
  seconds: number
  /** The loudness target; absent when the film is delivered silent (no audio stream expected). */
  loudness?: LoudnessTarget
  /** Where a voiceover line or a dialogue line is placed: digital silence inside one is a dropped voice. */
  speech: Interval[]
  /** The ASS file burned into the picture: titles, subtitles and the explicit AI label. */
  ass?: string
  /** The ProduceID the implicit AIGC metadata must carry. */
  produceId: string
  /** Windows where a still picture is intended (the end card's push-in): a freeze there is not reported. */
  stillWindows?: Interval[]
}

export interface ProbeSummary {
  formatName: string
  /** Container duration, s. */
  seconds: number
  sizeBytes: number
  bitrateMbps: number
  tags: Record<string, string>
  video?: {
    codec: string
    profile: string
    pixFmt: string
    width: number
    height: number
    /** r_frame_rate and avg_frame_rate as numbers; they differ on a variable-frame-rate file. */
    rFrameRate: number
    avgFrameRate: number
    seconds: number
    frames: number
    bitrateMbps: number
    colorPrimaries?: string
    colorTransfer?: string
    colorSpace?: string
  }
  audio?: { codec: string; profile: string; sampleRate: number; channels: number; bitrateKbps: number; seconds: number }
}

export interface LoudnessMeasure { integrated: number; lra: number; truePeak: number }
export interface AstatsMeasure { peakDb: number; flatFactor: number }

export interface AssEvent { start: number; end: number; style: string; text: string }

export interface QcMeasured {
  probe: ProbeSummary
  /** True when the moov atom precedes mdat (faststart). */
  faststart?: boolean
  loudness?: LoudnessMeasure
  astats?: AstatsMeasure
  black: Interval[]
  silence: Interval[]
  freeze: Interval[]
  /** Events of the burned-in ASS, when the spec names one and it exists. */
  ass?: AssEvent[]
}

export type QcStatus = 'pass' | 'warn' | 'fail'
export interface QcCheck { check: string; status: QcStatus; detail: string }
export type QcVerdict = 'pass' | 'pass-with-warnings' | 'fail'

export interface QcReport {
  label: string
  file: string
  spec: Omit<QcSpec, 'file' | 'label'>
  measured: QcMeasured
  results: QcCheck[]
  verdict: QcVerdict
}

// ---------------------------------------------------------------- parsers

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}
/** "60/1", "30000/1001" -> frames per second; "0/0" -> NaN. */
export const parseRate = (rate: string | undefined): number => {
  const [n, d] = String(rate ?? '').split('/').map(Number)
  return n !== undefined && d ? n / d : NaN
}
const round = (value: number, digits = 3) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value)

/** `ffprobe -show_streams -show_format -of json` -> the fields QC reads. */
export function parseProbe(json: string): ProbeSummary {
  const data = JSON.parse(json) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
  const format = data.format ?? {}
  const video = (data.streams ?? []).find((s) => s.codec_type === 'video')
  const audio = (data.streams ?? []).find((s) => s.codec_type === 'audio')
  const tags = Object.fromEntries(Object.entries((format.tags as Record<string, unknown> | undefined) ?? {}).map(([k, v]) => [k, String(v)]))
  return {
    formatName: String(format.format_name ?? ''),
    seconds: round(num(format.duration)),
    sizeBytes: num(format.size),
    bitrateMbps: round(num(format.bit_rate) / 1e6),
    tags,
    video: video && {
      codec: String(video.codec_name ?? ''),
      profile: String(video.profile ?? ''),
      pixFmt: String(video.pix_fmt ?? ''),
      width: num(video.width),
      height: num(video.height),
      rFrameRate: round(parseRate(video.r_frame_rate as string)),
      avgFrameRate: round(parseRate(video.avg_frame_rate as string)),
      seconds: round(num(video.duration)),
      frames: num(video.nb_frames),
      bitrateMbps: round(num(video.bit_rate) / 1e6),
      ...(video.color_primaries ? { colorPrimaries: String(video.color_primaries) } : {}),
      ...(video.color_transfer ? { colorTransfer: String(video.color_transfer) } : {}),
      ...(video.color_space ? { colorSpace: String(video.color_space) } : {}),
    },
    audio: audio && {
      codec: String(audio.codec_name ?? ''),
      profile: String(audio.profile ?? ''),
      sampleRate: num(audio.sample_rate),
      channels: num(audio.channels),
      bitrateKbps: round(num(audio.bit_rate) / 1e3, 1),
      seconds: round(num(audio.duration)),
    },
  }
}

const dbValue = (text: string | undefined): number => (text === undefined ? NaN : /^-?inf/i.test(text) ? (text.startsWith('-') ? -Infinity : Infinity) : Number(text))

/** The summary `ebur128=peak=true` prints at the end of a run. Undefined when there is none (no audio). */
export function parseEbur128(stderr: string): LoudnessMeasure | undefined {
  const at = stderr.lastIndexOf('Summary:')
  if (at < 0) return undefined
  const summary = stderr.slice(at)
  const integrated = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+|-?inf)\s*LUFS/i.exec(summary)?.[1]
  const lra = /Loudness range:\s*\n\s*LRA:\s*(-?[\d.]+|-?inf)\s*LU/i.exec(summary)?.[1]
  const peak = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-?inf)\s*dBFS/i.exec(summary)?.[1]
  if (integrated === undefined) return undefined
  return { integrated: dbValue(integrated), lra: dbValue(lra), truePeak: dbValue(peak) }
}

/** The "Overall" block of `astats`: sample peak and flat factor. */
export function parseAstats(stderr: string): AstatsMeasure | undefined {
  const at = stderr.lastIndexOf('] Overall')
  if (at < 0) return undefined
  const block = stderr.slice(at)
  const peak = /Peak level dB:\s*(-?[\d.]+|-?inf)/i.exec(block)?.[1]
  const flat = /Flat factor:\s*(-?[\d.]+|-?inf)/i.exec(block)?.[1]
  if (peak === undefined) return undefined
  return { peakDb: dbValue(peak), flatFactor: dbValue(flat) }
}

/** blackdetect: "black_start:0 black_end:0.5 black_duration:0.5". */
export function parseBlack(stderr: string): Interval[] {
  return [...stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }))
}

/**
 * silencedetect and freezedetect report a start and later an end; a run that lasts to the end of the file has no end
 * line, so it closes at `fileSeconds`.
 */
function pairedIntervals(stderr: string, startRe: RegExp, endRe: RegExp, fileSeconds: number): Interval[] {
  const events = [
    ...[...stderr.matchAll(startRe)].map((m) => ({ at: m.index ?? 0, kind: 'start' as const, value: Number(m[1]) })),
    ...[...stderr.matchAll(endRe)].map((m) => ({ at: m.index ?? 0, kind: 'end' as const, value: Number(m[1]) })),
  ].sort((a, b) => a.at - b.at)
  const out: Interval[] = []
  let open: number | undefined
  for (const event of events) {
    if (event.kind === 'start') open = event.value
    else if (open !== undefined) { out.push({ start: open, end: event.value }); open = undefined }
  }
  if (open !== undefined) out.push({ start: open, end: fileSeconds })
  return out
}
export const parseSilence = (stderr: string, fileSeconds: number) => pairedIntervals(stderr, /silence_start:\s*(-?[\d.]+)/g, /silence_end:\s*(-?[\d.]+)/g, fileSeconds)
export const parseFreeze = (stderr: string, fileSeconds: number) => pairedIntervals(stderr, /freeze_start:\s*([\d.]+)/g, /freeze_end:\s*([\d.]+)/g, fileSeconds)

const assSeconds = (time: string) => {
  const [h, m, s] = time.split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}
/** Dialogue events of an ASS file, override tags stripped from the text. */
export function parseAss(text: string): AssEvent[] {
  return text.split(/\r?\n/).filter((line) => line.startsWith('Dialogue:')).map((line) => {
    // Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text (the text may contain commas).
    const fields = line.slice('Dialogue:'.length).split(',')
    return { start: assSeconds(fields[1]!.trim()), end: assSeconds(fields[2]!.trim()), style: fields[3]!.trim(), text: fields.slice(9).join(',').replace(/\{[^}]*\}/g, '').trim() }
  })
}

/** Top-level MP4 box types in order, read from the file header (enough to tell whether moov precedes mdat). */
export async function topLevelBoxes(file: string, limit = 16): Promise<string[]> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const types: string[] = []
    let offset = 0
    const header = Buffer.alloc(16)
    while (offset + 8 <= size && types.length < limit) {
      await handle.read(header, 0, 16, offset)
      let boxSize = header.readUInt32BE(0)
      const type = header.toString('latin1', 4, 8)
      if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8))
      else if (boxSize === 0) boxSize = size - offset
      types.push(type)
      if (boxSize < 8) break
      offset += boxSize
    }
    return types
  } finally {
    await handle.close()
  }
}
export const isFaststart = (boxes: string[]): boolean | undefined => {
  const moov = boxes.indexOf('moov'), mdat = boxes.indexOf('mdat')
  return moov < 0 || mdat < 0 ? undefined : moov < mdat
}

// ---------------------------------------------------------------- measurement

/** Measure a file: one ffprobe, one decoding pass with every video and audio detector chained. */
export async function measure(spec: Pick<QcSpec, 'file' | 'ass'>): Promise<QcMeasured> {
  const probe = parseProbe((await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', spec.file])).stdout)
  const args = ['-hide_banner', '-nostats', '-i', spec.file]
  if (probe.video) args.push('-vf', 'blackdetect=d=0.1:pix_th=0.10,freezedetect=n=0.003:d=1.5')
  if (probe.audio) args.push('-af', 'ebur128=peak=true:framelog=verbose,astats=measure_perchannel=none,silencedetect=noise=-60dB:d=0.5')
  args.push('-f', 'null', '-')
  const { stderr } = await exec('ffmpeg', args)
  const length = probe.video?.seconds || probe.seconds
  const ass = spec.ass && existsSync(spec.ass) ? parseAss(await readFile(spec.ass, 'utf8')) : undefined
  return {
    probe,
    faststart: isFaststart(await topLevelBoxes(spec.file)),
    ...(probe.audio ? { loudness: parseEbur128(stderr), astats: parseAstats(stderr), silence: parseSilence(stderr, length) } : { silence: [] }),
    black: parseBlack(stderr),
    freeze: parseFreeze(stderr, length),
    ...(ass ? { ass } : {}),
  }
}

// ---------------------------------------------------------------- verdict

const EPS = 0.02
const overlaps = (a: Interval, b: Interval) => a.start < b.end - EPS && b.start < a.end - EPS
const inside = (a: Interval, b: Interval) => a.start >= b.start - EPS && a.end <= b.end + EPS
const span = (i: Interval) => `${i.start.toFixed(2)}-${i.end.toFixed(2)} s`
const check = (name: string, status: QcStatus, detail: string): QcCheck => ({ check: name, status, detail })

/** Every check of the delivery-qc skill that tools can decide, applied to one file's measurements. */
export function judge(spec: QcSpec, m: QcMeasured): QcCheck[] {
  const results: QcCheck[] = []
  const frame = 1 / spec.fps
  const v = m.probe.video
  const a = m.probe.audio

  results.push(/mp4/.test(m.probe.formatName) ? check('container', 'pass', m.probe.formatName) : check('container', 'fail', `${m.probe.formatName || 'unknown'}, expected MP4`))
  results.push(m.faststart === true ? check('faststart', 'pass', 'moov before mdat') : check('faststart', 'fail', m.faststart === false ? 'moov after mdat: the file cannot start playing before it is fully downloaded' : 'moov or mdat not found'))
  if (!v) {
    results.push(check('video', 'fail', 'no video stream'))
  } else {
    const codecOk = v.codec === 'h264' && v.profile === 'High' && v.pixFmt === 'yuv420p'
    results.push(check('codec', codecOk ? 'pass' : 'fail', `${v.codec} ${v.profile} ${v.pixFmt}${codecOk ? '' : ', expected h264 High yuv420p'}`))
    const colour = [v.colorPrimaries, v.colorTransfer, v.colorSpace]
    results.push(check('colour', colour.every((c) => c === 'bt709') ? 'pass' : 'fail', `primaries ${v.colorPrimaries ?? 'untagged'}, transfer ${v.colorTransfer ?? 'untagged'}, matrix ${v.colorSpace ?? 'untagged'}${colour.every((c) => c === 'bt709') ? '' : ', expected BT.709 for all three'}`))
    results.push(check('resolution', v.width === spec.width && v.height === spec.height ? 'pass' : 'fail', `${v.width}x${v.height}${v.width === spec.width && v.height === spec.height ? '' : `, expected ${spec.width}x${spec.height}`}`))
    const cfr = Math.abs(v.rFrameRate - v.avgFrameRate) < 0.01
    const fpsOk = cfr && Math.abs(v.rFrameRate - spec.fps) < 0.01
    results.push(check('frame_rate', fpsOk ? 'pass' : 'fail', `r ${v.rFrameRate} / avg ${v.avgFrameRate} fps${fpsOk ? '' : cfr ? `, expected ${spec.fps}` : ', variable frame rate'}`))
    const durationOk = Math.abs(v.seconds - spec.seconds) <= frame + 1e-6
    results.push(check('duration', durationOk ? 'pass' : 'fail', `${v.seconds.toFixed(3)} s, edit ${spec.seconds.toFixed(3)} s${durationOk ? '' : ` (off by ${(v.seconds - spec.seconds).toFixed(3)} s, more than one frame)`}`))
    const expectedFrames = Math.round(v.seconds * spec.fps)
    const framesOk = Number.isFinite(v.frames) && Math.abs(v.frames - expectedFrames) <= 1
    results.push(check('frame_count', framesOk ? 'pass' : 'fail', `${v.frames} frames for ${v.seconds.toFixed(3)} s at ${spec.fps} fps${framesOk ? '' : ` (expected ${expectedFrames})`}`))
    const ceiling = bitrateCeilingMbps(spec.width, spec.height, spec.fps)
    const reference = youtubeReferenceMbps(spec.fps)
    if (v.bitrateMbps > ceiling * 1.1) results.push(check('bitrate', 'fail', `${v.bitrateMbps} Mb/s above the ${ceiling} Mb/s ceiling (0.2 bit per pixel per frame, at least 8 Mb/s) by more than 10%`))
    else if (Math.min(spec.width, spec.height) >= 1080 && v.bitrateMbps < reference) results.push(check('bitrate', 'warn', `${v.bitrateMbps} Mb/s, under YouTube's ${reference} Mb/s 1080p reference`))
    else results.push(check('bitrate', 'pass', `${v.bitrateMbps} Mb/s (ceiling ${ceiling})`))
    // Black: the head and tail fades may read as black; anything else is a hole in the picture.
    const head: Interval = { start: 0, end: FADES.pictureIn }
    const tail: Interval = { start: spec.seconds - FADES.pictureOut, end: spec.seconds + frame }
    const black = m.black.filter((i) => !inside(i, head) && !inside(i, tail))
    results.push(check('black_frames', black.length ? 'fail' : 'pass', black.length ? `black ${black.map(span).join(', ')}` : `${m.black.length} black run(s), all inside the fades`))
    const frozen = m.freeze.filter((i) => !(spec.stillWindows ?? []).some((w) => inside(i, w)))
    results.push(check('frozen_picture', frozen.length ? 'warn' : 'pass', frozen.length ? `frozen ${frozen.map(span).join(', ')}: a failed generation reads as a glitch` : 'no frozen picture outside intended stills'))
  }

  if (!spec.loudness) {
    results.push(a ? check('audio', 'warn', 'a silent delivery carries an audio stream') : check('audio', 'pass', 'silent delivery, no audio stream'))
  } else if (!a) {
    results.push(check('audio', 'fail', 'no audio stream'))
  } else {
    const streamOk = a.codec === 'aac' && a.sampleRate === 48000 && a.channels === 2
    results.push(check('audio', streamOk ? 'pass' : 'fail', `${a.codec} ${a.profile} ${a.sampleRate} Hz ${a.channels} ch ${a.bitrateKbps} kb/s${streamOk ? '' : ', expected AAC 48 kHz stereo'}`))
    const target = spec.loudness
    const loud = m.loudness
    if (!loud) results.push(check('loudness', 'fail', 'ebur128 produced no summary'))
    else {
      const off = loud.integrated - target.integrated
      results.push(check('loudness', Math.abs(off) <= target.tolerance ? 'pass' : 'fail', `${loud.integrated} LUFS, target ${target.integrated} ±${target.tolerance} (${target.profile})`))
      results.push(check('true_peak', loud.truePeak <= target.truePeak ? 'pass' : 'fail', `${loud.truePeak} dBTP, ceiling ${target.truePeak}`))
      const lraLimit = target.profile === 'web' ? 11 : 15
      results.push(check('loudness_range', loud.lra > lraLimit ? 'warn' : 'pass', `${loud.lra} LU${loud.lra > lraLimit ? `, above ${lraLimit} LU` : ''}`))
    }
    const stats = m.astats
    if (!stats) results.push(check('clipping', 'fail', 'astats produced no overall block'))
    else {
      const clipped = stats.peakDb >= -0.1 || stats.flatFactor > 0
      results.push(check('clipping', clipped ? 'fail' : 'pass', `sample peak ${stats.peakDb.toFixed(2)} dBFS, flat factor ${stats.flatFactor}`))
    }
    // Silence where a line is placed is a dropped voice; anywhere else outside the fades it is a dropped bed.
    const fadeIn: Interval = { start: 0, end: FADES.soundIn }
    const fadeOut: Interval = { start: spec.seconds - FADES.soundOut, end: Math.max(spec.seconds, a.seconds) + frame }
    const gaps = m.silence.filter((i) => !inside(i, fadeIn) && !inside(i, fadeOut))
    const inSpeech = gaps.filter((i) => spec.speech.some((s) => overlaps(i, s)))
    if (inSpeech.length) results.push(check('silence', 'fail', `silence ${inSpeech.map(span).join(', ')} where a line is placed`))
    else if (gaps.length) results.push(check('silence', 'warn', `silence ${gaps.map(span).join(', ')} outside the lines and fades: the bed dropped out`))
    else results.push(check('silence', 'pass', `no silence gap outside the fades (${spec.speech.length} line window(s) checked)`))
  }

  results.push(checkAigc(m.probe.tags, spec.produceId))
  results.push(...checkAss(spec, m.ass))
  return results
}

/** The implicit label (GB 45438-2025 style, TC260 field names) and the comment the cut writes. */
export function checkAigc(tags: Record<string, string>, produceId: string): QcCheck {
  const raw = tags.AIGC ?? tags.aigc
  if (!raw) return check('aigc_metadata', 'fail', 'no AIGC tag in the container')
  let aigc: Record<string, unknown>
  try { aigc = JSON.parse(raw) as Record<string, unknown> } catch { return check('aigc_metadata', 'fail', 'AIGC tag is not valid JSON') }
  const problems: string[] = []
  if (aigc.Label !== '1') problems.push(`Label is ${JSON.stringify(aigc.Label)}, expected "1"`)
  if (!String(aigc.ContentProducer ?? '').trim()) problems.push('ContentProducer is empty')
  if (aigc.ProduceID !== produceId) problems.push(`ProduceID is ${JSON.stringify(aigc.ProduceID)}, expected "${produceId}"`)
  for (const key of ['ContentPropagator', 'PropagateID']) if (!(key in aigc)) problems.push(`${key} key is missing`)
  if (!(tags.comment ?? '').includes(AI_LABEL)) problems.push(`comment does not carry ${AI_LABEL}`)
  return problems.length ? check('aigc_metadata', 'fail', problems.join('; ')) : check('aigc_metadata', 'pass', `Label 1, ProduceID ${produceId}; propagator fields empty (the platform propagates)`)
}

/** The burned-in ASS: the explicit label at the opening (0-3 s) and on the closing seconds, and a subtitle per line. */
export function checkAss(spec: Pick<QcSpec, 'ass' | 'seconds' | 'speech'>, events: AssEvent[] | undefined): QcCheck[] {
  if (!spec.ass) return [check('ai_label', 'fail', 'no ASS file recorded for this deliverable: the explicit label cannot be verified')]
  if (!events) return [check('ai_label', 'fail', `ASS file missing: ${spec.ass}`)]
  const labels = events.filter((e) => e.style === 'Label' && e.text.includes(AI_LABEL))
  const opening = labels.some((e) => e.start <= 0.05 && e.end >= 3 - 0.05)
  const closing = labels.some((e) => e.end >= spec.seconds - 0.1 && e.end - e.start >= 2 - 0.05)
  const results = [check('ai_label', opening && closing ? 'pass' : 'fail', `${AI_LABEL} ${opening ? 'on' : 'MISSING from'} 0-3 s, ${closing ? 'on' : 'MISSING from'} the closing seconds`)]
  const subtitles = events.filter((e) => e.style === 'Sub')
  const unsubtitled = spec.speech.filter((s) => !subtitles.some((e) => overlaps(e, s)))
  results.push(check('subtitles', unsubtitled.length ? 'fail' : 'pass', unsubtitled.length ? `no subtitle over the line at ${unsubtitled.map(span).join(', ')}` : `${subtitles.length} subtitle event(s) for ${spec.speech.length} line(s)`))
  return results
}

export function verdictOf(results: QcCheck[]): QcVerdict {
  if (results.some((r) => r.status === 'fail')) return 'fail'
  return results.some((r) => r.status === 'warn') ? 'pass-with-warnings' : 'pass'
}

/** Measure and judge one deliverable. */
export async function runQc(spec: QcSpec): Promise<QcReport> {
  const measured = await measure(spec)
  const results = judge(spec, measured)
  const { file, label, ...rest } = spec
  return { label, file, spec: rest, measured, results, verdict: verdictOf(results) }
}

/** The lines a report surfaces as open items: every fail and warn, labelled by deliverable. */
export function qcOpenItems(reports: QcReport[]): string[] {
  return reports.flatMap((report) => report.results.filter((r) => r.status === 'fail' || r.status === 'warn').map((r) => `${report.label}: ${r.status} ${r.check} - ${r.detail}`))
}

/** reports/qc.json: one entry per deliverable, file paths relative to the project. Infinity becomes null in JSON. */
export async function writeQcReport(dir: string, reports: QcReport[]): Promise<string> {
  await mkdir(join(dir, 'reports'), { recursive: true })
  const path = join(dir, 'reports', 'qc.json')
  const relative = (file: string) => (file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : file)
  await writeFile(path, JSON.stringify(reports.map((r) => ({ ...r, file: relative(r.file), spec: { ...r.spec, ...(r.spec.ass ? { ass: relative(r.spec.ass) } : {}) } })), null, 2))
  return path
}

/**
 * reports/qc.json with these reports replacing the ones of the same deliverables, the others kept in their order: a
 * revision re-measures only what it re-cut. Returns every report now in the file.
 */
export async function mergeQcReport(dir: string, reports: QcReport[]): Promise<QcReport[]> {
  const path = join(dir, 'reports', 'qc.json')
  const previous = existsSync(path) ? (JSON.parse(await readFile(path, 'utf8')) as QcReport[]) : []
  const absolute = (file: string) => (file.startsWith('/') ? file : join(dir, file))
  const kept = previous.map((r) => reports.find((n) => n.label === r.label) ?? { ...r, file: absolute(r.file), spec: { ...r.spec, ...(r.spec.ass ? { ass: absolute(r.spec.ass) } : {}) } })
  const all = [...kept, ...reports.filter((r) => !previous.some((p) => p.label === r.label))]
  await writeQcReport(dir, all)
  return all
}

/** Summary of a run for the log, the run record and the stage note. */
export function qcSummary(reports: QcReport[]): { verdict: QcVerdict; files: Array<{ label: string; verdict: QcVerdict; fails: string[]; warns: string[] }> } {
  const files = reports.map((r) => ({ label: r.label, verdict: r.verdict, fails: r.results.filter((x) => x.status === 'fail').map((x) => x.check), warns: r.results.filter((x) => x.status === 'warn').map((x) => x.check) }))
  return { verdict: verdictOf(reports.flatMap((r) => r.results)), files }
}
