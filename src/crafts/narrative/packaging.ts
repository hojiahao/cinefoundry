import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatJson, type ModelEndpoint } from '../../agent/llm.js'
import { exec } from '../../lib/exec.js'
import { scanBrandWords } from '../../lib/compliance.js'
import type { NarrativeContext } from './context.js'
import { brandPackaging } from '../brand.js'

export interface Packaging {
  /** Three title variants for the platform's A/B test (YouTube's Test & Compare takes three). */
  titles: string[]
  /** The shot whose frame becomes the cover, and the few words set on it. */
  cover: { shot: number; text: string }
  description: string
  hashtags: string[]
}

const CJK = /[㐀-鿿]/
/** Title words regulators name (the 霸总 notice, the 2026 clean-up) and the feed's click-bait formulas. */
export const CLICKBAIT = /霸总|霸道总裁|震惊|惊呆|不看后悔|速看|必看|跪求|悔不当初|闪婚|豪门/

export function checkPackaging(p: Packaging, shots: number): string[] {
  const problems: string[] = []
  if (!Array.isArray(p.titles) || p.titles.length !== 3 || p.titles.some((t) => !t?.trim())) problems.push('exactly three title variants')
  else if (p.titles.some((t) => [...t].length > 30)) problems.push('titles at most 30 characters: they are cut off in the feed')
  if (!p.cover || !Number.isInteger(p.cover.shot) || p.cover.shot < 1 || p.cover.shot > shots) problems.push(`cover.shot must be a shot number from 1 to ${shots}`)
  else if (!p.cover.text?.trim() || [...p.cover.text].length > 12) problems.push('cover.text: a few words, at most 12 characters')
  if (!p.description?.trim()) problems.push('description is empty')
  else if (!/AI/.test(p.description)) problems.push('the description must disclose that the video is AI-generated (标识办法; YouTube altered or synthetic content)')
  if (!Array.isArray(p.hashtags) || p.hashtags.length < 3 || p.hashtags.length > 8) problems.push('three to eight hashtags')
  if (p.titles?.some((t) => CLICKBAIT.test(t))) problems.push('no clickbait formulas or 霸总-style words (NRTA notice): the title must say what the video is')
  if (p.titles?.length && !p.titles.some((t) => CJK.test(t))) problems.push('at least one title in Chinese for Douyin and Bilibili')
  return problems
}

/** The packaging editor's copy: titles, cover shot and words, description, hashtags; the brand's own are added by code. */
export async function draftPackaging(ctx: NarrativeContext, endpoint: ModelEndpoint): Promise<Packaging> {
  const play = ctx.plays[0]!
  const shots = ctx.shots.get(play.episode) ?? []
  const run = await chatJson<Packaging>(
    endpoint,
    {
      system: await ctx.agentPrompt('packaging editor', 'platform-packaging'),
      thinking: false, maxTokens: 1500, temperature: 0.6,
      user: `Video: ${ctx.bible!.logline}
Screenplay: ${play.scenes.map((s) => `${s.heading}: ${s.action} ${s.lines.map((l) => l.zh).join(' ')}`).join(' | ')}
Shots: ${shots.map((s) => `${s.shot}. ${s.image_prompt.slice(0, 90)}`).join(' | ')}${ctx.brand ? `\nMade for ${ctx.brand.kit.name}; its own hashtags (${ctx.brand.kit.platforms.hashtags.join(' ')}) are added by the studio - write the film's. Never use the kit's forbidden words: ${ctx.brand.kit.forbidden.words.join(', ') || 'none'}.` : ''}
Return JSON only: {"titles": ["...", "...", "..."], "cover": {"shot": 1, "text": "..."}, "description": "...", "hashtags": ["#..."]}`,
    },
    (value) => [...checkPackaging(value, shots.length), ...(ctx.brand ? scanBrandWords([...(value.titles ?? []), value.description ?? '', value.cover?.text ?? '', ...(value.hashtags ?? [])].join('\n'), ctx.brand.kit.forbidden.words, ctx.brand.kit.name).map((f) => `"${f.text}": ${f.reason}`) : [])],
    4,
  )
  await ctx.record('packaging', 'packaging-editor', endpoint, { seconds: run.seconds, attempts: run.attempts, titles: run.value.titles })
  return run.value
}

/** Packaging: titles to test, the cover frame and its words, description with the AI disclosure, hashtags. */
export async function packagingStage(ctx: NarrativeContext): Promise<string> {
  const play = ctx.plays[0]!
  const copy = ctx.packagingDraft ?? (await draftPackaging(ctx, ctx.planner))
  // The brand's hashtags lead and its handles are attached by code: the editor never retypes them.
  const pack: Packaging & { handles?: Record<string, string> } = ctx.brand ? { ...copy, ...brandPackaging(ctx.brand.kit, copy.hashtags) } : copy
  await writeFile(join(ctx.dir!, 'reports', 'packaging.json'), JSON.stringify(pack, null, 2))
  // The cover is the chosen shot's approved first frame, at full quality: what the feed shows before anyone presses play.
  const frame = ctx.frames.get(`${play.episode}:${pack.cover.shot}`)
  if (frame) await exec('ffmpeg', ['-y', '-v', 'error', '-i', frame, '-q:v', '2', join(ctx.dir!, 'cut', 'cover.jpg')])
  return pack.titles[0]!
}
