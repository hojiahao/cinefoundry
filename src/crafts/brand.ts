import { env } from '../lib/config.js'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { CATEGORIES, scanBrandWords, scanCopy, type Category } from '../lib/compliance.js'
import { exec } from '../lib/exec.js'
import { GRADES } from '../lib/ffmpeg.js'
import { endCardLayout, type LogoSpec } from '../lib/titles.js'
import { castableVoices, loadVoiceLibrary } from '../lib/voices.js'
import { INDUSTRIES, type Brief, type BrandBrief, type Industry } from '../agent/checks.js'
import type { Treatment } from './treatment.js'
import { loadCastMember, type CastMember } from './narrative/casting.js'
import type { Character, NarrativeShot, SeriesBible } from './narrative/types.js'

/**
 * Brand kits: everything that makes a film on-brand, decided once by the brand manager and applied by code in every
 * format, so an agency, a brand, an MCN or a seller never re-briefs it. A kit is a folder brands/<brand-id>/ (root:
 * CINEFOUNDRY_BRANDS) with a brand.json and the files it names: logos, product photos, presenter cast records, designed
 * voices. `checkBrandKit` validates all of it; a film made with `--brand` is refused when the check fails, and records
 * the kit's content hash in run.jsonl.
 */

export interface BrandColour {
  /** English colour words only: the name is pasted into image prompts, where a hex code would be painted as digits. */
  name: string
  hex: string
  role: 'primary' | 'secondary' | 'accent'
}

export interface BrandLogo {
  /** Relative to the kit folder: an SVG master or a PNG with transparency. The end card composites a PNG. */
  file: string
  /** Clear space on every side, as a fraction of the logo's height. */
  clearSpace: number
  /** Minimum width on a 1080-line frame, scaled with the frame. */
  minWidthPx: number
  /** What the artwork is for, e.g. "primary", "reversed for dark backgrounds". */
  use?: string
}

export interface BrandProduct {
  id: string
  /** The product's name as the brand writes it. */
  name: string
  /** What it looks like, in words (container, material, colours, label): the brief's `appearance`. */
  appearance: string
  /** Reference photos, relative to the kit folder. The first is the hero still every ad frame is anchored to. */
  photos: string[]
  category?: Category
  industry?: Industry
}

export interface GradeParams {
  /** 0.8-1.3 */
  contrast: number
  /** 0.6-1.4 */
  saturation: number
  /** 0.8-1.25 */
  gamma: number
  /** -0.1 (cool) to 0.1 (warm) */
  warmth: number
}

export interface BrandKit {
  version: 1
  id: string
  /** The brand's name. */
  name: string
  /** The lettering exactly as printed on the product: the gate reads it off every frame. */
  lettering: string
  logos: BrandLogo[]
  products: BrandProduct[]
  palette: BrandColour[]
  typography: { title: { family: string }; subtitle: { family: string } }
  tone: { do: string[]; dont: string[]; samples: { en: string[]; zh: string[] } }
  claims: Array<{ claim: string; proof: string; source: string }>
  forbidden: { words: string[]; topics: string[] }
  legal: string[]
  /** Score direction for the music model (English, no artist names). */
  music: string
  look: { light: string; texture: string; grade: string | GradeParams }
  /** The announcer: a casting-library id (deploy/voices/library.json) that passed voice QC. */
  announcer: string
  /** Recurring presenters or mascots: character ids with a cast record in cast/<id>/character.json. */
  presenters?: string[]
  /** Voices designed for the brand's characters, kept in the kit: a character with this id speaks with it. */
  voices?: Array<{ id: string; description: string; wav: string; text: string }>
  platforms: { handles: Record<string, string>; hashtags: string[] }
}

/** A kit as the pipelines use it: checked, with its folder and content hash. */
export interface LoadedBrand {
  id: string
  dir: string
  version: string
  kit: BrandKit
}

/** What the check needs from the machine; tests inject their own. */
export interface BrandEnv {
  /** Font families fontconfig knows (fc-list). */
  fontFamilies: () => Promise<string[]>
  /** Casting-library voices that passed voice QC on this machine. */
  castableVoiceIds: () => string[]
  /** The whole casting library, to tell "unknown id" from "not an announcer". */
  libraryVoices: () => Array<{ id: string; language: string; uses: string[] }>
}

