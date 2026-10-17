import { execFile, execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyBrandToBrief, applyBrandToTreatment, brandBibleProblems, brandFinish, brandForCopy, brandForStory, brandForTreatment, brandPackaging, brandPresenters,
  brandProduct, brandVoices, checkBrandKit, endCardLogoWidth, gradeFilter, loadBrand, pngSize, productReference, svgAspect, type BrandEnv, type BrandKit, type LoadedBrand,
} from '../src/crafts/brand.js'
import { checkScript, type Brief, type Script } from '../src/agent/checks.js'
import { cutFilm } from '../src/agent/finish.js'
import { scanBrandWords } from '../src/lib/compliance.js'
import { endCardLayout } from '../src/lib/titles.js'
import { checkScreenplay } from '../src/crafts/narrative/checks.js'
import { castSources, loadCastMember } from '../src/crafts/narrative/casting.js'
import { checkPackaging } from '../src/crafts/narrative/packaging.js'
import type { Treatment } from '../src/crafts/treatment.js'
import type { Screenplay } from '../src/crafts/narrative/types.js'

/**
 * Brand kits: the fixture kit "shidou" (a cold-brew coffee brand) is written fresh for every test that changes it.
 * The check runs against an injected machine (fonts, voices) except where the pipelines run it for real.
 */

const run = promisify(execFile)
const ANNOUNCER = 'en-m2635-warm-baritone'
const FONT = 'Noto Sans CJK SC'
const env: BrandEnv = {
  fontFamilies: async () => [FONT, 'Source Han Serif SC'],
  castableVoiceIds: () => [ANNOUNCER],
  libraryVoices: () => [{ id: ANNOUNCER, language: 'English', uses: ['announcer', 'narrator', 'character'] }, { id: 'zh-f2635-warm-velvet', language: 'Chinese', uses: ['announcer'] }, { id: 'en-m3650-deep-bass', language: 'English', uses: ['announcer'] }],
}

const KIT: BrandKit = {
  version: 1,
  id: 'shidou',
  name: 'Shidou Coffee',
  lettering: '拾豆',
  logos: [{ file: 'logos/logo.png', clearSpace: 0.5, minWidthPx: 160, use: 'primary' }, { file: 'logos/logo.svg', clearSpace: 0.5, minWidthPx: 160, use: 'master artwork' }],
  products: [
    { id: 'cold-brew', name: '拾豆冷萃咖啡', appearance: 'a slim silver aluminium can with a dark brown band printed with 拾豆', photos: ['products/cold-brew/hero.png', 'products/cold-brew/side.jpg'], category: 'food', industry: 'drink' },
    { id: 'drip-bag', name: '拾豆挂耳咖啡', appearance: 'a kraft paper drip bag with a brown 拾豆 seal', photos: ['products/drip-bag/hero.png'], category: 'food', industry: 'food' },
  ],
  palette: [{ name: 'espresso brown', hex: '#3B2418', role: 'primary' }, { name: 'brushed silver', hex: '#C9CCCF', role: 'secondary' }, { name: 'oat cream', hex: '#EFE6D2', role: 'accent' }],
  typography: { title: { family: FONT }, subtitle: { family: FONT } },
  tone: { do: ['quiet confidence', 'sensory detail'], dont: ['shouting', 'discount talk'], samples: { en: ['Steeped overnight, poured slow.'], zh: ['冷萃一夜 慢慢喝'] } },
  claims: [{ claim: '冷萃 12 小时', proof: 'brewing protocol SD-07', source: 'Shidou production standard 2026' }],
  forbidden: { words: ['cheap', '便宜', '提神'], topics: ['caffeine as a health aid'] },
  legal: ['请适量饮用'],
  music: 'sparse warm piano with brushed drums, slow, resolves on a soft major chord',
  look: { light: 'early morning window light from the left, warm and soft', texture: 'condensation on brushed metal, linen, pale oak', grade: { contrast: 1.06, saturation: 1.02, gamma: 0.99, warmth: 0.03 } },
  announcer: ANNOUNCER,
  presenters: ['ming'],
  voices: [{ id: 'ming', description: 'warm, unhurried baritone', wav: 'voices/ming.wav', text: 'Good morning. Slow down for a second.' }],
  platforms: { handles: { douyin: '@shidoucoffee', bilibili: '@拾豆咖啡' }, hashtags: ['#拾豆冷萃', '#慢咖啡'] },
}

const ffmpeg = (...args: string[]) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args])

