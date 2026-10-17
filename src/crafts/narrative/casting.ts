import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ComfyClient } from '../../comfy/client.js'
import { chatJson } from '../../agent/llm.js'
import { enterPhase } from '../../agent/finish.js'
import { generateImage, type EditModel, type ImageModel } from '../../lib/media.js'
import { addAsset } from '../../lib/project.js'
import { failIfHardProblems } from '../repair.js'
import type { NarrativeContext } from './context.js'
import { identityGate, sheetGate, type CastingVerdict, type PackView } from './gate.js'
import type { Character, NarrativeShot } from './types.js'

/**
 * The casting department of a narrative film. A character designer writes a casting brief per character; a casting
 * call of four candidates per role is generated with Qwen-Image-2512; the gate picks the best on realism, match to the
 * brief and distinctness from the cast so far; Qwen-Image-Edit-2511 then edits the reference pack (profile,
 * full-length) from the chosen master, each view gated for identity against it. Everything lands in cast/<id>/ with a
 * character.json, and a later episode or series run loads that record instead of casting again.
 */

export const NARRATIVE_IMAGE_MODEL: ImageModel = 'qwen-image-2512'
export const NARRATIVE_EDIT_MODEL: EditModel = 'qwen-image-edit-2511'
/** Candidates per role in one casting call, and calls per role before the best candidate is kept as an open item. */
export const CASTING_CALL = 4
export const CASTING_ROUNDS = 2
/** Edits per reference view before the view is dropped and frames fall back to the master. */
export const PACK_ATTEMPTS = 3

export const BRIEF_FIELDS = ['face', 'features', 'ethnicity', 'skin', 'hair', 'build', 'distinctive', 'wardrobe', 'palette'] as const
/** A casting director's brief: English picture words, one field per thing a casting call is judged on. */
export type CastingBrief = Record<(typeof BRIEF_FIELDS)[number], string>

export type ReferenceView = 'master' | PackView
export const PACK_VIEWS: PackView[] = ['profile', 'full-body']
const VIEW_SIZES: Record<ReferenceView, string> = { master: '1328x1328', profile: '1328x1328', 'full-body': '928x1664' }

export interface CastImage {
  /** Relative to the character's folder, cast/<id>/. */
  path: string
  score: number
  pass: boolean
  model: string
  issues?: string[]
  casting?: CastingVerdict['casting']
}

/** cast/<id>/character.json: everything a later run needs to put the same person on screen with the same voice. */
export interface CharacterRecord {
  version: 1
  id: string
  name: string
  gender: Character['gender']
  age: number
  look: string
  wardrobe: string
  brief: CastingBrief
  /** `library`: a casting-library voice id; `wav` + `text`: a voice designed for this character, kept in this folder. */
  voice: { description: string; library?: string; wav?: string; text?: string }
  images: { master: CastImage } & Partial<Record<PackView, CastImage>>
  candidates: CastImage[]
  castAt: string
}

/** A cast character as frames use it: absolute paths of the views that exist; `master` always does. */
export interface CastMember {
  id: string
  dir: string
  record: CharacterRecord
  views: { master: string } & Partial<Record<PackView, string>>
}