export const brandsRoot = () => resolve(env('CINEFOUNDRY_BRANDS') ?? 'brands')
export const brandDir = (id: string) => join(brandsRoot(), id)

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/
const HEX = /^#[0-9A-Fa-f]{6}$/
const CJK = /[㐀-鿿]/
const DIGIT = /\d/
const BANNED_REFERENCES = /\b(in the style of|like (the|a) (film|movie|ad|commercial) by|by (wes anderson|christopher nolan|ridley scott))\b/i
/** Hashtags a platform takes alongside the film's own: more than five crowd the film's. */
export const MAX_BRAND_HASHTAGS = 5
const GRADE_RANGES: Record<keyof GradeParams, [number, number]> = { contrast: [0.8, 1.3], saturation: [0.6, 1.4], gamma: [0.8, 1.25], warmth: [-0.1, 0.1] }

export async function systemFontFamilies(): Promise<string[]> {
  const { stdout } = await exec('fc-list', [':', 'family'], { allowFailure: true })
  return [...new Set(stdout.split('\n').flatMap((line) => line.split(',')).map((family) => family.trim()).filter(Boolean))]
}

export const defaultBrandEnv = (): BrandEnv => ({
  fontFamilies: systemFontFamilies,
  castableVoiceIds: () => castableVoices().map((voice) => voice.id),
  libraryVoices: () => { try { return loadVoiceLibrary().voices } catch { return [] } },
})

/** Width and height of a PNG from its header, or undefined when the file is not a PNG. */
export function pngSize(bytes: Buffer): { width: number; height: number } | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

/** Width over height of an SVG from its viewBox (or width and height), or undefined when it is not a readable SVG. */
export function svgAspect(text: string): number | undefined {
  if (!/<svg[\s>]/i.test(text)) return undefined
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(text)
  const size = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)(?:px)?["'][^>]*\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(text)
  const [w, h] = (box ?? size)?.slice(1).map(Number) ?? []
  return w && h ? w / h : undefined
}

const isJpeg = (bytes: Buffer) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

/** Inside the kit folder: a kit never reaches into other folders, so it can be copied whole to another machine. */
function kitPath(dir: string, file: string): string | undefined {
  if (typeof file !== 'string' || !file.trim() || isAbsolute(file)) return undefined
  const path = resolve(dir, file)
  return relative(dir, path).startsWith('..') ? undefined : path
}

const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : [])
const words = (list: unknown) => Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string' && !!item.trim()) : []

/** Width of the logo on the 1080p master's end card: a PNG narrower than this would be upscaled on screen. */
export function endCardLogoWidth(logo: LogoSpec): number {
  return endCardLayout(1920, 1080, 0, logo).logo!.width
}

/**
 * Every rule of a kit that needs no file and no machine: names, lettering, palette, tone, claims, wording, look, platforms.
 * The brand-manager agent's draft is held to these before it is written.
 */
