import { access } from 'node:fs/promises'
import { endpoints } from '../../agent/llm.js'
import { exec } from '../../lib/exec.js'
import { RATIOS, checkFps, generationResolution, isRatio } from '../../lib/formats.js'
import { TITLE_FONT } from '../../agent/finish.js'
import type { EngineContext, StageDef } from '../../engine/pipeline.js'
import type { NarrativeContext, NarrativeOptions } from './context.js'
import { castingStage, dialogueStage, narrativeClipsStage, narrativeCutStage, narrativeFramesStage, soundStage } from './production.js'
import { contentComplianceStage, developmentStage, screenplayStage, shotsStage } from './writing.js'
import { brandProduct, preflightBrand, type LoadedBrand } from '../brand.js'

/**
 * Everything a narrative run can be refused for before the first model call. Returns the checked brand kit, which the
 * pipeline keeps on its options (`brandKit`) so the run uses exactly what was checked.
 */
export async function narrativePreflight(options: NarrativeOptions, limits: { maxSeconds: number; maxEpisodes: number }): Promise<LoadedBrand | undefined> {
  const problems: string[] = []
  let checked: LoadedBrand | undefined
  const seconds = options.episodeSeconds
  if (seconds !== undefined && !(seconds % 5 === 0 && seconds >= 10 && seconds <= limits.maxSeconds)) problems.push(`--seconds ${seconds}: a multiple of 5 from 10 to ${limits.maxSeconds}`)
  if (options.episodes !== undefined && !(Number.isInteger(options.episodes) && options.episodes >= 1 && options.episodes <= limits.maxEpisodes)) problems.push(`--episodes ${options.episodes}: 1 to ${limits.maxEpisodes}`)
  if (options.produce !== undefined && !(Number.isInteger(options.produce) && options.produce >= 1 && options.produce <= (options.episodes ?? 1))) problems.push('--produce: from 1 to the number of planned episodes')
  if (options.ratio && !isRatio(options.ratio)) problems.push(`--ratio ${options.ratio}: use ${RATIOS.join(', ')}`)
  try { generationResolution(options.resolution ?? '1080p') } catch (error) { problems.push((error as Error).message) }
  try { checkFps(options.fps ?? 24) } catch (error) { problems.push((error as Error).message) }
  if (options.brand) {
    const { brand, problems: kitProblems } = await preflightBrand(options.brand)
    problems.push(...kitProblems)
    if (brand) {
      try { brandProduct(brand, options.brief, options.product); checked = brand } catch (error) { problems.push((error as Error).message) }
    }
  } else if (options.product) problems.push('--product names a product of a brand kit: use it with --brand')
  if (!options.planOnly) {
    const fonts = await exec('fc-list', [':', 'family']).then((r) => r.stdout).catch(() => '')
    // A kit's fonts are checked with the kit; without one, the studio's title font must be installed.
    if (fonts && !options.brand && !fonts.includes(TITLE_FONT)) problems.push(`title font "${TITLE_FONT}" is not installed (fc-list)`)
    await access('workflows/ltx25_fast_lipsync.json').catch(() => problems.push('workflows/ltx25_fast_lipsync.json is missing'))
  }
  if (problems.length) throw new Error(`Cannot start: ${problems.join('; ')}`)
  return checked
}

export function narrativeContext(options: NarrativeOptions, engine: EngineContext, defaults: { writer: NarrativeContext['writer']; seconds: number; ratio: NarrativeContext['ratio'] }): NarrativeContext {
  if (options.brand && !options.brandKit) throw new Error(`internal: --brand ${options.brand} was not checked in preflight`)
  const { planner, reviewer, editor, author } = endpoints()
  return Object.assign(engine, {
    options, planner, author, reviewer, editor, writer: defaults.writer,
    episodeSeconds: options.episodeSeconds ?? defaults.seconds,
    ratio: (options.ratio as NarrativeContext['ratio'] | undefined) ?? defaults.ratio,
    cast: new Map(), sheets: new Map(), voices: new Map(), plays: [], shots: new Map(), frames: new Map(), clips: new Map(), lines: new Map(), sound: new Map(), outputs: new Map(), qaRegenerations: 0, soundPlans: new Map(),
    ...(options.brandKit ? { brand: { ...options.brandKit, product: brandProduct(options.brandKit, options.brief, options.product), presenters: [] } } : {}),
  }) as NarrativeContext
}

const media = (ctx: NarrativeContext) => !ctx.options.planOnly

/** The narrative stages in production order; a format picks its development stage label and appends its own. */
export const narrativeStages: StageDef<NarrativeContext>[] = [
  { id: 'development', label: '剧本开发', run: developmentStage },
  { id: 'screenplay', label: '剧本', run: screenplayStage },
  { id: 'compliance', label: '合规', run: contentComplianceStage },
  { id: 'shots', label: '分镜', run: shotsStage },
  { id: 'casting', label: '选角定妆', when: media, run: castingStage },
  { id: 'frames', label: '生图质检', when: media, run: narrativeFramesStage },
  { id: 'dialogue', label: '对白', when: media, run: dialogueStage },
  { id: 'clips', label: '生视频', when: media, run: narrativeClipsStage },
  { id: 'sound', label: '声音', when: media, run: soundStage },
  { id: 'cut', label: '成片', when: media, run: narrativeCutStage },
]

export const NARRATIVE_FOLDERS = ['story', 'storyboard', 'cast', 'frames', 'clips', 'audio', 'cut', 'reports']