/** Writes the fixture kit (with every file it names) under `root`/<id>, after `change` edits a copy of it. */
function writeKit(root: string, change?: (kit: BrandKit) => void, files?: (dir: string) => void): string {
  const kit = structuredClone(KIT)
  change?.(kit)
  // The folder is always the fixture's id: a brand.json whose id differs from its folder is a test case.
  const dir = join(root, KIT.id)
  for (const sub of ['logos', 'products/cold-brew', 'products/drip-bag', 'cast/ming', 'voices']) mkdirSync(join(dir, sub), { recursive: true })
  // A pure red wordmark on transparency: its colour is checked, ungraded, on the end card.
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=600x200', '-frames:v', '1', '-pix_fmt', 'rgba', join(dir, 'logos/logo.png'))
  writeFileSync(join(dir, 'logos/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><rect width="600" height="200" fill="#3B2418"/></svg>')
  ffmpeg('-f', 'lavfi', '-i', 'color=c=silver:s=800x800', '-frames:v', '1', join(dir, 'products/cold-brew/hero.png'))
  ffmpeg('-f', 'lavfi', '-i', 'color=c=gray:s=800x800', '-frames:v', '1', join(dir, 'products/cold-brew/side.jpg'))
  ffmpeg('-f', 'lavfi', '-i', 'color=c=tan:s=800x800', '-frames:v', '1', join(dir, 'products/drip-bag/hero.png'))
  ffmpeg('-f', 'lavfi', '-i', 'color=c=gray:s=256x256', '-frames:v', '1', join(dir, 'cast/ming/master.png'))
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', join(dir, 'voices/ming.wav'))
  writeFileSync(join(dir, 'cast/ming/character.json'), JSON.stringify({
    version: 1, id: 'ming', name: 'Ming / 小明', gender: 'male', age: 31, look: 'a man in his early thirties with short black hair and a calm smile', wardrobe: 'oat linen shirt',
    brief: { face: 'oval', features: 'dark eyes', ethnicity: 'Han Chinese', skin: 'warm olive', hair: 'short black', build: 'medium', distinctive: 'a small mole under the left eye', wardrobe: 'oat linen shirt', palette: 'oat and espresso brown' },
    voice: { description: 'warm baritone', library: ANNOUNCER }, images: { master: { path: 'master.png', score: 90, pass: true, model: 'qwen-image-2512' } }, candidates: [], castAt: '2026-10-01T00:00:00.000Z',
  }, null, 2))
  files?.(dir)
  writeFileSync(join(dir, 'brand.json'), JSON.stringify(kit, null, 2))
  return dir
}

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cinefoundry-brands-'))
  process.env.CINEFOUNDRY_BRANDS = root
  return root
}

/** Problems of the fixture after `change`, joined for matching. */
async function problemsAfter(change: (kit: BrandKit) => void, files?: (dir: string) => void): Promise<string> {
  writeKit(freshRoot(), change, files)
  const check = await checkBrandKit('shidou', env)
  expect(check.ok).toBe(false)
  return check.problems.join(' | ')
}

const brief: Brief = { id: 'shidou-test', title: '拾豆冷萃', product: 'cold brew', category: 'general', audience: '上班族', message: '慢下来喝一口', ratio: '16:9', durationSeconds: 10, tone: 'warm', brandText: 'SD', industry: 'general', proof: 'whatever the client typed' }

