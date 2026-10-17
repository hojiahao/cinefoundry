import { checkRepairedPrompt, type Shot } from '../agent/checks.js'
import { chatJson, type ModelEndpoint } from '../agent/llm.js'

/** The most times a rejected frame is regenerated with a repaired prompt before the best attempt is kept. */
export const MAX_QA_REGENERATIONS = 2

/** A rejected frame's prompt, rewritten by the planner against the quality gate's issues. */
export async function repairPrompt(planner: ModelEndpoint, system: string, shot: Shot, prompt: string, issues: string[]): Promise<string> {
  // The model writes only the scene; the fixed product sentences are re-attached here, so they cannot drift.
  // It names the fix and the phrases it deletes first: asked for a "simpler scene" alone, it described the product again
  // and resubmitted the old scene with a word moved (eval/skill-bench, repair group).
  const anchor = /Image 1 is the product|The product:/.exec(prompt)
  const scene = (anchor ? prompt.slice(0, anchor.index) : prompt).trim()
  const assemble = (value: { scene: string }) => (anchor ? `${value.scene.trim()} ${prompt.slice(anchor.index)}` : value.scene.trim())
  const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  // A repair is an improvement, not a requirement: if the planner fails (timeout, 5xx, no JSON), the shot is regenerated
  // with the same prompt and a new seed rather than failing a film that has already spent its GPU time.
  const run = await chatJson<{ fixes?: Array<{ issue: string; change: string }>; delete?: string[]; scene: string }>(
    planner,
    {
      system,
      thinking: false,
      temperature: 0.4,
      user: `The quality gate rejected shot ${shot.shot}.\nIssues: ${issues.join('; ') || 'required content missing'}\nMust show: ${shot.must_show}\nCurrent scene description: ${scene}
${anchor ? 'The product sentences that follow the scene are fixed and will be re-attached unchanged; do not write them.\n' : ''}For each issue, first say in one short sentence what you change in the scene to fix it. Then list the exact phrases of the current scene you delete, and write the new scene: the current scene without those phrases, plus only what the fixes add. The new scene must differ from the current one; resubmitting it unchanged, or with a word or two moved, would produce the same rejected frame again. Keep it in English.
Keep the framing (wide, close-up, macro...) and copy the quoted label text character for character. The product always stays in the picture: if something is missing next to it, place that object beside, behind or in front of the product, never around or inside it, and never replace the product with it.
Return JSON only: {"fixes": [{"issue": "...", "change": "..."}], "delete": ["phrase copied from the current scene", "..."], "scene": "..."}`,
    },
    (value) => {
      if (!value.scene?.trim()) return ['scene is empty']
      if (words(value.scene) === words(scene)) return ['the new scene is the current one again; delete the phrases that caused the issues']
      return checkRepairedPrompt(prompt, assemble(value))
    },
    3,
  ).catch(() => undefined)
  // A repair that broke the label, the framing or the fixed sentences is worse than another seed on the old prompt.
  if (!run) return prompt
  return run.unresolved.length ? prompt : assemble(run.value)
}

/** A hard validator problem that survived every attempt would break the film (wrong beat count, restricted wording, Chinese in an image prompt): stop here, truthfully. */
export function failIfHardProblems(stage: string, problems: string[], attempts: number): void {
  if (problems.length) throw new Error(`${stage} still fails its checks after ${attempts} attempts: ${problems.join('; ')}`)
}