export function checkBrandFields(kit: BrandKit): string[] {
  const problems: string[] = []
  if (kit.version !== 1) problems.push('version must be 1')
  if (!SLUG.test(kit.id ?? '')) problems.push('id must be lowercase letters, digits and dashes')
  if (!kit.name?.trim()) problems.push('name is empty: the brand name as the brand writes it')
  const lettering = kit.lettering?.trim() ?? ''
  if (!lettering) problems.push('lettering is empty: copy the lettering printed on the product')
  else if (CJK.test(lettering) ? [...lettering].length > 4 : lettering.length > 12) problems.push(`lettering "${lettering}" is too long: at most 4 Chinese characters or 12 Latin letters, exactly as printed on the product (the gate reads it off every frame)`)

  if (!Array.isArray(kit.logos) || kit.logos.length === 0) problems.push('logos: at least one logo file')
  for (const [index, logo] of (Array.isArray(kit.logos) ? kit.logos : []).entries()) {
    const at = `logos[${index}]`
    if (!['.svg', '.png'].includes(extname(logo?.file ?? '').toLowerCase())) problems.push(`${at}: the file must be an SVG or a PNG (${logo?.file ?? 'none'})`)
    if (!(typeof logo?.clearSpace === 'number' && logo.clearSpace > 0 && logo.clearSpace <= 2)) problems.push(`${at}: clearSpace is the clear space on every side as a fraction of the logo's height, above 0 and at most 2`)
    if (!(Number.isInteger(logo?.minWidthPx) && logo.minWidthPx >= 24 && logo.minWidthPx <= 1080)) problems.push(`${at}: minWidthPx is the minimum width on a 1080-line frame, a whole number from 24 to 1080`)
  }

  const products = Array.isArray(kit.products) ? kit.products : []
  if (!products.length) problems.push('products: at least one product')
  const productIds = new Set<string>()
  for (const [index, product] of products.entries()) {
    const at = `products[${index}]`
    if (!SLUG.test(product?.id ?? '')) problems.push(`${at}: id must be lowercase letters, digits and dashes`)
    if (productIds.has(product?.id)) problems.push(`${at}: id "${product.id}" is used twice`)
    productIds.add(product?.id)
    if (!product?.name?.trim()) problems.push(`${at}: name is empty`)
    if (!product?.appearance?.trim()) problems.push(`${at}: appearance is empty: what the product looks like (container, material, colours, label)`)
    if (!Array.isArray(product?.photos) || product.photos.length === 0) problems.push(`${at}: at least one reference photo (the first is the hero still every frame is anchored to)`)
    if (product?.category !== undefined && !CATEGORIES.includes(product.category)) problems.push(`${at}: category must be one of ${CATEGORIES.join(', ')}`)
    if (product?.industry !== undefined && !INDUSTRIES.includes(product.industry)) problems.push(`${at}: industry must be one of ${INDUSTRIES.join(', ')}`)
  }

  const palette = Array.isArray(kit.palette) ? kit.palette : []
  for (const [index, colour] of palette.entries()) {
    const at = `palette[${index}]`
    if (!HEX.test(colour?.hex ?? '')) problems.push(`${at}: hex "${colour?.hex}" must be #RRGGBB`)
    if (!colour?.name?.trim()) problems.push(`${at}: name is empty`)
    else if (DIGIT.test(colour.name) || CJK.test(colour.name)) problems.push(`${at}: name "${colour.name}" must be English colour words only (it is pasted into image prompts, where digits are painted)`)
    if (!['primary', 'secondary', 'accent'].includes(colour?.role)) problems.push(`${at}: role must be primary, secondary or accent`)
  }
  for (const role of ['primary', 'secondary', 'accent'] as const) if (!palette.some((colour) => colour?.role === role)) problems.push(`palette: needs a ${role} colour`)

  for (const key of ['title', 'subtitle'] as const) if (!kit.typography?.[key]?.family?.trim()) problems.push(`typography.${key}.family is empty`)

  const tone = kit.tone
  if (!words(tone?.do).length) problems.push('tone.do: at least one thing the brand voice does')
  if (!words(tone?.dont).length) problems.push("tone.dont: at least one thing the brand voice never does")
  const en = words(tone?.samples?.en)
  const zh = words(tone?.samples?.zh)
  if (!en.length) problems.push('tone.samples.en: at least one sample line in English')
  if (!zh.length) problems.push('tone.samples.zh: at least one sample line in Chinese')
  for (const line of en) if (CJK.test(line)) problems.push(`tone.samples.en: "${line}" must be English`)
  for (const line of zh) if (!CJK.test(line)) problems.push(`tone.samples.zh: "${line}" must be Chinese`)
  // The samples are copy the writers imitate: they are held to the law and to the kit's own forbidden words.
  const forbiddenWords = words(kit.forbidden?.words)
  for (const line of [...en, ...zh]) {
    for (const finding of scanCopy(line, 'general').filter((f) => f.severity === 'block')) problems.push(`tone sample "${line}": restricted wording "${finding.text}" (${finding.rule})`)
    for (const finding of scanBrandWords(line, forbiddenWords, kit.name ?? kit.id)) problems.push(`tone sample "${line}" uses the kit's forbidden word "${finding.text}"`)
  }

  for (const [index, claim] of (Array.isArray(kit.claims) ? kit.claims : []).entries()) {
    const at = `claims[${index}]`
    for (const key of ['claim', 'proof', 'source'] as const) if (!claim?.[key]?.trim()) problems.push(`${at}: ${key} is empty: a claim is substantiated by its proof and the source that holds it`)
    // Substantiation does not make an absolute term legal (广告法 第九条): "最好" is restricted whatever the data.
    for (const finding of scanCopy(claim?.claim ?? '', 'general').filter((f) => f.severity === 'block')) problems.push(`${at}: "${claim.claim}" uses restricted wording "${finding.text}" (${finding.rule}); no proof makes it usable`)
  }
  if (!Array.isArray(kit.claims)) problems.push('claims must be a list (empty when the brand substantiates none)')

  if (!Array.isArray(kit.forbidden?.words) || !Array.isArray(kit.forbidden?.topics)) problems.push('forbidden.words and forbidden.topics must be lists')
  if (!Array.isArray(kit.legal)) problems.push('legal must be a list of mandatory lines (empty when there are none)')
  else {
    if (kit.legal.length > 3) problems.push('legal: at most three lines fit the foot of an end card')
    for (const line of kit.legal) if (typeof line !== 'string' || !line.trim() || [...line].length > 40) problems.push(`legal line "${line}": 1 to 40 characters, set on one line of the end card`)
  }

  if (!kit.music?.trim()) problems.push('music is empty: genre, instrumentation, tempo, mood, how it ends')
  else {
    if (CJK.test(kit.music)) problems.push('music must be in English: it prompts the music model')
    if (BANNED_REFERENCES.test(kit.music)) problems.push('music: no named artists or films; describe the qualities')
  }
  for (const key of ['light', 'texture'] as const) {
    const value = kit.look?.[key]
    if (!value?.trim()) problems.push(`look.${key} is empty`)
    else if (DIGIT.test(value) || CJK.test(value)) problems.push(`look.${key} must be English words only, no numbers (it is pasted into image prompts)`)
  }
  const grade = kit.look?.grade
  if (typeof grade === 'string') { if (!(grade in GRADES)) problems.push(`look.grade "${grade}" is not a grade: use one of ${Object.keys(GRADES).join(', ')}, or grade parameters`) }
  else if (grade && typeof grade === 'object') {
    for (const [key, [low, high]] of Object.entries(GRADE_RANGES) as Array<[keyof GradeParams, [number, number]]>) if (!(typeof grade[key] === 'number' && grade[key] >= low && grade[key] <= high)) problems.push(`look.grade.${key} must be a number from ${low} to ${high}`)
  } else problems.push('look.grade: an existing grade name or grade parameters {contrast, saturation, gamma, warmth}')

  if (!kit.announcer?.trim()) problems.push('announcer is empty: a casting-library voice id')

  const handles = kit.platforms?.handles
  if (!handles || typeof handles !== 'object' || Array.isArray(handles)) problems.push('platforms.handles: an object of platform -> handle')
  else for (const [platform, handle] of Object.entries(handles)) if (typeof handle !== 'string' || !handle.trim() || /\s/.test(handle)) problems.push(`platforms.handles.${platform}: a handle without spaces`)
  const hashtags = kit.platforms?.hashtags
  if (!Array.isArray(hashtags)) problems.push('platforms.hashtags must be a list')
  else {
    if (hashtags.length > MAX_BRAND_HASHTAGS) problems.push(`platforms.hashtags: at most ${MAX_BRAND_HASHTAGS}, so the film's own still fit`)
    for (const tag of hashtags) if (typeof tag !== 'string' || !/^#[^\s#]{1,30}$/.test(tag)) problems.push(`platforms.hashtags: "${tag}" must be one # followed by up to 30 characters, no spaces`)
  }
  if (kit.presenters !== undefined && (!Array.isArray(kit.presenters) || kit.presenters.some((id) => !/^[a-z][a-z0-9-]{0,23}$/.test(id)))) problems.push('presenters: a list of character ids (lowercase letters, digits and dashes)')
  return problems
}

/** Every rule that needs the kit's files or the machine: files exist and are readable, fonts installed, voices passed QC, cast records load. */
export async function checkBrandAssets(kit: BrandKit, dir: string, env: BrandEnv): Promise<string[]> {
  const problems: string[] = []
  const file = async (label: string, name: string): Promise<Buffer | undefined> => {
    const path = kitPath(dir, name)
    if (!path) { problems.push(`${label}: "${name}" must be a path inside the kit folder`); return undefined }
    if (!existsSync(path)) { problems.push(`${label}: ${name} does not exist in ${dir}`); return undefined }
    return readFile(path)
  }
  let pngs = 0
  for (const [index, logo] of list(kit.logos).entries()) {
    const bytes = await file(`logos[${index}]`, logo.file)
    if (!bytes) continue
    if (extname(logo.file).toLowerCase() === '.png') {
      const size = pngSize(bytes)
      if (!size) { problems.push(`logos[${index}]: ${logo.file} is not a readable PNG`); continue }
      pngs++
      const spec = { aspect: size.width / size.height, clearSpace: logo.clearSpace, minWidthPx: logo.minWidthPx }
      const needed = endCardLogoWidth(spec)
      if (size.width < needed) problems.push(`logos[${index}]: ${logo.file} is ${size.width} px wide; the 1080p end card sets it ${needed} px wide, so supply at least that`)
      for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]] as const) for (const problem of endCardLayout(w, h, list(kit.legal).length, spec).problems) problems.push(`logos[${index}]: ${problem}`)
    } else if (!svgAspect(bytes.toString('utf8'))) problems.push(`logos[${index}]: ${logo.file} is not a readable SVG (an <svg> element with a viewBox or width and height)`)
  }
  if (list(kit.logos).length && pngs === 0) problems.push('logos: at least one PNG; the end card composites a PNG (an SVG is kept as the master artwork)')
  for (const [index, product] of list(kit.products).entries()) {
    for (const photo of list(product.photos)) {
      const bytes = await file(`products[${index}].photos`, photo)
      if (bytes && !pngSize(bytes) && !isJpeg(bytes)) problems.push(`products[${index}].photos: ${photo} is not a readable PNG or JPEG`)
    }
  }
  const families = await env.fontFamilies()
  for (const key of ['title', 'subtitle'] as const) {
    const family = kit.typography?.[key]?.family
    if (family && !families.includes(family)) problems.push(`typography.${key}: the font "${family}" is not installed (fc-list)`)
  }
  const castable = new Set(env.castableVoiceIds())
  const library = env.libraryVoices()
  if (kit.announcer) {
    const voice = library.find((v) => v.id === kit.announcer)
    if (!voice) problems.push(`announcer "${kit.announcer}" is not in the casting library (deploy/voices/library.json)`)
    else if (voice.language !== 'English' || !voice.uses.includes('announcer')) problems.push(`announcer "${kit.announcer}" is not an English announcer voice (the announcer reads the English line)`)
    else if (!castable.has(kit.announcer)) problems.push(`announcer "${kit.announcer}" has not passed voice QC on this machine (scripts/voice-qc.py)`)
  }
  for (const [index, voice] of list(kit.voices).entries()) {
    if (!voice?.id?.trim() || !voice.text?.trim() || !voice.description?.trim()) problems.push(`voices[${index}]: id, description and the transcript of the reference clip (text) are required`)
    if (voice?.wav) await file(`voices[${index}]`, voice.wav)
    else problems.push(`voices[${index}]: wav is required`)
  }
  for (const id of list(kit.presenters)) {
    const castDir = join(dir, 'cast', id)
    const raw = await readFile(join(castDir, 'character.json'), 'utf8').then((text) => JSON.parse(text) as { gender?: Character['gender']; age?: number }).catch(() => undefined)
    if (!raw) { problems.push(`presenters: cast/${id}/character.json is missing or not valid JSON`); continue }
    const member = await loadCastMember(castDir, { id, gender: raw.gender ?? 'female' })
    if (!('record' in member)) { problems.push(`presenters: cast/${id} cannot be reused (${member.reason})`); continue }
    if (!(member.record.age >= 18)) problems.push(`presenters: ${id} is ${member.record.age}; presenters and mascots with a human face are adults`)
    const recorded = member.record.voice
    if (recorded?.library && !castable.has(recorded.library)) problems.push(`presenters: ${id}'s voice "${recorded.library}" has not passed voice QC on this machine`)
    if (recorded?.wav && !existsSync(join(castDir, recorded.wav))) problems.push(`presenters: ${id}'s designed voice ${recorded.wav} is missing`)
  }
  return problems
}