const CJK = /[㐀-鿿]/
const DIGIT = /\d/
const WORTH = /\b(beautiful|handsome|pretty|gorgeous|attractive|stunning|perfect|flawless|sexy|hot|cute|ideal)\b/i
const LIKENESS = /\b(looks? like|resembl\w*|look-?alike|lookalike|reminiscent of|doppelg\w*|celebrity|celebrities|famous|movie star|pop star|idol|public figure)\b/i
/** A passing state is acted in the scene, not cast: "tired eyes" in a look aged every candidate by a decade. */
export const STATE = /\b(tired|exhausted|weary|haggard|sleepy|sleep-deprived|worn-out|worn out|careworn|drained|bags under|dark circles|under-eye shadows?|slump\w*|hunched)\b/i
/** A distinctive detail the casting photograph cannot show cannot be cast, judged or kept: a scar on a thumb is out of frame. */
export const OUT_OF_FRAME = /\b(hands?|thumbs?|fingers?|knuckles?|palms?|wrists?|forearms?|arms?|elbows?|legs?|knees?|ankles?|feet|foot|toes?|waist|hips?|stomach|belly|chest)\b/i
const MINOR = /\b(girl|girls|boy|boys|teen|teens|teenage\w*|child|children|childlike|kid|kids|minor|underage|schoolgirl|schoolboy|loli\w*|baby-?faced)\b/i
/** Colour words a palette is compared on. */
const COLOURS = ['black', 'white', 'grey', 'gray', 'charcoal', 'graphite', 'slate', 'navy', 'blue', 'cobalt', 'indigo', 'denim', 'teal', 'turquoise', 'green', 'olive', 'sage', 'emerald', 'forest', 'mint', 'khaki', 'red', 'crimson', 'scarlet', 'burgundy', 'maroon', 'wine', 'oxblood', 'rust', 'brick', 'orange', 'terracotta', 'amber', 'mustard', 'yellow', 'ochre', 'gold', 'cream', 'ivory', 'beige', 'camel', 'tan', 'sand', 'stone', 'oatmeal', 'brown', 'chocolate', 'chestnut', 'taupe', 'pink', 'blush', 'rose', 'coral', 'peach', 'purple', 'plum', 'lavender', 'lilac', 'mauve', 'violet', 'silver']

export function paletteColours(palette: string): string[] {
  const words = palette.toLowerCase().split(/[^a-z]+/)
  return [...new Set(words.filter((w) => COLOURS.includes(w)).map((w) => (w === 'gray' ? 'grey' : w)))]
}

/** Two palettes are too close when most colours of the smaller one recur in the other. */
export function palettesClash(a: string, b: string): boolean {
  const x = paletteColours(a)
  const y = new Set(paletteColours(b))
  if (!x.length || !y.size) return false
  const shared = x.filter((c) => y.has(c)).length
  return shared / Math.min(x.length, y.size) >= 2 / 3
}

/**
 * Every rule of a casting brief that code can check: all fields present, English picture words without digits, no
 * words of worth (they pull every face to one average), no likeness of a real person, nothing that reads as a minor,
 * a wardrobe palette of at least two colours that does not repeat another character's.
 */
export function checkCastingBrief(brief: Partial<CastingBrief> | undefined, character: Pick<Character, 'id'>, others: Array<{ id: string; brief: Pick<CastingBrief, 'palette'> }> = []): string[] {
  const at = character.id
  if (!brief || typeof brief !== 'object') return [`${at}: the casting brief is missing`]
  const problems: string[] = []
  for (const field of BRIEF_FIELDS) {
    const value = brief[field]
    if (typeof value !== 'string' || !value.trim()) { problems.push(`${at}: ${field} is empty`); continue }
    if (CJK.test(value)) problems.push(`${at}: ${field} must be English (it prompts the image model)`)
    if (DIGIT.test(value)) problems.push(`${at}: ${field} must be words only, no digits (the image model paints numbers)`)
    if (WORTH.test(value)) problems.push(`${at}: ${field} uses a word of worth ("${WORTH.exec(value)![0]}"); describe the face plainly`)
    if (LIKENESS.test(value)) problems.push(`${at}: ${field} refers to a real or famous person ("${LIKENESS.exec(value)![0]}"); faces are designed, never a likeness`)
    if (MINOR.test(value)) problems.push(`${at}: ${field} reads as a minor ("${MINOR.exec(value)![0]}"); characters are adults`)
    if (STATE.test(value)) problems.push(`${at}: ${field} describes a passing state ("${STATE.exec(value)![0]}"); cast the face, and let the scene play the tiredness`)
  }
  if (typeof brief.distinctive === 'string' && OUT_OF_FRAME.test(brief.distinctive)) problems.push(`${at}: distinctive "${brief.distinctive}" is out of frame in a head-and-shoulders photograph; choose a detail of the face, hair, ears or neck`)
  if (typeof brief.palette === 'string' && brief.palette.trim()) {
    if (paletteColours(brief.palette).length < 2) problems.push(`${at}: palette names at least two colours (${brief.palette})`)
    for (const other of others) if (other.id !== at && palettesClash(brief.palette, other.brief.palette)) problems.push(`${at}: palette "${brief.palette}" repeats ${other.id}'s "${other.brief.palette}"; the cast must be told apart by wardrobe at phone size`)
  }
  return problems
}

