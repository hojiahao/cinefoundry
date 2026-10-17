import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { loadWorkflow, renderWorkflow } from '../comfy/workflow.js'
import { exec } from './exec.js'
import { probeDuration } from './ffmpeg.js'
import { speakChecked } from './speech.js'

const TTS_PYTHON = () => resolve(process.env.CINEFOUNDRY_TTS_PYTHON ?? 'runtime-data/tts-venv/bin/python')
const TTS_SCRIPT = () => resolve(process.env.CINEFOUNDRY_TTS_SCRIPT ?? 'scripts/tts.py')

/**
 * Offline Mandarin voiceover for one line. If the line runs longer than its slot it is
 * re-synthesised faster (up to 1.25x) rather than cut off.
 */
export async function synthesizeVoice(text: string, output: string, maxSeconds: number, voice = process.env.CINEFOUNDRY_TTS_VOICE ?? 'zf_001'): Promise<{ seconds: number; speed: number }> {
  await mkdir(dirname(output), { recursive: true })
  let speed = 1.0
  for (let attempt = 0; attempt < 3; attempt++) {
    await exec(TTS_PYTHON(), [TTS_SCRIPT(), '--text', text, '--out', output, '--voice', voice, '--speed', speed.toFixed(2)])
    const seconds = await probeDuration(output)
    if (seconds <= maxSeconds || speed >= 1.25) return { seconds, speed }
    speed = Math.min(1.25, speed * (seconds / maxSeconds) * 1.03)
  }
  return { seconds: await probeDuration(output), speed }
}

export interface VoiceLine { text: string; output: string; maxSeconds: number }
export interface VoiceResult { seconds: number; speed: number; model: string; /** Whisper's error rate on the kept take, when the line was checked. */ errorRate?: number }

/**
 * Which offline voice engine the film uses: Kokoro (default), StepFun's Step-Audio-EditX, or Qwen3-TTS.
 * The two cloning engines take one reference clip; the showcase uses a narrator voice designed from a
 * written description with Qwen3-TTS VoiceDesign (scripts/voice-design.py), so no real person's voice is involved.
 */
export const ttsEngine = (): 'kokoro' | 'step-audio' | 'qwen-tts' => {
  const engine = process.env.CINEFOUNDRY_TTS_ENGINE
  return engine === 'step-audio' || engine === 'qwen-tts' ? engine : 'kokoro'
}

/**
 * The chain a broadcast voiceover goes through: rumble cut, gentle compression for an even level,
 * a little low-mid body and upper-mid presence so it sits in front of the music, then a limiter.
 */
export const BROADCAST_VOICE_CHAIN = 'highpass=f=70,acompressor=threshold=-22dB:ratio=3:attack=5:release=90:makeup=4,equalizer=f=180:t=q:w=1.2:g=2,equalizer=f=3200:t=q:w=1.4:g=3,alimiter=limit=0.9'

/**
 * All voiceover lines of a film. Kokoro synthesises them one by one; Step-Audio-EditX loads its
 * model once for the whole batch (scripts/step-audio.sh batch), cloning the reference voice given by
 * CINEFOUNDRY_TTS_REF_WAV / CINEFOUNDRY_TTS_REF_TEXT and, with CINEFOUNDRY_TTS_STYLE, re-voicing each line in
 * that style. A line that overruns its slot is time-stretched, at most 1.25x, never cut.
 */
