import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatJson } from '../../agent/llm.js'
import { failIfHardProblems } from '../repair.js'
import { scanBrandWords, scanCopy } from '../../lib/compliance.js'
import { brandBibleProblems, brandForCopy, brandForStory, brandPresenters } from '../brand.js'
import { EN_ABSOLUTES } from '../../agent/checks.js'
import { checkBible, checkScreenplay, checkShots, maxZhChars } from './checks.js'
import { produced, type NarrativeContext } from './context.js'
import type { NarrativeShot, Screenplay, SeriesBible } from './types.js'

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** The screenplay checks of this run: under a brand kit its forbidden words are restricted wording. */
const screenplayWant = (ctx: NarrativeContext) => ({ seconds: ctx.episodeSeconds, ratio: ctx.ratio, ...(ctx.brand ? { forbidden: { brand: ctx.brand.kit.name, words: ctx.brand.kit.forbidden.words } } : {}) })

/** Development: the showrunner (or the creator-content writer) writes the bible - logline, world, look, cast, episode plan. */
export async function developmentStage(ctx: NarrativeContext): Promise<string> {
  const episodes = ctx.options.episodes ?? 1
  ctx.log(`▸ development  ${ctx.writer.role} · nemotron`)
  // Under a brand kit: its product, voice and wording frame the story, and its recurring presenters are in the cast.
  if (ctx.brand) ctx.brand.presenters = await brandPresenters(ctx.brand)
  const brandNote = ctx.brand ? `\n\n${brandForStory(ctx.brand, ctx.brand.product, ctx.brand.presenters)}\n` : ''
  const bibleProblems = (value: SeriesBible & { clientNames?: string[] }) => [...checkBible(value, { episodes, request: ctx.request }), ...(ctx.brand ? brandBibleProblems(value, ctx.brand.presenters) : [])]
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

Format: ${episodes} episode(s) of ${ctx.episodeSeconds} seconds, ${ctx.ratio}. Every shot is 5 seconds; characters speak English on screen (lip-synced), with Chinese subtitles.${brandNote}
Characters the client names keep exactly those names: "name" is the English (pinyin) form, then the client's own Chinese, e.g. "Lin Xia / 林夏". List the names the client wrote in "clientNames".
Return JSON only:
{"id": "lowercase-dashed-project-id", "title": "short Chinese title", "clientNames": ["names exactly as the request writes them"], "logline": "中文", "genre": "English", "world": "English, words only", "look": "English, words only: light, palette, texture",
 "characters": [{"id": "mia", "name": "Mia / 米娅", "role": "lead", "age": 28, "gender": "female", "look": "English", "wardrobe": "English", "arc": "中文", "voice": "English"}],
 "episodes": [{"episode": 1, "title": "中文", "synopsis": "中文", "hook": "中文", "cliffhanger": "中文"}]}`,
    },
    bibleProblems,
    5,
  )
  failIfHardProblems('development', bibleProblems(run.value), run.attempts)
  let draft = run.value
  // The premise is reviewed once, here, by an independent reviewer - as a studio clears a project before writing it -
  // and sent back to the showrunner with the findings, at most twice. Episode reviews then judge execution only.
  let premise = await reviewPremise(ctx, draft)
  for (let round = 1; !premise.approve && round <= 2; round++) {
    ctx.log(`  premise sent back (${premise.issues.join(' | ').slice(0, 160)})`)
    const redo = await chatJson<SeriesBible & { id?: string; title?: string; clientNames?: string[] }>(ctx.planner, {
      system: await ctx.agentPrompt(ctx.writer.role, [ctx.writer.skill, 'content-compliance']), thinking: false, maxTokens: 5000, temperature: 0.6,
      user: `Your series bible:\n${json(draft)}\n\nThe compliance reviewer did not clear it:\n${premise.issues.map((i) => `- ${i}`).join('\n')}\nKeep the client's story and names; change only what the findings name. Return the corrected bible as JSON only, same shape.`,
    }, bibleProblems, 4)
    draft = redo.value
    premise = await reviewPremise(ctx, draft)
  }
  if (!premise.approve) throw new Error(`the series premise did not pass compliance: ${premise.issues.join(' | ').slice(0, 300)}`)
  const { id: modelId, title, clientNames: _names, ...bible } = draft as SeriesBible & { id?: string; title?: string; clientNames?: string[] }
  const id = ctx.options.id ?? (modelId && /^[a-z0-9][a-z0-9-]{0,40}$/.test(modelId) ? modelId : `${ctx.format}-${Date.now().toString(36)}`)
  const dir = await ctx.openProject({ id, title: title ?? bible.logline.slice(0, 20), ratio: ctx.ratio, durationSeconds: ctx.episodeSeconds })
  ctx.bible = bible
  if (ctx.brand) await ctx.record('development', 'brand-kit', undefined, { brand: ctx.brand.id, version: ctx.brand.version, product: ctx.brand.product.id, presenters: ctx.brand.presenters.map((p) => p.id) })
  await writeFile(join(dir, 'story', 'bible.json'), json(bible))
  await ctx.record('development', ctx.writer.role, ctx.planner, { seconds: run.seconds, attempts: run.attempts, characters: bible.characters.map((c) => c.id), episodes: bible.episodes.length })
  return `${bible.characters.length} characters · ${bible.episodes.length} episodes`
}

