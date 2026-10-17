import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatJson } from '../../agent/llm.js'
import { failIfHardProblems } from '../repair.js'
import { checkBible, checkScreenplay, checkShots } from './checks.js'
import { produced, type NarrativeContext } from './context.js'
import type { NarrativeShot, Screenplay, SeriesBible } from './types.js'

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** Development: the showrunner (or the creator-content writer) writes the bible - logline, world, look, cast, episode plan. */
export async function developmentStage(ctx: NarrativeContext): Promise<string> {
  const episodes = ctx.options.episodes ?? 1
  ctx.log(`▸ development  ${ctx.writer.role} · nemotron`)
  const run = await chatJson<SeriesBible & { id?: string; title?: string }>(
    ctx.planner,
    {
      system: await ctx.agentPrompt(ctx.writer.role, [ctx.writer.skill, 'content-compliance']),
      thinking: false,
      maxTokens: 5000,
      temperature: 0.8,
      user: `This run is non-interactive: decide every open point yourself.
The client's request, in their own words:
${ctx.request}

Format: ${episodes} episode(s) of ${ctx.episodeSeconds} seconds, ${ctx.ratio}. Every shot is 5 seconds; characters speak English on screen (lip-synced), with Chinese subtitles.
Return JSON only:
{"id": "lowercase-dashed-project-id", "title": "short Chinese title", "logline": "中文", "genre": "English", "world": "English, words only", "look": "English, words only: light, palette, texture",
 "characters": [{"id": "mia", "name": "Mia / 米娅", "role": "lead", "age": 28, "gender": "female", "look": "English", "wardrobe": "English", "arc": "中文", "voice": "English"}],
 "episodes": [{"episode": 1, "title": "中文", "synopsis": "中文", "hook": "中文", "cliffhanger": "中文"}]}`,
    },
    (value) => checkBible(value, { episodes }),
    5,
  )
  failIfHardProblems('development', checkBible(run.value, { episodes }), run.attempts)
  const { id: modelId, title, ...bible } = run.value
  const id = ctx.options.id ?? (modelId && /^[a-z0-9][a-z0-9-]{0,40}$/.test(modelId) ? modelId : `${ctx.format}-${Date.now().toString(36)}`)
  const dir = await ctx.openProject({ id, title: title ?? bible.logline.slice(0, 20), ratio: ctx.ratio, durationSeconds: ctx.episodeSeconds })
  ctx.bible = bible
  await writeFile(join(dir, 'story', 'bible.json'), json(bible))
  await ctx.record('development', ctx.writer.role, ctx.planner, { seconds: run.seconds, attempts: run.attempts, characters: bible.characters.map((c) => c.id), episodes: bible.episodes.length })
  return `${bible.characters.length} characters · ${bible.episodes.length} episodes`
}

/** Screenplay: one per produced episode, written against the bible; every line fits one shot and carries its subtitle. */
export async function screenplayStage(ctx: NarrativeContext): Promise<string> {
  const bible = ctx.bible!
  for (const episode of produced(ctx)) {
    const plan = bible.episodes.find((e) => e.episode === episode)!
    ctx.log(`▸ screenplay   episode ${episode} · screenwriter · nemotron`)
    const previous = ctx.plays.at(-1)
    const run = await chatJson<Screenplay>(
      ctx.planner,
      {
        system: await ctx.agentPrompt('screenwriter', [ctx.writer.skill === 'short-video-scripting' ? 'short-video-scripting' : 'screenwriting']),
        thinking: false,
        maxTokens: 5000,
        temperature: 0.7,
        user: `Series bible:\n${json(bible)}\n\nWrite episode ${episode}: "${plan.title}" - ${plan.synopsis}
It opens on the hook (${plan.hook}) and ends on the cliffhanger (${plan.cliffhanger}).${previous ? `\nThe previous episode ended: ${previous.scenes.at(-1)?.action ?? ''}` : ''}
Running time ${ctx.episodeSeconds} seconds: ${Math.floor(ctx.episodeSeconds / 5)} shots of 5 seconds, each shot speaks at most one line.
Return JSON only: {"episode": ${episode}, "title": "中文", "scenes": [{"scene": 1, "heading": "INT. PLACE - TIME", "characters": ["id"], "action": "English", "lines": [{"speaker": "id", "en": "English", "zh": "中文字幕", "delivery": "English"}]}]}`,
      },
      (value) => checkScreenplay(value, bible, { seconds: ctx.episodeSeconds, ratio: ctx.ratio }),
      6,
    )
    failIfHardProblems(`screenplay ${episode}`, checkScreenplay(run.value, bible, { seconds: ctx.episodeSeconds, ratio: ctx.ratio }), run.attempts)
    const play = { ...run.value, episode }
    ctx.plays.push(play)
    await writeFile(join(ctx.dir!, 'story', `ep${String(episode).padStart(2, '0')}.screenplay.json`), json(play))
    await ctx.record('screenplay', 'screenwriter', ctx.planner, { episode, seconds: run.seconds, attempts: run.attempts, scenes: play.scenes.length, lines: play.scenes.reduce((n, s) => n + s.lines.length, 0) })
  }
  return `${ctx.plays.length} episode(s)`
}

/**
 * Compliance: an independent reviewer on another model reads every line against broadcast and platform rules
 * (content-compliance). Rewrites are taken only if the screenplay still passes every check.
 */
