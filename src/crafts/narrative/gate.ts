import { CRAFT_FLOOR, gateFailure, reviewProxy, type QaVerdict } from '../../agent/gate.js'
import { chatJson, type ModelEndpoint } from '../../agent/llm.js'
import type { CastingBrief } from './casting.js'
import type { Character, NarrativeShot } from './types.js'

/** A casting verdict also rates the candidate as a casting director would: realism, match to the brief, distinctness. */
export interface CastingVerdict extends QaVerdict {
  casting?: { realism: number; brief: number; distinct: number }
}

const VERDICT = (casting = '') => `Rate the craft as a feature cinematographer would, 0-10 each: light (motivated, sculpted), composition (balance, depth, eyeline room), realism (reads as a frame from a real film shot on a cinema camera).${casting}
Decide quickly. Reply with JSON only: {"pass": boolean, "score": 0-100, "craft": {"light": 0-10, "composition": 0-10, "realism": 0-10}${casting ? ', "casting": {"realism": 0-10, "brief": 0-10, "distinct": 0-10}' : ''}, "issues": ["short issue"]}. Pass requires score >= 80, every rating >= ${CRAFT_FLOOR} and none of the reject conditions.`

const numeric = <K extends string>(value: unknown, keys: K[]): Record<K, number> | undefined =>
  value && typeof value === 'object' && keys.every((k) => typeof (value as Record<string, unknown>)[k] === 'number')
    ? (Object.fromEntries(keys.map((k) => [k, (value as Record<K, number>)[k]])) as Record<K, number>)
    : undefined

async function judge(reviewer: ModelEndpoint, images: string[], user: string): Promise<CastingVerdict> {
  const copies = await Promise.all(images.map(reviewProxy))
  for (let attempt = 0; ; attempt++) {
    try {
      const run = await chatJson<CastingVerdict>(
        reviewer,
        { system: 'You are the quality gate of a film studio. You did not make this frame. Judge only what is visible, strictly: a flawed frame costs minutes of video generation and a face that changes between shots breaks the story.', images: copies, maxTokens: 3000, temperature: 0, user },
        (v) => (typeof v.pass === 'boolean' && typeof v.score === 'number' ? [] : ['need boolean "pass" and numeric "score"']),
        1,
      )
      if (run.unresolved.length) return { pass: false, score: -1, issues: ['reviewer inconclusive (malformed)'], inconclusive: { cause: 'malformed', detail: run.unresolved.join('; ').slice(0, 200) } }
      const issues = Array.isArray(run.value.issues) ? run.value.issues : []
      const craft = numeric(run.value.craft, ['light', 'composition', 'realism'])
      const casting = numeric(run.value.casting, ['realism', 'brief', 'distinct'])
      const weak = craft ? (Object.entries(craft) as Array<[string, number]>).filter(([, v]) => v < CRAFT_FLOOR) : []
      if (weak.length) issues.push(`craft below ${CRAFT_FLOOR}: ${weak.map(([k, v]) => `${k} ${v}`).join(', ')}`)
      const miscast = casting ? (Object.entries(casting) as Array<[string, number]>).filter(([, v]) => v < CRAFT_FLOOR) : []
      if (miscast.length) issues.push(`casting below ${CRAFT_FLOOR}: ${miscast.map(([k, v]) => `${k} ${v}`).join(', ')}`)
      return { pass: run.value.pass && run.value.score >= 80 && weak.length === 0 && miscast.length === 0, score: run.value.score, issues, ...(craft ? { craft } : {}), ...(casting ? { casting } : {}) }
    } catch (error) {
      const inconclusive = gateFailure(error)
      if (inconclusive.cause === 'transport' && attempt === 0) continue
      return { pass: false, score: -1, issues: [`reviewer inconclusive (${inconclusive.cause})`], inconclusive }
    }
  }
}

/** Already-cast characters a candidate is compared with; a bible has at most five characters. */
export const MAX_CAST_COMPARED = 4

/**
 * A casting candidate: one real-looking adult who matches the written look and the casting brief, and who cannot be
 * mistaken for a character already cast (their masters follow the candidate as images 2..n).
 */