describe('brand kit validation', () => {
  it('passes the fixture kit and versions it by content', async () => {
    const root = freshRoot()
    const dir = writeKit(root)
    const check = await checkBrandKit('shidou', env)
    expect(check.problems).toEqual([])
    expect(check.ok).toBe(true)
    expect(check.version).toMatch(/^sha256:[0-9a-f]{16}$/)
    expect((await checkBrandKit('shidou', env)).version).toBe(check.version)
    // Any file the kit names changes the version: a new logo is a new kit.
    ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:s=600x200', '-frames:v', '1', join(dir, 'logos/logo.png'))
    expect((await checkBrandKit('shidou', env)).version).not.toBe(check.version)
  })

  it('reads PNG sizes and SVG proportions, and refuses what is neither', () => {
    expect(pngSize(Buffer.from('not a png at all, just some text'))).toBeUndefined()
    expect(svgAspect('<svg viewBox="0 0 300 100"></svg>')).toBe(3)
    expect(svgAspect('<svg width="50" height="100"></svg>')).toBe(0.5)
    expect(svgAspect('<html></html>')).toBeUndefined()
  })

  it('names a missing kit and an id that does not match its folder', async () => {
    freshRoot()
    expect((await checkBrandKit('nobody', env)).problems[0]).toContain('cinefoundry brand init nobody')
    expect(await problemsAfter((kit) => { kit.id = 'other' })).toContain('does not match the folder name')
  })

  it('refuses bad colours, missing and unreadable files, uninstalled fonts and voices that did not pass QC', async () => {
    const problems = await problemsAfter((kit) => {
      kit.palette[0]!.hex = '#3B241'
      kit.palette[1]!.name = 'silver 877'
      kit.palette = kit.palette.filter((c) => c.role !== 'accent')
      kit.products[0]!.photos.push('products/cold-brew/missing.png')
      kit.typography.title.family = 'Brand Display Pro'
      kit.announcer = 'en-m3650-deep-bass'
    }, (dir) => writeFileSync(join(dir, 'products/cold-brew/side.jpg'), 'not an image'))
    expect(problems).toContain('hex "#3B241" must be #RRGGBB')
    expect(problems).toContain('must be English colour words only')
    expect(problems).toContain('palette: needs a accent colour')
    expect(problems).toContain('missing.png does not exist')
    expect(problems).toContain('side.jpg is not a readable PNG or JPEG')
    expect(problems).toContain('the font "Brand Display Pro" is not installed (fc-list)')
    expect(problems).toContain('has not passed voice QC on this machine')
  })

  it('refuses an announcer that is not an English announcer, or not in the library', async () => {
    expect(await problemsAfter((kit) => { kit.announcer = 'zh-f2635-warm-velvet' })).toContain('is not an English announcer voice')
    expect(await problemsAfter((kit) => { kit.announcer = 'en-nobody' })).toContain('is not in the casting library')
  })

  it('holds logos to readability, size, clear space and a PNG for the end card', async () => {
    const unreadable = await problemsAfter(() => {}, (dir) => { writeFileSync(join(dir, 'logos/logo.png'), 'garbage'); writeFileSync(join(dir, 'logos/logo.svg'), '<html/>') })
    expect(unreadable).toContain('logo.png is not a readable PNG')
    expect(unreadable).toContain('logo.svg is not a readable SVG')
    expect(unreadable).toContain('at least one PNG')
    const small = await problemsAfter(() => {}, (dir) => ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=120x40', '-frames:v', '1', join(dir, 'logos/logo.png')))
    expect(small).toMatch(/logo\.png is 120 px wide; the 1080p end card sets it \d+ px wide/)
    expect(await problemsAfter((kit) => { kit.logos = [{ file: 'logos/logo.svg', clearSpace: 0.5, minWidthPx: 160 }] })).toContain('at least one PNG')
    const malformed = await problemsAfter((kit) => { kit.logos[0]!.clearSpace = 0; kit.logos[0]!.file = 'logos/logo.gif' })
    expect(malformed).toContain('must be an SVG or a PNG')
    expect(malformed).toContain('clearSpace is the clear space on every side')
    // A clear space so large it cannot fit the frame is refused for the formats it breaks.
    expect(await problemsAfter((kit) => { kit.logos[0]!.clearSpace = 2; kit.logos[0]!.minWidthPx = 1000 })).toContain('does not fit a')
  })

  it('holds the words to the law and to the kit itself: lettering, samples, claims, legal lines, look, music, hashtags', async () => {
    const problems = await problemsAfter((kit) => {
      kit.lettering = '拾豆冷萃咖啡'
      kit.tone.samples.zh.push('最好喝的冷萃')
      kit.tone.samples.en.push('Never cheap, always slow.')
      kit.claims.push({ claim: '全网第一冷萃', proof: 'sales', source: '' })
      kit.legal.push('x'.repeat(41))
      kit.look.light = 'key light at 5600K'
      kit.look.grade = 'technicolor'
      kit.music = 'in the style of Wes Anderson'
      kit.platforms.hashtags.push('no hash', '#a', '#b', '#c')
    })
    expect(problems).toContain('lettering "拾豆冷萃咖啡" is too long')
    expect(problems).toContain('tone sample "最好喝的冷萃": restricted wording "最好"')
    expect(problems).toContain('tone sample "Never cheap, always slow." uses the kit\'s forbidden word "cheap"')
    expect(problems).toContain('claims[1]: source is empty')
    expect(problems).toContain('no proof makes it usable')
    expect(problems).toContain('1 to 40 characters')
    expect(problems).toContain('look.light must be English words only, no numbers')
    expect(problems).toContain('look.grade "technicolor" is not a grade')
    expect(problems).toContain('music: no named artists')
    expect(problems).toContain('platforms.hashtags: at most 5')
    expect(problems).toContain('"no hash" must be one #')
    expect(await problemsAfter((kit) => { kit.look.grade = { contrast: 2, saturation: 1, gamma: 1, warmth: 0 } })).toContain('look.grade.contrast must be a number from 0.8 to 1.3')
  })

  it('refuses a presenter whose cast record is missing, a minor, or voiced by a voice that did not pass QC', async () => {
    expect(await problemsAfter((kit) => { kit.presenters = ['lan'] })).toContain('cast/lan/character.json is missing')
    const minor = await problemsAfter(() => {}, (dir) => {
      const file = join(dir, 'cast/ming/character.json')
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), age: 16, voice: { description: 'x', library: 'en-m3650-deep-bass' } }))
    })
    expect(minor).toContain('ming is 16; presenters and mascots with a human face are adults')
    expect(minor).toContain('ming\'s voice "en-m3650-deep-bass" has not passed voice QC')
    expect(await problemsAfter((kit) => { kit.voices![0]!.wav = '../outside.wav' })).toContain('must be a path inside the kit folder')
  })
})