/**
 * The kit's version: a content hash of brand.json and every file it names, in a fixed order. Any change to a word, a
 * colour, a logo or a photo gives a new version; run.jsonl records the version a film was made with.
 */
export async function brandKitVersion(kit: BrandKit, dir: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(join(dir, 'brand.json')))
  const files = [...list(kit.logos).map((logo) => logo?.file), ...list(kit.products).flatMap((product) => list(product?.photos)), ...list(kit.voices).map((voice) => voice?.wav)].filter((name): name is string => typeof name === 'string')
  for (const id of list(kit.presenters)) files.push(join('cast', id, 'character.json'))
  for (const name of [...new Set(files)].sort()) {
    const path = kitPath(dir, name)
    hash.update(`\0${name}\0`)
    if (path && existsSync(path)) hash.update(await readFile(path))
  }
  return `sha256:${hash.digest('hex').slice(0, 16)}`
}

export interface BrandCheck {
  id: string
  dir: string
  ok: boolean
  problems: string[]
  version?: string
  kit?: BrandKit
}

/** `cinefoundry brand check`: brand.json parses, every field passes, every file, font and voice it names is there. */
export async function checkBrandKit(id: string, env: BrandEnv = defaultBrandEnv()): Promise<BrandCheck> {
  const dir = brandDir(id)
  if (!SLUG.test(id)) return { id, dir, ok: false, problems: [`brand id "${id}" must be lowercase letters, digits and dashes`] }
  const text = await readFile(join(dir, 'brand.json'), 'utf8').catch(() => undefined)
  if (text === undefined) return { id, dir, ok: false, problems: [`no brand kit at ${dir} (brand.json is missing): run cinefoundry brand init ${id}`] }
  let kit: BrandKit
  try { kit = JSON.parse(text) as BrandKit } catch (error) { return { id, dir, ok: false, problems: [`brand.json is not valid JSON (${(error as Error).message})`] } }
  const problems = checkBrandFields(kit)
  if (kit.id !== id) problems.push(`id "${kit.id}" does not match the folder name "${id}"`)
  problems.push(...await checkBrandAssets(kit, dir, env))
  return { id, dir, ok: problems.length === 0, problems, version: await brandKitVersion(kit, dir), kit }
}

