import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { flag, numberFlag, requireFlag, UsageError, type ParsedArgs } from '../lib/args.js'
import { CATEGORIES, scanCopy, type Category } from '../lib/compliance.js'
import { assembleFilm, detectCuts, extractFrame, probeDuration } from '../lib/ffmpeg.js'
import { generateImage, generateVideo, type EditModel, type ImageModel } from '../lib/media.js'
import { memoryStatus, planMemory } from '../lib/memory.js'
import { sleepService, wakeService } from '../lib/rest.js'
import { addAsset, createProject, loadProject, projectDir, projectsRoot, setStage, STAGES, type Stage, type StageStatus } from '../lib/project.js'
import { RevisionRefused, runRevision, type RevisionRequest } from '../engine/revise.js'
import { exportCut, INTERCHANGE_FORMATS, type InterchangeFormat } from '../crafts/export.js'
import { loadFinishing } from '../crafts/finishing.js'
import { isFormat, REVISIONS } from '../pipelines/index.js'
import { buildShots } from '../lib/shots.js'
import type { Brief, Script, Storyboard } from '../agent/checks.js'
import { CROSSFADE_SECONDS, finishFilm, type Recorder } from '../agent/finish.js'
import { DEFAULT_RATIO, DEFAULT_RESOLUTION, checkFps, deliverySize, isRatio } from '../lib/formats.js'
import { qualityGate } from '../agent/gate.js'
import { runHarness } from '../agent/harness.js'
import { runPipeline } from '../engine/run.js'
import type { PipelineDef } from '../engine/pipeline.js'
import { PIPELINES, type Format } from '../pipelines/index.js'
import type { NarrativeContext, NarrativeOptions } from '../crafts/narrative/context.js'
import { endpoints, type ModelEndpoint } from '../agent/llm.js'
import { runAblation, writeBenchmarks } from '../agent/evals.js'
import { startStudio } from '../studio/server.js'
import { installationReport, type DoctorSection } from '../setup/doctor.js'
import { installedFeatures, manifestCommand, runSetup } from '../setup/index.js'
import { FEATURES, featuresFor, loadManifest, type Feature } from '../setup/manifest.js'
import { checkWorkflows, loadWorkflows } from '../setup/workflows.js'
import { brandFinish, loadBrand } from '../crafts/brand.js'
import { brandCommand } from './brand.js'

export type Command = (args: ParsedArgs) => Promise<number>

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))

/** Asset paths are stored relative to the project so a project folder stays portable. */
const projectRelative = (id: string, path: string) => relative(projectDir(id), resolve(path))

async function project(args: ParsedArgs): Promise<number> {
  const action = args.positionals[0]
  if (action === 'init') {
    const state = await createProject({
      id: requireFlag(args, 'id'),
      title: flag(args, 'title') ?? requireFlag(args, 'id'),
      brief: requireFlag(args, 'brief'),
      ratio: flag(args, 'ratio', '9:16')!,
      durationSeconds: numberFlag(args, 'duration', 15),
    })
    print({ project: state.id, dir: projectDir(state.id) })
    return 0
  }
  if (action === 'status') {
    print(await loadProject(requireFlag(args, 'id')))
    return 0
  }
  if (action === 'stage') {
    const stage = requireFlag(args, 'stage') as Stage
    const status = requireFlag(args, 'status') as StageStatus
    const known = Object.keys((await loadProject(requireFlag(args, 'id')).catch(() => undefined))?.stages ?? {})
    const allowed = known.length ? known : [...STAGES]
    if (!allowed.includes(stage)) throw new UsageError(`--stage must be one of ${allowed.join(', ')}`)
    if (!['pending', 'running', 'done', 'failed'].includes(status)) throw new UsageError('--status must be pending, running, done or failed')
    print((await setStage(requireFlag(args, 'id'), stage, status, flag(args, 'note'))).stages)
    return 0
  }
  throw new UsageError('usage: cinefoundry project <init|status|stage> ...')
}

