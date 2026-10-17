import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ComfyClient } from '../../comfy/client.js'
import { enterPhase } from '../../agent/finish.js'
import { EN_ABSOLUTES } from '../../agent/checks.js'
import { chatJson } from '../../agent/llm.js'
import { exec } from '../../lib/exec.js'
import { probeDuration } from '../../lib/ffmpeg.js'
import { scanCopy } from '../../lib/compliance.js'
import { wakeAll } from '../../lib/rest.js'
import type { ProjectState } from '../../lib/project.js'
import { loadVoiceLibrary, voicesDir } from '../../lib/voices.js'
import { RevisionRefused, type RevisionDef, type RevisionRequest, type RevisionTools } from '../../engine/revise.js'
import type { EngineContext } from '../../engine/pipeline.js'
import { checkGrade, finishingPath, loadFinishing, saveFinishing } from '../finishing.js'
import { reviseShotPrompt, translateSubtitle } from '../revisions.js'
import { applyRecord, loadCastMember } from './casting.js'
import { checkScreenplay, maxZhChars } from './checks.js'
import { key, type NarrativeContext, type NarrativeOptions } from './context.js'
import { writeNarrativeDeliveryReport } from './delivery.js'
import { narrativeContext } from './pipeline.js'
import { cutEpisode, interpolateClip, lineOutput, narratorVoice, NARRATOR_TEXT, qcEpisodes, recordedVoice, scoreEpisode, scorePath, shotClip, shotFrame, soundDir, voiceLines } from './production.js'
import type { NarrativeShot, Screenplay, SeriesBible } from './types.js'
import { ALLOWED, checkReviewEvidence, type ContentReview } from './writing.js'

/**
 * Revisions of a finished short or micro-drama episode, on the narrative stage functions:
 * - a shot: its first frame again (new seed, or the client's note applied to the frame prompt), the identity gate, its
 *   clip (lip-synced to its line when it is a dialogue shot) and interpolation, then the episode;
 * - a line: the new line through the content checks and an independent reviewer (refused if it does not pass),
 *   re-voiced in the character's cast voice with the Whisper check, the lip-sync clip of its shot regenerated, then the
 *   episode;
 * - the grade or the score: finishing only, for the episode asked for or every cut episode.
 * Then delivery QC on the re-cut episodes, merged into reports/qc.json, and the delivery report with its revision history.
 */

type NarrativeRevisionContext = NarrativeContext & RevisionTools & { pending?: { play: Screenplay; lineKey: string; shot?: NarrativeShot } }

const pad = (n: number) => String(n).padStart(2, '0')
const shotName = (episode: number, shot: number) => `ep${pad(episode)}_shot_${String(shot).padStart(3, '0')}`
const readJson = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T

