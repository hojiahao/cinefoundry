import { flag, UsageError, type ParsedArgs } from '../lib/args.js'
import { castableVoices } from '../lib/voices.js'
import { chatJson, endpoints } from '../agent/llm.js'
import { agentSystem } from '../agent/prompts.js'
import { loadRules, loadSkill } from '../agent/skills.js'
import { checkBrandFields, checkBrandKit, scaffoldKit, systemFontFamilies, writeScaffold, type BrandKit } from '../crafts/brand.js'

const USAGE = 'usage: cinefoundry brand <init|check|show> <brand-id> [--name "Brand"] [--brief "brand brief"]'
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))

/** Fields that name files are the brand's to supply; a draft's other fields are held to every rule that needs no file. */
const draftProblems = (kit: BrandKit) => checkBrandFields(kit).filter((problem) => !/^(logos|products\[\d+\]: at least one reference photo)/.test(problem))

/**
 * The brand manager drafts a kit from a brand brief: names, lettering, products, palette, fonts chosen from those
 * installed, tone, only the claims the brief substantiates, forbidden words, legal lines, music, look, an announcer chosen
 * from the voices that passed QC, handles and hashtags. Logos and photos are the brand's files and are never invented.
 */
async function draftKit(id: string, name: string, brief: string): Promise<Partial<BrandKit>> {
  const fonts = (await systemFontFamilies()).filter((family) => /CJK|Hei|Song|Kai|Yuan|Han/i.test(family)).slice(0, 40)
  const announcers = castableVoices({ language: 'English', use: 'announcer' })
  const run = await chatJson<BrandKit>(
    endpoints().planner,
    {
      system: agentSystem('brand manager', await loadRules(), { name: 'brand-kit', body: await loadSkill('brand-kit') }),
      thinking: false,
      maxTokens: 4000,
      temperature: 0.3,
      user: `Draft the brand kit "${id}" for ${name} from the brand's brief. Take only what the brief states or what follows from it; a claim needs the proof and the source the brief gives, otherwise leave it out.
Brand brief:
${brief}

Fonts installed on this machine (typography must use one of these): ${fonts.join(', ') || 'Noto Sans CJK SC'}
Announcers that passed voice QC (choose one id): ${announcers.map((v) => `${v.id}: ${v.description}`).join(' | ') || 'none - leave "announcer" empty'}
Logos and product photos are files the brand supplies: leave "logos" and every product's "photos" as empty lists.
Return JSON only, this shape:
${JSON.stringify(scaffoldKit(id, name), null, 1)}`,
    },
    (kit) => draftProblems({ ...kit, version: 1, id, logos: [], products: (kit.products ?? []).map((p) => ({ ...p, photos: [] })) }),
    3,
  )
  if (run.unresolved.length) console.error(`draft accepted with open points: ${run.unresolved.join('; ').slice(0, 300)}`)
  return run.value
}

/** `cinefoundry brand init|check|show <brand-id>` */
export async function brandCommand(args: ParsedArgs): Promise<number> {
  const [action, id] = args.positionals
  if (!action || !id || !['init', 'check', 'show'].includes(action)) throw new UsageError(USAGE)
  if (action === 'init') {
    const name = flag(args, 'name', id)!
    const brief = flag(args, 'brief')
    const draft = brief ? await draftKit(id, name, brief) : undefined
    const dir = await writeScaffold(scaffoldKit(id, name, draft))
    const check = await checkBrandKit(id)
    print({ brand: id, dir, drafted: !!draft, ok: check.ok, todo: check.problems })
    return 0
  }
  const check = await checkBrandKit(id)
  if (action === 'check') {
    print({ brand: id, dir: check.dir, ok: check.ok, version: check.version, problems: check.problems })
    return check.ok ? 0 : 1
  }
  if (!check.kit) throw new Error(check.problems.join('; '))
  print({ brand: id, dir: check.dir, version: check.version, ok: check.ok, ...(check.ok ? {} : { problems: check.problems }), kit: check.kit })
  return 0
}