describe('every application point receives the kit', () => {
  let brand: LoadedBrand
  beforeAll(async () => {
    writeKit(freshRoot())
    brand = await loadBrand('shidou', env)
  })

  it('brief: product, look, lettering, the kit\'s claims as the only proof, forbidden words and legal lines', () => {
    const product = brandProduct(brand, '给拾豆挂耳咖啡做条广告')
    expect(product.id).toBe('drip-bag')
    expect(brandProduct(brand, 'a coffee ad').id).toBe('cold-brew')
    expect(() => brandProduct(brand, '', 'latte')).toThrow('cold-brew, drip-bag')
    const branded = applyBrandToBrief(brief, brand, brandProduct(brand, '', 'cold-brew'))
    expect(branded).toMatchObject({ product: '拾豆冷萃咖啡', brandText: '拾豆', appearance: KIT.products[0]!.appearance, category: 'food', industry: 'drink' })
    expect(branded.proof).toBe('冷萃 12 小时 (brewing protocol SD-07; source: Shidou production standard 2026)')
    expect(branded.proof).not.toContain('whatever the client typed')
    expect(branded.brand).toEqual({ id: 'shidou', version: brand.version, name: 'Shidou Coffee', forbiddenWords: ['cheap', '便宜', '提神'], forbiddenTopics: ['caffeine as a health aid'], claims: KIT.claims, legal: ['请适量饮用'] })
  })

  it('treatment: palette, light, texture and music are the kit\'s and the announcer is fixed to its voice', () => {
    const draft: Treatment = {
      insight: 'i', proposition: 'p', concept: 'c', brandVoice: 'loud', rhythm: 'r',
      visual: { concept: 'v', light: 'neon night', palette: ['red', 'blue', 'green'], texture: 'chrome' },
      sound: { voice: 'en-m3650-deep-bass', voiceDirection: 'fast', music: 'trap beat', ambience: 'city' },
    }
    const treatment = applyBrandToTreatment(draft, brand.kit)
    expect(treatment.visual).toMatchObject({ palette: ['espresso brown', 'brushed silver', 'oat cream'], light: KIT.look.light, texture: KIT.look.texture, concept: 'v' })
    expect(treatment.sound).toMatchObject({ voice: ANNOUNCER, music: KIT.music, ambience: 'city' })
    expect(brandForTreatment(brand.kit)).toContain('dominant espresso brown, supporting brushed silver, accent oat cream')
  })

  it('copy: the forbidden words are restricted wording in English and Chinese, and the copywriter is told the tone and claims', () => {
    const branded = applyBrandToBrief(brief, brand, brand.kit.products[0]!)
    const script: Script = { structure: 'sensory', beats: [
      { beat: 1, job: 'hook', see: 'ice', vo: 'Cold, slow and never cheap tasting.', zh: '冰块轻响 清晨开罐', text: '开罐' },
      { beat: 2, job: 'payoff', see: 'can', vo: 'Steeped overnight, every note still there.', zh: '冷萃一夜 一口提神', text: '冷萃' },
    ] }
    const problems = checkScript(script, branded).join(' | ')
    expect(problems).toContain('restricted wording "cheap" (brand_forbidden)')
    expect(problems).toContain('restricted wording "提神" (brand_forbidden)')
    expect(checkScript(script, brief).join(' | ')).not.toContain('brand_forbidden')
    // Whole words only for Latin: "cheapside" is not "cheap".
    expect(scanBrandWords('Cheapside market\nso CHEAP', ['cheap'], 'X').map((f) => f.line)).toEqual([2])
    const note = brandForCopy(brand.kit)
    expect(note).toContain('quiet confidence')
    expect(note).toContain('Forbidden words, in any language: cheap, 便宜, 提神')
    expect(note).toContain('the only proof any line may rest on: 冷萃 12 小时')
  })

  it('screenplay: the forbidden words are restricted wording in every line', () => {
    const play: Screenplay = { episode: 1, title: '早安', scenes: [{ scene: 1, heading: 'INT. CAFE - MORNING', characters: ['ming'], action: 'Ming pours a cold brew.', lines: [{ speaker: 'ming', en: 'Not cheap, just slow.', zh: '不便宜 只是慢' }] }] }
    const bible = { characters: [{ id: 'ming' }] } as never
    const forbidden = { brand: 'Shidou Coffee', words: brand.kit.forbidden.words }
    const problems = checkScreenplay(play, bible, { seconds: 10, ratio: '9:16', forbidden }).join(' | ')
    expect(problems).toContain('restricted wording "cheap"')
    expect(problems).toContain('restricted wording "便宜"')
    expect(checkScreenplay(play, bible, { seconds: 10, ratio: '9:16' })).toEqual([])
  })

  it('finishing: the kit\'s fonts, grade, legal line and end-card logo with clear space', async () => {
    const finish = await brandFinish(brand)
    expect(finish).toMatchObject({ titleFont: FONT, subtitleFont: FONT, legal: ['请适量饮用'] })
    expect(finish.grade).toBe(gradeFilter(KIT.look.grade as never))
    expect(finish.grade).toContain('eq=contrast=1.06:saturation=1.02:gamma=0.99,colorbalance=rs=0.03:bs=-0.03')
    expect(finish.logo).toMatchObject({ aspect: 3, clearSpace: 0.5, minWidthPx: 160 })
    expect(finish.logo!.path).toBe(join(brand.dir, 'logos/logo.png'))
    // The logo never shrinks below the kit's minimum, and its clear space stays free of the closing line and the AI label.
    expect(endCardLogoWidth({ aspect: 3, clearSpace: 0.5, minWidthPx: 400 })).toBe(400)
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]] as const) {
      const layout = endCardLayout(w, h, 1, finish.logo)
      expect(layout.problems).toEqual([])
      const closingTop = h - layout.closingMarginV - Math.round((h > w ? h * 0.04 : h * 0.064) * 1.25)
      expect(layout.logo!.y + layout.logo!.height + layout.clear).toBeLessThanOrEqual(closingTop)
      expect(layout.closingMarginV).toBeGreaterThan(layout.legalMarginV + layout.legalSize)
    }
  })

  it('cuts a branded film: fonts in the titles, the legal line on the end card, the logo composited ungraded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cinefoundry-brandcut-'))
    mkdirSync(join(dir, 'clips'), { recursive: true })
    const clip = (name: string, seconds: number) => { const path = join(dir, 'clips', name); ffmpeg('-f', 'lavfi', '-i', `color=c=0x202020:s=1280x720:r=24:d=${seconds}`, '-pix_fmt', 'yuv420p', path); return path }
    const finish = await brandFinish(brand)
    const film = { ...applyBrandToBrief(brief, brand, brand.kit.products[0]!), resolution: '720p', fps: 24 }
    const script: Script = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: 'Steeped overnight, poured slow.', zh: '冷萃一夜 慢慢喝', text: '冷萃' }, { beat: 2, job: 'payoff', see: 'y', vo: 'Every note still there.', zh: '风味一点不少', text: '慢' }] }
    const result = await cutFilm({
      dir, brief: film, script, shots: [{ clip: clip('a.mp4', 2), seconds: 2 }, { clip: clip('b.mp4', 2), seconds: 2 }], endCard: clip('end.mp4', 3),
      output: join(dir, 'cut', 'final.mp4'), ass: join(dir, 'cut', 'titles.ass'), voicePrefix: 'vo', silent: true, comfy: {} as never,
      record: async () => {}, log: () => {}, stage: 'cut', produceId: 'shidou-test', brand: finish,
    })
    const ass = readFileSync(result.ass, 'utf8')
    expect(ass).toMatch(/Style: Title,Noto Sans CJK SC,/)
    expect(ass).toMatch(/Dialogue: 1,[^,]+,[^,]+,Legal,,0,0,\d+,,.*请适量饮用/)
    const layout = endCardLayout(1280, 720, 1, finish.logo)
    expect(ass).toContain(`Closing,,0,0,${layout.closingMarginV},,`)
    // The logo's centre on the last second is the logo's own red, though the picture under it is graded.
    const { x, y, width, height } = layout.logo!
    const pixel = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(result.seconds - 0.5), '-i', result.path, '-frames:v', '1', '-vf', `crop=2:2:${x + Math.round(width / 2)}:${y + Math.round(height / 2)}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    expect(pixel[0]).toBeGreaterThan(200)
    expect(pixel[1]).toBeLessThan(60)
    expect(pixel[2]).toBeLessThan(60)
    // Before the end card the logo is not on screen.
    const before = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', '1', '-i', result.path, '-frames:v', '1', '-vf', `crop=2:2:${x + Math.round(width / 2)}:${y + Math.round(height / 2)}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    expect(before[0]).toBeLessThan(100)
  })

  it('frames: a narrative shot that shows the product takes the kit\'s photo as a reference, if a slot is free', () => {
    const product = brand.kit.products[0]!
    const ref = productReference({ image_prompt: 'Ming lifts the 拾豆冷萃咖啡 can to the window light' }, brand, product, 1)
    expect(ref).toEqual({ path: join(brand.dir, 'products/cold-brew/hero.png'), prompt: expect.stringContaining('Image 2 is the product, 拾豆冷萃咖啡') })
    expect(ref!.prompt).toContain('the label "拾豆"')
    expect(productReference({ image_prompt: 'the product on oak' }, brand, product, 3)).toBeUndefined()
    expect(productReference({ image_prompt: 'a quiet street at dawn' }, brand, product, 0)).toBeUndefined()
  })

  it('packaging: the kit\'s hashtags lead, its handles are attached, at most eight tags', () => {
    const merged = brandPackaging(brand.kit, ['#咖啡', '#拾豆冷萃', '#a', '#b', '#c', '#d', '#e', '#f'])
    expect(merged.handles).toEqual({ douyin: '@shidoucoffee', bilibili: '@拾豆咖啡' })
    expect(merged.hashtags.slice(0, 3)).toEqual(['#拾豆冷萃', '#慢咖啡', '#咖啡'])
    expect(merged.hashtags).toHaveLength(8)
    expect(checkPackaging({ titles: ['清晨一罐冷萃', 'Morning, slowly', '慢下来'], cover: { shot: 1, text: '慢一点' }, description: 'AI 生成的晨间短片', hashtags: merged.hashtags }, 3)).toEqual([])
  })

  it('presenters and character voices: the kit\'s cast record is reused, its designed voice speaks for it', async () => {
    const presenters = await brandPresenters(brand)
    expect(presenters.map((p) => p.id)).toEqual(['ming'])
    expect(castSources({ castDir: '/tmp/other-cast' }, brand)).toEqual(['/tmp/other-cast', join(brand.dir, 'cast')])
    expect('record' in await loadCastMember(join(castSources({}, brand)[0]!, 'ming'), { id: 'ming', gender: 'male' })).toBe(true)
    expect(brandVoices(brand).get('ming')).toEqual({ wav: join(brand.dir, 'voices/ming.wav'), text: 'Good morning. Slow down for a second.' })
    expect(brandForStory(brand, brand.kit.products[0]!, presenters)).toContain('"ming" (Ming / 小明, 31, male')
    expect(brandBibleProblems({ characters: [] }, presenters)[0]).toContain('presenter "ming"')
    expect(brandBibleProblems({ characters: [{ id: 'ming', gender: 'female', age: 31 } as never] }, presenters)[0]).toContain('is male in the brand\'s cast record')
    expect(brandBibleProblems({ characters: [{ id: 'ming', gender: 'male', age: 31 } as never] }, presenters)).toEqual([])
  })
})

