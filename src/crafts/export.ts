import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { exec } from '../lib/exec.js'
import { toEdl, toFcpxml, toOtio, toSrt, toXmeml, type InterchangeInput } from './interchange.js'
import { AUDIO_BUSES, readTimeline, renderStems, resolved, type AudioBus } from './timeline.js'

export type InterchangeFormat = 'edl' | 'fcpxml' | 'otio'
export const INTERCHANGE_FORMATS: InterchangeFormat[] = ['edl', 'fcpxml', 'otio']

export interface ExportResult {
  label: string
  format: InterchangeFormat
  /** exports/<label>/ inside the project. */
  dir: string
  /** Every file written, relative to the project. */
  files: string[]
}

/** Length and picture format of a media file, measured (ffprobe). */
export async function probeMedia(path: string): Promise<{ seconds: number; width?: number; height?: number; fps?: number }> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', path])
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; r_frame_rate?: string }> }
  const video = info.streams?.find((s) => s.codec_type === 'video' && s.width)
  const [num, den] = (video?.r_frame_rate ?? '').split('/').map(Number)
  const fps = num && den ? Math.round((num / den) * 1000) / 1000 : undefined
  return { seconds: Number(info.format?.duration ?? 0), ...(video ? { width: video.width, height: video.height } : {}), ...(fps ? { fps } : {}) }
}

/**
 * Export one finished cut for an online editor: the interchange file(s) of the chosen format, and always the mix with
 * its four stems as WAVs beside it, the subtitles as SRT (Chinese and English separately) and the ASS burned into the
 * delivered picture, plus manifest.json. Everything lands in exports/<label>/ inside the project. The cut's timeline
 * (cut/<label>.timeline.json, written by the cut) is the source of truth.
 */
export async function exportCut(dir: string, input: { label: string; format: InterchangeFormat }): Promise<ExportResult> {
  const { label, format } = input
  if (!INTERCHANGE_FORMATS.includes(format)) throw new Error(`--format ${format}: use ${INTERCHANGE_FORMATS.join(', ')}`)
  const timeline = await readTimeline(dir, label)
  if (!timeline) throw new Error(`no timeline for ${label} (cut/${label}.timeline.json): it is written when the cut is made; re-cut this deliverable first, e.g. \`cinefoundry revise <id> --grade neutral\``)
  for (const clip of timeline.picture) if (!existsSync(resolved(dir, clip.source))) throw new Error(`source missing: ${clip.source}`)
  const out = join(dir, 'exports', label)
  await mkdir(out, { recursive: true })
  const files: string[] = []
  const write = async (name: string, content: string) => { await writeFile(join(out, name), content); files.push(join(out, name)) }

  // Sound: the mix and its stems, rendered from the timeline's sources in one ffmpeg pass.
  let stems: Record<AudioBus, string> | undefined
  if (timeline.mix) {
    const paths = { mix: join(out, `${label}_mix.wav`), ...Object.fromEntries(AUDIO_BUSES.map((bus) => [bus, join(out, `${label}_${bus}.wav`)])) } as { mix: string } & Record<AudioBus, string>
    await renderStems(dir, timeline, paths)
    stems = Object.fromEntries(AUDIO_BUSES.map((bus) => [bus, paths[bus]])) as Record<AudioBus, string>
    files.push(paths.mix, ...AUDIO_BUSES.map((bus) => paths[bus]))
  }
  const media = new Map<string, Awaited<ReturnType<typeof probeMedia>>>()
  for (const path of [...new Set(timeline.picture.map((clip) => resolved(dir, clip.source)))]) media.set(path, await probeMedia(path))
  if (stems) for (const path of Object.values(stems)) media.set(path, await probeMedia(path))
  const interchange: InterchangeInput = { timeline, resolve: (path) => resolved(dir, path), ...(stems ? { stems } : {}), media }

  if (format === 'edl') {
    await write(`${label}.edl`, toEdl(interchange, 'main'))
    if (stems) await write(`${label}.effects.edl`, toEdl(interchange, 'effects'))
  } else if (format === 'fcpxml') {
    await write(`${label}.fcpxml`, toFcpxml(interchange))
    await write(`${label}.xml`, toXmeml(interchange))
  } else await write(`${label}.otio`, `${JSON.stringify(toOtio(interchange), null, 2)}\n`)

  await write(`${label}.zh.srt`, toSrt(timeline.subtitles, 'zh'))
  if (timeline.subtitles.some((s) => s.en?.trim())) await write(`${label}.en.srt`, toSrt(timeline.subtitles, 'en'))
  const ass = resolved(dir, timeline.ass)
  if (existsSync(ass)) { await copyFile(ass, join(out, `${label}.ass`)); files.push(join(out, `${label}.ass`)) }
  const manifest = {
    project: timeline.projectId, label, format, fps: timeline.fps, width: timeline.width, height: timeline.height, seconds: timeline.seconds,
    delivered: timeline.file, recordStart: '01:00:00:00',
    picture: timeline.picture.map((clip) => ({ kind: clip.kind, shot: clip.shot ?? null, source: clip.source, in: clip.in, duration: clip.duration, start: clip.start, dissolveIn: clip.transitionIn?.seconds ?? null })),
    stems: stems ? Object.fromEntries(AUDIO_BUSES.map((bus) => [bus, { file: relative(dir, stems![bus]), empty: timeline.audio[bus].length === 0 }])) : null,
    endCard: timeline.endCard ?? null, markers: timeline.markers, grade: timeline.grade ?? null,
    notes: [
      'Picture sources are the generated clips before grade and titles: the grade, the typeset titles and the explicit AI label (内容由 AI 生成) are in the delivered file and in the ASS; a conform must burn the ASS in and keep the label.',
      'Stems are the mix buses before the delivery loudness normalisation and limiter; they sum to the mix.',
      'A dissolve begins on the edit: the outgoing clip plays its tail handle under it.',
    ],
  }
  await write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  return { label, format, dir: out, files: files.map((file) => relative(dir, file)) }
}