/** The designer's whole reply: one valid brief per character to cast, palettes distinct from each other and the existing cast. */
export function checkCastingBriefs(reply: { characters?: Array<{ id: string; brief: CastingBrief }> }, characters: Array<Pick<Character, 'id'>>, existing: Array<{ id: string; brief: CastingBrief }> = []): string[] {
  const list = Array.isArray(reply?.characters) ? reply.characters : []
  const problems: string[] = []
  for (const character of characters) {
    const mine = list.filter((c) => c?.id === character.id)
    if (mine.length !== 1) { problems.push(`exactly one brief for "${character.id}", got ${mine.length}`); continue }
    const others = [...existing, ...list.filter((c) => c?.id !== character.id && c?.brief && typeof c.brief.palette === 'string')]
    problems.push(...checkCastingBrief(mine[0]!.brief, character, others))
  }
  for (const c of list) if (!characters.some((ch) => ch.id === c?.id)) problems.push(`"${c?.id}" is not a character to cast`)
  return problems
}

/** The age in words for a prompt ("in her late twenties"); eighteen and nineteen read as early twenties, never younger. */
export function ageWords(age: number, gender: Character['gender']): string {
  const pronoun = gender === 'female' ? 'her' : 'his'
  const decade = Math.max(2, Math.floor(age / 10))
  const names = ['', '', 'twenties', 'thirties', 'forties', 'fifties', 'sixties', 'seventies', 'eighties', 'nineties']
  const part = age < 20 ? 'early' : age % 10 <= 3 ? 'early' : age % 10 <= 6 ? 'mid' : 'late'
  return `in ${pronoun} ${part} ${names[Math.min(decade, 9)]}`
}

const firstName = (character: Pick<Character, 'name' | 'id'>) => character.name?.split('/')[0]?.trim() || character.id

/**
 * How a real casting office photographs someone: plain wall, window light from one side, an honest exposure and no
 * retouching. Studio beauty light on a seamless backdrop made the image model produce the airbrushed, symmetrical, glassy-
 * eyed face the gate rejects as AI; a bare audition snapshot swung too far, real but without a lead's presence. This is an
 * agency headshot: natural light and real skin, groomed and photogenic, as a casting director would want a lead.
 */
const PHOTO = 'An agency headshot of a working television actor, taken in natural light: plain off-white wall behind, soft diffused daylight from a large window, flattering but honest, a gentle shadow on the far cheek, true-to-life colour. Photogenic and believable, with the quiet presence of a series lead: groomed hair with a few natural flyaways, light natural makeup suited to the character, healthy skin that still shows real pores and texture, a face with natural asymmetry, clear eyes with natural moisture rather than gloss. Not retouched, no beauty filter. A real actor photographed, not a render. No text, captions or logos.'
/** What the image model drifts into on a face; read by the full-quality graph (CFG above one). */
export const CASTING_NEGATIVE = `${'beauty filter, airbrushed skin, smooth plastic skin, porcelain skin, waxy skin, doll-like face, uncanny glossy eyes, CGI, 3D render, digital painting, illustration, anime, oversaturated, HDR'}，低分辨率，低画质，肢体畸形，蜡像感，人脸无细节，过度光滑，磨皮，画面具有AI感`

