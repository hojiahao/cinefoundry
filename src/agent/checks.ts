/**
 * Deterministic checks for what the skills require. The director uses them to accept or
 * reject an agent's work; the evals use the same functions to score runs with and without
 * a skill, so "the skill helped" is a count of rule violations, not an opinion.
 */
import { scanCopy, type Category } from '../lib/compliance.js'

export interface Brief {
  id: string
  title: string
  product: string
  category: Category
  audience: string
  message: string
  ratio: '9:16' | '16:9' | '1:1'
  durationSeconds: number
  tone: string
  brandText: string
  /** How the product is shot (category playbooks). Chosen by the intake agent; `industryOf` reads the product name when it is missing. */
  industry?: Industry
  /** The product's look in the user's own words (container, material, colours, label), verbatim from the request. */
  appearance?: string
  /** What the vision model read off the user's product photo; with a photo, the photo is the product's look. */
  photo?: ProductPhoto
}

/** The vision model's reading of a user-supplied product photo: the product's look only, never its placement, light or background. */
export interface ProductPhoto {
  /** English: shape and proportions, colours, materials and surface texture, visible lettering and where it sits. */
  description: string
}

export interface Beat {
  beat: number
  job: string
  see: string
  vo: string
  text: string
}

export interface Script {
  structure: string
  beats: Beat[]
}

export interface Shot {
  shot: number
  seconds: number
  framing: string
  camera: string
  image_prompt: string
  video_prompt: string
  on_screen_text: string
  must_show: string
}

export interface Storyboard {
  style: string
  /** One visual description of the product, written once and reused in every shot so it cannot drift. */
  product: string
  shots: Shot[]
}

export const VO_MAX_CHARS = 18
/** Below this a 5-second beat is mostly silence, which is how a model 'passes' a length limit without writing copy. */
export const VO_MIN_CHARS = 8
export const TEXT_MAX_CHARS = 8
const CJK = /[一-鿿]/
// Container words that only make sense for a specific product form.
const CONTAINER_WORDS = ['罐', '瓶']
// Drinks may come in a can or a bottle even when the brief does not say so; a drip-bag coffee or a face cream does not.
const CANNED_DRINK = /\bcans?\b|bottle|水|饮|汽|气泡|啤酒|可乐|茶|juice|soda|water|drink|beverage|beer|cola|tea/i

// Everything a caption may contain: CJK, Latin letters, digits and ordinary punctuation. Anything else
// (emoji, replacement characters, stray symbols, other scripts) is how garbage reaches the screen.
const CAPTION_ALLOWED = /^[\u4e00-\u9fffA-Za-z0-9 ，。！？、：；“”‘’·—…%％℃°+\-]*$/
const REPEATED_PUNCTUATION = /[，。！？、：；·—…]{2,}|[,.!?;:]{1,}/

/** Problems that would make an on-screen line look wrong, whatever it says. */
export function captionProblems(label: string, text: string, isTitle: boolean): string[] {
  const problems: string[] = []
  const value = text ?? ''
  if (!CAPTION_ALLOWED.test(value)) problems.push(`${label}: contains characters that must not appear on screen (${[...value].filter((char) => !CAPTION_ALLOWED.test(char)).join(' ')}); use Chinese characters, digits and ordinary Chinese punctuation only`)
  if (REPEATED_PUNCTUATION.test(value)) problems.push(`${label}: repeated or half-width punctuation; use single full-width marks`)
  if (/^[，。！？、：；·—…]/.test(value.trim())) problems.push(`${label}: starts with punctuation`)
  if (isTitle && /[，。！？、：；]$/.test(value.trim())) problems.push(`${label}: a title has no closing punctuation`)
  return problems
}