/** The kit a film is made under, or the reason it is refused: every problem the check found. */
export async function loadBrand(id: string, env?: BrandEnv): Promise<LoadedBrand> {
  const check = await checkBrandKit(id, env)
  if (!check.ok) throw new Error(`brand kit "${id}" fails its check: ${check.problems.join('; ')}`)
  return { id, dir: check.dir, version: check.version!, kit: check.kit! }
}

/** Preflight for `--brand`: the problems of the kit, prefixed for the "Cannot start" message, or the loaded kit. */
export async function preflightBrand(id: string, env?: BrandEnv): Promise<{ brand?: LoadedBrand; problems: string[] }> {
  const check = await checkBrandKit(id, env)
  if (!check.ok) return { problems: [`--brand ${id}: the kit fails its check (cinefoundry brand check ${id}): ${check.problems.join('; ')}`] }
  return { brand: { id, dir: check.dir, version: check.version!, kit: check.kit! }, problems: [] }
}

export const kitFile = (brand: LoadedBrand, file: string) => resolve(brand.dir, file)

/** The product a film is about: the one asked for by id, else the one the request names, else the kit's first. */
export function brandProduct(brand: LoadedBrand, request: string, productId?: string): BrandProduct {
  const { products } = brand.kit
  if (productId) {
    const product = products.find((p) => p.id === productId)
    if (!product) throw new Error(`--product ${productId}: the ${brand.kit.name} kit has ${products.map((p) => p.id).join(', ')}`)
    return product
  }
  return products.find((p) => request.toLowerCase().includes(p.name.toLowerCase())) ?? products[0]!
}