async function image(args: ParsedArgs): Promise<number> {
  const id = flag(args, 'project')
  const shot = flag(args, 'shot')
  const output = resolve(flag(args, 'out') ?? join(projectDir(requireFlag(args, 'project')), 'frames', `shot_${String(shot ?? 'x').padStart(3, '0')}.png`))
  const result = await generateImage(new ComfyClient(), {
    prompt: requireFlag(args, 'prompt'),
    size: flag(args, 'size', '1328x1328')!,
    output,
    references: args.flags.get('ref'),
    seed: flag(args, 'seed') ? numberFlag(args, 'seed', 0) : undefined,
    model: flag(args, 'model') as ImageModel | undefined,
    editModel: flag(args, 'edit-model') as EditModel | undefined,
  })
  if (id) {
    await addAsset(id, {
      id: `frame-${shot ?? Date.now()}`, kind: 'image', stage: 'frames', path: projectRelative(id, output),
      shot: shot ? Number(shot) : undefined, execution: 'local-dgx-spark', model: result.workflow, seconds: result.seconds,
    })
  }
  print(result)
  return 0
}

async function video(args: ParsedArgs): Promise<number> {
  const id = flag(args, 'project')
  const shot = flag(args, 'shot')
  const output = resolve(flag(args, 'out') ?? join(projectDir(requireFlag(args, 'project')), 'clips', `shot_${String(shot ?? 'x').padStart(3, '0')}.mp4`))
  const result = await generateVideo(new ComfyClient(), {
    prompt: requireFlag(args, 'prompt'),
    output,
    resolution: flag(args, 'resolution', DEFAULT_RESOLUTION)!,
    ratio: flag(args, 'ratio', '9:16')!,
    durationSeconds: numberFlag(args, 'duration', 5),
    firstFrame: flag(args, 'first-frame'),
    freeAfter: flag(args, 'keep-loaded') !== 'true',
    model: flag(args, 'model') as never,
  })
  if (id) {
    await addAsset(id, {
      id: `clip-${shot ?? Date.now()}`, kind: 'video', stage: 'clips', path: projectRelative(id, output),
      shot: shot ? Number(shot) : undefined, execution: result.workflow.startsWith('cloud:') ? 'cloud' : 'local-dgx-spark', model: result.workflow, seconds: result.seconds,
    })
  }
  print(result)
  return 0
}

async function copyCheck(args: ParsedArgs): Promise<number> {
  const source = args.positionals[0]
  if (!source) throw new UsageError('usage: cinefoundry copy-check <file|-> [--category general|food|health_food|cosmetics|medical]')
  const category = flag(args, 'category', 'general') as Category
  if (!CATEGORIES.includes(category)) throw new UsageError(`--category must be one of ${CATEGORIES.join(', ')}`)
  const copy = source === '-' ? await new Response(process.stdin as never).text() : await readFile(source, 'utf8')
  const findings = scanCopy(copy, category)
  print({ verdict: findings.length === 0 ? 'pass' : 'needs_changes', category, findings })
  return findings.some((finding) => finding.severity === 'block') ? 1 : 0
}

async function shots(args: ParsedArgs): Promise<number> {
  const source = args.positionals[0]
  if (!source) throw new UsageError('usage: cinefoundry shots <video> [--out dir] [--threshold 0.30] [--min-shot 0.4]')
  const out = resolve(flag(args, 'out', 'breakdown')!)
  await mkdir(out, { recursive: true })
  const duration = await probeDuration(source)
  const ranges = buildShots(await detectCuts(source, numberFlag(args, 'threshold', 0.3)), duration, numberFlag(args, 'min-shot', 0.4))
  const list = []
  for (const [index, [start, end]] of ranges.entries()) {
    const keyframe = `shot_${String(index + 1).padStart(3, '0')}.jpg`
    // Mid-shot avoids transition frames at either edge.
    await extractFrame(source, (start + end) / 2, join(out, keyframe))
    list.push({ index: index + 1, start: round(start), end: round(end), duration: round(end - start), keyframe })
  }
  const manifest = { source: { file: source, duration: round(duration), shotCount: list.length, avgShotSeconds: round(duration / list.length) }, shots: list }
  await writeFile(join(out, 'shots.json'), JSON.stringify(manifest, null, 2))
  print(manifest.source)
  return 0
}

const round = (value: number) => Math.round(value * 1000) / 1000

