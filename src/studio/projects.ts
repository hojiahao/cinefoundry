import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { PIPELINES, isFormat, type Format } from '../pipelines/index.js'
import { loadProject, projectDir, projectsRoot, type Asset, type ProjectState, type StageStatus } from '../lib/project.js'
import type { QcCheck, QcReport, QcVerdict } from '../crafts/qc.js'
import type { Packaging } from '../crafts/narrative/packaging.js'
import type { CharacterRecord } from '../crafts/narrative/casting.js'
import type { NarrativeShot, Screenplay, SeriesBible } from '../crafts/narrative/types.js'

/**
 * What the studio shows of a project, read from its folder: the stage list it recorded, and per format the things it
 * produces (an ad's master and cutdowns, a series' bible, cast and episodes, a short's packaging). Every file is
 * optional: a project is shown as far as it got, and a project made before formats existed is an ad.
 */

/** Chinese names of the formats, as the studio shows them. */
export const FORMAT_NAMES: Record<Format, string> = { ad: '广告片', short: '短视频', drama: '微短剧' }

/** Board labels of one format's stages, from the pipeline's own StageDefs (alsoMarks included), in pipeline order. */
export function stageLabels(format: Format): Array<{ id: string; label: string }> {
  return PIPELINES[format].stages.flatMap((stage) => [{ id: stage.id, label: stage.label }, ...(stage.alsoMarks ?? [])])
}

/** A stage id no longer in its format's pipeline (an older project) still gets a label if any format knows it. */
function labelFor(format: Format, id: string): string {
  const own = stageLabels(format).find((stage) => stage.id === id)
  if (own) return own.label
  for (const other of Object.keys(PIPELINES) as Format[]) {
    const found = stageLabels(other).find((stage) => stage.id === id)
    if (found) return found.label
  }
  return id
}

export const formatOf = (state: Pick<ProjectState, 'format'>): Format => (state.format && isFormat(state.format) ? state.format : 'ad')

export interface StageView { id: string; label: string; status: StageStatus; note?: string; updatedAt?: string }

export interface ProjectSummary {
  id: string
  format: Format
  formatName: string
  title: string
  brief: string
  ratio: string
  durationSeconds: number
  createdAt: string
  updatedAt: string
  stages: StageView[]
  /** running / failed when any stage is; done when every stage is; otherwise the run stopped (e.g. a plan-only run). */
  status: 'running' | 'failed' | 'done' | 'stopped'
  /** A picture that stands for the project on the board: a short's cover, an ad's hero, a narrative's first frame. */
  cover?: string
  /** The finished film, when there is one: the ad master or the first episode. */
  film?: string
}

const exists = (path: string) => stat(path).then((info) => info.isFile(), () => false)
const readJson = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}
const pad2 = (n: number) => String(n).padStart(2, '0')
const pad3 = (n: number) => String(n).padStart(3, '0')
const byId = (state: ProjectState, id: string): Asset | undefined => state.assets.find((asset) => asset.id === id)

export async function summarize(state: ProjectState): Promise<ProjectSummary> {
  const format = formatOf(state)
  const stages = Object.entries(state.stages ?? {}).map(([id, stage]) => ({ id, label: labelFor(format, id), status: stage.status, note: stage.note, updatedAt: stage.updatedAt }))
  const status = stages.some((s) => s.status === 'running') ? 'running' : stages.some((s) => s.status === 'failed') ? 'failed' : stages.length && stages.every((s) => s.status === 'done') ? 'done' : 'stopped'
  const dir = projectDir(state.id)
  const assets = state.assets ?? []
  const firstFrame = assets.filter((a) => a.kind === 'image' && a.stage === 'frames' && a.shot !== undefined).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))[0]
  let cover: string | undefined
  let film: string | undefined
  if (format === 'ad') {
    cover = (byId(state, 'frame-1') ?? byId(state, 'product-hero') ?? firstFrame)?.path
    film = byId(state, 'final-cut')?.path
  } else {
    if (format === 'short' && (await exists(join(dir, 'cut', 'cover.jpg')))) cover = 'cut/cover.jpg'
    cover ??= firstFrame?.path ?? assets.find((a) => a.stage === 'casting' && a.path.endsWith('/master.png'))?.path
    film = assets.filter((a) => a.id.startsWith('episode-')).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))[0]?.path
  }
  return {
    id: state.id, format, formatName: FORMAT_NAMES[format], title: state.title, brief: state.brief, ratio: state.ratio, durationSeconds: state.durationSeconds,
    createdAt: state.createdAt, updatedAt: state.updatedAt, stages, status, cover, film,
  }
}

