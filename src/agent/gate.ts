import { LIT_LIKE_ELECTRONICS, type Industry, type Shot } from './checks.js'
import { chatJson, JsonReplyError, type ModelEndpoint } from './llm.js'
import { exec } from '../lib/exec.js'

/** The reviewer sees a 1024 px JPEG, not the full still: the verdict does not change, the prefill does. */
async function reviewCopy(path: string): Promise<string> {
  const copy = `${path}.review.jpg`
  await exec('ffmpeg', ['-y', '-v', 'error', '-i', path, '-vf', "scale='min(1024,iw)':-2", '-q:v', '3', copy])
  return copy
}

export interface QaVerdict {
  pass: boolean
  /** 0-100, or -1 when the reviewer could not answer and the frame went ahead unverified. */
  score: number
  issues: string[]
  /** Only on score -1: why the reviewer did not conclude, so the time it costs can be attributed. */
  inconclusive?: GateFailure
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
  const [frameCopy, referenceCopy] = await Promise.all([reviewCopy(frame), productReference ? reviewCopy(productReference) : undefined])
  try {
    return await runGate(reviewer, frameCopy, shot, referenceCopy, 3000, industry)
  } catch (error) {
    const inconclusive = gateFailure(error)
    return { pass: false, score: -1, issues: [`reviewer inconclusive (${inconclusive.cause})`], inconclusive }
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
- the product carries a brand name, logo or wordmark that is not on image 2 (a small badge that matches image 2 is fine)${LIT_LIKE_ELECTRONICS.includes(industry) ? ';\n- the lighting is rainbow or multicoloured (several hues at once): this product is lit in one or two colours' : ''}.
Decide quickly; do not deliberate at length. Reply with JSON only: {"pass": boolean, "score": 0-100, "issues": ["short issue"]}. Pass requires score >= 80 and none of the reject conditions.`,
    },
    (verdict) => (typeof verdict.pass === 'boolean' && typeof verdict.score === 'number' ? [] : ['need boolean "pass" and numeric "score"']),
    1,
  )
  if (run.unresolved.length) {
    return { pass: false, score: -1, issues: ['reviewer inconclusive (malformed)'], inconclusive: { cause: 'malformed', detail: run.unresolved.join('; ').slice(0, 200), seconds: run.seconds, completionTokens: run.completionTokens, finishReason: run.finishReason } }
  }
  const issues = Array.isArray(run.value.issues) ? run.value.issues : []
  return { pass: run.value.pass && run.value.score >= 80, score: run.value.score, issues }
}