/** The series' recorded state - bible, screenplays, shots, cast and voices, frames, clips, lines, sound - as the context. */
export async function loadNarrativeContext(engine: EngineContext & RevisionTools, state: ProjectState): Promise<NarrativeRevisionContext> {
  const dir = engine.dir!
  const format = state.format ?? 'drama'
  if (!existsSync(join(dir, 'story', 'bible.json'))) throw new RevisionRefused(`${state.id} has no series bible (story/bible.json)`)
  const recorded = (state.options ?? {}) as Partial<NarrativeOptions>
  const options: NarrativeOptions = { fps: format === 'drama' ? 24 : 30, ...recorded, brief: state.brief }
  const ctx = narrativeContext(options, engine, {
    writer: format === 'drama' ? { role: 'showrunner and head writer', skill: 'series-development' } : { role: 'creator-content writer', skill: 'short-video-scripting' },
    seconds: state.durationSeconds, ratio: (state.ratio as NarrativeContext['ratio']) ?? '9:16',
  }) as NarrativeRevisionContext
  const bible = await readJson<SeriesBible>(join(dir, 'story', 'bible.json'))
  ctx.bible = bible
  for (const plan of bible.episodes) {
    const file = join(dir, 'story', `ep${pad(plan.episode)}.screenplay.json`)
    const shots = join(dir, 'storyboard', `ep${pad(plan.episode)}.shots.json`)
    if (!existsSync(file) || !existsSync(shots)) continue
    ctx.plays.push(await readJson<Screenplay>(file))
    ctx.shots.set(plan.episode, await readJson<NarrativeShot[]>(shots))
  }
  // The cast as recorded: the locked faces and the voices the series speaks with.
  const library = (() => { try { return loadVoiceLibrary() } catch { return { voices: [] } } })()
  ctx.comfy = new ComfyClient()
  const available = library.voices.filter((v) => existsSync(join(voicesDir(), `${v.id}.wav`)))
  for (const [index, character] of bible.characters.entries()) {
    const member = await loadCastMember(join(dir, 'cast', character.id), character)
    if (!('record' in member)) continue
    bible.characters[index] = applyRecord(character, member.record)
    ctx.cast.set(character.id, member)
    ctx.sheets.set(character.id, member.views.master)
    const voice = recordedVoice(member, available)
    if (voice) ctx.voices.set(character.id, voice.voice)
  }
  if (existsSync(narratorVoice(ctx))) ctx.voices.set('vo', { wav: narratorVoice(ctx), text: NARRATOR_TEXT })
  for (const asset of state.assets) {
    const match = /^frame-(\d+)-(\d+)$/.exec(asset.id)
    if (match && existsSync(join(dir, asset.path))) ctx.frames.set(key(Number(match[1]), Number(match[2])), join(dir, asset.path))
  }
  const runRows = existsSync(join(dir, 'reports', 'run.jsonl')) ? (await readFile(join(dir, 'reports', 'run.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>) : []
  const errorRate = (k: string) => [...runRows].reverse().find((row) => row.stage === 'dialogue' && row.line === k && typeof row.errorRate === 'number')?.errorRate as number | undefined
  const fps = options.fps ?? 24
  for (const play of ctx.plays) {
    const episode = play.episode
    for (const shot of ctx.shots.get(episode) ?? []) {
      const base = join(dir, 'clips', shotName(episode, shot.shot))
      if (fps > 24 && existsSync(`${base}.hfr.mp4`)) ctx.clips.set(key(episode, shot.shot), `${base}.hfr.mp4`)
      else if (existsSync(`${base}.mp4`)) ctx.clips.set(key(episode, shot.shot), `${base}.mp4`)
    }
    for (const scene of play.scenes) {
      for (const [n] of scene.lines.entries()) {
        const wav = lineOutput(ctx, episode, scene.scene, n).replace(/\.wav$/, '.trim.wav')
        if (existsSync(wav)) ctx.lines.set(key(episode, scene.scene, n), { wav, seconds: await probeDuration(wav), cer: errorRate(key(episode, scene.scene, n)) ?? 0 })
      }
    }
    const sounds = soundDir(ctx, episode)
    const ambience = new Map(play.scenes.map((s) => [s.scene, join(sounds, `amb_s${s.scene}.wav`)] as const).filter(([, path]) => existsSync(path)))
    const sfx = new Map((ctx.shots.get(episode) ?? []).map((s) => [s.shot, join(sounds, `fx_${s.shot}.wav`)] as const).filter(([, path]) => existsSync(path)))
    ctx.sound.set(episode, { ambience, sfx, ...(existsSync(scorePath(ctx, episode)) ? { music: scorePath(ctx, episode) } : {}) })
    if (existsSync(join(dir, 'cut', `ep${pad(episode)}.mp4`))) ctx.outputs.set(episode, join(dir, 'cut', `ep${pad(episode)}.mp4`))
  }
  return ctx
}

const episodeOf = (ctx: NarrativeRevisionContext, request: RevisionRequest) => {
  const episode = request.episode ?? 1
  if (!ctx.outputs.has(episode)) throw new RevisionRefused(`episode ${episode} has not been cut${ctx.outputs.size ? `; cut episodes: ${[...ctx.outputs.keys()].join(', ')}` : ''}`)
  return episode
}

/** "3.1" -> scene 3, line index 0 (lines are numbered from 1, as the compliance reviewer numbers them). */
function lineOf(ctx: NarrativeRevisionContext, episode: number, line: string | undefined): { scene: number; index: number } {
  const match = /^(\d+)\.(\d+)$/.exec(line ?? '')
  if (!match) throw new RevisionRefused(`--line ${line ?? ''}: a narrative line is scene.line, both from 1 ("3.1" is the first line of scene 3)`)
  const play = ctx.plays.find((p) => p.episode === episode)!
  const scene = play.scenes.find((s) => s.scene === Number(match[1]))
  if (!scene) throw new RevisionRefused(`--line ${line}: episode ${episode} has scenes ${play.scenes.map((s) => s.scene).join(', ')}`)
  const index = Number(match[2]) - 1
  if (!scene.lines[index]) throw new RevisionRefused(`--line ${line}: scene ${scene.scene} has ${scene.lines.length} line(s)`)
  return { scene: scene.scene, index }
}

/**
 * The changed line through the content checks: the screenplay validators (what this change introduces), the restricted
 * wording scan and absolute claims, then an independent reviewer who did not write it. Anything short of a pass
 * refuses the revision with the reason.
 */
async function clearLine(ctx: NarrativeRevisionContext, episode: number, where: { scene: number; index: number }, en: string, zh: string): Promise<Screenplay> {
  const bible = ctx.bible!
  const play = ctx.plays.find((p) => p.episode === episode)!
  const next: Screenplay = { ...play, scenes: play.scenes.map((s) => (s.scene === where.scene ? { ...s, lines: s.lines.map((l, n) => (n === where.index ? { ...l, en, zh } : l)) } : s)) }
  const label = `scene ${where.scene} line ${where.index + 1}`
  const before = new Set(checkScreenplay(play, bible, { seconds: ctx.episodeSeconds, ratio: ctx.ratio }))
  const introduced = checkScreenplay(next, bible, { seconds: ctx.episodeSeconds, ratio: ctx.ratio }).filter((p) => !before.has(p))
  if (introduced.length) throw new RevisionRefused(`${label} does not pass the screenplay checks: ${introduced.join('; ')}`)
  const scan = scanCopy(zh, 'general').filter((f) => f.severity === 'block').map((f) => `restricted wording "${f.text}" (${f.rule})`)
  const absolute = EN_ABSOLUTES.exec(en)?.[0]
  if (absolute) scan.push(`absolute claim "${absolute}"`)
  if (scan.length) throw new RevisionRefused(`${label} does not pass compliance: ${scan.join('; ')}`)
  ctx.log(`▸ compliance   episode ${episode} ${label} · independent reviewer · ${ctx.editor.name}`)
  const source = `${bible.logline}\n${next.scenes.map((s) => `${s.heading} ${s.action}`).join('\n')}\n${next.scenes.flatMap((s) => s.lines.map((l) => `${l.en}\n${l.zh}`)).join('\n')}`
  const run = await chatJson<ContentReview>(
    ctx.editor,
    {
      system: await ctx.agentPrompt('compliance reviewer. You did not write this screenplay', 'content-compliance'), thinking: false, maxTokens: 2000, temperature: 0.2,
      user: `Series logline: ${bible.logline} (${bible.genre}). Characters: ${bible.characters.map((c) => `${c.id}, ${c.age}, ${c.role}`).join('; ')}.
Episode ${episode} has been cleared. The client changed one line, ${label}; judge that line in its scene:
${next.scenes.filter((s) => s.scene === where.scene).map((s) => `Scene ${s.scene} ${s.heading}: ${s.action}\n${s.lines.map((l, n) => `  ${s.scene}.${n + 1} ${l.speaker}: ${l.en} / ${l.zh}${n === where.index ? '   <- changed' : ''}`).join('\n')}`).join('\n')}
${ALLOWED}
Judge only what is written above. Every issue quotes the exact words it is about, in quotation marks.
Return JSON only: {"approve": true|false, "issues": ["scene N line M: \\"quoted words\\" - why"]}`,
    },
    (review) => checkReviewEvidence(review, source),
    3,
  ).catch((error: Error) => { throw new Error(`the changed line could not be reviewed (${error.message.slice(0, 160)}); nothing was changed`) })
  await ctx.record('compliance', 'reviewer', ctx.editor, { episode, line: `${where.scene}.${where.index + 1}`, approve: run.value.approve, issues: run.value.issues, unresolved: run.unresolved })
  if (!run.value.approve || run.unresolved.length) throw new RevisionRefused(`the compliance reviewer did not clear ${label}: ${(run.value.issues ?? []).join(' | ').slice(0, 300) || run.unresolved.join('; ')}`)
  return next
}

export const narrativeRevision: RevisionDef<NarrativeContext> = {
  load: loadNarrativeContext,

  plan: async (ctx: NarrativeRevisionContext, request) => {
    if (request.kind === 'shot') {
      const episode = episodeOf(ctx, request)
      const shots = ctx.shots.get(episode) ?? []
      if (!shots.some((s) => s.shot === request.shot)) throw new RevisionRefused(`--shot ${request.shot}: episode ${episode} has shots 1 to ${shots.length}`)
      const cover = await coverShot(ctx)
      return { stages: ['frames', 'clips', 'cut', ...(cover === request.shot ? ['packaging'] : [])], summary: `episode ${episode} shot ${request.shot}${request.note ? ` · ${request.note}` : ' · new seed'} → ep${pad(episode)}` }
    }
    if (request.kind === 'line') {
      const episode = episodeOf(ctx, request)
      const where = lineOf(ctx, episode, request.line)
      const en = request.text?.trim()
      if (!en) throw new RevisionRefused('--text is required: the new English line')
      const zh = request.zh?.trim() || await translateSubtitle(ctx.editor, await ctx.agentPrompt('bilingual subtitle editor', ['bilingual-subtitles', 'dialogue-and-voice']), { en, maxChars: maxZhChars(ctx.ratio), context: `A line of dialogue in ${ctx.bible!.genre}.` })
      const play = await clearLine(ctx, episode, where, en, zh)
      const shot = (ctx.shots.get(episode) ?? []).find((s) => s.scene === where.scene && s.line === where.index)
      const speaker = play.scenes.find((s) => s.scene === where.scene)!.lines[where.index]!.speaker
      const lipsync = shot && speaker !== 'vo' ? shot : undefined
      ctx.pending = { play, lineKey: key(episode, where.scene, where.index), ...(lipsync ? { shot: lipsync } : {}) }
      return { stages: ['compliance', 'dialogue', ...(lipsync ? ['clips'] : []), 'cut'], summary: `episode ${episode} line ${request.line} · "${en}" / ${zh} → ep${pad(episode)}` }
    }
    const episodes = request.episode !== undefined ? [episodeOf(ctx, request)] : [...ctx.outputs.keys()]
    if (!episodes.length) throw new RevisionRefused('no episode has been cut yet')
    if (request.kind === 'grade') {
      const problems = checkGrade(request.grade ?? '')
      if (problems.length) throw new RevisionRefused(problems.join('; '))
      return { stages: ['cut'], summary: `grade ${request.grade} → ${episodes.map((e) => `ep${pad(e)}`).join(' · ')}` }
    }
    if (!request.music?.trim()) throw new RevisionRefused('--music needs a direction ("solo cello, slower, ends unresolved")')
    return { stages: ['sound', 'cut'], summary: `music "${request.music}" → ${episodes.map((e) => `ep${pad(e)}`).join(' · ')}` }
  },

  run: async (ctx: NarrativeRevisionContext, request) => {
    const dir = ctx.dir!
    const finishing = await loadFinishing(dir)
    if (request.kind === 'shot') return redoShot(ctx, request, finishing.grade)
    if (request.kind === 'line') {
      const { play, lineKey, shot } = ctx.pending!
      const episode = play.episode
      const file = join(dir, 'story', `ep${pad(episode)}.screenplay.json`)
      await ctx.keep(file)
      await writeFile(file, JSON.stringify(play, null, 2))
      ctx.plays = ctx.plays.map((p) => (p.episode === episode ? play : p))
      // The same voice, the same Whisper check; the take it replaces is kept beside it.
      const [, sceneNo, n] = lineKey.split(':').map(Number) as [number, number, number]
      const line = play.scenes.find((s) => s.scene === sceneNo)!.lines[n]!
      const output = lineOutput(ctx, episode, sceneNo, n)
      await ctx.keep(output, output.replace(/\.wav$/, '.trim.wav'))
      await voiceLines(ctx, [{ k: lineKey, speaker: line.speaker, text: line.en, output }])
      const spoken = ctx.lines.get(lineKey)!
      const notes = spoken.cer > 0.08 ? [`line ${lineKey} still mis-heard after retakes (error ${(spoken.cer * 100).toFixed(0)}%); listen before release`] : []
      if (shot) {
        // The mouth must follow the new words: the dialogue shot is generated again against them, from the same frame.
        const comfy = ctx.comfy!
        await ctx.rest('clips (LTX-2.5)', [ctx.planner, ctx.reviewer])
        await enterPhase(comfy, 'clips (LTX-2.5)', ctx.record)
        await redoClip(ctx, episode, shot)
        await comfy.free()
      }
      const waking = shot ? wakeAll([ctx.planner, ctx.reviewer]) : Promise.resolve()
      const outcome = await recutEpisodes(ctx, [episode], finishing.grade)
      await waking
      return { ...outcome, notes }
    }
    const episodes = request.episode !== undefined ? [request.episode] : [...ctx.outputs.keys()]
    if (request.kind === 'grade') {
      const grade = request.grade === 'neutral' ? undefined : request.grade
      await ctx.keep(finishingPath(dir))
      await saveFinishing(dir, { ...finishing, grade })
      return recutEpisodes(ctx, episodes, grade)
    }
    await ctx.keep(finishingPath(dir))
    await saveFinishing(dir, { ...finishing, music: request.music })
    const comfy = ctx.comfy!
    await enterPhase(comfy, 'music (ACE-Step)', ctx.record)
    for (const episode of episodes) {
      await ctx.keep(scorePath(ctx, episode))
      await scoreEpisode(ctx, episode, request.music!)
    }
    await comfy.free()
    return recutEpisodes(ctx, episodes, finishing.grade)
  },

  report: async (ctx: NarrativeRevisionContext) => { await writeNarrativeDeliveryReport(ctx) },
}

async function coverShot(ctx: NarrativeContext): Promise<number | undefined> {
  const file = join(ctx.dir!, 'reports', 'packaging.json')
  return existsSync(file) ? (await readJson<{ cover?: { shot?: number } }>(file)).cover?.shot : undefined
}

/** A clip again from the shot's current frame (and line), and its interpolated master when the film runs above 24 fps. */
async function redoClip(ctx: NarrativeRevisionContext, episode: number, shot: NarrativeShot): Promise<void> {
  const base = join(ctx.dir!, 'clips', shotName(episode, shot.shot))
  await ctx.keep(`${base}.mp4`)
  await shotClip(ctx, episode, shot)
  if ((ctx.options.fps ?? 24) > 24) {
    await enterPhase(ctx.comfy!, 'interpolate (RIFE)', ctx.record)
    await ctx.keep(`${base}.hfr.mp4`)
    await interpolateClip(ctx, key(episode, shot.shot))
  }
}

async function redoShot(ctx: NarrativeRevisionContext, request: RevisionRequest, grade: string | undefined) {
  const dir = ctx.dir!
  const episode = request.episode ?? 1
  const shots = ctx.shots.get(episode)!
  const shot = shots.find((s) => s.shot === request.shot)!
  const notes: string[] = []
  if (request.note) {
    const revised = await reviseShotPrompt(ctx.planner, await ctx.agentPrompt('storyboard artist', ['storyboard-design', 'cinematography-and-art-direction', 'character-and-continuity']), { shot: shot.shot, prompt: shot.image_prompt, note: request.note, framing: shot.framing })
    const file = join(dir, 'storyboard', `ep${pad(episode)}.shots.json`)
    await ctx.keep(file)
    await ctx.record('shots', 'storyboard', ctx.planner, { episode, shot: shot.shot, note: request.note, change: revised.change, from: shot.image_prompt, to: revised.prompt })
    shot.image_prompt = revised.prompt
    await writeFile(file, JSON.stringify(shots, null, 2))
    notes.push(`episode ${episode} shot ${shot.shot} prompt: ${revised.change || revised.prompt}`)
  }
  const comfy = ctx.comfy!
  await ctx.rest('frames (Qwen-Image-Edit-2511)', [ctx.planner])
  await enterPhase(comfy, 'frames (Qwen-Image-Edit-2511)', ctx.record)
  const before = new Set(await readdir(join(dir, 'frames')))
  const frame = await shotFrame(ctx, episode, shot, { tag: `.rev${ctx.revision}` })
  ctx.created(...(await readdir(join(dir, 'frames'))).filter((name) => !before.has(name)).map((name) => join(dir, 'frames', name)))
  if (!frame.verdict.pass) notes.push(`episode ${episode} shot ${shot.shot}: kept the best frame after a failed gate (${frame.verdict.score}: ${frame.verdict.issues[0] ?? ''})`)
  await ctx.rest('clips (LTX-2.5)', [ctx.planner, ctx.reviewer])
  await enterPhase(comfy, 'clips (LTX-2.5)', ctx.record)
  await redoClip(ctx, episode, shot)
  await comfy.free()
  // The short's cover is this shot's first frame: it follows the new one.
  if ((await coverShot(ctx)) === shot.shot && ctx.format === 'short') {
    await ctx.keep(join(dir, 'cut', 'cover.jpg'))
    await exec('ffmpeg', ['-y', '-v', 'error', '-i', frame.path, '-q:v', '2', join(dir, 'cut', 'cover.jpg')])
  }
  const waking = wakeAll([ctx.planner, ctx.reviewer])
  const outcome = await recutEpisodes(ctx, [episode], grade)
  await waking
  return { ...outcome, notes: [...notes, ...outcome.notes] }
}

/** Episodes cut again from what is on disk, then delivery QC on them (merged into reports/qc.json). */
async function recutEpisodes(ctx: NarrativeRevisionContext, episodes: number[], grade: string | undefined) {
  const dir = ctx.dir!
  for (const episode of episodes) {
    const label = `ep${pad(episode)}`
    await ctx.keep(join(dir, 'cut', `${label}.mp4`), join(dir, 'cut', `${label}.ass`), join(dir, 'cut', `${label}.timeline.json`), join(dir, 'audio', `${label}_mix.wav`))
    await cutEpisode(ctx, episode, { grade })
  }
  await ctx.keep(join(dir, 'reports', 'qc.json'))
  const qc = await qcEpisodes(ctx, episodes)
  return { deliverables: episodes.map((e) => `ep${pad(e)}`), qc, notes: [] as string[] }
}