/** Visible characters, ignoring whitespace and punctuation - what a voice actually has to read. */
export const spokenLength = (text: string) => [...text.replace(/[\s，。！？、,.!?：:；;“”"'…—-]/g, '')].length

export function checkBrief(brief: Brief): string[] {
  const problems: string[] = []
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(brief.id ?? '')) problems.push('id must be lowercase letters, digits and dashes')
  if (!['9:16', '16:9', '1:1'].includes(brief.ratio)) problems.push('ratio must be 9:16, 16:9 or 1:1')
  if (!Number.isInteger(brief.durationSeconds) || brief.durationSeconds % 5 !== 0 || brief.durationSeconds < 5 || brief.durationSeconds > 30)
    problems.push('durationSeconds must be a multiple of 5 between 5 and 30, because clips are generated in 5-second segments')
  if (!['general', 'food', 'health_food', 'cosmetics', 'medical'].includes(brief.category)) problems.push('category must be general, food, health_food, cosmetics or medical')
  if (!INDUSTRIES.includes(brief.industry as Industry)) problems.push(`industry must be one of ${INDUSTRIES.join(', ')}: how the product is shot, not its legal category`)
  const brand = brief.brandText?.trim() ?? ''
  if (!brand) problems.push('brandText is empty: copy the lettering printed on the product')
  else if (CJK.test(brand) ? [...brand].length > 4 : brand.length > 12) problems.push(`brandText "${brand}" is too long: at most 4 Chinese characters or 12 Latin letters, copied exactly as printed on the product`)
  for (const field of ['title', 'product', 'audience', 'message', 'tone'] as const) if (!brief[field]?.trim()) problems.push(`${field} is empty`)
  return problems
}

export function checkScript(script: Script, brief: Brief): string[] {
  const problems: string[] = []
  const expected = brief.durationSeconds / 5
  const beats = Array.isArray(script.beats) ? script.beats : []
  if (!script.structure?.trim()) problems.push('structure is missing: name the one structure the script follows')
  if (beats.length !== expected) problems.push(`the script must have exactly ${expected} beats of 5 seconds (one beat becomes one generated clip); it has ${beats.length}`)
  for (const beat of beats) {
    const label = `beat ${beat.beat}`
    if (!beat.see?.trim()) problems.push(`${label}: "see" is empty`)
    if (!beat.vo?.trim()) problems.push(`${label}: "vo" is empty`)
    else {
      if (!CJK.test(beat.vo)) problems.push(`${label}: voiceover must be in Chinese`)
      else if (/[A-Za-z]{3,}/.test(beat.vo.replace(brief.brandText, ''))) problems.push(`${label}: voiceover mixes an English word into Chinese (${/[A-Za-z]{3,}/.exec(beat.vo)?.[0]}); write it in Chinese`)
      if (spokenLength(beat.vo) < VO_MIN_CHARS) problems.push(`${label}: voiceover has only ${spokenLength(beat.vo)} characters; write ${VO_MIN_CHARS}-${VO_MAX_CHARS} so the beat is not mostly silence`)
      if (spokenLength(beat.vo) > VO_MAX_CHARS) problems.push(`${label}: voiceover has ${spokenLength(beat.vo)} characters; at most ${VO_MAX_CHARS} fit in 5 seconds`)
    }
    problems.push(...captionProblems(`${label} voiceover`, beat.vo ?? '', false), ...captionProblems(`${label} on-screen text`, beat.text ?? '', true))
    // "一口咬下" for a sparkling water: a drink is sipped, not bitten.
    if (briefIndustry(brief) === 'drink' && /咬|嚼/.test(beat.vo ?? '')) problems.push(`${label}: a drink is not bitten or chewed ("${beat.vo}"); write 喝 / 入口 / 一口`)
    if (spokenLength(beat.text ?? '') > TEXT_MAX_CHARS) problems.push(`${label}: on-screen text has ${spokenLength(beat.text)} characters; at most ${TEXT_MAX_CHARS}`)
    // "开罐" on a drip-bag coffee: the title of the skill's example was copied onto a product that has no can.
    const productText = `${brief.product} ${brief.message} ${brief.title}`
    for (const word of CONTAINER_WORDS) if ((beat.text ?? '').includes(word) && !productText.includes(word) && !CANNED_DRINK.test(productText))
      problems.push(`${label}: "${beat.text}" talks about a container (${word}) that this product does not have (${brief.product}); write a title about this product`)
  }
  const copy = beats.map((beat) => `${beat.vo}\n${beat.text ?? ''}`).join('\n')
  for (const finding of scanCopy(copy, brief.category).filter((item) => item.severity === 'block'))
    problems.push(`restricted wording "${finding.text}" (${finding.rule}): ${finding.reason}`)
  return problems
}

export function checkProductPhoto(photo: ProductPhoto): string[] {
  const problems: string[] = []
  const text = photo.description?.trim() ?? ''
  if (text.length < 40) problems.push('description is missing or too short: give shape, colours, materials, surface texture and visible lettering')
  if (text.length > 700) problems.push('description is too long: at most three sentences')
  if (CJK.test(text.replace(/"[^"]*"/g, ''))) problems.push('description must be in English; only quoted lettering may be Chinese')
  return problems
}

/** The lettering the photo reader quoted, in order, keeping only what fits a brandText. */
export function photoLettering(description: string): string[] {
  const quoted = [...description.matchAll(/["“]([^"”]{1,40})["”]/g)].map((match) => match[1]!.trim())
  return [...new Set(quoted.filter((text) => text && (CJK.test(text) ? [...text].length <= 4 : text.length <= 12)))]
}

// Finish words in the style line are painted onto the product too ("smooth texture" erased a foam front).
const FINISH = /\b(smooth|glossy|gloss|matte|brushed|polished|mirror[- ]finish|chrome|satin|textured|foam|mesh|frosted|transparent|translucent)\b/gi
const PRODUCT_COLOUR = /\b(gold(en)?|silver|gr[ae]y|black|white|blue|red|green|pink|purple|bronze|copper|champagne|cool[- ]toned|warm[- ]toned)\s+(metal|body|chassis|casing|case|finish|surface|shell|housing|product|device|unit)\b/gi

/**
 * The style line is appended to every frame prompt, so with a product photo it may set light,
 * background and mood but not the product's colour or finish: that comes from the photo only.
 */
export function styleConflicts(style: string, photo: ProductPhoto | undefined): string[] {
  if (!photo || !style) return []
  const problems: string[] = []
  const seen = photo.description.toLowerCase()
  for (const word of new Set((style.match(FINISH) ?? []).map((w) => w.toLowerCase()))) {
    if (!seen.includes(word)) problems.push(`style names a "${word}" finish the product photo does not show; style sets light, background and mood only, never the product's finish`)
  }
  for (const match of new Set((style.match(PRODUCT_COLOUR) ?? []).map((w) => w.toLowerCase()))) {
    problems.push(`style gives the product a colour ("${match}"); its look comes from the product photo only`)
  }
  return problems
}

export function checkStoryboard(storyboard: Storyboard, script: Script, brief?: Pick<Brief, 'brandText' | 'product' | 'appearance' | 'photo' | 'industry'>): string[] {
  const problems: string[] = []
  const shots = Array.isArray(storyboard.shots) ? storyboard.shots : []
  // Every frame is edited from the user's photo; a style that repaints the product makes each shot drift its own way.
  problems.push(...styleConflicts(storyboard.style ?? '', brief?.photo))
  if (!storyboard.style?.trim()) problems.push('style line is missing')
  if (!storyboard.product?.trim()) problems.push('product description is missing: describe container type, material, colours and label once')
  // The hero still is generated from this sentence. A copied example (a soda can for a face cream) went unnoticed once.
  else if (brief?.brandText && !storyboard.product.includes(brief.brandText)) problems.push(`product must describe THIS brief's product (${brief.product}) with the label text "${brief.brandText}" in quotes; it does not mention "${brief.brandText}"`)
  // The user said what the product looks like; the storyboard may not change the container (a silver can became a glass bottle).
  if (storyboard.product?.trim() && brief?.appearance) {
    const said = brief.appearance, wrote = storyboard.product
    const forms: Array<[RegExp, RegExp, string]> = [
      [/罐|\bcans?\b/i, /\bcans?\b|\btin\b/i, 'a can'], [/瓶|bottle/i, /bottle/i, 'a bottle'], [/盒|\bbox\b|carton/i, /\bbox\b|carton|pack/i, 'a box'],
      [/袋|bag|pouch|sachet/i, /bag|pouch|sachet|packet/i, 'a bag'], [/管|\btube\b/i, /\btube\b/i, 'a tube'], [/杯|\bcup\b/i, /\bcup\b/i, 'a cup'],
    ]
    for (const [inRequest, inProduct, name] of forms) if (inRequest.test(said) && !inProduct.test(wrote)) problems.push(`product must be ${name}, as the request says ("${said}"); the storyboard describes something else`)
    if (/铝|aluminium|aluminum/i.test(said) && /glass|plastic/i.test(wrote)) problems.push(`product is aluminium in the request ("${said}"), not glass or plastic`)
  }
  if (/\bin quotes\b/i.test(storyboard.product ?? '')) problems.push('product contains the words "in quotes" copied from the template; write the label text itself inside the quotes and nothing about quoting')
  // The product line is painted into the hero still. Chinese outside the quoted label text ("无糖气泡水, container: ...") ends up printed on the can, garbled.
  if (storyboard.product?.trim() && CJK.test(storyboard.product.replace(/"[^"]*"|“[^”]*”/g, ''))) problems.push('product must be in English except the label text inside quotes: any other Chinese in it gets painted onto the product')
  if (storyboard.product?.trim() && brief && /\b(aluminium|aluminum|tin|soda|drink|beverage)?\s*cans?\b|气泡水|易拉罐/i.test(storyboard.product) && !/\bcan\b|aluminium|气泡|饮料|汽水|可乐|啤酒|soda|drink|beverage|water|beer|cola|tea|coffee|juice/i.test(brief.product)) problems.push('product describes a drink can but the brief is not for a canned drink; describe the actual product from the brief')
  if (brief && storyboard.product?.includes('matte-silver aluminium can') && !/can|罐|铝/i.test(brief.product)) problems.push('product is the example from the skill, not this brief\'s product')
  if (shots.length !== script.beats.length) problems.push(`one shot per beat: expected ${script.beats.length} shots, got ${shots.length}`)
  for (const shot of shots) {
    const label = `shot ${shot.shot}`
    if (!shot.image_prompt?.trim()) problems.push(`${label}: image_prompt is empty`)
    else {
      if (CJK.test(shot.image_prompt.replace(/"[^"]*"/g, ''))) problems.push(`${label}: image_prompt must be in English; Chinese is only allowed inside the quoted on-screen text`)
    }
    if (!shot.video_prompt?.trim()) problems.push(`${label}: video_prompt is empty`)
    else if (CJK.test(shot.video_prompt)) problems.push(`${label}: video_prompt must be in English and must not contain on-screen text`)
    const moves = (shot.camera ?? '').match(/\b(push|pull|pan|tilt|orbit|dolly|zoom|track|crane|rack|whip|static|handheld|arc)\b/gi) ?? []
    if (!shot.camera?.trim() || /\b(then|followed by)\b/i.test(shot.camera) || new Set(moves.map((m) => m.toLowerCase())).size > 1) problems.push(`${label}: camera must be exactly one move (found: ${shot.camera})`)
    if (!shot.must_show?.trim()) problems.push(`${label}: must_show is empty; the quality gate needs something visible to check`)
    if (spokenLength(shot.on_screen_text ?? '') > TEXT_MAX_CHARS) problems.push(`${label}: on_screen_text is longer than ${TEXT_MAX_CHARS} characters and will warp`)
    // Screens, cursors and interfaces: image models invent gibberish UI and four attempts failed on "a cursor moving across a screen".
    if (/\b(cursor|user interface|\bUI\b|on-screen|on screen|menu|dashboard)\b/i.test(`${shot.image_prompt} ${shot.must_show}`)) problems.push(`${label}: asks for screen or interface content (cursor, UI, on-screen); show the device, not what it displays`)
  }
  if (storyboard.style?.trim() && CJK.test(storyboard.style)) problems.push('style must be in English: it is appended to every image prompt')
  // Variety: two shots with the same framing and the same camera move read as one long shot (the keyboard film: three near-identical three-quarter views; then two macro push-ins on a pressed key).
  for (let index = 1; index < shots.length; index++) for (let earlier = 0; earlier < index; earlier++) {
    const a = shots[earlier]!, b = shots[index]!
    if (a.framing?.trim().toLowerCase() === b.framing?.trim().toLowerCase() && a.camera?.trim().toLowerCase() === b.camera?.trim().toLowerCase())
      problems.push(`shot ${b.shot}: same framing and camera move as shot ${a.shot} (${b.framing}, ${b.camera}); give each shot its own framing and move (macro push-in, medium orbit, wide pull-back)`)
  }
  for (const shot of shots) {
    if (/\b(row by row|gradually|slowly|moving|moves|rising|swirling|flowing|sweeping|lights up|turns on)\b/i.test(shot.must_show ?? '')) problems.push(`shot ${shot.shot}: must_show describes motion ("${shot.must_show}"); the gate sees one still frame, so name what is visible in a single picture`)
  }
  const HANDS = /\b(hand|hands|finger|fingers|typing|typed|types|presses|pressing|pressed|in use|being used|holding|held|grips?|gripping)\b/i
  const withHands = shots.filter((shot) => HANDS.test(`${shot.image_prompt} ${shot.must_show}`))
  if (withHands.length > 1) problems.push(`hands or fingers appear in ${withHands.length} shots (${withHands.map((shot) => shot.shot).join(', ')}); at most one shot may include a hand, and the product alone carries the rest`)
  for (const shot of withHands) if (/no people|no hands|hands-free/i.test(shot.image_prompt)) problems.push(`shot ${shot.shot}: asks for a finger or hand and also says "no people/no hands"; decide one`)
  if (shots.length >= 3 && new Set(shots.map((shot) => shot.framing?.trim().toLowerCase())).size === 1) problems.push(`all ${shots.length} shots use the same framing (${shots[0]!.framing}); a film needs at least two framings`)
  // Electronics playbook, the rules the keyboard film broke.
  if (brief && briefIndustry(brief) === 'electronics') {
    const briefText = `${brief.product}`
    for (const shot of shots) {
      const label = `shot ${shot.shot}`
      const text = `${shot.image_prompt} ${shot.video_prompt} ${storyboard.style}`
      if (/rainbow|RGB|multicolou?r(ed)? (light|glow|backlight)/i.test(text) && !/rainbow|RGB|幻彩|炫彩|多彩/i.test(briefText)) problems.push(`${label}: rainbow or RGB lighting that the brief did not ask for; electronics are lit with one or two colours (rim light, a single accent)`)
      if (/(top-down|overhead|bird'?s[- ]eye|from above)/i.test(text) && /\b(hand|hands|typing|fingers)\b/i.test(text)) problems.push(`${label}: hands typing seen from above look unnatural and warp; shoot hands from a low side angle with wrists in frame, or leave hands out`)
      if (/\b(keyboard|keycaps?)\b/i.test(briefText + ' ' + text) && /\b(whole|entire|full|complete) keyboard\b|all (the )?keys/i.test(shot.image_prompt) && !/bokeh|out of focus|shallow|blur/i.test(shot.image_prompt)) problems.push(`${label}: a whole keyboard in sharp focus shows dozens of tiny legends that the model garbles; go macro on a few keys, or keep the legends out of focus`)
    }
  }
  return problems
}

/** Lens specs and other short numeric tokens get painted into the image as text ("50mm" appeared as a caption), so drop them. */
export const sanitizeStyle = (style: string) =>
  style.replace(/\b\d+(\.\d+)?\s?mm\b/gi, '').replace(/\bf\/?\d+(\.\d+)?\b/gi, '').replace(/\b\d+k\b/gi, '').replace(/\s*,\s*(?=,|$)/g, '').replace(/^\s*,\s*/, '').replace(/\s{2,}/g, ' ').trim()

export type Industry = 'electronics' | 'drink' | 'skincare' | 'food' | 'general'
export const INDUSTRIES: Industry[] = ['electronics', 'drink', 'skincare', 'food', 'general']

/**
 * A rough industry read of the product's name, the fallback when the brief carries no `industry`.
 * Whole words only: a single 面 (noodles) once matched 桌面 (desktop) and shot a computer as food.
 */
export function industryOf(text: string): Industry {
  if (/\b(keyboards?|mouse|mice|headphones?|earbuds?|earphones?|phones?|smartphones?|laptops?|tablets?|cameras?|smartwatch(es)?|watch(es)?|speakers?|chargers?|monitors?|consoles?|computers?|PCs?|workstations?|servers?|supercomputers?|GPUs?|routers?|drones?|projectors?)\b|键盘|鼠标|耳机|手机|笔记本|平板|相机|手表|音箱|充电|显示器|电脑|计算机|主机|服务器|工作站|显卡|路由器|无人机|投影仪/i.test(text)) return 'electronics'
  if (/\b(cans?|bottles?|soda|drinks?|beverages?|water|beer|cola|tea|coffee|juice|milk)\b|饮料|饮品|汽水|气泡水|矿泉水|啤酒|可乐|茶(?!几|具|台|杯)|咖啡|果汁|牛奶|酸奶/i.test(text)) return 'drink'
  if (/\b(creams?|serums?|lotions?|skincare|cosmetics?|lipsticks?)\b|面霜|精华|乳液|护肤|口红|化妆品/i.test(text)) return 'skincare'
  if (/\b(snacks?|chocolates?|biscuits?|cakes?|noodles?|rice|sauces?)\b|零食|巧克力|饼干|蛋糕|面条|方便面|拉面|意面|挂面|面包|米饭|大米|米粉|酱料|辣酱/i.test(text)) return 'food'
  return 'general'
}

/** The industry the whole run shoots with: the brief's own when valid, else read from the product name. */
export const briefIndustry = (brief: Pick<Brief, 'industry' | 'product'>): Industry =>
  brief.industry && INDUSTRIES.includes(brief.industry) ? brief.industry : industryOf(brief.product)

/**
 * Category anchors appended to every frame prompt. They encode how each kind of product is shot
 * in real commercials, so the storyboard agent's scene sits on a professional base.
 */
const INDUSTRY_ANCHOR: Record<Industry, string> = {
  electronics: 'Consumer electronics commercial photography: dark studio, cool rim light along the edges, a subtle gradient light sweep on the surface, reflective black tabletop, shallow depth of field so any small printed legends fall softly out of focus, no rainbow lighting',
  drink: 'Beverage commercial photography: backlit, crisp condensation, clean highlights, shallow depth of field',
  skincare: 'Skincare commercial photography: soft diffused light, clean pale surfaces, gentle highlights, shallow depth of field',
  food: 'Food commercial photography: warm directional light, appetising texture, shallow depth of field',
  general: 'Commercial product photography: controlled studio light, clean composition, shallow depth of field',
}

const NO_TEXT = 'No captions, no subtitles, no slogans, no watermark, no numbers and no lettering anywhere except the label printed on the product itself'

/** The hero still that every shot is anchored to. */
export function composeProductPrompt(storyboard: Storyboard, industry: Industry = 'general', brandText?: string): string {
  // "Stands upright" is right for a can and wrong for a keyboard: the hero once showed a keyboard on its end, and the end card inherited it.
  const pose = industry === 'electronics'
    ? 'The product rests flat in its natural working position, seen from a slightly elevated three-quarter angle, centred and fully visible, on a seamless dark backdrop with a cool rim light. Apart from its one small badge it carries no other words, logos or brand names anywhere'
    : 'The product stands upright, centred, fully visible, on a seamless neutral backdrop with soft even light'
  return `Studio product photograph of ${storyboard.product.trim().replace(/[.。]$/, '')}. ${pose}. ${brandText ? `The only lettering anywhere in the picture is the label "${brandText}", written once, exactly like that, with no other words, slogans, claims or quotation marks. ` : ''}${NO_TEXT}. ${sanitizeStyle(storyboard.style)}`
}

/** Motion rules appended to every clip prompt by industry: what the video model drifts into on its own. */
const VIDEO_ANCHOR: Record<Industry, string> = {
  electronics: 'The lighting keeps its one cool colour for the whole clip: no colour cycling, no rainbow, no flashing. The product stays exactly where it is',
  drink: 'The container keeps its shape and label; liquid and light move, the product does not deform',
  skincare: 'Slow and quiet; the jar keeps its shape and label',
  food: 'Steam and light move; the pack keeps its shape and print',
  general: 'The product keeps its shape, colours and label for the whole clip',
}

/** Negative prompt additions per industry: rainbow cycling and ghost duplicates are what Wan adds to a keyboard on its own. */
const VIDEO_NEGATIVE_EXTRA: Record<Industry, string> = {
  electronics: 'rainbow lighting, RGB colour cycling, colour changing light, multicoloured glow, flashing, duplicated product, ghost copy, transparent overlay, second keyboard',
  drink: 'duplicated product, second can, melting label',
  skincare: 'duplicated product, opening lid, spilling',
  food: 'duplicated product',
  general: 'duplicated product',
}
export const composeVideoNegative = (base: string, industry: Industry = 'general') => `${base}, ${VIDEO_NEGATIVE_EXTRA[industry]}`

export function composeVideoPrompt(shot: Shot, industry: Industry = 'general'): string {
  return `${shot.video_prompt.trim().replace(/[.。]$/, '')}. ${VIDEO_ANCHOR[industry]}`
}

/**
 * Product, no-text rule and style are appended by code, not by the model, so every shot
 * carries them verbatim. `withReference` is set when the frame is generated from the hero still.
 */
export function composeImagePrompt(shot: Shot, storyboard: Storyboard, withReference = false, industry: Industry = 'general'): string {
  const scene = shot.image_prompt.trim().replace(/[.。]$/, '')
  const product = withReference
    ? 'Image 1 shows the product: reproduce only the product itself, with its shape, proportions, colours, material, surface texture and label exactly as in image 1. Do not copy image 1\'s background, surface, props or lighting; place and light the product as this prompt describes'
    : `The product: ${storyboard.product.trim().replace(/[.。]$/, '')}`
  return `${scene}. ${product}. ${NO_TEXT}. ${INDUSTRY_ANCHOR[industry]}. ${sanitizeStyle(storyboard.style)}`
}
