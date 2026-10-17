import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { env } from '../lib/config.js'
import { exec } from '../lib/exec.js'
import { LIT_LIKE_ELECTRONICS, type Industry, type Shot } from './checks.js'
import { chatJson, JsonReplyError, type ModelEndpoint } from './llm.js'

/** Proxies being made, per still: gates running together on one still (every frame is judged against the hero) share one. */
const proxies = new Map<string, Promise<string>>()

/**
 * The reviewer sees a 1024 px JPEG proxy, not the full still: the verdict does not change, the prefill does. The proxy
 * is encoded under a name of its own and renamed into place, so a reader never sees a half-written file.
 */
export function reviewProxy(path: string): Promise<string> {
  const pending = proxies.get(path)
  if (pending) return pending
  const made = (async () => {
    const proxy = `${path}.review.jpg`
    const partial = `${path}.review.${process.pid}.${randomUUID().slice(0, 8)}.jpg`
    try {
      await exec('ffmpeg', ['-y', '-v', 'error', '-i', path, '-vf', "scale='min(1024,iw)':-2", '-q:v', '3', partial])
      await rename(partial, proxy)
    } finally {
      await rm(partial, { force: true })
    }
    return proxy
  })().finally(() => proxies.delete(path))
  proxies.set(path, made)
  return made
}

export interface QaVerdict {
  pass: boolean
  /** 0-100, or -1 when the reviewer could not answer and the frame went ahead unverified. */
  score: number
  issues: string[]
  /** Only on score -1: why the reviewer did not conclude, so the time it costs can be attributed. */
  inconclusive?: GateFailure
  /** Craft, 0-10 each: does the frame look like a commercial shot by a top crew, not like generated art. */
  craft?: { light: number; composition: number; realism: number }
}

/** A frame below this on any craft axis is regenerated even when nothing is wrong with it. */
// A value that is not a number would disable the floor silently (v < NaN is always false): fall back to 6.
export const CRAFT_FLOOR = craftFloor(env('CINEFOUNDRY_CRAFT_FLOOR'))

export function craftFloor(value: string | undefined): number {
  return value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : 6
}

export interface GateFailure {
  /** budget: max_tokens ran out (finish_reason "length"); unparsable: it finished without JSON; malformed: JSON without pass/score; transport: HTTP or connection error. */
  cause: 'budget' | 'unparsable' | 'malformed' | 'transport'
  detail: string
  seconds?: number
  completionTokens?: number
  finishReason?: string
}

/** Sort a failed gate call into a cause. */
export function gateFailure(error: unknown): GateFailure {
  const detail = (error as Error).message?.slice(0, 200) ?? String(error)
  if (error instanceof JsonReplyError) {
    return { cause: error.finishReason === 'length' ? 'budget' : 'unparsable', detail, seconds: error.seconds, completionTokens: error.completionTokens, finishReason: error.finishReason }
  }
  return { cause: 'transport', detail }
}

/**
 * The gate must never take the film down with it, and it must not take an hour either: the local
 * reviewer decodes at ~18 tokens/s, so one budget of 3000 tokens (~170 s worst case) is all a frame
 * gets. A reviewer that cannot conclude in that budget counts as a rejection (score -1): the frame is
 * regenerated like any other failure and, if nothing better comes, kept and reported as unverified.
 * (Two escalating budgets once cost 18 minutes on a single frame and then accepted it blind.)
 */
export async function qualityGate(reviewer: ModelEndpoint, frame: string, shot: Shot, productReference?: string, industry: Industry = 'general'): Promise<QaVerdict> {
  const [frameCopy, referenceCopy] = await Promise.all([reviewProxy(frame), productReference ? reviewProxy(productReference) : undefined])
  for (let attempt = 0; ; attempt++) {
    try {
      return await runGate(reviewer, frameCopy, shot, referenceCopy, 3000, industry)
    } catch (error) {
      const inconclusive = gateFailure(error)
      // A dropped connection says nothing about the frame: ask once more. A reviewer that ran out of budget would again.
      if (inconclusive.cause === 'transport' && attempt === 0) continue
      return { pass: false, score: -1, issues: [`reviewer inconclusive (${inconclusive.cause})`], inconclusive }
    }
  }
}