/** The kit's claims written as the proof the copy may rest on, and nothing else. */
export const brandProof = (kit: BrandKit) => kit.claims.map((c) => `${c.claim} (${c.proof}; source: ${c.source})`).join('; ')

export const brandBrief = (brand: LoadedBrand): BrandBrief => ({
  id: brand.id, version: brand.version, name: brand.kit.name, forbiddenWords: brand.kit.forbidden.words, forbiddenTopics: brand.kit.forbidden.topics, claims: brand.kit.claims, legal: brand.kit.legal,
})

/**
 * The brief under a kit: the product, its look and lettering are the kit's, the kit's claims are the only proof, and the
 * kit's words, claims and legal lines travel with the brief to every later stage.
 */
export function applyBrandToBrief(brief: Brief, brand: LoadedBrand, product: BrandProduct): Brief {
  const proof = brandProof(brand.kit)
  const next: Brief = { ...brief, product: product.name, brandText: brand.kit.lettering, appearance: product.appearance, brand: brandBrief(brand) }
  if (proof) next.proof = proof
  else delete next.proof
  if (product.category) next.category = product.category
  if (product.industry) next.industry = product.industry
  return next
}

const colour = (kit: BrandKit, role: BrandColour['role']) => kit.palette.find((c) => c.role === role)!.name

/** What the creative director is told the kit fixes. */
export const brandForTreatment = (kit: BrandKit) => `The ${kit.name} brand kit fixes these; the treatment carries them as they are:
- Palette: dominant ${colour(kit, 'primary')}, supporting ${colour(kit, 'secondary')}, accent ${colour(kit, 'accent')}
- Light: ${kit.look.light}
- Texture: ${kit.look.texture}
- Music: ${kit.music}
- The announcer: ${kit.announcer}
- Brand voice: ${kit.tone.do.join('; ')}. Never: ${kit.tone.dont.join('; ')}`

