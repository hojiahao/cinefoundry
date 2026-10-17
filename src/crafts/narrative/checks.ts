import { scanBrandWords } from '../../lib/compliance.js'
import { CLICKBAIT } from './packaging.js'
import { STATE } from './casting.js'
import type { NarrativeShot, Screenplay, SeriesBible } from './types.js'

const CJK = /[㐀-鿿]/
const DIGIT = /\d/
const SLUG = /^[a-z][a-z0-9-]{0,23}$/
/** A line has about 4.4 s inside a 5-second shot (a breath before it); conversational English runs about 2.5 words a second. */
export const MAX_LINE_WORDS = 12
/** Simplified Chinese subtitles, one line per English line: 16 characters on 16:9 (Netflix timed-text style guide), 12 on the narrower 9:16 line. */
export const maxZhChars = (ratio: string) => (ratio === '9:16' ? 12 : 16)
const DIALOGUE_FRAMINGS = ['medium', 'close-up', 'over-the-shoulder', 'medium close-up']

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
const zhLength = (text: string) => [...text.replace(/\s/g, '')].length

const slugName = (name: string) => name.toLowerCase().normalize('NFD').replace(/[^a-z\s-]/g, '').trim().split(/[\s-]+/).filter(Boolean).join('-')
/** The id is the English name as a slug, or one of its words ("lin-xia" or "xia" for "Lin Xia"). */
export function idMatchesName(id: string, english: string): boolean {
  const slug = slugName(english)
  return id === slug || slug.split('-').includes(id)
}

export function checkBible(bible: SeriesBible & { clientNames?: string[] }, want: { episodes: number; maxCharacters?: number; request?: string }): string[] {
  const problems: string[] = []
  // A name the client wrote is theirs: "林夏" came back as "Mia / 米娅". Every name listed must be in the request, and
  // every listed name must be a character's name exactly as written.
  if (want.request !== undefined) {
    const names = Array.isArray(bible.clientNames) ? bible.clientNames : []
    if (!Array.isArray(bible.clientNames)) problems.push('"clientNames" must list the character names the request gives (an empty list if it gives none)')
    for (const name of names) {
      if (!want.request.includes(name)) problems.push(`clientNames: "${name}" is not written in the request; list only names the client wrote, exactly`)
      else if (!(bible.characters ?? []).some((c) => c.name?.includes(name))) problems.push(`the client named a character "${name}": that character keeps the name exactly (e.g. "Lin Xia / ${name}"), not a new one`)
    }
  }
  for (const key of ['logline', 'genre', 'world', 'look'] as const) if (!bible[key]?.trim()) problems.push(`${key} is empty`)
  for (const key of ['world', 'look'] as const) {
    if (DIGIT.test(bible[key] ?? '')) problems.push(`${key} must be words only (no numbers): it prompts the image model`)
    if (CJK.test(bible[key] ?? '')) problems.push(`${key} must be in English: it prompts the image model`)
  }
  const characters = bible.characters ?? []
  if (characters.length < 1) problems.push('at least one character')
  if (characters.length > (want.maxCharacters ?? 5)) problems.push(`at most ${want.maxCharacters ?? 5} characters: every one needs a locked look and a designed voice, and a short series cannot develop more`)
  const ids = new Set<string>()
  for (const c of characters) {
    if (!SLUG.test(c.id ?? '')) problems.push(`character id "${c.id}" must be lowercase letters, digits and dashes`)
    if (ids.has(c.id)) problems.push(`character id "${c.id}" is used twice`)
    ids.add(c.id)
    if (!(Number.isFinite(c.age) && c.age >= 18 && c.age <= 90)) problems.push(`${c.id}: age must be an adult's (18-90); minors are not cast`)
    if (!['female', 'male'].includes(c.gender)) problems.push(`${c.id}: gender must be female or male (it casts the voice)`)
    for (const key of ['look', 'wardrobe', 'voice'] as const) {
      if (!c[key]?.trim()) problems.push(`${c.id}: ${key} is empty`)
      else if (CJK.test(c[key])) problems.push(`${c.id}: ${key} must be in English`)
    }
    if (c.look && STATE.test(c.look)) problems.push(`${c.id}: look describes a passing state ("${STATE.exec(c.look)![0]}"); write the face as cast, and play the tiredness in a scene`)
    if (c.look && DIGIT.test(c.look)) problems.push(`${c.id}: look must be words only (write "in her late twenties", not "28")`)
    if (!c.name?.trim() || !c.arc?.trim()) problems.push(`${c.id}: name and arc are required`)
    else {
      // "English / 中文": the English (pinyin) name is what the cast is called on screen and the id is made from it;
      // a bible once came back as "林夏 / 林夏" with the prompt's example id "mia".
      const english = c.name.split('/')[0]!.trim()
      if (!english || CJK.test(english) || !c.name.includes('/')) problems.push(`${c.id}: name is "English / 中文", e.g. "Lin Xia / 林夏" (got "${c.name}")`)
      else if (!idMatchesName(c.id, english)) problems.push(`${c.id}: id is made from the English name "${english}" (e.g. "${slugName(english)}"), not an example id`)
    }
  }
  const episodes = bible.episodes ?? []
  if (episodes.length !== want.episodes) problems.push(`plan exactly ${want.episodes} episode(s), got ${episodes.length}`)
  episodes.forEach((e, index) => {
    if (e.episode !== index + 1) problems.push(`episodes must be numbered 1..${want.episodes} in order`)
    for (const key of ['title', 'synopsis', 'hook', 'cliffhanger'] as const) if (!e[key]?.trim()) problems.push(`episode ${index + 1}: ${key} is empty`)
    if (CLICKBAIT.test(e.title ?? '')) problems.push(`episode ${index + 1}: the title "${e.title}" uses a 霸总-style or click-bait word the regulator names; title it after an object or a situation in the story`)
  })
  return problems
}