/** The casting-call prompt: the brief in a casting director's order, posed as the master (front three-quarter). */
export function castingPrompt(character: Character, brief: CastingBrief): string {
  // The image model ages a face given only a decade: under thirty the youth is stated outright.
  const young = character.age < 30 ? 'young ' : ''
  const who = `a ${young}${brief.ethnicity} ${character.gender === 'female' ? 'woman' : 'man'} ${ageWords(character.age, character.gender)}${character.age < 30 ? ', youthful and fresh-faced' : ''}${character.age <= 35 ? ', no older-looking than that: smooth forehead, firm jawline, bright eyes, no deep lines' : ''}`
  // Leads are cast for presence, as a casting director casts a series lead; supporting roles for character.
  const appeal = /lead|love interest|protagonist|heroine|hero\b|主角|女主|男主/i.test(character.role)
    ? 'Cast as the lead of a top streaming series: a striking, photogenic leading face with clear healthy skin, defined features and bright expressive eyes, rested and camera-ready, the kind of face an audience follows for a whole season, looking exactly their age'
    : 'Cast for character: believable and specific, looking exactly their age'
  return `Casting photograph of ${who}. ${appeal}. Face: ${brief.face}. Features: ${brief.features}. Skin: ${brief.skin}. Hair: ${brief.hair}. Build: ${brief.build}. Distinctive detail: ${brief.distinctive}. Wearing ${brief.wardrobe}, in ${brief.palette}. Head and shoulders, front three-quarter view, face turned slightly off camera, eyes toward the lens side, neutral relaxed expression, mouth closed. ${PHOTO}`
}

/** The edit prompt of a reference view, from the master as image 1. */
export function viewPrompt(view: PackView, character: Character): string {
  const name = firstName(character)
  const keep = `Image 1 is ${name}. The same person: keep the face, eyes, nose, mouth, hairline, hair, skin tone and every distinguishing mark exactly as in image 1.`
  const pose = view === 'profile'
    ? `Show ${name} in left profile, head and shoulders, the face turned fully to frame left, neutral expression, mouth closed, the same wardrobe at the collar.`
    : `Show ${name} full length from the top of the head to the feet, standing naturally with arms relaxed, front three-quarter, wearing ${character.wardrobe}, with shoes that suit the outfit, both feet on the floor.`
  return `${keep} ${pose} The same neutral mid-grey seamless backdrop and soft key light from camera left. ${PHOTO}`
}

/**
 * Which view of a character a shot needs: a wide or full-length shot the full-body view, a profile shot the profile,
 * every closer framing (close-up, medium, over-the-shoulder) the master portrait.
 */
export function viewForShot(shot: Pick<NarrativeShot, 'framing' | 'image_prompt'>): ReferenceView {
  const framing = (shot.framing ?? '').toLowerCase()
  const prompt = (shot.image_prompt ?? '').toLowerCase()
  if (/\b(wide|full|long|establishing)\b/.test(framing) || /\b(full[- ]length|full[- ]body|head to (toe|feet)|walks?|walking|strides?|striding)\b/.test(prompt)) return 'full-body'
  if (/\bprofile\b/.test(framing) || /\b(in profile|side[- ]on|side view|profile view)\b/.test(prompt)) return 'profile'
  return 'master'
}

export interface SelectedReference { id: string; view: ReferenceView; path: string }

/**
 * The references of one shot, at most `max` across everyone in frame: each character's view for the shot (the master
 * when that view was not made), in the shot's order; spare slots then take the master of a character whose first
 * reference was another view, so a small face in a wide still has its portrait.
 */