/** The treatment under a kit: palette, light, texture, music and the announcer are the kit's, whatever the draft said. */
export function applyBrandToTreatment(treatment: Treatment, kit: BrandKit): Treatment {
  return {
    ...treatment,
    visual: { ...treatment.visual, light: kit.look.light, texture: kit.look.texture, palette: [colour(kit, 'primary'), colour(kit, 'secondary'), colour(kit, 'accent')] },
    sound: { ...treatment.sound, voice: kit.announcer, music: kit.music },
  }
}

/** What the copywriter, the versioning editor and the screenwriter are told the kit fixes. */
export const brandForCopy = (kit: BrandKit) => `The ${kit.name} brand kit (every line is on-brand):
- The voice does: ${kit.tone.do.join('; ')}
- The voice never: ${kit.tone.dont.join('; ')}
- Lines the brand has approved, for register only (never copy them): ${[...kit.tone.samples.en, ...kit.tone.samples.zh].map((line) => `"${line}"`).join(' ')}
- Forbidden words, in any language: ${kit.forbidden.words.join(', ') || 'none'}
- Forbidden topics: ${kit.forbidden.topics.join(', ') || 'none'}
- Substantiated claims, the only proof any line may rest on: ${brandProof(kit) || 'none - make no claims'}`

/** Fonts, grade, legal lines and the end-card logo of a finished film. */
export interface BrandFinish {
  titleFont: string
  subtitleFont: string
  /** ffmpeg filters of the kit's grade. */
  grade: string
  legal: string[]
  logo?: { path: string } & LogoSpec
}

/** The kit's grade parameters as ffmpeg filters, in the same restrained chain as the built-in grades. */
export function gradeFilter(p: GradeParams): string {
  const w = p.warmth
  const f = (n: number) => Number(n.toFixed(3))
  return `eq=contrast=${f(p.contrast)}:saturation=${f(p.saturation)}:gamma=${f(p.gamma)},colorbalance=rs=${f(w)}:bs=${f(-w)}:rh=${f(w / 2)}:bh=${f(-w / 2)},noise=alls=2:allf=t+u,vignette=PI/6`
}

export async function brandFinish(brand: LoadedBrand): Promise<BrandFinish> {
  const { kit } = brand
  const grade = typeof kit.look.grade === 'string' ? GRADES[kit.look.grade]! : gradeFilter(kit.look.grade)
  let logo: BrandFinish['logo']
  for (const item of kit.logos) {
    if (extname(item.file).toLowerCase() !== '.png') continue
    const size = pngSize(await readFile(kitFile(brand, item.file)))
    if (size) { logo = { path: kitFile(brand, item.file), aspect: size.width / size.height, clearSpace: item.clearSpace, minWidthPx: item.minWidthPx }; break }
  }
  return { titleFont: kit.typography.title.family, subtitleFont: kit.typography.subtitle.family, grade, legal: kit.legal, ...(logo ? { logo } : {}) }
}

/** The handles and hashtags a published film carries: the kit's first, then the film's own, at most eight in all. */
export function brandPackaging(kit: BrandKit, hashtags: string[] = []): { handles: Record<string, string>; hashtags: string[] } {
  const merged = [...new Set([...kit.platforms.hashtags, ...hashtags])].slice(0, 8)
  return { handles: { ...kit.platforms.handles }, hashtags: merged }
}

/** A recurring presenter or mascot: the kit's cast record, loaded as a cast member. */
export async function brandPresenters(brand: LoadedBrand): Promise<CastMember[]> {
  const members: CastMember[] = []
  for (const id of brand.kit.presenters ?? []) {
    const dir = join(brand.dir, 'cast', id)
    const raw = JSON.parse(await readFile(join(dir, 'character.json'), 'utf8')) as { gender: Character['gender'] }
    const member = await loadCastMember(dir, { id, gender: raw.gender })
    if ('record' in member) members.push(member)
  }
  return members
}

/** What the showrunner or creator-content writer is told about the brand: product, voice, wording, presenters. */
export function brandForStory(brand: LoadedBrand, product: BrandProduct, presenters: CastMember[]): string {
  const { kit } = brand
  const cast = presenters.map(({ record }) => `"${record.id}" (${record.name}, ${record.age}, ${record.gender}; look: ${record.look}; wears ${record.wardrobe})`)
  return `${brandForCopy(kit)}
- The product: ${product.name} - ${product.appearance}
${cast.length ? `- The brand's recurring presenter(s) appear as characters with exactly these ids, names, ages and looks: ${cast.join('; ')}` : ''}`.trim()
}

