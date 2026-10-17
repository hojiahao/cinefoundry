import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ComfyClient } from '../../comfy/client.js'
import { chatJson } from '../../agent/llm.js'
import { AI_LABEL, TITLE_FONT, enterPhase } from '../../agent/finish.js'
import type { QaVerdict } from '../../agent/gate.js'
import { generateMusic } from '../../lib/audio.js'
import { exec } from '../../lib/exec.js'
import { GRADES, assembleFilm, fontCovers, probeDuration } from '../../lib/ffmpeg.js'
import { deliverySize, generationResolution } from '../../lib/formats.js'
import { generateImage, generateVideo, interpolateVideo, interpolationMultiplier, videoFps, videoSize, VIDEO_NEGATIVE } from '../../lib/media.js'
import { addAsset } from '../../lib/project.js'
import { audioWork, designVoices, generateSfx, scoreSpeech, speakChecked } from '../../lib/speech.js'
import { loadVoiceLibrary, voiceReference, voicesDir, type LibraryVoice } from '../../lib/voices.js'
import { existsSync } from 'node:fs'
import { buildAss, endCardLayout, type TitleCue } from '../../lib/titles.js'
import { brandFinish, brandPackaging, brandVoices, productReference } from '../brand.js'
import { NARRATIVE_EDIT_MODEL, NARRATIVE_IMAGE_MODEL, castPictures, referencePrompt, saveCharacterRecord, selectReferences, type CastMember } from './casting.js'
import { gradeWith } from '../finishing.js'
import { pictureTrack, stored, writeTimeline } from '../timeline.js'
import { produced, key, type NarrativeContext } from './context.js'
import { loudnessFor, mergeQcReport, qcOpenItems, qcSummary, runQc, type QcReport, type QcSpec, type QcVerdict } from '../qc.js'
import { shotGate } from './gate.js'
import { mixNarrative } from './mix.js'
import type { Character, NarrativeShot } from './types.js'

const pad = (n: number) => String(n).padStart(2, '0')
const shotName = (episode: number, shot: number) => `ep${pad(episode)}_shot_${String(shot).padStart(3, '0')}`
/** The breath before a line inside its shot; the lip-sync track and the subtitles both start here. */
const LINE_OFFSET = 0.4
const REALISM = 'Photorealistic frame from a modern American television drama shot on a cinema camera: natural skin with pores and fine texture, real hair, motivated light, shallow depth of field, subtle film grain. No text, captions or logos.'
const castOf = (ctx: NarrativeContext, ids: string[]) => ids.map((id) => ctx.bible!.characters.find((c) => c.id === id)).filter((c): c is Character => !!c)

/**
 * Casting: a casting brief, a gated casting call and an identity-gated reference pack per character (casting.ts), and a
 * voice for each; all recorded in cast/<id>/character.json, which later episodes and series runs reuse.
 */