export function sheetGate(
  reviewer: ModelEndpoint,
  sheet: string,
  character: Character,
  casting: { brief?: CastingBrief; others?: Array<{ character: Character; master: string }> } = {},
): Promise<CastingVerdict> {
  const others = (casting.others ?? []).slice(0, MAX_CAST_COMPARED)
  const brief = casting.brief
  const rate = brief || others.length
    ? '\nRate the casting too, 0-10 each: realism (a real person photographed, not generated), brief (how exactly face, features, skin, hair, build and the distinctive detail match the brief), distinct (how clearly this person differs from the characters already cast; 10 when none are shown).'
    : ''
  return judge(reviewer, [sheet, ...others.map((o) => o.master)], `Image 1 is a casting candidate for ${character.name}, ${character.gender}, ${character.age}: ${character.look}. Wardrobe: ${character.wardrobe}.${brief ? `
Casting brief: face ${brief.face}; features ${brief.features}; ${brief.ethnicity}; skin ${brief.skin}; hair ${brief.hair}; build ${brief.build}; distinctive detail ${brief.distinctive}; wardrobe ${brief.wardrobe}, palette ${brief.palette}.` : ''}${others.length ? `\n${others.map((o, i) => `Image ${i + 2} is ${o.character.name}, already cast.`).join(' ')}` : ''}
Reject (pass=false) if ANY is true:
- not exactly one person, or the person is not clearly an adult of about that age and that gender;
- the face, hair or build clearly contradicts the description${brief ? ' or the casting brief, or the distinctive detail is missing' : ''};
${others.map((o, i) => `- image 1 could be mistaken for ${o.character.name} (image ${i + 2}) at phone size: a similar face, hair length and colour, or wardrobe colours;\n`).join('')}- the face is distorted, asymmetric in an unnatural way, has extra or missing features; hands (if visible) are malformed;
- it looks like CGI, a 3D render, an illustration or a beauty-filtered AI portrait: plastic or waxy skin, poreless skin, glossy eyes, perfect symmetry;
- the face is recognisably a well-known actor, model or public figure;
- any text, logo or watermark;
- the face is not clearly lit and readable, or is cropped.
${VERDICT(rate)}`)
}

export type PackView = 'profile' | 'full-body'

/** A reference view edited from the master: the same person, in the view asked for, nothing invented. */
export function identityGate(reviewer: ModelEndpoint, view: string, master: string, character: Character, kind: PackView): Promise<CastingVerdict> {
  const asked = kind === 'profile'
    ? 'a head-and-shoulders profile: the face turned fully to the side, one eye visible, nose and chin in silhouette against the backdrop'
    : `a full-length view from the top of the head to the feet, standing, wearing ${character.wardrobe}`
  return judge(reviewer, [view, master], `Image 2 is the master portrait of ${character.name}, the identity of record. Image 1 must be the same person shown as ${asked}.
Reject (pass=false) if ANY is true:
- image 1 is a different person from image 2: another face shape, eye spacing, nose, mouth, hairline or parting, hair colour or length, skin tone, age or build;
- the distinctive detail of image 2 is missing or on the other side;
- image 1 is not ${kind === 'profile' ? 'a true profile' : 'head to feet, with both feet in frame'};
- the wardrobe contradicts: ${character.wardrobe};
- more than one person, or a distorted face, extra or fused fingers, malformed hands or limbs;
- it looks like CGI or a beauty-filtered AI portrait: plastic or poreless skin, glossy eyes;
- any text, logo or watermark.
${VERDICT()}`)
}

/** A shot's first frame against the master portraits of the characters in it (at most three). */
export function shotGate(reviewer: ModelEndpoint, frame: string, shot: NarrativeShot, cast: Array<{ character: Character; sheet: string }>): Promise<QaVerdict> {
  const refs = cast.slice(0, 3)
  const people = shot.characters.length
  return judge(reviewer, [frame, ...refs.map((r) => r.sheet)], `Image 1 is the generated first frame of a ${shot.framing} shot. ${refs.map((r, i) => `Image ${i + 2} is the master portrait of ${r.character.name}, the identity of record.`).join(' ')}
The frame shows: ${shot.image_prompt}
Reject (pass=false) if ANY is true:
${refs.map((r, i) => `- ${r.character.name} in image 1 is a different person from image ${i + 2}: another face shape, eye spacing, hairline, hair colour or style, skin tone, age or build (ignore expression, light, angle and wardrobe changes the scene calls for);`).join('\n')}
- ${people === 0 ? 'any person appears (this shot has no one in it)' : `more than ${people} ${people === 1 ? 'person faces' : 'people face'} the camera, or an unexpected extra person appears`};
${shot.line !== undefined ? '- the speaker\'s mouth is hidden, turned away or out of focus: this shot is lip-synced;\n' : ''}- a distorted face, extra or fused fingers, malformed hands or limbs;
- any text, caption, sign lettering, logo or watermark;
- it looks like CGI or AI art rather than a frame from a real film: plastic skin, over-smooth surfaces, warped geometry;
- flat or muddy light, or a cluttered, accidentally tilted composition.
${VERDICT()}`)
}