export function selectReferences(shot: Pick<NarrativeShot, 'characters' | 'framing' | 'image_prompt'>, cast: Map<string, Pick<CastMember, 'views'>>, max = 3): SelectedReference[] {
  const wanted = viewForShot(shot)
  const present = [...new Set(shot.characters ?? [])].filter((id) => cast.has(id))
  const chosen: SelectedReference[] = []
  for (const id of present.slice(0, max)) {
    const views = cast.get(id)!.views
    const view: ReferenceView = views[wanted] ? wanted : 'master'
    chosen.push({ id, view, path: views[view]! })
  }
  for (const first of [...chosen]) {
    if (chosen.length >= max) break
    if (first.view !== 'master') chosen.push({ id: first.id, view: 'master', path: cast.get(first.id)!.views.master })
  }
  return chosen
}

/** What each reference image is, in the order they are passed: "Image 1 is Mia full length: ...". */
export function referencePrompt(selection: SelectedReference[], characters: Character[]): string {
  const described = new Set<string>()
  return selection.map((ref, i) => {
    const character = characters.find((c) => c.id === ref.id)
    const name = character ? firstName(character) : ref.id
    const what = ref.view === 'master' ? `${name}'s face` : ref.view === 'profile' ? `${name} in profile` : `${name} full length`
    const keep = ref.view === 'full-body' ? 'keep the face, hair, build and wardrobe exactly' : 'keep the face, hair and skin exactly'
    const wardrobe = character && !described.has(ref.id) ? `; wearing ${character.wardrobe}` : ''
    described.add(ref.id)
    return `Image ${i + 1} is ${what}: the same person - ${keep}${wardrobe}.`
  }).join(' ')
}

const rank = (v: CastingVerdict) => [v.pass ? 1 : 0, v.score, v.casting ? v.casting.realism + v.casting.brief + v.casting.distinct : 0]

/** The candidate the casting director keeps: a pass over a reject, then the gate's score, then the casting ratings. */
export function pickCandidate<T extends { verdict: CastingVerdict }>(candidates: T[]): T | undefined {
  return [...candidates].sort((a, b) => {
    const x = rank(a.verdict)
    const y = rank(b.verdict)
    return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!
  })[0]
}

/**
 * The record of a character already cast in `dir` (cast/<id>/), or why it cannot be reused: it must be this
 * character (same id and gender) and its master portrait must exist. Views whose files are missing are left out.
 */
export async function loadCastMember(dir: string, character: Pick<Character, 'id' | 'gender'>): Promise<CastMember | { reason: string }> {
  const file = join(dir, 'character.json')
  if (!existsSync(file)) return { reason: 'not cast yet' }
  let record: CharacterRecord
  try { record = JSON.parse(await readFile(file, 'utf8')) as CharacterRecord } catch { return { reason: `${file} is not valid JSON` } }
  if (record?.version !== 1) return { reason: `unknown record version ${String(record?.version)}` }
  if (record.id !== character.id) return { reason: `record is for "${record.id}", not "${character.id}"` }
  if (record.gender !== character.gender) return { reason: `record is ${record.gender}, the bible says ${character.gender}` }
  const master = record.images?.master?.path ? join(dir, record.images.master.path) : ''
  if (!master || !existsSync(master)) return { reason: 'master portrait is missing' }
  const views: CastMember['views'] = { master }
  for (const view of PACK_VIEWS) {
    const path = record.images[view]?.path ? join(dir, record.images[view]!.path) : ''
    if (path && existsSync(path)) views[view] = path
  }
  return { id: record.id, dir, record, views }
}

/** The cast record overrides the bible's look and wardrobe: the person on screen is the one cast, episode after episode. */
export function applyRecord(character: Character, record: CharacterRecord): Character {
  return { ...character, look: record.look, wardrobe: record.wardrobe }
}

export async function saveCharacterRecord(member: Pick<CastMember, 'dir' | 'record'>): Promise<void> {
  await mkdir(member.dir, { recursive: true })
  await writeFile(join(member.dir, 'character.json'), `${JSON.stringify(member.record, null, 2)}\n`)
}