/** Every readable project, most recently updated first. Folders that are not projects (.archive, .uploads) are skipped. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const ids = await readdir(projectsRoot()).catch(() => [] as string[])
  const states = await Promise.all(ids.map((id) => loadProject(id).catch(() => undefined)))
  const valid = states.filter((state): state is ProjectState => Boolean(state?.id && state.stages))
  const summaries = await Promise.all(valid.map(summarize))
  return summaries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

// ---------------------------------------------------------------- detail

export interface QcView { label: string; file: string; verdict: QcVerdict; width?: number; height?: number; fps?: number; seconds?: number; loudness?: number; truePeak?: number; results: QcCheck[] }

export interface Deliverable { id: string; label: string; path: string; seconds?: number; qc?: QcView }

export interface AdShotView {
  shot: number
  seconds?: number
  framing?: string
  camera?: string
  onScreenText?: string
  voiceover?: string
  frame?: string
  clip?: string
  gate?: string
  execution?: Asset['execution']
}

export interface AdDetail {
  format: 'ad'
  brief?: { product?: string; audience?: string; message?: string; tone?: string; category?: string; brandText?: string }
  treatment?: { insight?: string; proposition?: string; concept?: string }
  hero?: { path: string; gate?: string; execution: Asset['execution'] }
  deliverables: Deliverable[]
  shots: AdShotView[]
}

export interface CastView {
  id: string
  name: string
  role: string
  age: number
  gender: string
  arc: string
  wardrobe: string
  portrait?: string
  /** The casting-library voice id, or "designed" for a voice made for this character. */
  voice?: string
  voiceDescription?: string
  gate?: number
}

export interface NarrativeShotView {
  shot: number
  scene: number
  framing: string
  camera: string
  frame?: string
  clip?: string
  gate?: string
  line?: { speaker: string; zh: string; en: string }
}

export interface EpisodeView {
  episode: number
  title: string
  synopsis: string
  hook: string
  cliffhanger: string
  scenes?: number
  lines?: number
  shots: NarrativeShotView[]
  cut?: string
  qc?: QcView
}

export interface NarrativeDetail {
  format: 'short' | 'drama'
  bible?: { logline: string; genre: string; world: string; look: string }
  cast: CastView[]
  episodes: EpisodeView[]
  packaging?: Packaging & { coverImage?: string }
}

export type ProjectDetail = ProjectSummary & { links: Array<{ label: string; path: string }>; qc: QcView[]; detail: AdDetail | NarrativeDetail }

function qcView(report: QcReport): QcView {
  const video = report.measured?.probe?.video
  return {
    label: report.label, file: report.file, verdict: report.verdict, results: report.results ?? [],
    width: video?.width ?? report.spec?.width, height: video?.height ?? report.spec?.height, fps: report.spec?.fps,
    seconds: report.measured?.probe?.seconds ?? report.spec?.seconds, loudness: report.measured?.loudness?.integrated, truePeak: report.measured?.loudness?.truePeak,
  }
}

