import type { Brief, Script } from './checks.js'

/** User prompts for the stage agents. Shared by the director and the evals so both measure the same task. */

const photoNote = (brief: Brief) => brief.photo
  ? `A photo of the real product exists and every frame is edited from it, so the product's look comes from the photo: ${brief.photo.description} Placement, camera, light and background are yours to choose; never give the product another colour, material or surface texture.`
  : ''

export const scriptUser = (brief: Brief, request?: string) => `${request ? `The client's request, in their own words (the brief below is the studio's reading of it; where they differ, the request wins):\n${request}\n\n` : ''}Brief:\n${JSON.stringify(brief, null, 2)}\n${brief.photo ? `\n${photoNote(brief)}\n` : ''}${brief.tagline ? `\nThe end card shows the client's closing line "${brief.tagline}". Build towards it; do not repeat it in a title or voiceover.\n` : ''}${brief.proof ? `\nFacts you may claim (and nothing stronger): ${brief.proof}\n` : '\nNo proof points were supplied: no figures, no specs, no comparisons.\n'}\nWrite the script with EXACTLY ${brief.durationSeconds / 5} beats of 5 seconds each (${brief.durationSeconds} s in total; one beat becomes one generated clip). Voiceover ("vo") is 8-18 Chinese characters per beat, on-screen text ("text") at most 8; "see" is in English.
Return JSON only: {"structure": "...", "beats": [{"beat": 1, "job": "hook|proof|payoff|cta", "see": "...", "vo": "...", "text": "..."}]}`

export const storyboardUser = (brief: Brief, script: Script) => `Brief:\n${JSON.stringify(brief, null, 2)}\n\nApproved script:\n${JSON.stringify(script, null, 2)}

${brief.photo
  ? `${photoNote(brief)} \`product\` must describe exactly what the photo shows; the product label reads "${brief.brandText}". \`style\` sets light, background and mood only: no colour, material or finish for the product.`
  : `No reference photos exist. The product label reads "${brief.brandText}".${brief.appearance ? `\nThe product looks like this, in the client's words, and \`product\` must describe exactly that: ${brief.appearance}\nWrite \`product\` in English: translate that description${containerWord(brief.appearance) ? `, name the container as "${containerWord(brief.appearance)}"` : ''}, and keep only the label text "${brief.brandText}" in Chinese inside quotes. Use the same English word for the product in every shot.` : ''}`}
Write EXACTLY ${script.beats.length} shots, numbered 1 to ${script.beats.length}, one per beat, in beat order.
Return JSON only: {"style": "...", "product": "...", "shots": [{"shot": 1, "seconds": 5, "framing": "...", "camera": "...", "image_prompt": "...", "video_prompt": "...", "on_screen_text": "", "must_show": "..."}]}`

/** One agent can work from several skills at once: the storyboard artist works with the director of photography's. */
export const agentSystem = (role: string, rules: string, skill?: { name: string; body: string } | Array<{ name: string; body: string }>) =>
  [`You are the ${role} of Spotfoundry, an advertising studio running on one DGX Spark.`, rules,
    ...(skill ? (Array.isArray(skill) ? skill : [skill]) : []).map((s) => `# Skill: ${s.name}\n\n${s.body}`)].filter(Boolean).join('\n\n')

/** The English container word for a client's Chinese description: a storyboard that copied 透明玻璃瓶 verbatim never said "bottle" and failed six times. */
export function containerWord(appearance: string): string | undefined {
  const forms: Array<[RegExp, string]> = [[/易拉罐|铝罐|罐/, 'can'], [/瓶/, 'bottle'], [/杯/, 'cup'], [/自立袋|袋/, 'pouch'], [/盒/, 'box'], [/管/, 'tube'], [/罐|jar/i, 'jar']]
  return forms.find(([pattern]) => pattern.test(appearance))?.[1]
}