/** Chinese subtitles use a space where prose uses a comma or a full stop (Netflix Simplified Chinese style guide). */
export const normalizeSubtitle = (zh: string) => zh.replace(/[，,、；;。.！!]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The subtitle editor: punctuation normalised, then every subtitle still longer than the frame's line width is
 * tightened by an agent working under bilingual-subtitles, keeping the meaning of the English line it translates.
 */
export async function fitSubtitles(ctx: NarrativeContext, play: Screenplay): Promise<Screenplay> {
  const max = maxZhChars(ctx.ratio)
  let fitted: Screenplay = { ...play, scenes: play.scenes.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, zh: normalizeSubtitle(l.zh ?? '') })) })) }
  const long = () => fitted.scenes.flatMap((s) => s.lines.map((l, n) => ({ scene: s.scene, line: n + 1, en: l.en, zh: l.zh }))).filter((l) => [...l.zh.replace(/\s/g, '')].length > max)
  const tooLong = long()
  if (!tooLong.length) return fitted
  ctx.log(`  subtitle editor: ${tooLong.length} subtitle(s) over ${max} characters`)
  const run = await chatJson<{ subtitles: Array<{ scene: number; line: number; zh: string }> }>(ctx.planner, {
    system: await ctx.agentPrompt('subtitle editor', 'bilingual-subtitles'), thinking: false, maxTokens: 1500, temperature: 0.3,
    user: `Tighten each Chinese subtitle to at most ${max} characters (spaces do not count; no commas or full stops - use a space), keeping what the English line says and how the character says it:\n${tooLong.map((l) => `${l.scene}.${l.line} EN: ${l.en}\n${l.scene}.${l.line} ZH (${[...l.zh.replace(/\s/g, '')].length}): ${l.zh}`).join('\n')}\nReturn JSON only: {"subtitles": [{"scene": 1, "line": 1, "zh": "..."}]}`,
  }, (r) => (Array.isArray(r.subtitles) ? r.subtitles.flatMap((x) => (!x.zh?.trim() ? [`${x.scene}.${x.line} is empty`] : [...normalizeSubtitle(x.zh).replace(/\s/g, '')].length > max ? [`${x.scene}.${x.line} "${x.zh}" is still over ${max} characters`] : [])).concat(tooLong.filter((t) => !r.subtitles.some((x) => x.scene === t.scene && x.line === t.line)).map((t) => `return ${t.scene}.${t.line} too`)) : ['"subtitles" must be an array']), 4).catch(() => undefined)
  if (run) fitted = { ...fitted, scenes: fitted.scenes.map((s) => ({ ...s, lines: s.lines.map((l, n) => { const fix = run.value.subtitles.find((x) => x.scene === s.scene && x.line === n + 1); return fix ? { ...l, zh: normalizeSubtitle(fix.zh) } : l }) })) }
  await ctx.record('screenplay', 'subtitle-editor', ctx.planner, { episode: play.episode, tightened: tooLong.length, left: long().length })
  return fitted
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
Running time ${ctx.episodeSeconds} seconds: ${Math.floor(ctx.episodeSeconds / 5)} shots of 5 seconds, each shot speaks at most one line.${ctx.brand ? `\n${brandForCopy(ctx.brand.kit)}` : ''}
Return JSON only: {"episode": ${episode}, "title": "中文", "scenes": [{"scene": 1, "heading": "INT. PLACE - TIME", "characters": ["id"], "action": "English", "lines": [{"speaker": "id", "en": "English", "zh": "中文字幕", "delivery": "English"}]}]}`,
      },
      (value) => checkScreenplay(value, bible, screenplayWant(ctx)),
      6,
    )
    // Subtitles are the subtitle editor's craft, not a reason to throw the screenplay away: punctuation is normalised by
    // rule, and only the lines still too long go to a subtitle editor to tighten.
    const play = await fitSubtitles(ctx, { ...run.value, episode })
    failIfHardProblems(`screenplay ${episode}`, checkScreenplay(play, bible, screenplayWant(ctx)), run.attempts)
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
/** What the regulation allows, stated in the reviewer's own instruction so it is weighed, not skimmed. */
export const ALLOWED = `Allowed when the values are sound: wealthy characters, inheritances, business acquisitions, contract or fake relationships, arranged matches, rivals who fall in love. Judge the treatment: wealth is never the measure of a person or a weapon of humiliation; no coercion, confinement or "taming" as romance; the lead has her own skill, choices and voice; conflict resolves through truth and character, not revenge; titles carry no 霸总-style or click-bait words.`

async function reviewPremise(ctx: NarrativeContext, bible: SeriesBible): Promise<ContentReview> {
  const source = `${bible.logline}\n${bible.genre}\n${bible.characters.map((c) => `${c.name} ${c.role} ${c.arc}`).join('\n')}\n${bible.episodes.map((e) => `${e.title} ${e.synopsis} ${e.hook} ${e.cliffhanger}`).join('\n')}`
  ctx.log(`▸ compliance   series premise · independent reviewer · ${ctx.editor.name}`)
  const run = await chatJson<ContentReview>(ctx.editor, {
    system: await ctx.agentPrompt('compliance reviewer. You did not write this series', 'content-compliance'), thinking: false, maxTokens: 2500, temperature: 0.2,
    user: `Clear this micro-drama series for production (premise, characters, episode titles and plans):\n${source}\n\n${ALLOWED}\nEvery issue quotes the exact words it is about, in quotation marks. Return JSON only: {"approve": true|false, "issues": ["\\"quoted words\\" - why"]}`,
  }, (r) => checkReviewEvidence(r, source), 3).catch((error: Error) => { throw new Error(`the series premise could not be reviewed (${error.message.slice(0, 160)}); the run stops here`) })
  await ctx.record('compliance', 'premise-reviewer', ctx.editor, { approve: run.value.approve, issues: run.value.issues, unresolved: run.unresolved })
  return { ...run.value, approve: run.value.approve && run.unresolved.length === 0 }
}

export type ContentReview = { approve: boolean; issues: string[]; revised?: Array<{ scene: number; line: number; en: string; zh: string }> }

/**
 * Every finding must quote the words it is about, exactly as they appear in the episode or the logline: a reviewer
 * once condemned a perfume-shop romance as "rebirth revenge on the rich husband" - the skill's own counter-example,
 * nowhere in the script. A finding that quotes nothing on the page is sent back.
 */
export function checkReviewEvidence(review: ContentReview, source: string): string[] {
  if (typeof review.approve !== 'boolean') return ['"approve" must be true or false']
  if (!Array.isArray(review.issues)) return ['"issues" must be an array']
  const quotes = (issue: string) => [...issue.matchAll(/["“'‘「]([^"”'’」]{2,80})["”'’」]/g)].map((m) => m[1]!.trim())
  const problems: string[] = []
  for (const issue of review.issues) {
    const cited = quotes(issue)
    if (!cited.length) problems.push(`quote the exact words this finding is about, in quotation marks: ${issue.slice(0, 80)}`)
    else if (!cited.some((q) => source.includes(q))) problems.push(`the quoted words do not appear in this episode or the logline - judge only what is written: ${issue.slice(0, 80)}`)
  }
  if (!review.approve && review.issues.length === 0) problems.push('a review that does not approve names at least one issue')
  return problems
}

/**
 * Compliance: a deterministic scan of the subtitles and lines, then an independent reviewer on another agent who did not
 * write the screenplay (content-compliance). Rewrites are taken only if the screenplay still passes every check, then the
 * episode is reviewed again. Compliance is a gate: a reviewer that cannot be reached, or an episode still not approved
 * after its rewrite, stops the run before any frame is generated.
 */
export async function contentComplianceStage(ctx: NarrativeContext): Promise<string> {
  const bible = ctx.bible!
  const system = await ctx.agentPrompt('compliance reviewer. You did not write this screenplay', 'content-compliance')
  for (const [index, initial] of ctx.plays.entries()) {
    let play = initial
    const episode = String(play.episode).padStart(2, '0')
    const reviews: ContentReview[] = []
    for (let pass = 1; pass <= 2; pass++) {
      ctx.log(`▸ compliance   episode ${play.episode} · ${pass === 1 ? 'scan + independent reviewer' : 'second review after rewrites'} · ${ctx.editor.name}`)
      const lines = play.scenes.flatMap((s) => s.lines.map((l, n) => ({ s, n, l })))
      const source = `${bible.logline}\n${play.scenes.map((s) => `${s.heading} ${s.action}`).join('\n')}\n${lines.map(({ l }) => `${l.en}\n${l.zh}`).join('\n')}`
      // The same restricted-wording scan the ads get, on the Chinese subtitles, and absolute claims in English.
      const scan = scanCopy(lines.map(({ l }) => l.zh).join('\n'), 'general').filter((f) => f.severity === 'block').map((f) => `restricted wording "${f.text}" (${f.rule})`)
      for (const { s, n, l } of lines) { const hit = EN_ABSOLUTES.exec(l.en)?.[0]; if (hit) scan.push(`scene ${s.scene} line ${n + 1}: absolute claim "${hit}"`) }
      // The kit's forbidden words, in either language, must be rewritten like the law's.
      if (ctx.brand) for (const { s, n, l } of lines) for (const f of scanBrandWords(`${l.en}\n${l.zh}`, ctx.brand.kit.forbidden.words, ctx.brand.kit.name)) scan.push(`scene ${s.scene} line ${n + 1}: the brand kit forbids "${f.text}"`)
      const brandNote = ctx.brand ? `This film is made for ${ctx.brand.kit.name}. Its substantiated claims are the only proof a line about the product may rest on: ${ctx.brand.kit.claims.map((c) => `${c.claim} (${c.source})`).join('; ') || 'none - no product claims'}. Topics the brand keeps out: ${ctx.brand.kit.forbidden.topics.join(', ') || 'none'}.\n` : ''
      const run = await chatJson<ContentReview>(
        ctx.editor,
        {
          system, thinking: false, maxTokens: 3000, temperature: 0.2,
          user: `Series logline: ${bible.logline} (${bible.genre}). Characters: ${bible.characters.map((c) => `${c.id}, ${c.age}, ${c.role}`).join('; ')}.
