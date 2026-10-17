import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkScript, type Script } from '../../agent/checks.js'
import { judgeCopy } from '../../agent/jev.js'
import { chatJson } from '../../agent/llm.js'
import { scriptUser } from '../../agent/prompts.js'
import { treatmentForCopy } from '../../crafts/treatment.js'
import { failIfHardProblems } from '../../crafts/repair.js'
import { brandForCopy } from '../../crafts/brand.js'
import { judgeWith, need, type AdContext } from './context.js'

/** Script: the copywriter writes the beats from the brief and the treatment; every draft is checked and judged. */
export async function scriptStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const treatment = need(ctx.treatment, 'treatment')
  const { planner } = ctx
  ctx.log('▸ script       copywriter agent · nemotron')
  const scriptRun = await chatJson<Script>(
    planner,
    {
      system: await ctx.agentPrompt('copywriter', 'ad-script-writing'),
      // Thinking mode spent the whole token budget reasoning about the length limits and returned nothing.
      thinking: false,
      maxTokens: 3000,
      temperature: 0.8,
      user: `${scriptUser(brief, ctx.request)}\n\n${treatmentForCopy(treatment)}${ctx.brand ? `\n\n${brandForCopy(ctx.brand.kit)}` : ''}`,
    },
    async (script) => {
      const problems = checkScript(script, brief)
      // Structured judge (optional, cloud): semantic problems the regex scan cannot see, at a
      // calibrated threshold. Certain findings go straight back to the copywriter as rewrite reasons.
      const judged = problems.length === 0 ? await judgeWith(ctx, (config) => judgeCopy(config, brief, script), 'script') : undefined
      if (judged) {
        await ctx.record('script', 'jev', undefined, { execution: 'cloud', model: judged.model, seconds: judged.seconds, inputTokens: judged.inputTokens, findings: judged.findings })
        problems.push(...judged.findings.filter((f) => f.severity === 'block').map((f) => `beat ${f.beat} "${f.line}": ${f.issue} (p=${f.probability.toFixed(2)})`))
        ctx.jevReview = judged.findings.filter((f) => f.severity === 'review')
      }
      return problems
    },
    6,
  )
  failIfHardProblems('script', checkScript(scriptRun.value, brief), scriptRun.attempts)
  if (scriptRun.unresolved.length) ctx.log(`  script accepted with ${scriptRun.unresolved.length} unresolved semantic finding(s) after ${scriptRun.attempts} attempts`)
  const script = scriptRun.value
  // The copywriter's draft, kept so a report (or a demo video) can show what compliance changed.
  await writeFile(join(ctx.dir!, 'script', 'script.draft.json'), JSON.stringify(script, null, 2))
  ctx.rejectedAttempts.script = scriptRun.rejected.length
  await ctx.record('script', 'copywriter', planner, { seconds: scriptRun.seconds, attempts: scriptRun.attempts, rejected: scriptRun.rejected })
  ctx.script = script
  return `${script.beats.length} beats · ${script.structure}`
}
