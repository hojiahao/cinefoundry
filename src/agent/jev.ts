/**
 * Optional structured judge: TypeSafe's Jev (System One model) through its HTTP API.
 * Text only, cloud, opt-in via TYPESAFE_API_KEY. It answers typed questions about a
 * state with calibrated probabilities, which lets the harness set thresholds instead of
 * parsing prose. Anything sent here leaves the machine, so callers record it as cloud.
 */
import type { Brief, Script, Shot, Storyboard } from './checks.js'
import { env } from '../lib/config.js'

export interface JevConfig {
  apiKey: string
  endpoint: string
  model: string
}

export function jevConfig(): JevConfig | undefined {
  const apiKey = env('TYPESAFE_API_KEY')
  if (!apiKey) return undefined
  return { apiKey, endpoint: env('TYPESAFE_ENDPOINT')!.replace(/\/+$/, ''), model: env('TYPESAFE_MODEL')! }
}

type Question =
  | { type: 'noul'; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> }
  | { type: 'score'; instructions: unknown; criteria: unknown[] }

export interface JevAnswers {
  [id: string]: { type: 'noul'; noul: number } | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number } | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }
}

export async function evaluate(config: JevConfig, state: unknown, questions: Record<string, Question>): Promise<{ answers: JevAnswers; model: string; inputTokens: number; seconds: number }> {
  const started = Date.now()
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ state, model: config.model, questions }),
  })
  if (!response.ok) throw new Error(`Jev returned ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const body = (await response.json()) as { model: string; answers: JevAnswers; usage?: { input_tokens?: number } }
  return { answers: body.answers, model: body.model, inputTokens: body.usage?.input_tokens ?? 0, seconds: (Date.now() - started) / 1000 }
}

/** Probability at or above which a finding is treated as certain enough to send the work back. */
export const BLOCK_AT = 0.7
/** Between REVIEW_AT and BLOCK_AT the answer is uncertain: hand it to the reviewer agent (confidence routing). */
export const REVIEW_AT = 0.3

const CATEGORY_LABEL: Record<Brief['category'], string> = {
  general: 'general consumer product', food: 'food or drink', health_food: 'health food / dietary supplement', cosmetics: 'cosmetics / skincare', medical: 'medical product',
}

export interface CopyFinding {
  beat: number
  line: string
  issue: string
  probability: number
  severity: 'block' | 'review'
}

/** One request per beat: absolute claims, health effects, category register, naturalness. */
export async function judgeCopy(config: JevConfig, brief: Brief, script: Script): Promise<{ findings: CopyFinding[]; seconds: number; inputTokens: number; model: string }> {
  const findings: CopyFinding[] = []
  let seconds = 0
  let inputTokens = 0
  let model = config.model
  for (const beat of script.beats) {
    const state = { product: brief.product, product_category: CATEGORY_LABEL[brief.category] ?? brief.category, voiceover_line_chinese: beat.zh, on_screen_title_chinese: beat.text }
    const result = await evaluate(config, state, {
      absolute_claim: { type: 'noul', instructions: 'Does the voiceover line or title use an absolute or superlative claim (the best, number one, the only, 100%, forever, never), explicitly or by clear implication?', criteria: { true: 'Claims to be best / first / only / 100% / 永不, or clearly implies superiority over all competitors', false: 'Describes taste, feel, a moment, or a plain product fact' } },
      health_effect: { type: 'noul', instructions: 'Does the copy state an effect on the body or health as a fact?', criteria: { true: 'A claimed physiological or medical effect: 提神醒脑, 消除疲劳, 解暑降火, 增强免疫, 减肥瘦身, 修复肌肤, 治疗/缓解 a condition', false: 'Taste, feel, mood, scenery or a figurative phrase (唤醒晨光, 唤醒一天, 清爽一刻, 温暖时光) with no claimed effect on the body' } },
      register: { type: 'choice', instructions: 'Which product category does the vocabulary of the copy belong to?', criteria: { drink: 'tasting, thirst, bubbles, coolness in the mouth', food: 'flavour, aroma, chewing, fullness', skincare: 'skin, moisture, absorption, texture on skin', device: 'operation, keys, speed, build quality, battery', home: 'room, scent, light, rest, gifting', generic: 'no category-specific vocabulary' } },
      packaging_talk: { type: 'noul', instructions: 'Does the voiceover line mainly describe the packaging, label, typography or materials of the product (e.g. "black serif lettering, kraft-paper texture") instead of the experience of using it?', criteria: { true: 'The line is about how the package or label looks', false: 'The line is about taste, feel, a moment, a benefit or a mood' } },
      naturalness: { type: 'score', instructions: 'How natural does the voiceover line sound when read aloud as Chinese advertising voiceover?', criteria: ['awkward, ungrammatical or unnatural', 'acceptable', 'natural, like a person speaking'] },
    })
    seconds += result.seconds
    inputTokens += result.inputTokens
    model = result.model
    const a = result.answers
    const noul = (id: string) => (a[id]?.type === 'noul' ? (a[id] as { noul: number }).noul : 0)
    const push = (issue: string, probability: number) => {
      if (probability >= REVIEW_AT) findings.push({ beat: beat.beat, line: beat.zh, issue, probability, severity: probability >= BLOCK_AT ? 'block' : 'review' })
    }
    push('absolute or superlative claim', noul('absolute_claim'))
    if (brief.category !== 'medical') push('claims a bodily or health effect', noul('health_effect'))
    push('describes the packaging or label instead of the experience', noul('packaging_talk'))
    const register = a.register
    if (register?.type === 'choice') {
      const expected: Record<Brief['category'], string[]> = { general: [], food: ['drink', 'food', 'generic'], health_food: ['food', 'drink', 'generic'], cosmetics: ['skincare', 'generic'], medical: [] }
      const allowed = expected[brief.category] ?? []
      if (allowed.length && !allowed.includes(register.choice) && register.confidence >= 0.6) push(`vocabulary reads as ${register.choice}, not ${CATEGORY_LABEL[brief.category]}`, register.confidence)
    }
    const natural = a.naturalness
    if (natural?.type === 'score' && natural.score < 1.0) findings.push({ beat: beat.beat, line: beat.zh, issue: 'sounds unnatural when read aloud', probability: Math.round((1 - natural.score) * 100) / 100, severity: 'review' })
  }
  return { findings, seconds, inputTokens, model }
}

/** Per-shot semantic checks the regex validator cannot make. Returns problems in the validator's own format. */
export async function judgeStoryboard(config: JevConfig, storyboard: Storyboard): Promise<{ problems: string[]; notes: string[]; seconds: number; inputTokens: number; model: string }> {
  const problems: string[] = []
  // Notes are logged, not sent back: the product description and style are appended by code, so a
  // re-described product is redundant rather than fatal, and an unexpected hand is caught by the gate.
  const notes: string[] = []
  let seconds = 0
  let inputTokens = 0
  let model = config.model
  for (const shot of storyboard.shots ?? []) {
    const wantsPeople = /\b(hand|hands|person|people|student|man|woman|girl|boy|model|holding|drinking|sipping|face)\b/i.test(shot.must_show ?? '')
    const result = await evaluate(config, { shot: { image_prompt: shot.image_prompt, video_prompt: shot.video_prompt, camera: shot.camera } }, {
      asks_for_text: { type: 'noul', instructions: 'Does `shot.image_prompt` ask the image model to render any lettering, caption, slogan, label text or numbers (other than simply referring to "the product")?' },
      multiple_actions: { type: 'noul', instructions: 'Does `shot.image_prompt` or `shot.video_prompt` describe more than one distinct action, or more than one camera move?', criteria: { true: 'Two or more actions or moves (tears open AND pours; push-in then pan)', false: 'One action and one camera move, or a static composition' } },
      redescribes_product: { type: 'noul', instructions: 'Does `shot.image_prompt` describe the product\'s appearance (container type, colours, label design) instead of just referring to it as "the product"?' },
      people_or_hands: { type: 'noul', instructions: 'Does `shot.image_prompt` call for a person, hand or fingers to appear in the frame?' },
    })
    seconds += result.seconds
    inputTokens += result.inputTokens
    model = result.model
    const noul = (id: string) => (result.answers[id]?.type === 'noul' ? (result.answers[id] as { noul: number }).noul : 0)
    const label = `shot ${shot.shot}`
    if (noul('asks_for_text') >= BLOCK_AT) problems.push(`${label}: image_prompt asks the model to draw text; on-screen text is typeset in post`)
    if (noul('multiple_actions') >= BLOCK_AT) problems.push(`${label}: more than one action or camera move; keep exactly one`)
    // A re-described product competes with the hero still: "brass-finish texture" turned a dark grey keyboard gold in one frame.
    if (noul('redescribes_product') >= 0.85) problems.push(`${label}: image_prompt re-describes the product's look; refer to it as "the product" only and leave its material, colours and label to the hero still`)
    if (!wantsPeople && noul('people_or_hands') >= BLOCK_AT) notes.push(`${label}: asks for a person or hand although must_show does not call for one; make it a product-only composition or say so in must_show`)
  }
  return { problems, notes, seconds, inputTokens, model }
}

export type { Shot }
