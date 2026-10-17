import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { env } from './config.js'
import { audioWork, runContainer } from './containers.js'

export { audioWork }

/**
 * The audio models: Qwen3-TTS (voice design and cloning), Whisper (pronunciation check) and MOSS-SoundEffect, each run
 * in its container (src/lib/containers.ts). Each call loads its model once for a whole batch. Files are exchanged
 * through the step-audio work folder, the only host folder the containers can write to: every output path must live
 * under it, and an input from elsewhere is copied in.
 */
const inside = (path: string) => {
  const rel = relative(audioWork(), resolve(path))
  if (rel.startsWith('..')) throw new Error(`${path} must live under ${audioWork()} so the audio container can reach it`)
  return `/work/${rel}`
}
const outside = (path: string) => join(audioWork(), path.replace(/^\/work\//, ''))

/** A fresh folder for one container call: its job file, and any input staged for it. */
async function jobDir(): Promise<string> {
  const dir = join(audioWork(), 'jobs', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
  await mkdir(dir, { recursive: true })
  return dir
}

async function jobFile(name: string, jobs: unknown, dir?: string): Promise<string> {
  const path = join(dir ?? (await jobDir()), name)
  await writeFile(path, JSON.stringify(jobs, null, 2))
  return path
}

/**
 * A file the container only reads, as the container sees it: in place when it is under the work folder, otherwise
 * copied into the job's folder first. A character's designed voice is kept with its cast record in the project
 * (cast/<id>/voice.wav), outside the work folder, and must still be speakable.
 */
async function readable(path: string, dir: string): Promise<string> {
  if (!relative(audioWork(), resolve(path)).startsWith('..')) return inside(path)
  const staged = join(dir, `input-${basename(path)}`)
  await copyFile(path, staged)
  return inside(staged)
}

const ttsImage = () => env('CINEFOUNDRY_QWEN_TTS_IMAGE')!
const audioImage = () => env('CINEFOUNDRY_AUDIO_IMAGE')!
const mount = (name: 'CINEFOUNDRY_TTS_MODEL_DIR' | 'CINEFOUNDRY_ASR_MODEL_DIR' | 'CINEFOUNDRY_SFX_MODEL_DIR', at: string) => `${resolve(env(name)!)}:${at}:ro`

/** Voice design: `takes` candidate clips per voice, each saying `text`, from a written description. */
export async function designVoices(jobs: Array<{ id: string; design: string; text: string; language: 'English' | 'Chinese'; outDir: string }>, takes = 3): Promise<Array<{ id: string; path: string; text: string; seconds: number }>> {
  const file = await jobFile('cast.json', jobs.map((j) => ({ id: j.id, design: j.design, text: j.text, language: j.language, out: inside(j.outDir) })))
  const out = await runContainer({ image: ttsImage(), mounts: [mount('CINEFOUNDRY_TTS_MODEL_DIR', '/models')], script: 'voice-cast.py', args: ['--model', '/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign', '--jobs', inside(file), '--takes', String(takes)] })
  return (JSON.parse(out) as { results: Array<{ id: string; path: string; text: string; seconds: number }> }).results.map((r) => ({ ...r, path: outside(r.path) }))
}

/** Lines cloned from one reference clip; a line's seed picks its take. */
export async function cloneLines(reference: { wav: string; text: string }, lines: Array<{ text: string; output: string; seed?: number }>, language: 'English' | 'Chinese'): Promise<void> {
  const dir = await jobDir()
  const file = await jobFile('jobs.json', { prompt_audio: await readable(reference.wav, dir), prompt_text: reference.text, language, lines: lines.map((l) => ({ text: l.text, output: inside(l.output), seed: l.seed ?? 7 })) }, dir)
  await runContainer({ image: ttsImage(), mounts: [mount('CINEFOUNDRY_TTS_MODEL_DIR', '/models')], script: 'qwen-clone.py', args: ['--model', '/models/Qwen3-TTS-12Hz-1.7B-Base', '--jobs', inside(file)] })
}

/**
 * What the listener hears, against what should be said: Whisper transcribes each clip and the error rate is the
 * word error rate for English, the toned-syllable error rate for Chinese (homophones are not errors).
 */
export async function scoreSpeech(jobs: Array<{ path: string; text: string }>): Promise<Array<{ path: string; heard: string; cer: number }>> {
  if (!jobs.length) return []
  const file = await jobFile('asr.json', jobs.map((j) => ({ path: inside(j.path), text: j.text })))
  const out = await runContainer({ image: audioImage(), mounts: [mount('CINEFOUNDRY_ASR_MODEL_DIR', '/asr')], script: 'asr-score.py', args: ['--model', '/asr/whisper-large-v3-turbo', '--jobs', inside(file)] })
  return (JSON.parse(out) as { results: Array<{ path: string; heard: string; cer: number }> }).results.map((r) => ({ ...r, path: outside(r.path) }))
}

/** Sound effects and ambience, 48 kHz, one prompt each (English), up to 30 s. */
export async function generateSfx(jobs: Array<{ prompt: string; seconds: number; output: string; seed?: number }>): Promise<void> {
  if (!jobs.length) return
  const file = await jobFile('sfx.json', jobs.map((j) => ({ prompt: j.prompt, seconds: j.seconds, output: inside(j.output), seed: j.seed ?? 1 })))
  await runContainer({ image: audioImage(), mounts: [mount('CINEFOUNDRY_SFX_MODEL_DIR', '/moss')], script: 'sfx.py', args: ['--model', '/moss', '--jobs', inside(file)] })
}

/**
 * Speak every line, check it, and retake the lines the listener would not hear right: up to `retakes` more seeds per
 * line, keeping the take with the lowest error. Returns the error rate of the kept take per line; a line still above the
 * threshold after every retake is the caller's to report (it is kept, never silently treated as clean).
 */
export async function speakChecked(reference: { wav: string; text: string }, lines: Array<{ text: string; output: string }>, language: 'English' | 'Chinese', options: { threshold?: number; retakes?: number } = {}): Promise<number[]> {
  const threshold = options.threshold ?? 0.08
  const best = lines.map(() => ({ cer: Infinity, take: '' }))
  let pending = lines.map((_, index) => index)
  for (let round = 0; round <= (options.retakes ?? 2) && pending.length; round++) {
    const takes = pending.map((index) => ({ index, text: lines[index]!.text, output: lines[index]!.output.replace(/\.wav$/, `.take${round + 1}.wav`), seed: 7 + 101 * round }))
    await cloneLines(reference, takes, language)
    const scores = await scoreSpeech(takes.map((t) => ({ path: t.output, text: t.text })))
    takes.forEach((t, n) => {
      const cer = scores[n]?.cer ?? 1
      if (cer < best[t.index]!.cer) best[t.index] = { cer, take: t.output }
    })
    pending = pending.filter((index) => best[index]!.cer > threshold)
  }
  for (const [index, line] of lines.entries()) await copyFile(best[index]!.take, line.output)
  return best.map((b) => b.cer)
}
