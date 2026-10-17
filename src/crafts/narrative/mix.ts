import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { exec } from '../../lib/exec.js'
import { tapStem } from '../../lib/audio.js'

/**
 * A dialogue-led mix in four buses, the way a re-recording mixer balances a drama: dialogue on top and always intelligible,
 * effects in sync with the picture, ambience as a bed that changes with the scene, and the score ducking under every line.
 * Levels are relative; the cut normalises the result to the delivery loudness.
 */
export interface MixInput {
  totalSeconds: number
  dialogue: Array<{ path: string; start: number }>
  /** One bed per scene, laid from `start` for `seconds` with short fades so scene changes are heard. */
  ambience: Array<{ path: string; start: number; seconds: number }>
  effects: Array<{ path: string; start: number }>
  music?: string
  output: string
  /** Also write each bus as a stem WAV of the film's length (export, `cinefoundry export`). */
  stems?: Partial<Record<'dialogue' | 'ambience' | 'effects' | 'music', string>>
}

export async function mixNarrative(input: MixInput): Promise<void> {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y']
  const parts: string[] = []
  const buses: string[] = []
  let n = 0
  const add = (path: string) => { args.push('-i', path); return n++ }
  const ms = (s: number) => Math.max(0, Math.round(s * 1000))

  const dialogue = input.dialogue.map((d) => {
    const i = add(d.path)
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,highpass=f=80,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=2,adelay=${ms(d.start)}|${ms(d.start)}[d${i}]`)
    return `[d${i}]`
  })
  if (dialogue.length) {
    parts.push(`${dialogue.join('')}amix=inputs=${dialogue.length}:normalize=0:duration=longest,apad=whole_dur=${input.totalSeconds}[dia]`)
    buses.push('dia')
  }
  const ambience = input.ambience.map((a) => {
    const i = add(a.path)
    const fade = Math.min(0.6, a.seconds / 4)
    // A bed shorter than its scene loops; the fades hide the seam at scene changes.
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,aloop=loop=-1:size=2147483647,atrim=duration=${a.seconds},afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, a.seconds - fade)}:d=${fade},volume=0.22,adelay=${ms(a.start)}|${ms(a.start)}[a${i}]`)
    return `[a${i}]`
  })
  if (ambience.length) { parts.push(`${ambience.join('')}amix=inputs=${ambience.length}:normalize=0:duration=longest,apad=whole_dur=${input.totalSeconds}[amb]`); buses.push('amb') }
  const effects = input.effects.map((e) => {
    const i = add(e.path)
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.5,adelay=${ms(e.start)}|${ms(e.start)}[e${i}]`)
    return `[e${i}]`
  })
  if (effects.length) { parts.push(`${effects.join('')}amix=inputs=${effects.length}:normalize=0:duration=longest,apad=whole_dur=${input.totalSeconds}[fx]`); buses.push('fx') }
  if (input.music) {
    const i = add(input.music)
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${input.totalSeconds},afade=t=out:st=${Math.max(0, input.totalSeconds - 2)}:d=2,volume=0.35[mus0]`)
    if (dialogue.length) {
      // A link label is used once: the dialogue bus is split into what is heard and the key that ducks the score.
      parts.push('[dia]asplit=2[diaOut][key]')
      buses[buses.indexOf('dia')] = 'diaOut'
      parts.push('[mus0][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=500[mus]')
    } else parts.push('[mus0]anull[mus]')
    buses.push('mus')
  }
  if (!buses.length) throw new Error('nothing to mix')
  // Stems: each bus also to its own WAV in the same pass, so the stems are exactly what the mix summed.
  const stemOutputs: string[] = []
  const kind = { dia: 'dialogue', diaOut: 'dialogue', amb: 'ambience', fx: 'effects', mus: 'music' } as const
  const mixed = buses.map((bus) => tapStem(parts, stemOutputs, bus, input.stems?.[kind[bus as keyof typeof kind]], input.totalSeconds))
  parts.push(`${mixed.map((b) => `[${b}]`).join('')}amix=inputs=${mixed.length}:normalize=0:duration=longest,atrim=duration=${input.totalSeconds},alimiter=limit=0.95[out]`)
  await mkdir(dirname(input.output), { recursive: true })
  for (const path of Object.values(input.stems ?? {})) if (path) await mkdir(dirname(path), { recursive: true })
  await exec('ffmpeg', [...args, '-filter_complex', parts.join(';'), '-map', '[out]', '-ar', '48000', input.output, ...stemOutputs])
}
