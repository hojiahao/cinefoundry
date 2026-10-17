import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatJson } from '../../agent/llm.js'
import { checkTreatment, treatmentUser, type Treatment } from '../../crafts/treatment.js'
import { castableVoices } from '../../lib/voices.js'
import { need, type AdContext } from './context.js'

/**
 * Creative: the creative director decides the film before anyone writes or draws it - insight, proposition, concept,
 * the visual treatment (light, palette, texture), the rhythm and the sound (cast voice, score, ambience).
 */
export async function creativeStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  ctx.log('▸ creative     creative director · nemotron')
  const voices = castableVoices()
  const casting = voices.length ? voices : [{ id: 'default', description: 'the configured narrator' }]
  const run = await chatJson<Treatment>(
    ctx.planner,
    { system: await ctx.agentPrompt('creative director', 'creative-direction'), thinking: false, maxTokens: 3000, temperature: 0.6, user: treatmentUser(brief, ctx.request, casting) },
    (value) => checkTreatment(value, casting),
    4,
  )
  if (run.unresolved.length) ctx.log(`  treatment accepted with open points: ${run.unresolved.join('; ').slice(0, 200)}`)
  ctx.treatment = run.value
  await writeFile(join(ctx.dir!, 'creative', 'treatment.json'), JSON.stringify(run.value, null, 2))
  await ctx.record('creative', 'creative-director', ctx.planner, { seconds: run.seconds, attempts: run.attempts, voice: run.value.sound?.voice, concept: run.value.concept })
  return run.value.concept
}
