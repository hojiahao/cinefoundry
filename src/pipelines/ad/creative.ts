import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatJson } from '../../agent/llm.js'
import { checkTreatment, treatmentUser, type Treatment } from '../../crafts/treatment.js'
import { castableVoices } from '../../lib/voices.js'
import { applyBrandToTreatment, brandForTreatment } from '../../crafts/brand.js'
import { need, type AdContext } from './context.js'

/**
 * Creative: the creative director decides the film before anyone writes or draws it - insight, proposition, concept,
 * the visual treatment (light, palette, texture), the rhythm and the sound (cast voice, score, ambience).
 */
export async function creativeStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  ctx.log('▸ creative     creative director · nemotron')
  // The announcer reads English: cast from the library's English announcers that passed voice QC on this machine.
  // Under a brand kit the announcer is the kit's: it is the only voice offered, and the treatment is held to it.
  const voices = castableVoices({ language: 'English', use: 'announcer' }).filter((voice) => !ctx.brand || voice.id === ctx.brand.kit.announcer)
  const casting = voices.length ? voices : ctx.brand ? [{ id: ctx.brand.kit.announcer, description: `the ${ctx.brand.kit.name} announcer` }] : [{ id: 'default', description: 'the configured narrator' }]
  const run = await chatJson<Treatment>(
    ctx.planner,
    { system: await ctx.agentPrompt('creative director', 'creative-direction'), thinking: false, maxTokens: 3000, temperature: 0.6, user: `${treatmentUser(brief, ctx.request, casting)}${ctx.brand ? `\n\n${brandForTreatment(ctx.brand.kit)}` : ''}` },
    (value) => checkTreatment(value, casting),
    4,
  )
  if (run.unresolved.length) ctx.log(`  treatment accepted with open points: ${run.unresolved.join('; ').slice(0, 200)}`)
  // Palette, light, texture, music and the announcer are the kit's, whatever the draft said.
  const treatment = ctx.brand ? applyBrandToTreatment(run.value, ctx.brand.kit) : run.value
  ctx.treatment = treatment
  await writeFile(join(ctx.dir!, 'creative', 'treatment.json'), JSON.stringify(treatment, null, 2))
  await ctx.record('creative', 'creative-director', ctx.planner, { seconds: run.seconds, attempts: run.attempts, voice: treatment.sound?.voice, concept: treatment.concept, ...(ctx.brand ? { brand: ctx.brand.id } : {}) })
  return treatment.concept
}
