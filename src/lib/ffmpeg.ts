import { writeFile } from 'node:fs/promises'
import { exec } from './exec.js'

export async function probeDuration(video: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video])
  return Number(stdout.trim())
}

export async function scaleImage(input: string, output: string, width: number, height: number): Promise<void> {
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${width}:${height}:flags=lanczos`, output])
}

/** Re-encode any still ffmpeg can read as PNG, the longest side capped at `maxSide` (never upscaled). */
export async function normalizeImage(input: string, output: string, maxSide: number): Promise<void> {
  const scale = `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))':flags=lanczos`
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', scale, output])
}

export async function extractFrame(video: string, seconds: number, output: string): Promise<void> {
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', seconds.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', output])
}

export async function extractLastFrame(video: string, output: string): Promise<void> {
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.2', '-i', video, '-frames:v', '1', output])
}

/** Timestamps where ffmpeg's scene score crosses the threshold. */
export async function detectCuts(video: string, threshold: number): Promise<number[]> {
  const { stderr } = await exec('ffmpeg', ['-hide_banner', '-i', video, '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'])
  return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]))
}

export interface CutOptions {
  width: number
  height: number
  fps: number
  audio?: string
  audioGainDb?: number
  subtitles?: string
}

/** Normalise every clip to one size and frame rate, join them, then lay audio and subtitles on top. */
export async function assembleCut(clips: string[], output: string, options: CutOptions): Promise<void> {
  const inputs = clips.flatMap((clip) => ['-i', clip])
  const normalise = clips
    .map((_, index) => `[${index}:v]scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${options.fps}[v${index}]`)
    .join(';')
  let chain = `${normalise};${clips.map((_, index) => `[v${index}]`).join('')}concat=n=${clips.length}:v=1:a=0[joined]`
  let videoLabel = '[joined]'
  if (options.subtitles) {
    const escaped = options.subtitles.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
    chain += `;[joined]subtitles='${escaped}'[subbed]`
    videoLabel = '[subbed]'
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...inputs]
  if (options.audio) {
    args.push('-i', options.audio)
    chain += `;[${clips.length}:a]volume=${options.audioGainDb ?? -10}dB[music]`
  }
  args.push('-filter_complex', chain, '-map', videoLabel)
  if (options.audio) args.push('-map', '[music]', '-shortest', '-c:a', 'aac')
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output)
  await exec('ffmpeg', args)
}

export async function concatCopy(segments: string[], output: string): Promise<void> {
  const listing = `${output}.txt`
  await writeFile(listing, segments.map((segment) => `file '${segment}'\n`).join(''))
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listing, '-c', 'copy', output])
}

export interface FilmOptions {
  width: number
  height: number
  fps: number
  /** Seconds each clip occupies on the timeline, in clip order. */
  durations: number[]
  /**
   * Overlap between clip i and clip i+1, in seconds: 0 is a hard cut, more is a dissolve of that length. One number applies
   * to every join (the old behaviour, a crossfade everywhere); commercials mostly cut hard and dissolve only into the end card.
   */
  crossfadeSeconds: number | number[]
  ass?: string
  /** Finished soundtrack (voiceover already mixed over music), laid under the picture as is. */
  audio?: string
  /** Comma-joined ffmpeg filters applied to the joined picture (the grade); defaults to GRADES.neutral. */
  grade?: string
  /** Container metadata, e.g. the implicit AI-generated label. */
  metadata?: Record<string, string>
  /** Integrated loudness target in LUFS for the soundtrack (web -16, broadcast -24); true peak is held at -1.5 dBTP. */
  loudness?: number
}

const overlapAt = (overlaps: number | number[], join: number) => (Array.isArray(overlaps) ? overlaps[join] ?? 0 : overlaps)

/** Seconds at which clip `index` starts on the final timeline, given the overlap at each join. */
export const clipStart = (index: number, durations: number[], overlaps: number | number[]) =>
  durations.slice(0, index).reduce((sum, duration, join) => sum + duration - overlapAt(overlaps, join), 0)
export const filmLength = (durations: number[], overlaps: number | number[]) => clipStart(durations.length - 1, durations, overlaps) + durations.at(-1)!

/** Picture looks, applied to the whole joined film so shots from different generations read as one. Kept restrained. */
export const GRADES: Record<string, string> = {
  neutral: 'eq=contrast=1.05:saturation=1.04:gamma=0.99,unsharp=3:3:0.25:3:3:0.0,noise=alls=3:allf=t+u,vignette=PI/6',
  // Drama: filmic and restrained - gentle contrast, slightly held-back saturation, warm skin, soft highlight roll-off, grain.
  drama: 'eq=contrast=1.04:saturation=0.94:gamma=1.0,colorbalance=rs=0.015:gs=0.005:bs=-0.01:bh=0.01,curves=all=0/0 0.85/0.82 1/0.96,noise=alls=4:allf=t+u,vignette=PI/6',
  // Drinks: clean and cool in the highlights, crisp; keep whites white.
  drink: 'eq=contrast=1.07:saturation=1.06:gamma=0.98,colorbalance=rh=-0.02:bh=0.03:rs=0.01,unsharp=3:3:0.3:3:3:0.0,noise=alls=2:allf=t+u,vignette=PI/6.5',
  // Skincare: soft, low contrast, warm-neutral skin, gentle highlight bloom, no sharpening.
  skincare: 'eq=contrast=0.97:saturation=0.96:gamma=1.02:brightness=0.01,colorbalance=rs=0.02:gs=0.005:rh=0.01,gblur=sigma=0.4:steps=1,noise=alls=2:allf=t+u,vignette=PI/7',
  // Food: warm and rich, lifted mids, texture kept.
  food: 'eq=contrast=1.06:saturation=1.10:gamma=0.97,colorbalance=rs=0.04:gs=0.01:bs=-0.03:rm=0.02,unsharp=3:3:0.3:3:3:0.0,noise=alls=3:allf=t+u,vignette=PI/6',
  // Consumer electronics: deep neutral blacks, cool edge, crisp metal.
  electronics: 'eq=contrast=1.10:saturation=0.98:gamma=0.97,colorbalance=bs=0.02:bh=0.02:rh=-0.01,unsharp=3:3:0.35:3:3:0.0,noise=alls=2:allf=t+u,vignette=PI/5.5',
  // Computers and servers: warm gold key, deep blacks, no blue cast.
  computing: 'eq=contrast=1.08:saturation=1.02:gamma=0.98,colorbalance=rs=0.03:gs=0.01:bs=-0.03:rh=0.02:bh=-0.02,unsharp=3:3:0.3:3:3:0.0,noise=alls=2:allf=t+u,vignette=PI/5.5',
  // Home and lifestyle: warm practical light, soft contrast.
  home: 'eq=contrast=1.02:saturation=1.02:gamma=1.0,colorbalance=rs=0.03:gs=0.01:bs=-0.02,noise=alls=3:allf=t+u,vignette=PI/6',
}
GRADES.general = GRADES.neutral!