export async function synthesizeVoices(lines: VoiceLine[], voice?: { wav: string; text: string; language?: 'English' | 'Chinese' }): Promise<VoiceResult[]> {
  // A voice cast from the library is always the designed Qwen3-TTS voice, whatever the default engine is.
  const engine = voice ? 'qwen-tts' : ttsEngine()
  if (engine === 'kokoro') {
    const results: VoiceResult[] = []
    for (const line of lines) results.push({ ...(await synthesizeVoice(line.text, line.output, line.maxSeconds)), model: 'Kokoro-82M-v1.1-zh' })
    return results
  }
  const work = resolve(process.env.CINEFOUNDRY_STEP_AUDIO_DIR ?? 'runtime-data/step-audio')
  // The voice the creative director cast for this film, else the configured default narrator.
  const reference = resolve(voice?.wav ?? process.env.CINEFOUNDRY_TTS_REF_WAV ?? '')
  const referenceText = voice?.text ?? process.env.CINEFOUNDRY_TTS_REF_TEXT ?? ''
  if (!(voice?.wav ?? process.env.CINEFOUNDRY_TTS_REF_WAV) || !referenceText) throw new Error(`CINEFOUNDRY_TTS_ENGINE=${engine} needs CINEFOUNDRY_TTS_REF_WAV (a wav under runtime-data/step-audio/) and CINEFOUNDRY_TTS_REF_TEXT (what it says)`)
  if (!reference.startsWith(`${work}/`)) throw new Error(`the reference voice must live under ${work} so the container can read it`)
  const inside = (path: string) => `/work/${relative(work, path)}`
  const jobDir = join(work, 'jobs', `${Date.now().toString(36)}`)
  await mkdir(jobDir, { recursive: true })
  const jobs = { prompt_audio: inside(reference), prompt_text: referenceText, language: voice?.language ?? 'Chinese', style: process.env.CINEFOUNDRY_TTS_STYLE || null,
    lines: lines.map((line, index) => ({ text: line.text, output: inside(join(jobDir, `vo_${index + 1}.wav`)) })) }
  await writeFile(join(jobDir, 'jobs.json'), JSON.stringify(jobs, null, 2))
  const errors: number[] = []
  if (engine === 'qwen-tts' && voice) {
    // Every line is checked by ear (Whisper) and retaken until it is heard right; a line no retake fixes is reported.
    errors.push(...(await speakChecked({ wav: reference, text: referenceText }, lines.map((line, index) => ({ text: line.text, output: join(jobDir, `vo_${index + 1}.wav`) })), voice.language ?? 'Chinese')))
  } else if (engine === 'qwen-tts') {
    await exec('docker', ['run', '--rm', '--device', 'nvidia.com/gpu=all', '--ipc=host', '-v', `${resolve('.')}:/repo:ro`, '-v', `${resolve(process.env.CINEFOUNDRY_TTS_MODEL_DIR ?? join(process.env.SPARK_MODEL_DIR ?? join(homedir(), 'models'), 'tts'))}:/models:ro`, '-v', `${work}:/work`,
      process.env.CINEFOUNDRY_QWEN_TTS_IMAGE ?? 'cinefoundry/qwen-tts:local', '/repo/scripts/qwen-clone.py', '--model', '/models/Qwen3-TTS-12Hz-1.7B-Base', '--jobs', inside(join(jobDir, 'jobs.json'))])
  } else await exec('bash', [resolve(process.env.CINEFOUNDRY_STEP_AUDIO_SCRIPT ?? 'scripts/step-audio.sh'), 'batch', inside(join(jobDir, 'jobs.json'))])
  const results: VoiceResult[] = []
  for (const [index, line] of lines.entries()) {
    const raw = join(jobDir, `vo_${index + 1}.wav`)
    await mkdir(dirname(line.output), { recursive: true })
    // Trim leading and trailing silence first: the slot is for speech, not for the model's pauses.
    const trimmed = join(jobDir, `vo_${index + 1}.trim.wav`)
    await exec('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', trimmed])
    let seconds = await probeDuration(trimmed)
    const speed = seconds > line.maxSeconds ? Math.min(1.25, seconds / line.maxSeconds) : 1
    const chain = [speed > 1 ? `atempo=${speed.toFixed(3)}` : '', process.env.CINEFOUNDRY_VOICE_CHAIN === '0' ? '' : BROADCAST_VOICE_CHAIN].filter(Boolean).join(',')
    if (chain) await exec('ffmpeg', ['-y', '-v', 'error', '-i', trimmed, '-af', chain, line.output])
    else await copyFile(trimmed, line.output)
    seconds = await probeDuration(line.output)
    results.push({ seconds, speed, model: engine === 'qwen-tts' ? 'Qwen3-TTS-1.7B (designed voice)' : `Step-Audio-EditX${jobs.style ? ` (${jobs.style})` : ''}`, ...(errors[index] !== undefined ? { errorRate: errors[index] } : {}) })
  }
  return results
}