async function runGate(reviewer: ModelEndpoint, frame: string, shot: Shot, productReference: string | undefined, maxTokens: number, industry: Industry = 'general'): Promise<QaVerdict> {
  const run = await chatJson<QaVerdict>(
    reviewer,
    {
      system: 'You are the quality gate of an advertising studio. You did not write the prompt. Judge only what is visible, and be strict: a flawed frame costs six minutes of video generation.',
      images: productReference ? [frame, productReference] : [frame],
      // The local vision model reasons before it answers; too small a budget returns nothing at all.
      maxTokens,
      temperature: 0,
      user: `Image 1 is the generated frame.${productReference ? ' Image 2 is the approved product reference.' : ''}
The frame must show: ${shot.must_show}
Reject (pass=false) if ANY of these is true:
- the required content is missing;
${productReference ? '- the product in image 1 is a different product from image 2: another kind of object, other main colours, or different brand lettering. Ignore condensation, lighting, camera angle, reflections, scale and fine print - those are expected to change between shots;\n' : ''}- there is text that is not printed on the product itself: captions, slogans, subtitles, floating numbers, lens specs, watermarks. Lettering that belongs to the product (its label, key legends, packaging copy) is fine;
- any lettering is garbled, duplicated or nonsensical;
${/\b(hand|hands|person|people|student|man|woman|girl|boy|model|holding|drinking|sipping)\b/i.test(`${shot.must_show} ${shot.image_prompt}`) ? '' : '- a person, a hand or fingers appear although this shot does not call for them;\n'}- extra limbs, malformed hands or a distorted face;
- the product is cropped, floating or physically implausible, or a drink that should be clear is an odd colour;
- the product appears twice, as a ghost outline, a transparent overlay or a second copy;
- the product carries a brand name, logo or wordmark that is not on image 2 (a small badge that matches image 2 is fine)${LIT_LIKE_ELECTRONICS.includes(industry) ? ';\n- the lighting is rainbow or multicoloured (several hues at once): this product is lit in one or two colours' : ''};
- it looks like CGI or AI art rather than a photograph: plastic or waxy skin, over-smooth surfaces, melted or warped geometry, impossible reflections, a glossy illustration look;
- the light is flat or muddy, or the product is not the sharpest and best-lit thing in the frame;
- the composition is cluttered, accidentally tilted, or the subject is jammed against an edge.
Also rate the craft as a commercial cinematographer would, 0-10 each: light (motivated, sculpted, one clear key), composition (balance, depth, room for a title), realism (reads as a real photograph).
Decide quickly; do not deliberate at length. Reply with JSON only: {"pass": boolean, "score": 0-100, "craft": {"light": 0-10, "composition": 0-10, "realism": 0-10}, "issues": ["short issue"]}. Pass requires score >= 80, every craft rating >= ${CRAFT_FLOOR} and none of the reject conditions.`,
    },
    (verdict) => (typeof verdict.pass === 'boolean' && typeof verdict.score === 'number' ? [] : ['need boolean "pass" and numeric "score"']),
    1,
  )
  if (run.unresolved.length) {
    return { pass: false, score: -1, issues: ['reviewer inconclusive (malformed)'], inconclusive: { cause: 'malformed', detail: run.unresolved.join('; ').slice(0, 200), seconds: run.seconds, completionTokens: run.completionTokens, finishReason: run.finishReason } }
  }
  const issues = Array.isArray(run.value.issues) ? run.value.issues : []
  const c = run.value.craft
  const craft = c && [c.light, c.composition, c.realism].every((v) => typeof v === 'number') ? { light: c.light, composition: c.composition, realism: c.realism } : undefined
  const weak = craft ? (Object.entries(craft) as Array<[string, number]>).filter(([, v]) => v < CRAFT_FLOOR) : []
  if (weak.length) issues.push(`craft below ${CRAFT_FLOOR}: ${weak.map(([k, v]) => `${k} ${v}`).join(', ')}`)
  return { pass: run.value.pass && run.value.score >= 80 && weak.length === 0, score: run.value.score, issues, ...(craft ? { craft } : {}) }
}