async function adDetail(state: ProjectState, dir: string, qc: QcView[]): Promise<AdDetail> {
  const brief = await readJson<AdDetail['brief']>(join(dir, 'brief.json'))
  const treatment = await readJson<AdDetail['treatment']>(join(dir, 'creative', 'treatment.json'))
  const storyboard = await readJson<{ shots?: Array<{ shot: number; seconds?: number; framing?: string; camera?: string; on_screen_text?: string }> }>(join(dir, 'storyboard', 'storyboard.json'))
  const script = await readJson<{ beats?: Array<{ beat: number; vo?: string; zh?: string }> }>(join(dir, 'script', 'script.json'))
  const hero = byId(state, 'product-hero')
  const qcOf = (label: string) => qc.find((report) => report.label === label)
  const deliverables: Deliverable[] = []
  const master = byId(state, 'final-cut')
  if (master) deliverables.push({ id: 'master', label: '主片', path: master.path, seconds: qcOf('master')?.seconds, qc: qcOf('master') })
  for (const [id, label] of [['15s', '15 秒版'], ['06s', '6 秒版']] as const) {
    const asset = byId(state, `final-${id}`)
    const path = asset?.path ?? `cut/final_${id}.mp4`
    if (asset || (await exists(join(dir, path)))) deliverables.push({ id, label, path, seconds: qcOf(id)?.seconds ?? asset?.seconds, qc: qcOf(id) })
  }
  const shotNumbers = new Set<number>([...(storyboard?.shots ?? []).map((s) => s.shot), ...state.assets.filter((a) => a.shot !== undefined && (a.stage === 'frames' || a.stage === 'clips')).map((a) => a.shot!)])
  const shots = [...shotNumbers].sort((a, b) => a - b).map((n): AdShotView => {
    const board = storyboard?.shots?.find((s) => s.shot === n)
    const beat = script?.beats?.find((b) => b.beat === n)
    const frame = byId(state, `frame-${n}`)
    return {
      shot: n, seconds: board?.seconds, framing: board?.framing, camera: board?.camera, onScreenText: board?.on_screen_text || undefined, voiceover: beat?.zh ?? beat?.vo,
      frame: frame?.path, clip: byId(state, `clip-${n}`)?.path, gate: frame?.note, execution: frame?.execution,
    }
  })
  return {
    format: 'ad',
    brief: brief && { product: brief.product, audience: brief.audience, message: brief.message, tone: brief.tone, category: brief.category, brandText: brief.brandText },
    treatment: treatment && { insight: treatment.insight, proposition: treatment.proposition, concept: treatment.concept },
    hero: hero && { path: hero.path, gate: hero.note, execution: hero.execution },
    deliverables,
    shots,
  }
}