export async function castingStage(ctx: NarrativeContext): Promise<string> {
  const bible = ctx.bible!
  await mkdir(join(ctx.dir!, 'cast'), { recursive: true })
  const pictures = await castPictures(ctx)
  // Voices: a recorded voice is kept. Otherwise a character is cast from the library when a QC-passed voice fits (same
  // gender, within twelve years, the timbre the bible asks for); only a character no library voice fits gets a voice
  // designed for them alone.
  const library = loadVoiceLibrary()
  const available = library.voices.filter((v) => existsSync(join(voicesDir(), `${v.id}.wav`)))
  const unmatched: Character[] = []
  // Voices the brand kit designed for its characters come first: the brand's character sounds the same in every film.
  const kitVoices = ctx.brand ? brandVoices(ctx.brand) : new Map<string, { wav: string; text: string }>()
  for (const character of bible.characters) {
    const member = ctx.cast.get(character.id)
    const kitVoice = kitVoices.get(character.id)
    if (kitVoice && existsSync(kitVoice.wav)) {
      ctx.voices.set(character.id, kitVoice)
      ctx.log(`▸ voice ${character.id.padEnd(10)} designed voice (${ctx.brand!.id} brand kit)`)
      await ctx.record('casting', 'voice', undefined, { character: character.id, brandKit: ctx.brand!.id })
      continue
    }
    const recorded = member ? recordedVoice(member, available) : undefined
    if (recorded) {
      ctx.voices.set(character.id, recorded.voice)
      ctx.log(`▸ voice ${character.id.padEnd(10)} ${recorded.from} (cast record)`)
      continue
    }
    const match = castFromLibrary(character, available)
    if (match) {
      ctx.voices.set(character.id, voiceReference(match.id))
      if (member) { member.record.voice = { description: character.voice, library: match.id }; await saveCharacterRecord(member) }
      await ctx.record('casting', 'voice', undefined, { character: character.id, library: match.id })
      ctx.log(`▸ voice ${character.id.padEnd(10)} ${match.id} (casting library)`)
    } else unmatched.push(character)
  }
  if (unmatched.length) {
    const reference = "I didn't think you'd come back tonight. But here you are, and honestly, I'm glad."
    const outDir = join(audioWork(), 'cast', ctx.projectId!)
    const takes = await designVoices(unmatched.map((c) => ({ id: c.id, design: `${c.voice}. A ${c.age}-year-old ${c.gender === 'female' ? 'woman' : 'man'}, natural American English, speaking like a real actor in a television drama, not an announcer.`, text: reference, language: 'English' as const, outDir })), 4)
    const scores = await scoreSpeech(takes.map((t) => ({ path: t.path, text: t.text })))
    for (const character of unmatched) {
      const mine = takes.map((t, i) => ({ ...t, cer: scores[i]?.cer ?? 1 })).filter((t) => t.id === character.id).sort((a, b) => a.cer - b.cer)
      const member = ctx.cast.get(character.id)
      // A designed voice lives with the cast record, so a later run speaks with the same voice.
      const wav = member ? join(member.dir, 'voice.wav') : join(outDir, `${character.id}.wav`)
      await copyFile(mine[0]!.path, wav)
      ctx.voices.set(character.id, { wav, text: reference })
      if (member) { member.record.voice = { description: character.voice, wav: 'voice.wav', text: reference }; await saveCharacterRecord(member) }
      await ctx.record('casting', 'voice', undefined, { character: character.id, designed: true, takes: mine.map((t) => ({ cer: t.cer, seconds: t.seconds })) })
      ctx.log(`▸ voice ${character.id.padEnd(10)} designed for this character (error ${(mine[0]!.cer * 100).toFixed(0)}%)`)
    }
  }
  return `${bible.characters.length} characters · ${pictures.cast.length} cast · ${pictures.reused.length} reused`
}

/**
 * First frames: edited with Qwen-Image-Edit-2511 from the reference views the shot needs (close-up the master, wide the
 * full-length, profile the profile; at most three across everyone in frame), and judged for identity against the masters.
 */
export async function narrativeFramesStage(ctx: NarrativeContext): Promise<string> {
  const comfy = (ctx.comfy ??= new ComfyClient())
  await ctx.rest('frames (Qwen-Image-Edit-2511)', [ctx.planner])
  await enterPhase(comfy, 'frames (Qwen-Image-Edit-2511)', ctx.record)
  let made = 0
  for (const episode of produced(ctx)) {
    for (const shot of ctx.shots.get(episode) ?? []) {
      await shotFrame(ctx, episode, shot)
      made++
    }
  }
  return `${made} frames · ${ctx.qaRegenerations} repairs`
}

/**
 * One shot's first frame and its identity gate loop, kept as the shot's asset. The frames stage runs it for every shot; a
 * revision runs it for the shot the client asked to redo, with `tag` in the file names (ep01_shot_003.rev1.png) so the
 * frames it replaces stay on disk.
 */