async function mem(args: ParsedArgs): Promise<number> {
  const action = args.positionals[0] ?? 'status'
  const status = await memoryStatus()
  if (action === 'status') {
    print(status)
    return 0
  }
  if (action === 'plan') {
    const needs = Object.fromEntries((args.flags.get('need') ?? []).map((item) => {
      const [name, gb] = item.split('=')
      return [name!, Number(gb)]
    }))
    const plan = planMemory(status, needs, numberFlag(args, 'reserve', 10), flag(args, 'against', 'total') as 'total' | 'available')
    print(plan)
    return plan.fits ? 0 : 1
  }
  if (action === 'free') {
    await new ComfyClient().free()
    print({ availableBeforeGb: status.availableGb, availableAfterGb: (await memoryStatus()).availableGb })
    return 0
  }
  if (action === 'sleep' || action === 'wake') {
    // Release (or restore) the language models' memory by hand, e.g. before a long ComfyUI session.
    const { planner, reviewer } = endpoints()
    const targets = (args.positionals[1] ? [args.positionals[1]] : ['planner', 'reviewer']).map((name) => (name === 'planner' ? planner : name === 'reviewer' ? reviewer : undefined)).filter((item): item is ModelEndpoint => Boolean(item))
    const result: Record<string, unknown> = {}
    for (const target of targets) result[target.name] = action === 'sleep' ? (await sleepService(target.baseUrl)) ? 'asleep' : 'no sleep mode' : await wakeService(target.baseUrl)
    print({ ...result, availableGb: (await memoryStatus()).availableGb })
    return 0
  }
  throw new UsageError('usage: cinefoundry mem <status|plan|free|sleep|wake> [planner|reviewer] [--need name=GB ...] [--reserve 10] [--against total|available]')
}

/** The same gate the harness runs, for one frame. */
async function qa(args: ParsedArgs): Promise<number> {
  const frame = requireFlag(args, 'frame')
  const reference = args.flags.get('ref')?.[0]
  const expectation = flag(args, 'expect', 'a clean, well composed advertising frame')!
  const shot = { shot: Number(flag(args, 'shot', '0')), seconds: 5, framing: '', camera: '', image_prompt: flag(args, 'prompt', '')!, video_prompt: '', on_screen_text: '', must_show: expectation }
  const verdict = await qualityGate(endpoints().reviewer, frame, shot, reference)
  const id = flag(args, 'project')
  if (id) await writeFile(join(projectDir(id), 'reports', `qa_${flag(args, 'shot', 'x')}.json`), JSON.stringify({ frame, reference, verdict }, null, 2))
  print(verdict)
  return verdict.pass ? 0 : 1
}