/** The video bitrate ceiling of a delivery, Mb/s: 0.2 bit per pixel per frame, never under 8 Mb/s. Delivery QC checks against it. */
export const bitrateCeilingMbps = (width: number, height: number, fps: number) => Math.max(8, Math.round((width * height * fps * 0.2) / 1e6))

export async function assembleFilm(clips: string[], output: string, options: FilmOptions): Promise<void> {
  const { width, height, fps, durations, crossfadeSeconds } = options
  const conform = clips
    .map((_, index) => `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,fps=${fps},trim=duration=${durations[index]},setpts=PTS-STARTPTS,format=yuv420p[c${index}]`)
    .join(';')
  let chain = conform
  let last = '[c0]'
  for (let index = 1; index < clips.length; index++) {
    const label = `[x${index}]`
    const overlap = overlapAt(crossfadeSeconds, index - 1)
    chain += overlap > 0
      ? `;${last}[c${index}]xfade=transition=fade:duration=${overlap}:offset=${clipStart(index, durations, crossfadeSeconds).toFixed(3)}${label}`
      : `;${last}[c${index}]concat=n=2:v=1:a=0,settb=1/${fps}${label}` // concat outputs a 1/1000000 timebase; xfade needs the clips' own
    last = label
  }
  const total = filmLength(durations, crossfadeSeconds)
  const grade = [options.grade ?? GRADES.neutral, `fade=t=in:st=0:d=0.35,fade=t=out:st=${(total - 0.5).toFixed(3)}:d=0.5`].join(',')
  chain += `;${last}${grade}[graded]`
  let videoLabel = '[graded]'
  if (options.ass) {
    const escaped = options.ass.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
    chain += `;[graded]ass='${escaped}'[titled]`
    videoLabel = '[titled]'
  }
  // Tag the frames themselves: the encoder's -color_* options alone left primaries and transfer untagged (delivery QC).
  chain += `;${videoLabel}setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[delivered]`
  videoLabel = '[delivered]'
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...clips.flatMap((clip) => ['-i', clip])]
  if (options.audio) {
    args.push('-i', options.audio)
    const loud = options.loudness ?? -16
    chain += `;[${clips.length}:a]afade=t=in:st=0:d=0.3,afade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8,loudnorm=I=${loud}:TP=-1.5:LRA=11,aresample=48000[sound]`
  }
  args.push('-filter_complex', chain, '-map', videoLabel)
  if (options.audio) args.push('-map', '[sound]', '-t', total.toFixed(3), '-c:a', 'aac', '-b:a', '320k', '-ar', '48000')
  for (const [key, value] of Object.entries(options.metadata ?? {})) args.push('-metadata', `${key}=${value}`)
  // Delivery: H.264 High, BT.709, quality-driven (crf 16) with a ceiling of 0.2 bits per pixel per frame:
  // about 25 Mbps for 1080p60, 100 Mbps for 4K60 - high-quality platform masters, not a mezzanine.
  const maxrate = bitrateCeilingMbps(width, height, fps)
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-maxrate', `${maxrate}M`, '-bufsize', `${maxrate * 2}M`, '-profile:v', 'high',
    '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart+use_metadata_tags', output)
  await exec('ffmpeg', args)
}

/** A slow push-in on a still image: used for the end card built from the approved product hero. */
export async function stillToClip(image: string, output: string, options: { width: number; height: number; fps: number; seconds: number }): Promise<void> {
  const frames = Math.round(options.seconds * options.fps)
  // Oversample before zoompan, otherwise its integer pixel steps show up as jitter.
  const filter = `scale=${options.width * 2}:${options.height * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${options.width * 2}:${options.height * 2},zoompan=z='1+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${options.width}x${options.height}:fps=${options.fps},format=yuv420p`
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', image, '-vf', filter, '-t', String(options.seconds), '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', output])
}

/** True when the font has a glyph for every character, so a missing glyph fails the cut instead of showing a box. */
export async function fontCovers(family: string, text: string): Promise<{ ok: boolean; missing: string[] }> {
  const chars = [...new Set([...text].filter((char) => char.trim() && char.codePointAt(0)! > 0x7f))]
  const missing: string[] = []
  for (const char of chars) {
    const { stdout } = await exec('fc-list', [`:family=${family}:charset=${char.codePointAt(0)!.toString(16)}`, 'family'], { allowFailure: true })
    if (!stdout.trim()) missing.push(char)
  }
  return { ok: missing.length === 0, missing }
}
