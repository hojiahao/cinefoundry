import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkStoryboard, type Storyboard } from '../../agent/checks.js'
import { judgeStoryboard } from '../../agent/jev.js'
import { chatJson, JsonReplyError } from '../../agent/llm.js'
import { storyboardUser } from '../../agent/prompts.js'
import { treatmentForPicture } from '../../crafts/treatment.js'
import { failIfHardProblems } from '../../crafts/repair.js'
import { judgeWith, need, type AdContext } from './context.js'

/** Storyboard: the storyboard artist and the director of photography turn the approved script into shots. */
export async function storyboardStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const script = need(ctx.script, 'script')
  const treatment = need(ctx.treatment, 'treatment')
  const { planner } = ctx
  ctx.log('▸ storyboard   storyboard agent · nemotron')
  const storyboardUserPrompt = `${storyboardUser(brief, script)}\n\n${treatmentForPicture(treatment)}`
  const storyboardRun = await chatJson<Storyboard>(
    planner,
    { system: await ctx.agentPrompt('storyboard artist working with the director of photography', ['storyboard-design', 'cinematography-and-art-direction']), thinking: false, maxTokens: 5000, temperature: 0.4, user: storyboardUserPrompt },
    async (storyboard) => {
      const problems = checkStoryboard(storyboard, script, brief)
      const judged = problems.length === 0 ? await judgeWith(ctx, (config) => judgeStoryboard(config, storyboard), 'storyboard') : undefined
      if (judged) {
        await ctx.record('storyboard', 'jev', undefined, { execution: 'cloud', model: judged.model, seconds: judged.seconds, inputTokens: judged.inputTokens, problems: judged.problems, notes: judged.notes })
        for (const note of judged.notes) ctx.log(`  note: ${note}`)
        problems.push(...judged.problems)
      }
      return problems
    },
    6,
  ).catch(async (error: unknown) => {
    // A storyboard that never came back usable: keep why each attempt was turned down.
    if (error instanceof JsonReplyError) await ctx.record('storyboard', 'storyboard', planner, { seconds: error.seconds, failed: error.message, finishReason: error.finishReason, rejected: error.rejected })
    throw error
  })
  const storyboardProblems = checkStoryboard(storyboardRun.value, script, brief)
  if (storyboardProblems.length) await ctx.record('storyboard', 'storyboard', planner, { seconds: storyboardRun.seconds, attempts: storyboardRun.attempts, failed: 'hard problems left', rejected: storyboardRun.rejected })
  failIfHardProblems('storyboard', storyboardProblems, storyboardRun.attempts)
  if (storyboardRun.unresolved.length) ctx.log(`  storyboard accepted with ${storyboardRun.unresolved.length} unresolved semantic finding(s) after ${storyboardRun.attempts} attempts`)
  // With a photo the product's look is the photo's, not the storyboard artist's paraphrase of it.
  // Shot numbers and lengths are the pipeline's, not the model's: file names, the frame map and the timeline key on them,
  // and two "shot: 1" once wrote one frame over another.
  const storyboard = { ...(brief.photo ? { ...storyboardRun.value, product: brief.photo.description } : storyboardRun.value) }
  storyboard.shots = storyboard.shots.map((shot, index) => ({ ...shot, shot: index + 1, seconds: 5 }))
  ctx.rejectedAttempts.storyboard = storyboardRun.rejected.length
  await writeFile(join(ctx.dir!, 'storyboard', 'storyboard.json'), JSON.stringify(storyboard, null, 2))
  await ctx.record('storyboard', 'storyboard', planner, { seconds: storyboardRun.seconds, attempts: storyboardRun.attempts, rejected: storyboardRun.rejected })
  ctx.storyboard = storyboard
  return `${storyboard.shots.length} shots`
}