Episode ${play.episode} (scene.line numbered from 1):
${play.scenes.map((s) => `Scene ${s.scene} ${s.heading}: ${s.action}\n${s.lines.map((l, n) => `  ${s.scene}.${n + 1} ${l.speaker}: ${l.en} / ${l.zh}`).join('\n')}`).join('\n')}
${scan.length ? `The deterministic scan found: ${scan.join('; ')}. Each of these must be rewritten.\n` : ''}${brandNote}The series premise has already been cleared; judge how this episode executes it - its lines, actions and on-screen behaviour.\n${ALLOWED}\nJudge only what is written above. Every issue quotes the exact words it is about, in quotation marks.
Return JSON only: {"approve": true|false, "issues": ["scene N line M: \\"quoted words\\" - why"], "revised": [{"scene": N, "line": M, "en": "...", "zh": "..."}]}`,
        },
        (r) => checkReviewEvidence(r, source),
        3,
      ).catch((error: Error) => { throw new Error(`compliance review of episode ${play.episode} could not be completed (${error.message.slice(0, 160)}); the run stops here rather than shoot unreviewed lines`) })
      const review = { ...run.value, approve: run.value.approve && scan.length === 0 && run.unresolved.length === 0 }
      reviews.push(review)
      await ctx.record('compliance', 'reviewer', ctx.editor, { episode: play.episode, pass, approve: review.approve, issues: review.issues, scan, revised: review.revised?.length ?? 0, unresolved: run.unresolved })
      if (review.approve) break
      if (!review.revised?.length) break
      const next: Screenplay = { ...play, scenes: play.scenes.map((s) => ({ ...s, lines: s.lines.map((l, n) => { const r = review.revised!.find((x) => x.scene === s.scene && x.line === n + 1); return r ? { ...l, en: r.en ?? l.en, zh: r.zh ?? l.zh } : l }) })) }
      const problems = checkScreenplay(next, bible, screenplayWant(ctx))
      if (problems.length) { ctx.log(`  reviewer rewrites fail the screenplay checks (${problems[0]}); not taken`); break }
      play = next
    }
    ctx.plays[index] = play
    await writeFile(join(ctx.dir!, 'reports', `compliance.ep${episode}.json`), json(reviews))
    await writeFile(join(ctx.dir!, 'story', `ep${String(episode).padStart(2, '0')}.screenplay.json`), json(play))
    const last = reviews.at(-1)!
    if (!last.approve) throw new Error(`episode ${play.episode} did not pass compliance: ${last.issues.join(' | ').slice(0, 300)}`)
  }
  return 'approved'
}

/** Shot breakdown: the director and the director of photography cut each scene into 5-second shots; dialogue is shot single. */
/**
 * How many 5-second shots each scene gets: one per line (each line is spoken in exactly one shot) plus at least one
 * without dialogue (an establishing view, a reaction, an insert); what is left goes to the scenes with the most action.
 */
export function allocateShots(play: Screenplay, total: number): number[] {
  const base = play.scenes.map((s) => s.lines.length + 1)
  let left = total - base.reduce((a, b) => a + b, 0)
  if (left < 0) throw new Error(`${base.reduce((a, b) => a + b, 0)} shots are needed (one per line and one more per scene) but the episode has ${total}`)
  const weight = play.scenes.map((s) => Math.max(1, s.action.split(/\s+/).length))
  const counts = [...base]
  while (left > 0) {
    // The scene whose action is least covered per shot gets the next shot.
    let best = 0
    for (let k = 1; k < counts.length; k++) if (weight[k]! / counts[k]! > weight[best]! / counts[best]!) best = k
    counts[best]!++
    left--
  }
  return counts
}

/** "No line" arrives as -1, null or a string; only a non-negative integer index is a line. */
const lineIndex = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined)

/**
 * Shot breakdown, scene by scene as a real production breaks down a script: each scene gets its exact number of shots
 * (allocateShots), the director and the DP design them with the scene's lines in hand, and the joined episode passes
 * checkShots. One call per scene keeps every answer small enough to be right; a 24-shot episode in one answer came
 * back with 13 shots six times running.
 */
export async function shotsStage(ctx: NarrativeContext): Promise<string> {
  const bible = ctx.bible!
  const system = await ctx.agentPrompt('director working with the director of photography and the script supervisor', ['storyboard-design', 'cinematography-and-art-direction', 'character-and-continuity'])
  let total = 0
  for (const play of ctx.plays) {
    const counts = allocateShots(play, Math.floor(ctx.episodeSeconds / 5))
    ctx.log(`▸ shots        episode ${play.episode} · director + DP · ${counts.reduce((a, b) => a + b, 0)} shots over ${play.scenes.length} scenes`)
    const shots: NarrativeShot[] = []
    let seconds = 0
    for (const [index, scene] of play.scenes.entries()) {
      const want = counts[index]!
      const sceneOnly: Screenplay = { ...play, scenes: [{ ...scene, scene: 1 }] }
      const previous = shots.at(-1)
      const run = await chatJson<{ shots: NarrativeShot[] }>(
        ctx.planner,
        {
          system, thinking: false, maxTokens: 4000, temperature: 0.4,
          user: `Series look: ${bible.look}. World: ${bible.world}.