/** Re-run the cut stage of a harness project: end card, titles, sound, grade. */
async function cut(args: ParsedArgs): Promise<number> {
  const id = requireFlag(args, 'project')
  const dir = projectDir(id)
  const state = await loadProject(id)
  const read = async <T>(path: string) => JSON.parse(await readFile(join(dir, path), 'utf8')) as T
  const hero = state.assets.find((asset) => asset.id === 'product-hero')
  if (!hero) {
    // A project assembled by hand with the individual tools has no script or hero still:
    // join and grade its clips, without end card, titles or sound.
    const clips = state.assets.filter((asset) => asset.kind === 'video' && asset.stage === 'clips').sort((a, b) => (a.shot ?? 0) - (b.shot ?? 0))
    if (clips.length === 0) throw new Error('No clips in this project yet.')
    const paths = clips.map((clip) => join(dir, clip.path))
    const durations = await Promise.all(paths.map(async (path) => Math.max(0.5, Math.floor((await probeDuration(path)) * 10) / 10)))
    const [width, height] = deliverySize(DEFAULT_RESOLUTION, isRatio(state.ratio) ? state.ratio : DEFAULT_RATIO)
    const simple = join(dir, 'cut', 'final.mp4')
    await mkdir(join(dir, 'cut'), { recursive: true })
    await assembleFilm(paths, simple, { width, height, fps: 24, durations, crossfadeSeconds: Math.min(CROSSFADE_SECONDS, Math.min(...durations) / 3), audio: flag(args, 'audio') })
    await addAsset(id, { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg' })
    await setStage(id, 'cut', 'done')
    print({ output: simple, clips: clips.length, duration: round(await probeDuration(simple)), mode: 'picture only' })
    return 0
  }
  const record: Recorder = async (stage, agent, _endpoint, detail) =>
    appendFile(join(dir, 'reports', 'run.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), runId: state.runId, stage, agent, execution: 'local-dgx-spark', ...detail })}\n`)
  const brief = await read<Brief>('brief.json')
  // A film made under a kit is re-cut under the kit as it is now; a changed kit is said, not silently applied.
  const brand = brief.brand ? await loadBrand(brief.brand.id) : undefined
  if (brand && brand.version !== brief.brand!.version) console.error(`note: the ${brand.id} kit changed since this film was made (${brief.brand!.version} -> ${brand.version}); re-cutting with the current kit`)
  if (brand) await record('cut', 'brand-kit', undefined, { brand: brand.id, version: brand.version })
  const output = await finishFilm({
    dir, brief, ...(brand ? { brand: await brandFinish(brand) } : {}), script: await read<Script>('script/script.json'), storyboard: await read<Storyboard>('storyboard/storyboard.json'),
    heroPath: join(dir, hero.path), endStill: flag(args, 'end-still') ? resolve(flag(args, 'end-still')!) : undefined, comfy: new ComfyClient(), audio: flag(args, 'audio'), silent: flag(args, 'silent') === 'true', record, log: (line) => console.error(line), grade: (await loadFinishing(dir)).grade,
  })
  await addAsset(id, { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg' })
  await setStage(id, 'cut', 'done')
  print({ output, duration: round(await probeDuration(output)) })
  return 0
}

/**
 * Is this machine ready to make a film? Platform, model files, images, voice library and services (src/setup/doctor.ts),
 * then every workflow template node by node against the running ComfyUI: unknown nodes, unknown inputs, missing model
 * files. `--verify` hashes every model file now instead of trusting the installer's record.
 */
async function doctor(args: ParsedArgs): Promise<number> {
  const sections: Record<string, DoctorSection> = await installationReport({ verify: flag(args, 'verify') === 'true' })
  const manifest = loadManifest()
  const installed = new Set(installedFeatures())
  const optional = (filename: string) => manifest.files.find((file) => file.layout === 'file' && file.filename === filename && !file.features.some((feature) => installed.has(feature)))?.features.join(',')
  try {
    const { problems, warnings } = checkWorkflows(await new ComfyClient().objectInfo(), loadWorkflows(), optional)
    sections.workflows = { ok: problems.length === 0, problems, warnings }
  } catch (error) {
    sections.workflows = { ok: false, problems: [`ComfyUI not reachable, workflows not checked: ${(error as Error).message}`], warnings: [] }
  }
  const problems = Object.entries(sections).flatMap(([name, section]) => section.problems.map((problem) => `${name}: ${problem}`))
  const warnings = Object.entries(sections).flatMap(([name, section]) => section.warnings.map((warning) => `${name}: ${warning}`))
  print({ ok: problems.length === 0, problems, warnings, sections: Object.fromEntries(Object.entries(sections).map(([name, section]) => [name, { ok: section.ok, ...section.detail }])) })
  return problems.length === 0 ? 0 : 1
}

const SETUP_USAGE = `usage: cinefoundry setup [--check | --dry-run] [--models-only] [--no-start] [--formats ad,short,drama] [--with ${Object.keys(FEATURES).filter((name) => !FEATURES[name as Feature].default).join(',')}] [--proxy URL|none]
       cinefoundry setup manifest [--refresh] [--proxy URL|none]`

/** Install everything a first film needs (scripts/install.sh calls this once Node and the build are in place). */
async function setup(args: ParsedArgs): Promise<number> {
  const log = (line: string) => console.log(line)
  if (args.positionals[0] === 'manifest') return manifestCommand(flag(args, 'refresh') === 'true', flag(args, 'proxy'), log)
  if (args.positionals.length) throw new UsageError(SETUP_USAGE)
  const check = flag(args, 'check') === 'true'
  const dryRun = flag(args, 'dry-run') === 'true'
  if (check && dryRun) throw new UsageError('--check and --dry-run are exclusive')
  const list = (name: string) => (args.flags.get(name) ?? []).flatMap((value) => value.split(',')).map((value) => value.trim()).filter((value) => value && value !== 'true')
  let features: Feature[]
  try {
    features = featuresFor(list('formats'), list('with'))
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${SETUP_USAGE}`)
  }
  return runSetup({ mode: check ? 'check' : dryRun ? 'dry-run' : 'install', modelsOnly: flag(args, 'models-only') === 'true', noStart: flag(args, 'no-start') === 'true', features, proxy: flag(args, 'proxy'), log })
}

async function studio(args: ParsedArgs): Promise<number> {
  await startStudio(numberFlag(args, 'port', 3090), flag(args, 'host', '127.0.0.1')!)
  return new Promise(() => {})
}

/** Brief in, finished film out: Cinefoundry Harness runs every stage with its agents and skills. */
async function harnessCommand(args: ParsedArgs): Promise<number> {
  const brief = args.positionals.join(' ').trim()
  if (!brief) throw new UsageError('usage: cinefoundry harness "<brief>" [--id id] [--brand brand-id] [--product product-id] [--ratio 16:9|9:16|1:1] [--duration 15] [--resolution 1080p|2k|4k|6k] [--fps 60|24|30|120] [--product-image photo] [--proof "facts the client can substantiate"] [--plan-only] [--without-skills]')
  const result = await runHarness({
    brief,
    id: flag(args, 'id'),
    ratio: flag(args, 'ratio'),
    durationSeconds: flag(args, 'duration') ? numberFlag(args, 'duration', 15) : undefined,
    planOnly: flag(args, 'plan-only') === 'true',
    withoutSkills: flag(args, 'without-skills') === 'true',
    resolution: flag(args, 'resolution'),
    fps: flag(args, 'fps') ? checkFps(numberFlag(args, 'fps', 60)) : undefined,
    videoModel: flag(args, 'video-model') as never,
    audio: flag(args, 'audio'),
    silent: flag(args, 'silent') === 'true',
    productImage: flag(args, 'product-image'),
    proof: flag(args, 'proof'),
    brand: flag(args, 'brand'),
    product: flag(args, 'product'),
    candidates: flag(args, 'candidates') ? numberFlag(args, 'candidates', 2) : undefined,
    bestOf: flag(args, 'best-of') === 'true',
    frameScheduling: flag(args, 'frame-scheduling') as never,
  })
  print(result)
  return 0
}

/** Options shared by the narrative formats (short video, micro-drama). */
function narrativeOptions(args: ParsedArgs, usage: string): NarrativeOptions {
  const brief = args.positionals.join(' ').trim()
  if (!brief) throw new UsageError(usage)
  return {
    brief,
    id: flag(args, 'id'),
    episodes: flag(args, 'episodes') ? numberFlag(args, 'episodes', 1) : undefined,
    produce: flag(args, 'produce') ? numberFlag(args, 'produce', 1) : undefined,
    episodeSeconds: flag(args, 'seconds') ? numberFlag(args, 'seconds', 60) : undefined,
    ratio: flag(args, 'ratio'),
    resolution: flag(args, 'resolution'),
    fps: flag(args, 'fps') ? checkFps(numberFlag(args, 'fps', 24)) : undefined,
    videoModel: flag(args, 'video-model') as never,
    candidates: flag(args, 'candidates') ? numberFlag(args, 'candidates', 2) : undefined,
    castDir: flag(args, 'cast'),
    brand: flag(args, 'brand'),
    product: flag(args, 'product'),
    planOnly: flag(args, 'plan-only') === 'true',
    withoutSkills: flag(args, 'without-skills') === 'true',
  }
}

const DRAMA_USAGE = 'usage: cinefoundry drama "<story idea>" [--episodes 10] [--produce 2] [--seconds 120] [--ratio 9:16] [--fps 24] [--id id] [--cast projects/<id>/cast] [--brand brand-id] [--product product-id] [--plan-only]'
const SHORT_USAGE = 'usage: cinefoundry short "<topic>" [--seconds 60] [--ratio 9:16] [--fps 30] [--id id] [--cast projects/<id>/cast] [--brand brand-id] [--product product-id] [--plan-only]'

/** `cinefoundry short|drama`: the format's pipeline from the registry, run with the options the narrative formats share. */
function narrativeCommand(format: Extract<Format, 'short' | 'drama'>, usage: string): Command {
  return async (args) => {
    const pipeline: PipelineDef<NarrativeOptions, NarrativeContext, unknown> = PIPELINES[format]
    print(await runPipeline(pipeline, narrativeOptions(args, usage)))
    return 0
  }
}

/** Same model, same briefs, with and without the skills; scored by the director's validators. */
async function evalCommand(args: ParsedArgs): Promise<number> {
  if (flag(args, 'report-only') === 'true') {
    print({ written: await writeBenchmarks(flag(args, 'out', 'eval/results/ablation.json')!) })
    return 0
  }
  print(await runAblation(flag(args, 'briefs', 'eval/briefs.json')!, flag(args, 'out', 'eval/results/ablation.json')!, numberFlag(args, 'repeats', 2), (line) => console.error(line)))
  return 0
}

const REVISE_USAGE = 'usage: cinefoundry revise <id> (--shot N [--note "what to change"] | --line <beat|scene.line> --text "new English" [--zh "新字幕"] | --grade <warmer|cooler|...> | --music "direction") [--episode E]'

/** The revision a command line asks for: exactly one of --shot, --line, --grade, --music. */
export function revisionRequest(args: ParsedArgs): RevisionRequest {
  const asked = (['shot', 'line', 'grade', 'music'] as const).filter((name) => flag(args, name) !== undefined)
  if (asked.length !== 1) throw new UsageError(`${asked.length ? `one revision at a time (got --${asked.join(', --')})` : 'say what to revise'}; ${REVISE_USAGE}`)
  const kind = asked[0]!
  const episode = flag(args, 'episode') !== undefined ? numberFlag(args, 'episode', 1) : undefined
  const text = (name: string) => { const value = flag(args, name); if (value === 'true') throw new UsageError(`--${name} needs a value`); return value }
  if (kind === 'shot') {
    const shot = numberFlag(args, 'shot', 0)
    if (!Number.isInteger(shot) || shot < 1) throw new UsageError('--shot is a shot number from 1')
    return { kind, shot, ...(episode !== undefined ? { episode } : {}), ...(text('note') ? { note: text('note') } : {}) }
  }
  if (kind === 'line') {
    const line = text('line')
    const newText = text('text')
    if (!line || !newText) throw new UsageError(`--line needs --text "the new English line"; ${REVISE_USAGE}`)
    return { kind, line, text: newText, ...(text('zh') ? { zh: text('zh') } : {}), ...(episode !== undefined ? { episode } : {}) }
  }
  const value = text(kind)
  if (!value) throw new UsageError(`--${kind} needs a value; ${REVISE_USAGE}`)
  return { kind, [kind]: value, ...(episode !== undefined ? { episode } : {}) }
}

/** Revise a finished project: one shot, one line, the grade or the score; only what depends on it is re-made. */
async function revise(args: ParsedArgs): Promise<number> {
  const id = args.positionals[0]
  if (!id) throw new UsageError(REVISE_USAGE)
  const request = revisionRequest(args)
  const state = await loadProject(id).catch(() => { throw new UsageError(`no project ${id} in ${projectsRoot()}`) })
  const format = (state.format ?? 'ad') as Format
  if (!isFormat(format)) throw new UsageError(`project ${id} has an unknown format ${format}`)
  try {
    print(await runRevision(REVISIONS[format], { id, request, withoutSkills: flag(args, 'without-skills') === 'true' }))
    return 0
  } catch (error) {
    if (!(error instanceof RevisionRefused)) throw error
    print({ revision: 'refused', reason: error.message })
    return 1
  }
}

/** Interchange for an online editor: EDL, FCPXML (+ FCP 7 XML) or OTIO, with stems, SRT and ASS. */
async function exportCommand(args: ParsedArgs): Promise<number> {
  const id = args.positionals[0]
  const format = flag(args, 'format')
  if (!id || !format || !INTERCHANGE_FORMATS.includes(format as InterchangeFormat)) throw new UsageError('usage: cinefoundry export <id> --format edl|fcpxml|otio [--episode E | --version master|15s|06s]')
  const state = await loadProject(id)
  const narrative = state.format === 'short' || state.format === 'drama'
  if (narrative && flag(args, 'version')) throw new UsageError('--version is for ad cutdowns; a narrative film exports an --episode')
  if (!narrative && flag(args, 'episode')) throw new UsageError('--episode is for narrative films; an ad exports a --version (master, 15s, 06s)')
  const label = narrative ? `ep${String(numberFlag(args, 'episode', 1)).padStart(2, '0')}` : flag(args, 'version', 'master')!
  print(await exportCut(projectDir(id), { label, format: format as InterchangeFormat }))
  return 0
}

export const COMMANDS: Record<string, Command> = { brand: brandCommand, ad: harnessCommand, short: narrativeCommand('short', SHORT_USAGE), drama: narrativeCommand('drama', DRAMA_USAGE), harness: harnessCommand, eval: evalCommand, project, image, video, 'copy-check': copyCheck, shots, mem, qa, cut, doctor, setup, studio, revise, export: exportCommand }