/** The bible under a kit: every recurring presenter is a character with the same id, gender and age as its cast record. */
export function brandBibleProblems(bible: Pick<SeriesBible, 'characters'>, presenters: CastMember[]): string[] {
  const problems: string[] = []
  for (const { record } of presenters) {
    const character = (bible.characters ?? []).find((c) => c.id === record.id)
    if (!character) problems.push(`the brand's presenter "${record.id}" (${record.name}) must be a character with exactly that id`)
    else {
      if (character.gender !== record.gender) problems.push(`the presenter "${record.id}" is ${record.gender} in the brand's cast record`)
      if (character.age !== record.age) problems.push(`the presenter "${record.id}" is ${record.age} in the brand's cast record`)
    }
  }
  return problems
}

/**
 * The product photo a narrative shot needs: when the shot shows the product (its name, or the word "product"), the kit's
 * first photo of it joins the references, if a slot is free; the prompt says which image it is.
 */
export function productReference(shot: Pick<NarrativeShot, 'image_prompt'>, brand: LoadedBrand, product: BrandProduct, used: number, max = 3): { path: string; prompt: string } | undefined {
  if (used >= max) return undefined
  const prompt = (shot.image_prompt ?? '').toLowerCase()
  if (!prompt.includes(product.name.toLowerCase()) && !/\bproduct\b/.test(prompt)) return undefined
  return { path: kitFile(brand, product.photos[0]!), prompt: `Image ${used + 1} is the product, ${product.name}: keep its shape, colours, material and the label "${brand.kit.lettering}" exactly as in image ${used + 1}.` }
}

/** Designed voices the kit holds for its characters, by character id. */
export function brandVoices(brand: LoadedBrand): Map<string, { wav: string; text: string }> {
  return new Map((brand.kit.voices ?? []).map((voice) => [voice.id, { wav: kitFile(brand, voice.wav), text: voice.text }]))
}

/** A new kit: brand.json with every field to fill, and the folders its files go in. Fails the check until it is filled. */
export function scaffoldKit(id: string, name: string, draft?: Partial<BrandKit>): BrandKit {
  return {
    version: 1,
    id,
    name: draft?.name ?? name,
    lettering: draft?.lettering ?? '',
    logos: [{ file: 'logos/logo.png', clearSpace: 0.5, minWidthPx: 160, use: 'primary' }, { file: 'logos/logo.svg', clearSpace: 0.5, minWidthPx: 160, use: 'master artwork' }],
    products: (draft?.products?.length ? draft.products : [{ id: 'product', name: '', appearance: '', photos: [] }]).map((product) => ({ ...product, photos: product.photos?.length ? product.photos : [`products/${product.id}/hero.png`] })),
    palette: draft?.palette ?? [{ name: '', hex: '', role: 'primary' }, { name: '', hex: '', role: 'secondary' }, { name: '', hex: '', role: 'accent' }],
    typography: draft?.typography ?? { title: { family: 'Noto Sans CJK SC' }, subtitle: { family: 'Noto Sans CJK SC' } },
    tone: draft?.tone ?? { do: [], dont: [], samples: { en: [], zh: [] } },
    claims: draft?.claims ?? [],
    forbidden: draft?.forbidden ?? { words: [], topics: [] },
    legal: draft?.legal ?? [],
    music: draft?.music ?? '',
    look: draft?.look ?? { light: '', texture: '', grade: 'neutral' },
    announcer: draft?.announcer ?? '',
    presenters: draft?.presenters ?? [],
    voices: [],
    platforms: draft?.platforms ?? { handles: {}, hashtags: [] },
  }
}

/** Writes a scaffolded kit; never overwrites an existing brand.json. */
export async function writeScaffold(kit: BrandKit): Promise<string> {
  const dir = brandDir(kit.id)
  if (existsSync(join(dir, 'brand.json'))) throw new Error(`${join(dir, 'brand.json')} already exists; edit it, or check it with cinefoundry brand check ${kit.id}`)
  for (const sub of ['logos', 'cast', 'voices', ...kit.products.map((product) => join('products', product.id))]) await mkdir(join(dir, sub), { recursive: true })
  await writeFile(join(dir, 'brand.json'), `${JSON.stringify(kit, null, 2)}\n`)
  return dir
}