Characters: ${bible.characters.map((c) => `${c.id} (${c.name}): ${c.look}; wears ${c.wardrobe}`).join(' | ')}
Episode ${play.episode}, scene ${scene.scene} of ${play.scenes.length}:
${json(scene)}
${previous ? `The previous shot was: ${previous.framing}, ${previous.image_prompt.slice(0, 160)}\n` : ''}
Break this scene into exactly ${want} shots of 5 seconds for a ${ctx.ratio} frame. Each of its ${scene.lines.length} line(s) is spoken in exactly one shot ("line" = the line's index in this scene, from 0; omit "line" on a shot without dialogue). A dialogue shot frames only its speaker facing camera (medium or close-up), or over the listener's shoulder; use the other shots for an establishing view, reactions and inserts. Vary framing from shot to shot. Image prompts describe the frame in picture words - never a character's face or hair (the reference portrait carries that), never numbers or on-screen text.
Return JSON only: {"shots": [{"shot": 1, "scene": 1, "framing": "wide|medium|close-up|over-the-shoulder|insert", "camera": "...", "characters": ["id"], "image_prompt": "...", "video_prompt": "...", "line": 0, "seconds": 5}]}`,
        },
        (value) => (Array.isArray(value.shots) ? checkShots(value.shots.map((s) => ({ ...s, scene: 1, line: lineIndex(s.line) })), sceneOnly, { seconds: want * 5 }) : ['"shots" must be an array']),
        6,
      )
      const sceneShots = run.value.shots.map((s) => ({ ...s, scene: 1, line: lineIndex(s.line) }))
      failIfHardProblems(`shots ${play.episode}.${scene.scene}`, checkShots(sceneShots, sceneOnly, { seconds: want * 5 }), run.attempts)
      shots.push(...sceneShots.map((s) => ({ ...s, scene: scene.scene })))
      seconds += run.seconds
    }
    const numbered = shots.map((shot, index) => ({ ...shot, shot: index + 1, seconds: 5 }))
    failIfHardProblems(`shots ${play.episode}`, checkShots(numbered, play, { seconds: ctx.episodeSeconds }), 1)
    ctx.shots.set(play.episode, numbered)
    total += numbered.length
    await writeFile(join(ctx.dir!, 'storyboard', `ep${String(play.episode).padStart(2, '0')}.shots.json`), json(numbered))
    await ctx.record('shots', 'director', ctx.planner, { episode: play.episode, seconds, scenes: play.scenes.length, perScene: counts, shots: numbered.length, dialogue: numbered.filter((s) => s.line !== undefined).length })
  }
  return `${total} shots`
}