async function narrativeDetail(state: ProjectState, format: 'short' | 'drama', dir: string, qc: QcView[]): Promise<NarrativeDetail> {
  const bible = await readJson<SeriesBible>(join(dir, 'story', 'bible.json'))
  const cast = await Promise.all((bible?.characters ?? []).map(async (character): Promise<CastView> => {
    const record = await readJson<CharacterRecord>(join(dir, 'cast', character.id, 'character.json'))
    const masterPath = `cast/${character.id}/${record?.images?.master?.path ?? 'master.png'}`
    return {
      id: character.id, name: character.name, role: character.role, age: character.age, gender: character.gender, arc: character.arc, wardrobe: record?.wardrobe ?? character.wardrobe,
      portrait: (await exists(join(dir, masterPath))) ? masterPath : undefined,
      voice: record?.voice ? (record.voice.library ?? (record.voice.wav ? 'designed' : undefined)) : undefined,
      voiceDescription: record?.voice?.description ?? character.voice,
      gate: record?.images?.master?.score,
    }
  }))
  const names = new Map((bible?.characters ?? []).map((c) => [c.id, c.name]))
  const plans = bible?.episodes?.length ? bible.episodes : [{ episode: 1, title: state.title, synopsis: '', hook: '', cliffhanger: '' }]
  const episodes = await Promise.all(plans.map(async (plan): Promise<EpisodeView> => {
    const ep = plan.episode
    const play = await readJson<Screenplay>(join(dir, 'story', `ep${pad2(ep)}.screenplay.json`))
    const boards = (await readJson<NarrativeShot[]>(join(dir, 'storyboard', `ep${pad2(ep)}.shots.json`))) ?? []
    const shots = await Promise.all(boards.map(async (shot): Promise<NarrativeShotView> => {
      const name = `ep${pad2(ep)}_shot_${pad3(shot.shot)}`
      const asset = byId(state, `frame-${ep}-${shot.shot}`)
      const frame = asset?.path ?? ((await exists(join(dir, 'frames', `${name}.png`))) ? `frames/${name}.png` : undefined)
      const clip = (await exists(join(dir, 'clips', `${name}.mp4`))) ? `clips/${name}.mp4` : undefined
      const spoken = shot.line !== undefined ? play?.scenes?.find((s) => s.scene === shot.scene)?.lines?.[shot.line] : undefined
      return {
        shot: shot.shot, scene: shot.scene, framing: shot.framing, camera: shot.camera, frame, clip, gate: asset?.note,
        line: spoken && { speaker: spoken.speaker === 'vo' ? '旁白' : (names.get(spoken.speaker) ?? spoken.speaker), zh: spoken.zh, en: spoken.en },
      }
    }))
    const cutAsset = byId(state, `episode-${ep}`)
    const cut = cutAsset?.path ?? ((await exists(join(dir, 'cut', `ep${pad2(ep)}.mp4`))) ? `cut/ep${pad2(ep)}.mp4` : undefined)
    return {
      episode: ep, title: plan.title, synopsis: plan.synopsis, hook: plan.hook, cliffhanger: plan.cliffhanger,
      scenes: play?.scenes?.length, lines: play?.scenes?.reduce((sum, s) => sum + (s.lines?.length ?? 0), 0), shots, cut, qc: qc.find((r) => r.label === `ep${pad2(ep)}`),
    }
  }))
  let packaging: NarrativeDetail['packaging']
  if (format === 'short') {
    const pack = await readJson<Packaging>(join(dir, 'reports', 'packaging.json'))
    if (pack) packaging = { ...pack, coverImage: (await exists(join(dir, 'cut', 'cover.jpg'))) ? 'cut/cover.jpg' : undefined }
  }
  return { format, bible: bible && { logline: bible.logline, genre: bible.genre, world: bible.world, look: bible.look }, cast, episodes, packaging }
}

/** Everything the project page shows. Undefined when the id names no project. */
export async function projectDetail(id: string): Promise<ProjectDetail | undefined> {
  let state: ProjectState
  try {
    state = await loadProject(id)
  } catch {
    return undefined
  }
  state.assets ??= []
  const summary = await summarize(state)
  const dir = projectDir(id)
  const reports = await readJson<QcReport[]>(join(dir, 'reports', 'qc.json'))
  const qc = Array.isArray(reports) ? reports.map(qcView) : []
  const detail = summary.format === 'ad' ? await adDetail(state, dir, qc) : await narrativeDetail(state, summary.format, dir, qc)
  const candidates: Array<[string, string]> = summary.format === 'ad'
    ? [['交付报告', 'reports/delivery.md'], ['创意', 'creative/treatment.json'], ['脚本', 'script/script.json'], ['分镜', 'storyboard/storyboard.json'], ['合规', 'reports/compliance.json'], ['技术质检', 'reports/qc.json'], ['运行记录', 'reports/run.jsonl']]
    : [['剧集设定', 'story/bible.json'], ['技术质检', 'reports/qc.json'], ['平台包装', 'reports/packaging.json'], ['运行记录', 'reports/run.jsonl']]
  const links = (await Promise.all(candidates.map(async ([label, path]) => ((await exists(join(dir, path))) ? { label, path } : undefined)))).filter((link): link is { label: string; path: string } => Boolean(link))
  return { ...summary, links, qc, detail }
}