export async function contentComplianceStage(ctx: NarrativeContext): Promise<string> {
  const bible = ctx.bible!
  const notes: string[] = []
  for (const [index, play] of ctx.plays.entries()) {
    ctx.log(`▸ compliance   episode ${play.episode} · independent reviewer · ${ctx.editor.name}`)
    const review = await chatJson<{ approve: boolean; issues: string[]; revised?: Array<{ scene: number; line: number; en: string; zh: string }> }>(
      ctx.editor,
      {
        system: await ctx.agentPrompt('compliance reviewer. You did not write this screenplay', 'content-compliance'),
        thinking: false,
        maxTokens: 2500,
        temperature: 0.2,
        user: `Series: ${bible.logline} (${bible.genre}). Characters: ${bible.characters.map((c) => `${c.id}, ${c.age}, ${c.role}`).join('; ')}.
Episode ${play.episode} lines (scene.line numbered from 1):
${play.scenes.map((s) => `Scene ${s.scene} ${s.heading}: ${s.action}\n${s.lines.map((l, n) => `  ${s.scene}.${n + 1} ${l.speaker}: ${l.en} / ${l.zh}`).join('\n')}`).join('\n')}
Return JSON only: {"approve": true|false, "issues": ["scene N line M: ..."], "revised": [{"scene": N, "line": M, "en": "...", "zh": "..."}]}`,
      },
      (r) => (typeof r.approve === 'boolean' ? [] : ['"approve" must be true or false']),
      2,
    ).catch(() => undefined)
    if (!review) { notes.push(`ep${play.episode}: reviewer unavailable`); continue }
    if (review.value.revised?.length) {
      const next: Screenplay = { ...play, scenes: play.scenes.map((s) => ({ ...s, lines: s.lines.map((l, n) => { const r = review.value.revised!.find((x) => x.scene === s.scene && x.line === n + 1); return r ? { ...l, en: r.en ?? l.en, zh: r.zh ?? l.zh } : l }) })) }
      if (checkScreenplay(next, bible, { seconds: ctx.episodeSeconds, ratio: ctx.ratio }).length === 0) ctx.plays[index] = next
      else notes.push(`ep${play.episode}: reviewer rewrites failed the screenplay checks and were not taken`)
    }
    if (!review.value.approve) notes.push(`ep${play.episode}: ${(review.value.issues ?? []).join(' ').slice(0, 200)}`)
    await writeFile(join(ctx.dir!, 'reports', `compliance.ep${String(play.episode).padStart(2, '0')}.json`), json(review.value))
    await writeFile(join(ctx.dir!, 'story', `ep${String(play.episode).padStart(2, '0')}.screenplay.json`), json(ctx.plays[index]))
    await ctx.record('compliance', 'reviewer', ctx.editor, { episode: play.episode, approve: review.value.approve, issues: review.value.issues, revised: review.value.revised?.length ?? 0 })
  }
  for (const note of notes) ctx.log(`  open item: ${note}`)
  return notes.length ? `${notes.length} open item(s)` : 'approved'
}

/** Shot breakdown: the director and the director of photography cut each scene into 5-second shots; dialogue is shot single. */
export async function shotsStage(ctx: NarrativeContext): Promise<string> {
  const bible = ctx.bible!
  let total = 0
  for (const play of ctx.plays) {
    ctx.log(`▸ shots        episode ${play.episode} · director + DP · nemotron`)
    const run = await chatJson<{ shots: NarrativeShot[] }>(
      ctx.planner,
      {
        system: await ctx.agentPrompt('director working with the director of photography and the script supervisor', ['storyboard-design', 'cinematography-and-art-direction', 'character-and-continuity']),
        thinking: false,
        maxTokens: 6000,
        temperature: 0.4,
        user: `Series look: ${bible.look}. World: ${bible.world}.
Characters: ${bible.characters.map((c) => `${c.id} (${c.name}): ${c.look}; wears ${c.wardrobe}`).join(' | ')}
Screenplay:\n${json(play)}

Break it into exactly ${Math.floor(ctx.episodeSeconds / 5)} shots of 5 seconds for a ${ctx.ratio} frame. Every line is spoken in exactly one shot ("line" = its index in the scene, from 0). A dialogue shot frames only its speaker facing camera (medium or close-up), or over the listener's shoulder; use the other shots for establishing, reactions and inserts. Image prompts describe the frame in picture words - never a character's face or hair (the reference portrait carries that), never numbers or on-screen text.
Return JSON only: {"shots": [{"shot": 1, "scene": 1, "framing": "wide|medium|close-up|over-the-shoulder|insert", "camera": "...", "characters": ["id"], "image_prompt": "...", "video_prompt": "...", "line": 0, "seconds": 5}]}`,
      },
      (value) => (Array.isArray(value.shots) ? checkShots(value.shots, play, { seconds: ctx.episodeSeconds }) : ['"shots" must be an array']),
      6,
    )
    failIfHardProblems(`shots ${play.episode}`, checkShots(run.value.shots, play, { seconds: ctx.episodeSeconds }), run.attempts)
    const shots = run.value.shots.map((shot, index) => ({ ...shot, shot: index + 1, seconds: 5, line: typeof shot.line === 'number' ? shot.line : undefined }))
    ctx.shots.set(play.episode, shots)
    total += shots.length
    await writeFile(join(ctx.dir!, 'storyboard', `ep${String(play.episode).padStart(2, '0')}.shots.json`), json(shots))
    await ctx.record('shots', 'director', ctx.planner, { episode: play.episode, seconds: run.seconds, attempts: run.attempts, shots: shots.length, dialogue: shots.filter((s) => s.line !== undefined).length })
  }
  return `${total} shots`
}