const image = (path: string, verdict: CastingVerdict, model: string): CastImage => ({
  path, score: verdict.score, pass: verdict.pass, model, ...(verdict.issues.length ? { issues: verdict.issues.slice(0, 5) } : {}), ...(verdict.casting ? { casting: verdict.casting } : {}),
})

/** Where a character's cast record may come from, after the project's own: `--cast <dir>`, then the brand kit's cast/. */
export function castSources(options: Pick<NarrativeContext['options'], 'castDir'>, brand?: { dir: string }): string[] {
  return [...(options.castDir ? [resolve(options.castDir)] : []), ...(brand ? [join(brand.dir, 'cast')] : [])]
}

/**
 * Reuse: the project's own cast/<id>/ first, then `--cast <dir>`, then the brand kit's recurring presenters and mascots
 * (copied in so the project stays self-contained).
 */
async function reuse(ctx: NarrativeContext, character: Character): Promise<CastMember | undefined> {
  const own = join(ctx.dir!, 'cast', character.id)
  const found = await loadCastMember(own, character)
  if ('record' in found) return found
  for (const root of castSources(ctx.options, ctx.brand)) {
    const source = join(root, character.id)
    if (source !== own && existsSync(source)) {
      const other = await loadCastMember(source, character)
      if ('record' in other) {
        await cp(source, own, { recursive: true })
        const copied = await loadCastMember(own, character)
        if ('record' in copied) return copied
      } else ctx.log(`  cast ${character.id}: ${source} not reused (${other.reason})`)
    }
  }
  if (found.reason !== 'not cast yet') ctx.log(`  cast ${character.id}: ${own} not reused (${found.reason})`)
  return undefined
}

/** The character designer's casting briefs for the characters not cast yet. */
async function designBriefs(ctx: NarrativeContext, toCast: Character[], existing: CastMember[]): Promise<Map<string, CastingBrief>> {
  const bible = ctx.bible!
  const existingBriefs = existing.map((m) => ({ id: m.id, brief: m.record.brief }))
  const run = await chatJson<{ characters: Array<{ id: string; brief: CastingBrief }> }>(
    ctx.author,
    {
      system: await ctx.agentPrompt('character designer and casting director', 'character-and-continuity'),
      thinking: false,
      maxTokens: 4000,
      temperature: 0.6,
      user: `World: ${bible.world}
Visual treatment: ${bible.look}
Characters to cast:
${JSON.stringify(toCast.map(({ id, name, role, age, gender, look, wardrobe }) => ({ id, name, role, age, gender, look, wardrobe })), null, 2)}
${existingBriefs.length ? `Already cast, keep the new cast clearly distinct from them:\n${JSON.stringify(existingBriefs, null, 2)}\n` : ''}
Write a casting brief per character, as a casting director briefs a casting call. English picture words only, no digits.
- face: face shape, brow, cheekbones, jaw, chin. features: eyes (shape, colour, spacing), nose, mouth, ears if notable.
- ethnicity: consistent with the world and the character's name and family.
- skin: tone and texture (freckles, pores, laugh lines as fits the age). hair: length, parting (which side), texture, colour.
- build: height impression, frame, posture. distinctive: one detail of the face, hair, ears or neck that identifies them, with its side ("a small scar through the left eyebrow") - it must show in a head-and-shoulders photograph.
- wardrobe: the default costume, garment by garment, fabric and fit; palette: two or three named colours that no other character wears.
Cast the face, not a mood: tiredness, a slump or dark circles are acted in a scene, never written into the brief. Leads of a commercial series are cast as a top studio casts them: striking, clear-skinned faces with defined features and bright, expressive eyes that hold a close-up, looking their age and no older.
Adults only. A designed face: never a real person, a celebrity or "someone who looks like" anyone. No words of worth (beautiful, handsome). Different hair length or colour value, silhouette and palette for every character, so each reads apart at phone size.
Return JSON only: {"characters": [{"id": "mia", "brief": {"face": "...", "features": "...", "ethnicity": "...", "skin": "...", "hair": "...", "build": "...", "distinctive": "...", "wardrobe": "...", "palette": "..."}}]}`,
    },
    (value) => checkCastingBriefs(value, toCast, existingBriefs),
    4,
  )
  failIfHardProblems('casting briefs', checkCastingBriefs(run.value, toCast, existingBriefs), run.attempts)
  await ctx.record('casting', 'character-designer', ctx.author, { seconds: run.seconds, attempts: run.attempts, characters: toCast.map((c) => c.id) })
  return new Map(run.value.characters.map((c) => [c.id, c.brief]))
}

