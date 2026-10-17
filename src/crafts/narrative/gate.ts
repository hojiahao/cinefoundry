import { CRAFT_FLOOR, gateFailure, reviewCopy, type QaVerdict } from '../../agent/gate.js'
import { chatJson, type ModelEndpoint } from '../../agent/llm.js'
import type { Character, NarrativeShot } from './types.js'

const VERDICT = (extra = '') => `Rate the craft as a feature cinematographer would, 0-10 each: light (motivated, sculpted), composition (balance, depth, eyeline room), realism (reads as a frame from a real film shot on a cinema camera).
Decide quickly. Reply with JSON only: {"pass": boolean, "score": 0-100, "craft": {"light": 0-10, "composition": 0-10, "realism": 0-10}, "issues": ["short issue"]}. Pass requires score >= 80, every craft rating >= ${CRAFT_FLOOR} and none of the reject conditions.${extra}`

async function judge(reviewer: ModelEndpoint, images: string[], user: string): Promise<QaVerdict> {
  const copies = await Promise.all(images.map(reviewCopy))
  for (let attempt = 0; ; attempt++) {
    try {
      const run = await chatJson<QaVerdict>(
        reviewer,
        { system: 'You are the quality gate of a film studio. You did not make this frame. Judge only what is visible, strictly: a flawed frame costs minutes of video generation and a face that changes between shots breaks the story.', images: copies, maxTokens: 3000, temperature: 0, user },
        (v) => (typeof v.pass === 'boolean' && typeof v.score === 'number' ? [] : ['need boolean "pass" and numeric "score"']),
        1,
      )
      if (run.unresolved.length) return { pass: false, score: -1, issues: ['reviewer inconclusive (malformed)'], inconclusive: { cause: 'malformed', detail: run.unresolved.join('; ').slice(0, 200) } }
      const issues = Array.isArray(run.value.issues) ? run.value.issues : []
      const c = run.value.craft
      const craft = c && [c.light, c.composition, c.realism].every((v) => typeof v === 'number') ? { light: c.light, composition: c.composition, realism: c.realism } : undefined
      const weak = craft ? (Object.entries(craft) as Array<[string, number]>).filter(([, v]) => v < CRAFT_FLOOR) : []
      if (weak.length) issues.push(`craft below ${CRAFT_FLOOR}: ${weak.map(([k, v]) => `${k} ${v}`).join(', ')}`)
      return { pass: run.value.pass && run.value.score >= 80 && weak.length === 0, score: run.value.score, issues, ...(craft ? { craft } : {}) }
    } catch (error) {
      const inconclusive = gateFailure(error)
      if (inconclusive.cause === 'transport' && attempt === 0) continue
      return { pass: false, score: -1, issues: [`reviewer inconclusive (${inconclusive.cause})`], inconclusive }
    }
  }
}

/** The character's locked reference portrait: one real-looking adult who matches the written look, nothing else in frame. */
export function sheetGate(reviewer: ModelEndpoint, sheet: string, character: Character): Promise<QaVerdict> {
  return judge(reviewer, [sheet], `Image 1 is the casting reference portrait for ${character.name}, ${character.gender}, ${character.age}: ${character.look}. Wardrobe: ${character.wardrobe}.
Reject (pass=false) if ANY is true:
- not exactly one person, or the person is not clearly an adult of about that age and that gender;
- the face, hair or build clearly contradicts the description;
- the face is distorted, asymmetric in an unnatural way, has extra or missing features; hands (if visible) are malformed;
- it looks like CGI, a 3D render, an illustration or a beauty-filtered AI portrait: plastic or waxy skin, poreless skin, glossy eyes, perfect symmetry;
- any text, logo or watermark;
- the face is not clearly lit and readable, or is cropped.
${VERDICT()}`)
}

/** A shot's first frame against the reference portraits of the characters in it. */
export function shotGate(reviewer: ModelEndpoint, frame: string, shot: NarrativeShot, cast: Array<{ character: Character; sheet: string }>): Promise<QaVerdict> {
  const refs = cast.slice(0, 2)
  const people = shot.characters.length
  return judge(reviewer, [frame, ...refs.map((r) => r.sheet)], `Image 1 is the generated first frame of a ${shot.framing} shot. ${refs.map((r, i) => `Image ${i + 2} is the locked reference of ${r.character.name}.`).join(' ')}
The frame shows: ${shot.image_prompt}
Reject (pass=false) if ANY is true:
${refs.map((r, i) => `- ${r.character.name} in image 1 is a different person from image ${i + 2}: another face, hair colour or style, age or build (ignore expression, light, angle and wardrobe changes the scene calls for);`).join('\n')}
- ${people === 0 ? 'any person appears (this shot has no one in it)' : `more than ${people} ${people === 1 ? 'person faces' : 'people face'} the camera, or an unexpected extra person appears`};
${shot.line !== undefined ? '- the speaker\'s mouth is hidden, turned away or out of focus: this shot is lip-synced;\n' : ''}- a distorted face, extra or fused fingers, malformed hands or limbs;
- any text, caption, sign lettering, logo or watermark;
- it looks like CGI or AI art rather than a frame from a real film: plastic skin, over-smooth surfaces, warped geometry;
- flat or muddy light, or a cluttered, accidentally tilted composition.
${VERDICT()}`)
}