/** An instrumental bed generated locally by ACE-Step through ComfyUI: nothing licensed, nothing uploaded. */
export async function generateMusic(comfy: ComfyClient, request: { tags: string; seconds: number; output: string }): Promise<{ seconds: number }> {
  const started = Date.now()
  const outputs = await comfy.run(
    renderWorkflow(await loadWorkflow('ace_step_instrumental'), {
      tags: request.tags,
      seconds: Math.ceil(request.seconds) + 2,
      seed: Math.floor(Math.random() * 2 ** 31),
      filename_prefix: `cinefoundry/music_${Date.now()}`,
    }),
  )
  await mkdir(dirname(request.output), { recursive: true })
  await writeFile(request.output, await comfy.download(outputs[0]!))
  return { seconds: (Date.now() - started) / 1000 }
}

/**
 * Voice lines placed at their cue times over the music bed. The bed ducks under the voice
 * (sidechain compression) instead of sitting at one low level for the whole film.
 * `musicOffset` starts the bed that many seconds in: a cutdown back-times the master's score so it ends on the same
 * resolution as the master instead of being faded out mid-phrase.
 */
export async function mixSoundtrack(request: { voices: Array<{ path: string; start: number }>; music?: string; musicOffset?: number; totalSeconds: number; output: string; stems?: Partial<Record<'dialogue' | 'music', string>> }): Promise<void> {
  const { voices, music, totalSeconds, output } = request
  const offset = Math.max(0, request.musicOffset ?? 0)
  if (voices.length === 0 && !music) throw new Error('Nothing to mix: no voice lines and no music.')
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...voices.flatMap((voice) => ['-i', voice.path])]
  const parts: string[] = []
  const stemOutputs: string[] = []
  voices.forEach((voice, index) => {
    const delay = Math.round(voice.start * 1000)
    parts.push(`[${index}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}|${delay},volume=1.6[v${index}]`)
  })
  let voiceBus = ''
  if (voices.length > 0) {
    parts.push(`${voices.map((_, index) => `[v${index}]`).join('')}amix=inputs=${voices.length}:normalize=0:duration=longest,apad=whole_dur=${totalSeconds}[voice]`)
    voiceBus = tapStem(parts, stemOutputs, 'voice', request.stems?.dialogue, totalSeconds)
  }
  if (music) {
    args.push('-i', music)
    parts.push(`[${voices.length}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${offset.toFixed(3)}:duration=${totalSeconds},asetpts=PTS-STARTPTS,volume=0.55[bed]`)
    if (voiceBus) {
      parts.push(`[${voiceBus}]asplit=2[voiceMix][voiceKey]`)
      parts.push('[bed][voiceKey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]')
      parts.push(`[voiceMix][${tapStem(parts, stemOutputs, 'ducked', request.stems?.music, totalSeconds)}]amix=inputs=2:normalize=0:duration=longest[mix]`)
    } else parts.push(`[${tapStem(parts, stemOutputs, 'bed', request.stems?.music, totalSeconds)}]anull[mix]`)
  } else parts.push(`[${voiceBus}]anull[mix]`)
  parts.push(`[mix]atrim=duration=${totalSeconds},alimiter=limit=0.95[out]`)
  await mkdir(dirname(output), { recursive: true })
  for (const path of Object.values(request.stems ?? {})) if (path) await mkdir(dirname(path), { recursive: true })
  await exec('ffmpeg', [...args, '-filter_complex', parts.join(';'), '-map', '[out]', '-ar', '48000', output, ...stemOutputs])
}

/**
 * A stem: the bus `label` also goes, unchanged and trimmed to the film's length, to its own WAV - the same ffmpeg pass as
 * the mix, so the stems are exactly the buses the mix summed (before its limiter). Returns the label the mix goes on with.
 */
export function tapStem(parts: string[], outputs: string[], label: string, path: string | undefined, totalSeconds: number): string {
  if (!path) return label
  const n = outputs.filter((arg) => arg === '-map').length
  parts.push(`[${label}]asplit=2[${label}_mix][${label}_stem]`, `[${label}_stem]apad=whole_dur=${totalSeconds},atrim=duration=${totalSeconds}[stem${n}]`)
  outputs.push('-map', `[stem${n}]`, '-ar', '48000', '-c:a', 'pcm_s24le', path)
  return `${label}_mix`
}