/** The ad pipeline under a kit, plan only, against a scripted model server: preflight, brief, treatment, copy, compliance, run log. */
describe('films made under a kit', () => {
  let llm: Server
  let llmUrl = ''
  const seen: string[] = []
  const prompts: Array<{ role: string; user: string }> = []
  let scriptCalls = 0
  let bibleCalls = 0
  let voices = ''

  beforeAll(async () => {
    // A casting library on this machine in which only the kit's announcer passed voice QC.
    const audio = mkdtempSync(join(tmpdir(), 'cinefoundry-audio-'))
    mkdirSync(join(audio, 'voices'), { recursive: true })
    ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=200:duration=1', join(audio, 'voices', `${ANNOUNCER}.wav`))
    voices = join(audio, 'library.json')
    writeFileSync(voices, JSON.stringify({ referenceText: { English: 'x', Chinese: 'x' }, pitchHz: { female: [150, 300], male: [80, 180] }, voices: [{ id: ANNOUNCER, language: 'English', accent: 'General American', gender: 'male', ageBand: '26-35', age: 30, timbre: 'warm', uses: ['announcer', 'narrator'], design: 'x', description: 'warm baritone' }] }))
    Object.assign(process.env, { CINEFOUNDRY_VOICE_LIBRARY: voices, CINEFOUNDRY_STEP_AUDIO_DIR: audio, CINEFOUNDRY_RELEASE_CACHE: '0' })
    llm = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        if (!request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return }
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const system: string = body.messages[0].content
        const role = /^You are the (.+?) of Cinefoundry/.exec(system)?.[1] ?? ''
        const user = body.messages[1].content
        prompts.push({ role, user: typeof user === 'string' ? user : JSON.stringify(user) })
        let reply: unknown
        if (Array.isArray(user)) { seen.push('photo'); reply = { description: 'A slim silver aluminium can with a brushed finish and a dark brown band printed with "拾豆".' } }
        else if (role.startsWith('intake producer')) { seen.push('brief'); reply = { id: 'model-id', title: '拾豆冷萃', product: 'cold brew coffee', category: 'general', audience: '上班族', message: '慢下来喝一口', ratio: '9:16', durationSeconds: 10, tone: 'warm, cinematic', brandText: 'SD', industry: 'general' } }
        else if (role.startsWith('creative director')) {
          seen.push('creative')
          reply = { insight: '忙碌的人想要片刻安静', proposition: '一口醇香', concept: '喧闹中打开罐子，世界安静下来', brandVoice: 'restrained', visual: { concept: 'a cold can glowing in a quiet room', light: 'neon night', palette: ['red', 'blue', 'green'], texture: 'chrome' }, rhythm: 'quiet hook, hero', sound: { voice: ANNOUNCER, voiceDirection: 'unhurried', music: 'trap beat', ambience: 'a quiet room' } }
        } else if (role.startsWith('compliance reviewer')) { seen.push('review'); reply = { approve: true, issues: [] } }
        else if (role.startsWith('copywriter')) {
          seen.push('script')
          reply = ++scriptCalls === 1
            ? { structure: 'sensory', beats: [{ beat: 1, job: 'hook', see: 'ice', vo: 'Cold, slow and never cheap tasting.', zh: '冰块轻响 清晨开罐', text: '开罐' }, { beat: 2, job: 'payoff', see: 'can', vo: 'Steeped overnight, every note still there.', zh: '冷萃一夜 风味一点不少', text: '冷萃' }] }
            : { structure: 'sensory', beats: [{ beat: 1, job: 'hook', see: 'ice', vo: 'Ice cracks, and the morning opens with a hiss.', zh: '冰块轻响 清晨开罐', text: '开罐' }, { beat: 2, job: 'payoff', see: 'can', vo: 'Steeped overnight, every note still there.', zh: '冷萃一夜 风味一点不少', text: '冷萃' }] }
        } else if (role.startsWith('creator-content writer')) {
          // The first bible leaves out the brand's presenter and is sent back for it.
          seen.push('development')
          const ming = { id: 'ming', name: 'Ming / 小明', role: 'lead', age: 31, gender: 'male', look: 'a man in his early thirties with short black hair', wardrobe: 'oat linen shirt', arc: '他想让人慢下来。他先慢下来。', voice: 'warm baritone' }
          const lan = { ...ming, id: 'lan', name: 'Lan / 兰', gender: 'female' }
          reply = { id: 'model-id', title: '拾豆早安', clientNames: [], logline: '一位咖啡师在清晨教人慢下来', genre: 'warm creator skit', world: 'a small cafe in an old quarter at dawn', look: 'soft window light, espresso brown and oat cream, gentle grain', characters: [++bibleCalls === 1 ? lan : ming], episodes: [{ episode: 1, title: '早安', synopsis: '小明给客人一罐冷萃。', hook: '冰块落进杯子', cliffhanger: '明天见' }] }
        } else if (role.startsWith('screenwriter')) {
          seen.push('screenplay')
          reply = { episode: 1, title: '早安', scenes: [{ scene: 1, heading: 'INT. CAFE - MORNING', characters: ['ming'], action: 'Ming sets a cold can on the oak counter.', lines: [{ speaker: 'ming', en: 'Slow down for a second.', zh: '先慢一下' }] }] }
        } else if (role.startsWith('director working')) {
          seen.push('shots')
          reply = { shots: [
            { shot: 1, scene: 1, framing: 'insert', camera: 'locked-off', characters: [], image_prompt: 'a cold can on an oak counter in window light', video_prompt: 'condensation runs down the can', seconds: 5 },
            { shot: 2, scene: 1, framing: 'medium', camera: 'slow push-in', characters: ['ming'], image_prompt: 'a man in an oat shirt behind a counter, window light', video_prompt: 'he looks up and smiles', line: 0, seconds: 5 },
          ] }
        } else {
          seen.push('storyboard')
          reply = { style: 'warm backlit morning light, fine film grain', product: 'a slim silver aluminium can with a dark brown band that reads "拾豆"', shots: [1, 2].map((shot) => ({ shot, seconds: 5, framing: shot === 1 ? 'macro' : 'medium', camera: 'slow push-in', image_prompt: `Shot ${shot}: the product on crushed ice`, video_prompt: 'Slow push-in. No people and no hands enter the frame.', on_screen_text: '', must_show: 'the can upright with its label readable' })) }
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { completion_tokens: 10 } }))
      })
    })
    await new Promise<void>((done) => llm.listen(0, '127.0.0.1', done))
    llmUrl = `http://127.0.0.1:${(llm.address() as { port: number }).port}/v1`
    Object.assign(process.env, { CINEFOUNDRY_PLANNER_URL: llmUrl, CINEFOUNDRY_VISION_URL: llmUrl })
    delete process.env.STEPFUN_API_KEY
    delete process.env.TYPESAFE_API_KEY
  })
  afterAll(() => llm.close())

  it('applies the kit from the brief to the copy and records its version in run.jsonl', async () => {
    writeKit(freshRoot())
    const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-branded-'))
    process.env.CINEFOUNDRY_PROJECTS = projects
    const { runHarness } = await import('../src/agent/harness.js')
    const result = await runHarness({ brief: '给拾豆冷萃咖啡做一条 10 秒竖版广告', id: 'branded', brand: 'shidou', planOnly: true, candidates: 1, log: () => {} })
    const dir = join(projects, 'branded')
    const version = (await checkBrandKit('shidou')).version

    // Brief: the kit's product, lettering, look and proof; its words and legal lines travel with it.
    const brief = JSON.parse(readFileSync(join(dir, 'brief.json'), 'utf8'))
    expect(brief).toMatchObject({ product: '拾豆冷萃咖啡', brandText: '拾豆', category: 'food', industry: 'drink', brand: { id: 'shidou', version, legal: ['请适量饮用'] } })
    expect(brief.proof).toContain('冷萃 12 小时')
    // Frames: the kit's hero photo is the product photo, read before anyone writes.
    expect(seen.indexOf('photo')).toBeLessThan(seen.indexOf('script'))
    expect(readFileSync(join(dir, 'refs', 'product.png')).subarray(1, 4).toString()).toBe('PNG')
    // Treatment: palette, light, texture, music and the announcer are the kit's; only the kit's announcer was offered.
    const treatment = JSON.parse(readFileSync(join(dir, 'creative', 'treatment.json'), 'utf8'))
    expect(treatment.visual.palette).toEqual(['espresso brown', 'brushed silver', 'oat cream'])
    expect(treatment.sound).toMatchObject({ voice: ANNOUNCER, music: KIT.music })
    const creative = prompts.find((p) => p.role.startsWith('creative director'))!.user
    expect(creative).toContain(`- ${ANNOUNCER}:`)
    expect(creative).toContain('The Shidou Coffee brand kit fixes these')
    // Copy: the first draft used a forbidden word and went back; the copywriter saw the kit's tone and claims.
    expect(result.rejectedAttempts.script).toBe(1)
    expect(prompts.find((p) => p.role.startsWith('copywriter'))!.user).toContain('Forbidden words, in any language: cheap, 便宜, 提神')
    // Compliance: the reviewer is told the kit's claims are the only proof.
    expect(prompts.find((p) => p.role.startsWith('compliance reviewer'))!.user).toContain('the only proof any line may rest on')
    // The run log carries the kit's version and the reason the draft went back.
    const rows = readFileSync(join(dir, 'reports', 'run.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    expect(rows.find((row) => row.agent === 'brand-kit')).toMatchObject({ stage: 'brief', brand: 'shidou', version, product: 'cold-brew' })
    expect(JSON.stringify(rows.find((row) => row.agent === 'copywriter'))).toContain('brand_forbidden')
  })

  it('casts the brand\'s presenter in a short and records the kit\'s version', async () => {
    writeKit(freshRoot())
    const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-branded-short-'))
    process.env.CINEFOUNDRY_PROJECTS = projects
    const { runPipeline } = await import('../src/engine/run.js')
    const { shortPipeline } = await import('../src/pipelines/short/index.js')
    await runPipeline(shortPipeline, { brief: '拾豆冷萃的早安短片', id: 'branded-short', brand: 'shidou', episodeSeconds: 10, planOnly: true, log: () => {} })
    // The bible without the presenter went back; the writer was told who the presenter is and what the kit forbids.
    expect(bibleCalls).toBe(2)
    const development = prompts.find((p) => p.role.startsWith('creator-content writer'))!.user
    expect(development).toContain('"ming" (Ming / 小明, 31, male')
    expect(development).toContain('The product: 拾豆冷萃咖啡')
    expect(prompts.find((p) => p.role.startsWith('screenwriter'))!.user).toContain('Forbidden words, in any language: cheap, 便宜, 提神')
    expect(prompts.filter((p) => p.role.startsWith('compliance reviewer')).at(-1)!.user).toContain('This film is made for Shidou Coffee')
    const rows = readFileSync(join(projects, 'branded-short', 'reports', 'run.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    expect(rows.find((row) => row.agent === 'brand-kit')).toMatchObject({ stage: 'development', format: 'short', brand: 'shidou', version: (await checkBrandKit('shidou')).version, presenters: ['ming'] })
  })

  it('refuses to start when the kit fails its check, before any model call', async () => {
    writeKit(freshRoot(), (kit) => { kit.typography.subtitle.family = 'Brand Sans That Is Not Installed' })
    process.env.CINEFOUNDRY_PROJECTS = mkdtempSync(join(tmpdir(), 'cinefoundry-refused-'))
    const { runHarness } = await import('../src/agent/harness.js')
    const { runPipeline } = await import('../src/engine/run.js')
    const { dramaPipeline } = await import('../src/pipelines/drama/index.js')
    const { shortPipeline } = await import('../src/pipelines/short/index.js')
    const calls = prompts.length
    await expect(runHarness({ brief: '给拾豆冷萃咖啡做条广告', brand: 'shidou', log: () => {} })).rejects.toThrow(/--brand shidou: the kit fails its check .*Brand Sans That Is Not Installed/)
    await expect(runPipeline(dramaPipeline, { brief: '咖啡店的故事', brand: 'shidou', log: () => {} })).rejects.toThrow('--brand shidou: the kit fails its check')
    await expect(runPipeline(shortPipeline, { brief: '冷萃怎么喝', brand: 'shidou', log: () => {} })).rejects.toThrow('--brand shidou: the kit fails its check')
    await expect(runHarness({ brief: 'x', brand: 'nobody', log: () => {} })).rejects.toThrow('no brand kit at')
    expect(prompts.length).toBe(calls)
  })

  it('refuses --proof beside a kit and a product the kit does not have', async () => {
    writeKit(freshRoot())
    const { runHarness } = await import('../src/agent/harness.js')
    await expect(runHarness({ brief: 'x', brand: 'shidou', proof: '销量第一', planOnly: true, log: () => {} })).rejects.toThrow('the kit\'s substantiated claims are the only proof')
    await expect(runHarness({ brief: 'x', brand: 'shidou', product: 'latte', planOnly: true, log: () => {} })).rejects.toThrow('--product latte')
    await expect(runHarness({ brief: 'x', product: 'latte', planOnly: true, log: () => {} })).rejects.toThrow('use it with --brand')
  })

  it('cinefoundry brand init, check and show', async () => {
    const root = freshRoot()
    const cli = async (...args: string[]) => {
      const out = await run('node', ['dist/cli.js', 'brand', ...args], { env: { ...process.env, CINEFOUNDRY_BRANDS: root } }).catch((error: { code: number; stdout: string; stderr: string }) => error)
      return { code: 'code' in out ? out.code : 0, json: out.stdout ? JSON.parse(out.stdout) : undefined, stderr: out.stderr }
    }
    const init = await cli('init', 'acme', '--name', 'Acme')
    expect(init.json).toMatchObject({ brand: 'acme', ok: false, drafted: false })
    expect(init.json.todo.join(' ')).toContain('lettering is empty')
    expect(JSON.parse(readFileSync(join(root, 'acme', 'brand.json'), 'utf8')).name).toBe('Acme')
    // A kit is never overwritten.
    expect(await cli('init', 'acme')).toMatchObject({ code: 1, stderr: expect.stringContaining('already exists') })
    const failing = await cli('check', 'acme')
    expect(failing.code).toBe(1)
    expect(failing.json.problems.join(' ')).toContain('logos/logo.png does not exist')
    writeKit(root)
    const passing = await cli('check', 'shidou')
    expect(passing).toMatchObject({ code: 0, json: { ok: true, problems: [] } })
    const shown = await cli('show', 'shidou')
    expect(shown.json).toMatchObject({ brand: 'shidou', version: passing.json.version, kit: { lettering: '拾豆' } })
  })
})