/** A brand kit's forbidden words, which become restricted wording in every line. */
export interface ForbiddenWords { brand: string; words: string[] }

export function checkScreenplay(play: Screenplay, bible: Pick<SeriesBible, 'characters'>, want: { seconds: number; ratio: string; forbidden?: ForbiddenWords }): string[] {
  const zhMax = maxZhChars(want.ratio)
  const problems: string[] = []
  const ids = new Set(bible.characters.map((c) => c.id))
  const scenes = play.scenes ?? []
  if (!scenes.length) problems.push('no scenes')
  let lines = 0
  scenes.forEach((scene, index) => {
    const at = `scene ${index + 1}`
    if (scene.scene !== index + 1) problems.push('scenes must be numbered 1..n in order')
    if (!/^(INT|EXT|INT\.\/EXT)\./.test(scene.heading ?? '')) problems.push(`${at}: heading must start INT. or EXT. ("INT. CAFÉ - MORNING")`)
    if (!scene.action?.trim()) problems.push(`${at}: action is empty`)
    else if (CJK.test(scene.action)) problems.push(`${at}: action must be in English (picture words)`)
    for (const id of scene.characters ?? []) if (!ids.has(id)) problems.push(`${at}: unknown character "${id}" (cast them in the bible first)`)
    ;(scene.lines ?? []).forEach((line, n) => {
      lines++
      const where = `${at} line ${n + 1}`
      if (line.speaker !== 'vo' && !(scene.characters ?? []).includes(line.speaker)) problems.push(`${where}: speaker "${line.speaker}" is not in the scene`)
      if (!line.en?.trim()) problems.push(`${where}: the English line is empty`)
      else {
        if (CJK.test(line.en)) problems.push(`${where}: "en" must be English only`)
        if (words(line.en) > MAX_LINE_WORDS) problems.push(`${where}: "${line.en}" is ${words(line.en)} words; at most ${MAX_LINE_WORDS} so it is spoken inside one 5-second shot - split it into two lines`)
      }
      if (!line.zh?.trim() || !CJK.test(line.zh)) problems.push(`${where}: "zh" must be the Chinese subtitle`)
      else {
        if (zhLength(line.zh) > zhMax) problems.push(`${where}: subtitle "${line.zh}" is ${zhLength(line.zh)} characters; at most ${zhMax} on a ${want.ratio} frame`)
        if (/[，。,.]/.test(line.zh)) problems.push(`${where}: Chinese subtitles use a space instead of commas and full stops`)
      }
      if (want.forbidden) for (const finding of scanBrandWords(`${line.en ?? ''}\n${line.zh ?? ''}`, want.forbidden.words, want.forbidden.brand)) problems.push(`${where}: restricted wording "${finding.text}" (${finding.rule}): ${finding.reason}`)
    })
  })
  // Each line is a shot, and scenes need a few shots without dialogue (establishing, reaction, insert).
  const budget = Math.floor(want.seconds / 5)
  // Every line is one shot and every scene needs at least one shot without dialogue (an establishing view, a reaction).
  if (lines + scenes.length > budget) problems.push(`${lines} lines in ${scenes.length} scenes need ${lines + scenes.length} shots (one per line, one more per scene) but ${want.seconds} seconds hold ${budget}: cut lines or merge scenes`)
  if (lines === 0) problems.push('no dialogue: characters speak on screen in this format')
  return problems
}