/**
 * The picture side of casting: reuse every recorded character, brief and cast the rest, edit and gate their reference
 * packs, and write cast/<id>/character.json (the voice is added by the casting stage). Fills `ctx.cast` and `ctx.sheets`.
 */
export async function castPictures(ctx: NarrativeContext, beforePictures: () => Promise<void> = async () => {}): Promise<{ reused: string[]; cast: string[] }> {
  const bible = ctx.bible!
  const dir = ctx.dir!
  const reused: string[] = []
  const toCast: Character[] = []
  for (const [index, character] of bible.characters.entries()) {
    const member = await reuse(ctx, character)
    if (!member) { toCast.push(character); continue }
    bible.characters[index] = applyRecord(character, member.record)
    ctx.cast.set(character.id, member)
    ctx.sheets.set(character.id, member.views.master)
    reused.push(character.id)
    ctx.log(`▸ cast ${character.id.padEnd(10)} reused from ${member.dir} (master gate ${member.record.images.master.score})`)
    await ctx.record('casting', 'reuse', undefined, { character: character.id, from: member.dir, views: Object.keys(member.views) })
  }
  // The casting briefs are written in the writers' room, which closes (beforePictures) before the first picture is made.
  if (!toCast.length) { await beforePictures(); return { reused, cast: [] } }

  const briefs = await designBriefs(ctx, toCast, [...ctx.cast.values()])
  await beforePictures()
  const comfy = (ctx.comfy ??= new ComfyClient())
  await ctx.rest('casting (Qwen-Image-2512)', [ctx.planner])
  await enterPhase(comfy, 'casting (Qwen-Image-2512)', ctx.record)
  const masters = new Map<string, { brief: CastingBrief; master: string; chosen: CastImage; candidates: CastImage[] }>()
  for (const character of toCast) {
    const brief = briefs.get(character.id)!
    const home = join(dir, 'cast', character.id)
    await mkdir(join(home, 'candidates'), { recursive: true })
    const others = bible.characters.filter((c) => c.id !== character.id && ctx.sheets.has(c.id)).map((c) => ({ character: c, master: ctx.sheets.get(c.id)! }))
    const candidates: Array<{ path: string; verdict: CastingVerdict }> = []
    let prompt = castingPrompt(character, brief)
    for (let round = 0; round < CASTING_ROUNDS && !candidates.some((c) => c.verdict.pass); round++) {
      for (let n = 0; n < CASTING_CALL; n++) {
        const path = join(home, 'candidates', `c${round * CASTING_CALL + n + 1}.png`)
        const made = await generateImage(comfy, { size: VIEW_SIZES.master, output: path, prompt, model: NARRATIVE_IMAGE_MODEL, negative: CASTING_NEGATIVE })
        const verdict = await sheetGate(ctx.reviewer, path, character, { brief, others })
        ctx.log(`▸ cast ${character.id.padEnd(10)} candidate ${round * CASTING_CALL + n + 1} ${made.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
        await ctx.record('casting', 'casting-gate', ctx.reviewer, { character: character.id, candidate: round * CASTING_CALL + n + 1, imageSeconds: made.seconds, ...verdict })
        candidates.push({ path, verdict })
      }
      // A second call carries the gate's own words: four more seeds alone repeat a systematic fault.
      const issues = [...new Set(candidates.flatMap((c) => c.verdict.issues))].slice(0, 3)
      if (issues.length) prompt = `${castingPrompt(character, brief)} Avoid: ${issues.join('; ')}.`
    }
    const best = pickCandidate(candidates)!
    const master = join(home, 'master.png')
    await copyFile(best.path, master)
    const chosen = image('master.png', best.verdict, NARRATIVE_IMAGE_MODEL)
    if (!best.verdict.pass) ctx.log(`  open item: ${character.id} kept the best of ${candidates.length} candidates without a pass (gate ${best.verdict.score})`)
    masters.set(character.id, { brief, master, chosen, candidates: candidates.map((c) => image(c.path.slice(home.length + 1), c.verdict, NARRATIVE_IMAGE_MODEL)) })
    ctx.sheets.set(character.id, master)
    await addAsset(ctx.projectId!, { id: `cast-${character.id}`, kind: 'image', stage: 'casting', path: `cast/${character.id}/master.png`, execution: 'local-dgx-spark', model: 'qwen_image_2512', note: `gate ${best.verdict.score}${best.verdict.pass ? '' : ` (best of ${candidates.length}, not passed)`}` })
  }

  // One diffusion family in memory at a time: the edit model loads only after the text-to-image model is released.
  await enterPhase(comfy, 'reference pack (Qwen-Image-Edit-2511)', ctx.record)
  for (const character of toCast) {
    const { brief, master, chosen, candidates } = masters.get(character.id)!
    const home = join(dir, 'cast', character.id)
    const record: CharacterRecord = {
      version: 1, id: character.id, name: character.name, gender: character.gender, age: character.age, look: character.look, wardrobe: character.wardrobe,
      brief, voice: { description: character.voice }, images: { master: chosen }, candidates, castAt: new Date().toISOString(),
    }
    const views: CastMember['views'] = { master }
    for (const view of PACK_VIEWS) {
      let best: { path: string; verdict: CastingVerdict } | undefined
      for (let attempt = 0; attempt < PACK_ATTEMPTS && !best?.verdict.pass; attempt++) {
        const path = join(home, `${view}${attempt ? `_r${attempt}` : ''}.png`)
        const made = await generateImage(comfy, { size: VIEW_SIZES[view], output: path, prompt: viewPrompt(view, character), references: [master], editModel: NARRATIVE_EDIT_MODEL })
        const verdict = await identityGate(ctx.reviewer, path, master, character, view)
        ctx.log(`▸ pack ${character.id.padEnd(10)} ${view}${attempt ? `_r${attempt}` : ''} ${made.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
        await ctx.record('casting', 'identity-gate', ctx.reviewer, { character: character.id, view, attempt, imageSeconds: made.seconds, ...verdict })
        if (!best || verdict.score > best.verdict.score) best = { path, verdict }
      }
      // A view that never matched the master is not used: frames fall back to the master rather than to a cousin.
      if (best!.verdict.pass) {
        const final = join(home, `${view}.png`)
        if (best!.path !== final) await copyFile(best!.path, final)
        views[view] = final
        record.images[view] = image(`${view}.png`, best!.verdict, NARRATIVE_EDIT_MODEL)
        await addAsset(ctx.projectId!, { id: `cast-${character.id}-${view}`, kind: 'image', stage: 'casting', path: `cast/${character.id}/${view}.png`, execution: 'local-dgx-spark', model: 'qwen_image_edit_2511_lightning', note: `identity gate ${best!.verdict.score}` })
      } else ctx.log(`  open item: ${character.id} has no ${view} view that matches the master (best ${best!.verdict.score}); frames use the master`)
    }
    const member: CastMember = { id: character.id, dir: home, record, views }
    await saveCharacterRecord(member)
    ctx.cast.set(character.id, member)
  }
  await comfy.free()
  return { reused, cast: toCast.map((c) => c.id) }
}