export async function shotFrame(ctx: NarrativeContext, episode: number, shot: NarrativeShot, options: { tag?: string } = {}): Promise<{ path: string; verdict: QaVerdict }> {
  const bible = ctx.bible!
  const comfy = (ctx.comfy ??= new ComfyClient())
  const size = videoSize(generationResolution(ctx.options.resolution ?? '1080p'), ctx.ratio).join('x')
  const play = ctx.plays.find((p) => p.episode === episode)!
  const scene = play.scenes.find((s) => s.scene === shot.scene)!
  const references = selectReferences(shot, ctx.cast)
  const inFrame = castOf(ctx, [...new Set(references.map((r) => r.id))])
  const cast = inFrame.map((character) => ({ character, sheet: ctx.sheets.get(character.id)! }))
  const tag = options.tag ?? ''
  // A shot that shows the brand's product takes the kit's photo of it as a reference, if a slot is free.
  const product = ctx.brand ? productReference(shot, ctx.brand, ctx.brand.product, references.length) : undefined
  const referencePaths = [...references.map((r) => r.path), ...(product ? [product.path] : [])]
  let prompt = `${shot.image_prompt}. ${scene.heading.replace(/^(INT|EXT)\.\s*/, '')}. ${bible.look}. ${referencePrompt(references, inFrame)}${product ? ` ${product.prompt}` : ''} ${REALISM}`
  let best: { path: string; verdict: QaVerdict } | undefined
  const tries = Math.max(1, ctx.options.candidates ?? 2) + 1
  for (let attempt = 0; attempt < tries && !best?.verdict.pass; attempt++) {
    const suffix = `${tag}${attempt ? `_r${attempt}` : ''}`
    const path = join(ctx.dir!, 'frames', `${shotName(episode, shot.shot)}${suffix}.png`)
    const image = await generateImage(comfy, { prompt, size, output: path, references: referencePaths, model: NARRATIVE_IMAGE_MODEL, editModel: NARRATIVE_EDIT_MODEL })
    const verdict = await shotGate(ctx.reviewer, path, shot, cast)
    ctx.log(`▸ frame ${episode}.${shot.shot}${suffix}  ${image.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
    await ctx.record('frames', 'shot-gate', ctx.reviewer, { episode, shot: shot.shot, attempt, imageSeconds: image.seconds, references: [...references.map((r) => `${r.id}:${r.view}`), ...(product ? [`product:${ctx.brand!.product.id}`] : [])], ...verdict })
    if (!best || verdict.score > best.verdict.score) best = { path, verdict }
    // The last try carries the gate's own words as fixes: a new seed alone repeats a systematic fault.
    if (!verdict.pass && attempt === tries - 2 && verdict.issues.length) { prompt = `${prompt} Avoid: ${verdict.issues.slice(0, 3).join('; ')}.`; ctx.qaRegenerations++ }
  }
  ctx.frames.set(key(episode, shot.shot), best!.path)
  await addAsset(ctx.projectId!, { id: `frame-${episode}-${shot.shot}`, kind: 'image', stage: 'frames', path: best!.path.slice(ctx.dir!.length + 1), shot: shot.shot, execution: 'local-dgx-spark', model: referencePaths.length ? 'qwen_image_edit_2511_lightning' : 'qwen_image_2512', note: `gate ${best!.verdict.score}${best!.verdict.pass ? '' : ' (kept after failed gate)'}` })
  return best!
}

/** Where a line's take lives: the audio work folder, the only place the voice containers can write. */
export const lineOutput = (ctx: Pick<NarrativeContext, 'projectId'>, episode: number, scene: number, n: number) => join(audioWork(), 'lines', ctx.projectId!, `ep${pad(episode)}_s${scene}_l${n}.wav`)
export interface LineJob { k: string; speaker: string; text: string; output: string }
/** What the designed narrator's reference clip says (audio work folder, cast/<project>/vo.wav). */
export const NARRATOR_TEXT = 'Some stories begin quietly. This one began with a single letter.'
export const narratorVoice = (ctx: Pick<NarrativeContext, 'projectId'>) => join(audioWork(), 'cast', ctx.projectId!, 'vo.wav')

/** Dialogue: every line cloned from its character's voice, checked by Whisper and retaken until it is heard right. */
export async function dialogueStage(ctx: NarrativeContext): Promise<string> {
  const lines: LineJob[] = []
  for (const play of ctx.plays) play.scenes.forEach((scene) => scene.lines.forEach((line, n) => lines.push({ k: key(play.episode, scene.scene, n), speaker: line.speaker, text: line.en, output: lineOutput(ctx, play.episode, scene.scene, n) })))
  await voiceLines(ctx, lines)
  // A line that no retake got right stays in the film only as an open item: someone listens to it before release.
  const unclear = [...ctx.lines].filter(([, l]) => l.cer > 0.08)
  for (const [k, l] of unclear) ctx.log(`  open item: line ${k} still mis-heard after retakes (error ${(l.cer * 100).toFixed(0)}%); listen before release`)
  if (unclear.length) await ctx.record('dialogue', 'voice', undefined, { openItems: unclear.map(([k, l]) => ({ line: k, errorRate: l.cer })) })
  const worst = [...ctx.lines.values()].reduce((m, l) => Math.max(m, l.cer), 0)
  return `${lines.length} lines · worst error ${(worst * 100).toFixed(0)}%`
}

/**
 * Voice lines in their speakers' voices: cloned, checked by Whisper and retaken until heard right, trimmed of the model's
 * silence and fitted to the shot (at most 12 % quicker). The dialogue stage voices every line; a revision re-voices the
 * one line the client changed, with the same voice and the same check.
 */
export async function voiceLines(ctx: NarrativeContext, lines: LineJob[]): Promise<void> {
  if (lines.some((l) => l.speaker === 'vo') && !ctx.voices.has('vo')) {
    // The off-screen narrator: the casting library's warm baritone designed in English.
    const outDir = join(audioWork(), 'cast', ctx.projectId!)
    const text = NARRATOR_TEXT
    const takes = await designVoices([{ id: 'vo', design: 'A male narrator in his forties, warm deep baritone, natural American English, intimate and unhurried, like the narrator of a prestige television drama.', text, language: 'English', outDir }])
    const scores = await scoreSpeech(takes.map((t) => ({ path: t.path, text })))
    const bestTake = takes.map((t, i) => ({ ...t, cer: scores[i]?.cer ?? 1 })).sort((a, b) => a.cer - b.cer)[0]!
    await copyFile(bestTake.path, join(outDir, 'vo.wav'))
    ctx.voices.set('vo', { wav: join(outDir, 'vo.wav'), text })
  }
  for (const speaker of new Set(lines.map((l) => l.speaker))) {
    const mine = lines.filter((l) => l.speaker === speaker)
    for (const l of mine) await mkdir(join(l.output, '..'), { recursive: true })
    const voice = ctx.voices.get(speaker)
    if (!voice) throw new Error(`no voice is cast for ${speaker}`)
    const cer = await speakChecked(voice, mine.map((l) => ({ text: l.text, output: l.output })), 'English')
    for (const [i, l] of mine.entries()) {
      // Silence the model leaves around a line is trimmed: the shot's timing is for speech.
      const trimmed = l.output.replace(/\.wav$/, '.trim.wav')
      await exec('ffmpeg', ['-y', '-v', 'error', '-i', l.output, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', trimmed])
      let seconds = await probeDuration(trimmed)
      const room = 5 - LINE_OFFSET - 0.2
      if (seconds > room) {
        // Slightly quicker rather than cut: at most 12 % faster, which still sounds like the actor.
        const tempo = Math.min(1.12, seconds / room)
        await exec('ffmpeg', ['-y', '-v', 'error', '-i', trimmed, '-af', `atempo=${tempo.toFixed(3)}`, `${trimmed}.fit.wav`])
        await copyFile(`${trimmed}.fit.wav`, trimmed)
        seconds = await probeDuration(trimmed)
      }
      ctx.lines.set(l.k, { wav: trimmed, seconds, cer: cer[i]! })
      await ctx.record('dialogue', 'voice', undefined, { line: l.k, speaker, seconds, errorRate: cer[i] })
    }
  }
}

const videoModelOf = (ctx: NarrativeContext) => ctx.options.videoModel ?? 'ltx25-fast-nvfp4'

/** Clips: dialogue shots are generated against their line so the mouth follows it; the rest animate from the frame. */
export async function narrativeClipsStage(ctx: NarrativeContext): Promise<string> {
  const comfy = ctx.comfy!
  const fps = ctx.options.fps ?? 24
  await ctx.rest('clips (LTX-2.5)', [ctx.planner, ctx.reviewer])
  await enterPhase(comfy, 'clips (LTX-2.5)', ctx.record)
  let count = 0
  for (const episode of produced(ctx)) {
    for (const shot of ctx.shots.get(episode) ?? []) {
      await shotClip(ctx, episode, shot)
      count++
    }
  }
  if (fps > 24) {
    await enterPhase(comfy, 'interpolate (RIFE)', ctx.record)
    for (const k of [...ctx.clips.keys()]) await interpolateClip(ctx, k)
  }
  await comfy.free()
  return `${count} clips`
}

/** One shot's clip from its first frame; a dialogue shot is generated against its spoken line so the mouth follows it. */
export async function shotClip(ctx: NarrativeContext, episode: number, shot: NarrativeShot): Promise<{ path: string; lipsync: boolean }> {
  const play = ctx.plays.find((p) => p.episode === episode)!
  const scene = play.scenes.find((s) => s.scene === shot.scene)!
  const line = shot.line !== undefined ? scene.lines[shot.line] : undefined
  const spoken = line && line.speaker !== 'vo' ? ctx.lines.get(key(episode, shot.scene, shot.line!)) : undefined
  const speaker = spoken ? castOf(ctx, [line!.speaker])[0] : undefined
  const prompt = `${shot.video_prompt} ${shot.camera}.${speaker ? ` ${speaker.name.split('/')[0]!.trim()} says: "${line!.en}"${line!.delivery ? ` (${line!.delivery})` : ''}, with natural lip and jaw movement, small head motion and natural blinking.` : ''} Photorealistic, natural motion, film grain.`
  const output = join(ctx.dir!, 'clips', `${shotName(episode, shot.shot)}.mp4`)
  const clip = await generateVideo((ctx.comfy ??= new ComfyClient()), { prompt, negative: `${VIDEO_NEGATIVE}, mouth not moving, lips out of sync, frozen face, extra person`, output, resolution: generationResolution(ctx.options.resolution ?? '1080p'), ratio: ctx.ratio, durationSeconds: 5, firstFrame: ctx.frames.get(key(episode, shot.shot)), freeAfter: false, model: videoModelOf(ctx), dialogue: spoken ? { audio: spoken.wav, offsetSeconds: LINE_OFFSET } : undefined })
  ctx.log(`▸ clip ${episode}.${shot.shot}${spoken ? ' (lip-sync)' : ''}  ${clip.seconds.toFixed(1)}s`)
  await ctx.record('clips', 'video', undefined, { episode, shot: shot.shot, seconds: clip.seconds, lipsync: !!spoken })
  ctx.clips.set(key(episode, shot.shot), output)
  return { path: output, lipsync: !!spoken }
}

/** A clip (by "episode:shot") to its RIFE high-frame-rate master, which the cut then uses. */
export async function interpolateClip(ctx: NarrativeContext, k: string): Promise<string> {
  const path = ctx.clips.get(k)!.replace(/\.hfr\.mp4$/, '.mp4')
  const sourceFps = videoFps(videoModelOf(ctx))
  const hfr = await interpolateVideo((ctx.comfy ??= new ComfyClient()), { input: path, output: path.replace(/\.mp4$/, '.hfr.mp4'), multiplier: interpolationMultiplier(sourceFps), sourceFps })
  ctx.clips.set(k, path.replace(/\.mp4$/, '.hfr.mp4'))
  await ctx.record('clips', 'interpolate', undefined, { clip: k, seconds: hfr.seconds, fps: hfr.fps, model: 'rife-4.26' })
  return ctx.clips.get(k)!
}

/** Sound: the sound designer writes ambience per scene and effects per shot; MOSS-SoundEffect and ACE-Step make them. */
export async function soundStage(ctx: NarrativeContext): Promise<string> {
  const bible = ctx.bible!
  let made = 0
  for (const episode of produced(ctx)) {
    const play = ctx.plays.find((p) => p.episode === episode)!
    const shots = ctx.shots.get(episode) ?? []
    const plan = await chatJson<{ ambience: Array<{ scene: number; prompt: string }>; effects: Array<{ shot: number; prompt: string }>; music: string }>(
      ctx.planner,
      {
        system: await ctx.agentPrompt('sound designer and composer', 'sound-design-and-music'),
        thinking: false, maxTokens: 2500, temperature: 0.5,
        user: `Series: ${bible.genre}; look ${bible.look}.
Scenes: ${play.scenes.map((s) => `${s.scene}. ${s.heading}: ${s.action}`).join(' | ')}
Shots: ${shots.map((s) => `${s.shot} (scene ${s.scene}): ${s.video_prompt}`).join(' | ')}
Write one ambience bed per scene and a sync effect only for shots where something audible happens (a door, a cup set down, rain on glass) - at most half the shots. English, concrete, no music and no speech in effect prompts. Then the score direction for the episode (genre, instrumentation, tempo, how it ends on the cliffhanger; no artist names).
Return JSON only: {"ambience": [{"scene": 1, "prompt": "..."}], "effects": [{"shot": 2, "prompt": "..."}], "music": "..."}`,
      },
      (v) => (Array.isArray(v.ambience) && Array.isArray(v.effects) && typeof v.music === 'string' && v.music.trim() ? [] : ['need "ambience", "effects" arrays and a "music" direction']),
      3,
    )
    const base = soundDir(ctx, episode)
    const sceneSpan = (scene: number) => shots.filter((s) => s.scene === scene).length * 5
    const ambience = plan.value.ambience.filter((a) => sceneSpan(a.scene) > 0).map((a) => ({ scene: a.scene, prompt: a.prompt, seconds: Math.min(30, sceneSpan(a.scene)), output: join(base, `amb_s${a.scene}.wav`) }))
    const effects = plan.value.effects.filter((e) => shots.some((s) => s.shot === e.shot)).slice(0, Math.ceil(shots.length / 2)).map((e) => ({ shot: e.shot, prompt: e.prompt, seconds: 5, output: join(base, `fx_${e.shot}.wav`) }))
    await generateSfx([...ambience, ...effects].map((j, i) => ({ prompt: j.prompt, seconds: j.seconds, output: j.output, seed: i + 1 })))
    ctx.sound.set(episode, { ambience: new Map(ambience.map((a) => [a.scene, a.output])), sfx: new Map(effects.map((e) => [e.shot, e.output])) })
    await scoreEpisode(ctx, episode, plan.value.music)
    made += ambience.length + effects.length + 1
    await ctx.record('sound', 'sound-designer', ctx.planner, { episode, ambience: ambience.length, effects: effects.length, music: plan.value.music })
  }
  await ctx.comfy?.free()
  return `${made} sound files`
}

/** Where an episode's ambience and effects live (the audio work folder the effects container writes to). */
export const soundDir = (ctx: Pick<NarrativeContext, 'projectId'>, episode: number) => join(audioWork(), 'sound', ctx.projectId!, `ep${pad(episode)}`)
export const scorePath = (ctx: Pick<NarrativeContext, 'dir'>, episode: number) => join(ctx.dir!, 'audio', `ep${pad(episode)}_score.wav`)

/** The episode's score from a direction (ACE-Step, local): the sound stage writes it, a music revision writes it again. */
export async function scoreEpisode(ctx: NarrativeContext, episode: number, direction: string): Promise<string> {
  const shots = ctx.shots.get(episode) ?? []
  const music = scorePath(ctx, episode)
  const started = Date.now()
  await generateMusic((ctx.comfy ??= new ComfyClient()), { tags: `instrumental, ${direction}, cinematic television score, clean modern production, no vocals`, seconds: shots.length * 5, output: music })
  const sound: { ambience: Map<number, string>; sfx: Map<number, string>; music?: string } = ctx.sound.get(episode) ?? { ambience: new Map(), sfx: new Map() }
  sound.music = music
  ctx.sound.set(episode, sound)
  await ctx.record('sound', 'music', undefined, { episode, seconds: (Date.now() - started) / 1000, model: 'ace_step_v1_3.5b', direction })
  return music
}

/** Cut: hard cuts at 5 s, the four-bus mix, bilingual subtitles timed to the spoken lines, grade, AI labels, loudness. */
export async function narrativeCutStage(ctx: NarrativeContext): Promise<string> {
  for (const episode of produced(ctx)) await cutEpisode(ctx, episode)
  // A drama has no packaging stage: its brand's handles and hashtags are written for publishing all the same.
  if (ctx.brand && ctx.format !== 'short') await writeFile(join(ctx.dir!, 'reports', 'packaging.json'), JSON.stringify({ brand: ctx.brand.id, ...brandPackaging(ctx.brand.kit), disclosure: AI_LABEL }, null, 2))
  const qc = await qcEpisodes(ctx, [...ctx.outputs.keys()])
  return `${ctx.outputs.size} episode(s) · qc ${qc}`
}

/**
 * One finished episode: hard cuts at 5 s, the four-bus mix, bilingual subtitles timed to the spoken lines, the grade (with
 * the project's adjustment, cut/finishing.json), AI labels and loudness; and its timeline (cut/epNN.timeline.json).
 */
export async function cutEpisode(ctx: NarrativeContext, episode: number, options: { grade?: string } = {}): Promise<string> {
  const fps = ctx.options.fps ?? 24
  const dir = ctx.dir!
  const [width, height] = deliverySize(ctx.options.resolution ?? '1080p', ctx.ratio)
  const play = ctx.plays.find((p) => p.episode === episode)!
  const shots = ctx.shots.get(episode) ?? []
  const total = shots.length * 5
  const start = (shot: NarrativeShot) => (shot.shot - 1) * 5
  // Under a brand kit: its fonts and grade, and over the last three seconds its logo with clear space and its legal lines.
  const brand = ctx.brand ? await brandFinish(ctx.brand) : undefined
  const layout = brand ? endCardLayout(width, height, brand.legal.length, brand.logo) : undefined
  const cues: TitleCue[] = [{ start: 0, end: 3, label: AI_LABEL }, { start: total - 3, end: total, label: AI_LABEL }]
  for (const [index, line] of (brand?.legal ?? []).entries()) cues.push({ start: total - 3, end: total, legal: line, marginV: layout!.legalMarginV + (brand!.legal.length - 1 - index) * Math.round(layout!.legalSize * 1.3) })
  const dialogue: Array<{ path: string; start: number; seconds: number; line: string }> = []
  for (const shot of shots) {
    if (shot.line === undefined) continue
    const line = play.scenes.find((s) => s.scene === shot.scene)!.lines[shot.line]!
    const k = key(episode, shot.scene, shot.line)
    const spoken = ctx.lines.get(k)
    if (!spoken) continue
    const at = start(shot) + LINE_OFFSET
    dialogue.push({ path: spoken.wav, start: at, seconds: spoken.seconds, line: k })
    // On screen at least 5/6 s, at most 7 s, and never past the shot it belongs to.
    cues.push({ start: start(shot), end: start(shot) + 5, subtitle: line.zh, subtitleEn: line.en, subtitleStart: at, subtitleEnd: Math.min(start(shot) + 5, at + Math.max(5 / 6, Math.min(7, spoken.seconds + 0.3))) })
  }
  const sound = ctx.sound.get(episode)
  const ambience = [...(sound?.ambience ?? new Map<number, string>())].map(([scene, path]) => {
    const inScene = shots.filter((s) => s.scene === scene)
    return { path, start: start(inScene[0]!), seconds: inScene.length * 5 }
  })
  const effects = await Promise.all([...(sound?.sfx ?? new Map<number, string>())].map(async ([shot, path]) => ({ path, start: start(shots.find((s) => s.shot === shot)!), seconds: Math.min(5, await probeDuration(path)) })))
  const soundtrack = join(dir, 'audio', `ep${pad(episode)}_mix.wav`)
  await mixNarrative({ totalSeconds: total, dialogue, ambience, effects, music: sound?.music, output: soundtrack })
  const ass = join(dir, 'cut', `ep${pad(episode)}.ass`)
  // A brand's own font must hold every character it sets, or the film shows boxes.
  if (brand) {
    const covered = await fontCovers(brand.subtitleFont, cues.map((cue) => `${cue.subtitle ?? ''}${cue.legal ?? ''}${cue.label ?? ''}`).join(''))
    if (!covered.ok) throw new Error(`The font ${brand.subtitleFont} has no glyph for: ${covered.missing.join(' ')}. Refusing to render boxes on screen.`)
  }
  await writeFile(ass, buildAss(cues, width, height, brand?.titleFont ?? TITLE_FONT, brand?.subtitleFont ?? TITLE_FONT))
  const output = join(dir, 'cut', `ep${pad(episode)}.mp4`)
  const aigc = JSON.stringify({ Label: '1', ContentProducer: 'Cinefoundry', ProduceID: `${ctx.projectId}-ep${pad(episode)}`, ReservedCode1: '', ContentPropagator: '', PropagateID: '', ReservedCode2: '' })
  const clips = shots.map((s) => ctx.clips.get(key(episode, s.shot))!)
  await assembleFilm(clips, output, {
    width, height, fps, durations: shots.map(() => 5), crossfadeSeconds: 0, ass, audio: soundtrack, grade: gradeWith(brand?.grade ?? GRADES.drama ?? GRADES.neutral!, options.grade), loudness: -14,
    ...(layout?.logo ? { logo: { image: brand!.logo!.path, ...layout.logo, start: total - 3 } } : {}),
    metadata: { AIGC: aigc, comment: `${AI_LABEL} · Cinefoundry · ${ctx.projectId} ep${episode}`, title: `${play.title}` },
  })
  ctx.outputs.set(episode, output)
  await addAsset(ctx.projectId!, { id: `episode-${episode}`, kind: 'video', stage: 'cut', path: `cut/ep${pad(episode)}.mp4`, execution: 'local-dgx-spark', model: 'ffmpeg' })
  await writeTimeline(dir, {
    version: 1, label: `ep${pad(episode)}`, format: ctx.format, projectId: ctx.projectId!, title: play.title, fps, width, height, seconds: total,
    file: stored(dir, output), ass: stored(dir, ass), mix: { file: stored(dir, soundtrack), kind: 'four-bus' },
    picture: pictureTrack(shots.map((s, index) => ({ kind: 'shot' as const, shot: s.shot, episode, scene: s.scene, source: stored(dir, clips[index]!) })), shots.map(() => 5), shots.map(() => 0)),
    audio: {
      dialogue: dialogue.map((d) => ({ source: stored(dir, d.path), start: d.start, in: 0, duration: d.seconds, line: d.line })),
      music: sound?.music ? [{ source: stored(dir, sound.music), start: 0, in: 0, duration: total }] : [],
      effects: effects.map((e) => ({ source: stored(dir, e.path), start: e.start, in: 0, duration: e.seconds })),
      ambience: ambience.map((a) => ({ source: stored(dir, a.path), start: a.start, in: 0, duration: a.seconds, loop: true })),
    },
    subtitles: cues.filter((cue) => cue.subtitle?.trim()).map((cue) => ({ start: cue.subtitleStart ?? cue.start, end: cue.subtitleEnd ?? cue.end, zh: cue.subtitle, en: cue.subtitleEn })),
    markers: shots.map((s) => ({ at: start(s), name: `Shot ${s.shot} · scene ${s.scene}`, kind: 'shot' as const })),
    ...(options.grade ? { grade: options.grade } : {}),
  })
  ctx.log(`▸ cut          episode ${episode}: ${output}`)
  return output
}

/** The QC spec of a finished episode: delivery size and rate, five seconds a shot, a line window per spoken line. */
export function episodeQcSpec(ctx: NarrativeContext, episode: number): QcSpec {
  const [width, height] = deliverySize(ctx.options.resolution ?? '1080p', ctx.ratio)
  const shots = ctx.shots.get(episode) ?? []
  const speech = shots.flatMap((shot) => {
    const spoken = shot.line === undefined ? undefined : ctx.lines.get(key(episode, shot.scene, shot.line))
    if (!spoken) return []
    const at = (shot.shot - 1) * 5 + LINE_OFFSET
    return [{ start: at, end: at + spoken.seconds }]
  })
  return {
    label: `ep${pad(episode)}`, file: ctx.outputs.get(episode)!, width, height, fps: ctx.options.fps ?? 24, seconds: shots.length * 5,
    loudness: loudnessFor(ctx.format === 'drama' ? 'drama' : 'short'), speech, ass: join(ctx.dir!, 'cut', `ep${pad(episode)}.ass`), produceId: `${ctx.projectId}-ep${pad(episode)}`,
  }
}

/**
 * Delivery QC on the given episodes: reports/qc.json (merged with the episodes measured before, so a revision of one
 * episode keeps the others' reports), open items in the log and the run record.
 */
export async function qcEpisodes(ctx: NarrativeContext, episodes: number[], stage = 'cut'): Promise<QcVerdict> {
  const reports: QcReport[] = []
  for (const episode of episodes) reports.push(await runQc(episodeQcSpec(ctx, episode)))
  const all = await mergeQcReport(ctx.dir!, reports)
  const open = qcOpenItems(all)
  for (const item of qcOpenItems(reports)) ctx.log(`  open item: qc ${item}`)
  const summary = qcSummary(all)
  await ctx.record(stage, 'delivery-qc', undefined, { verdict: summary.verdict, files: summary.files, openItems: open, measured: reports.map((r) => r.label) })
  return qcSummary(reports).verdict
}

/**
 * The library voice that fits a character: English, cast for characters, the same gender, within twelve years of the
 * character's age, and sharing the most timbre words with the bible's description of how they sound. None fits -> undefined.
 */
export function castFromLibrary(character: Character, voices: LibraryVoice[]): LibraryVoice | undefined {
  const wanted = new Set(character.voice.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3))
  const scored = voices
    .filter((v) => v.language === 'English' && v.uses.includes('character') && v.gender === character.gender && Math.abs(v.age - character.age) <= 12)
    .map((v) => ({ v, score: `${v.timbre} ${v.design}`.toLowerCase().split(/[^a-z]+/).filter((w) => wanted.has(w)).length * 3 - Math.abs(v.age - character.age) / 4 }))
    .sort((a, b) => b.score - a.score)
  return scored[0]?.v
}

/**
 * The voice a cast record keeps: a casting-library voice whose reference clip passed QC on this machine, or the voice
 * designed for this character in its cast folder. The casting stage and a revision both read it, so a re-voiced line is
 * spoken by the same voice as the rest of the series.
 */
export function recordedVoice(member: CastMember, available: LibraryVoice[]): { voice: { wav: string; text: string }; from: string } | undefined {
  const recorded = member.record.voice
  if (recorded?.library && available.some((v) => v.id === recorded.library)) return { voice: voiceReference(recorded.library), from: recorded.library }
  if (recorded?.wav && recorded.text && existsSync(join(member.dir, recorded.wav))) return { voice: { wav: join(member.dir, recorded.wav), text: recorded.text }, from: 'designed voice' }
  return undefined
}