export function checkShots(shots: NarrativeShot[], play: Screenplay, want: { seconds: number }): string[] {
  const problems: string[] = []
  const expected = Math.floor(want.seconds / 5)
  if (shots.length !== expected) problems.push(`exactly ${expected} shots of 5 seconds for ${want.seconds} seconds, got ${shots.length}`)
  const spoken = new Set<string>()
  shots.forEach((shot, index) => {
    const at = `shot ${index + 1}`
    const scene = play.scenes.find((s) => s.scene === shot.scene)
    if (!scene) { problems.push(`${at}: scene ${shot.scene} does not exist`); return }
    for (const key of ['image_prompt', 'video_prompt', 'camera', 'framing'] as const) if (!shot[key]?.trim()) problems.push(`${at}: ${key} is empty`)
    if (CJK.test(`${shot.image_prompt} ${shot.video_prompt}`)) problems.push(`${at}: prompts must be in English`)
    if (DIGIT.test(shot.image_prompt ?? '')) problems.push(`${at}: image_prompt must be words only (the image model paints digits)`)
    if (/["“”]/.test(shot.image_prompt ?? '')) problems.push(`${at}: no quoted text in image_prompt - on-screen text is typeset in the cut`)
    for (const id of shot.characters ?? []) if (!scene.characters.includes(id)) problems.push(`${at}: "${id}" is not in scene ${shot.scene}`)
    if (shot.line !== undefined && shot.line !== null) {
      const line = scene.lines[shot.line]
      if (!line) { problems.push(`${at}: scene ${shot.scene} has no line ${shot.line}`); return }
      const key = `${shot.scene}:${shot.line}`
      if (spoken.has(key)) problems.push(`${at}: line ${shot.line} of scene ${shot.scene} is already spoken in another shot`)
      spoken.add(key)
      if (line.speaker !== 'vo') {
        // Two faces in one frame: the model gives the line to the wrong mouth. Dialogue is shot single, or over the shoulder.
        if (shot.characters[0] !== line.speaker) problems.push(`${at}: a dialogue shot frames its speaker first ("${line.speaker}")`)
        if (!DIALOGUE_FRAMINGS.includes(shot.framing)) problems.push(`${at}: a dialogue shot is ${DIALOGUE_FRAMINGS.join(', ')} so the mouth reads, not "${shot.framing}"`)
        if (shot.characters.length > 1 && shot.framing !== 'over-the-shoulder') problems.push(`${at}: only the speaker faces camera on a dialogue shot; frame the listener from behind (over-the-shoulder) or cut to them`)
      }
    }
  })
  play.scenes.forEach((scene) => scene.lines.forEach((_, n) => { if (!spoken.has(`${scene.scene}:${n}`)) problems.push(`scene ${scene.scene} line ${n} has no shot: every line is spoken on screen or as voice-over in a shot`) }))
  return problems
}
