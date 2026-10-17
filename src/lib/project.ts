import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export type StageStatus = 'pending' | 'running' | 'done' | 'failed'

export const STAGES = ['brief', 'creative', 'script', 'compliance', 'storyboard', 'frames', 'qa', 'clips', 'cut'] as const
export type Stage = (typeof STAGES)[number]

export interface Asset {
  id: string
  kind: 'image' | 'video' | 'audio' | 'document'
  stage: Stage
  path: string
  shot?: number
  /** Where the asset was produced. Shown in the studio so local and cloud work stay distinguishable. */
  execution: 'local-dgx-spark' | 'cloud' | 'user-supplied'
  model?: string
  seconds?: number
  note?: string
  createdAt: string
}

export interface ProjectState {
  id: string
  /** The harness run that produced this state; every run.jsonl record carries it, so a report reads one run only. */
  runId?: string
  title: string
  brief: string
  ratio: string
  durationSeconds: number
  createdAt: string
  updatedAt: string
  stages: Record<Stage, { status: StageStatus; note?: string; updatedAt?: string }>
  assets: Asset[]
}

export function projectsRoot(): string {
  return resolve(process.env.CINEFOUNDRY_PROJECTS ?? 'projects')
}

export function projectDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid project id ${JSON.stringify(id)}; use lowercase letters, digits and dashes.`)
  return join(projectsRoot(), id)
}

export async function createProject(input: Pick<ProjectState, 'id' | 'title' | 'brief' | 'ratio' | 'durationSeconds'> & { runId?: string }): Promise<ProjectState> {
  const now = new Date().toISOString()
  const state: ProjectState = {
    ...input,
    createdAt: now,
    updatedAt: now,
    stages: Object.fromEntries(STAGES.map((stage) => [stage, { status: 'pending' }])) as ProjectState['stages'],
    assets: [],
  }
  state.stages.brief = { status: 'done', updatedAt: now }
  for (const folder of ['creative', 'script', 'storyboard', 'frames', 'clips', 'cut', 'reports']) {
    await mkdir(join(projectDir(input.id), folder), { recursive: true })
  }
  await saveProject(state)
  return state
}

export async function loadProject(id: string): Promise<ProjectState> {
  return JSON.parse(await readFile(join(projectDir(id), 'state.json'), 'utf8')) as ProjectState
}

export async function saveProject(state: ProjectState): Promise<void> {
  state.updatedAt = new Date().toISOString()
  const target = join(projectDir(state.id), 'state.json')
  // Write-then-rename so the studio never reads a half-written file; a unique temp name so two writers never share one.
  const temp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(temp, JSON.stringify(state, null, 2))
  await rename(temp, target)
}

/**
 * Read-modify-write of state.json, one at a time per project within this process: in queue mode every shot's frame
 * work finishes on its own and two addAsset calls a few milliseconds apart lost an update or failed the rename.
 */
const updates = new Map<string, Promise<unknown>>()
export function updateProject(id: string, change: (state: ProjectState) => void): Promise<ProjectState> {
  const run = async () => {
    const state = await loadProject(id)
    change(state)
    await saveProject(state)
    return state
  }
  const next = (updates.get(id) ?? Promise.resolve()).then(run, run)
  updates.set(id, next.catch(() => undefined))
  return next
}

export function setStage(id: string, stage: Stage, status: StageStatus, note?: string): Promise<ProjectState> {
  return updateProject(id, (state) => { state.stages[stage] = { status, note, updatedAt: new Date().toISOString() } })
}

export function addAsset(id: string, asset: Omit<Asset, 'createdAt'>): Promise<ProjectState> {
  return updateProject(id, (state) => {
    state.assets = state.assets.filter((existing) => existing.id !== asset.id)
    state.assets.push({ ...asset, createdAt: new Date().toISOString() })
  })
}

export function projectExists(id: string): boolean {
  return existsSync(join(projectDir(id), 'state.json'))
}

/** Move a previous run of this id out of the way (projects/.archive/<id>-<time>) instead of overwriting it. */
export async function archiveProject(id: string): Promise<string | undefined> {
  if (!existsSync(projectDir(id))) return undefined
  const target = join(projectsRoot(), '.archive', `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(join(projectsRoot(), '.archive'), { recursive: true })
  await rename(projectDir(id), target)
  return target
}
