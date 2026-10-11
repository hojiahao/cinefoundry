import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export type StageStatus = 'pending' | 'running' | 'done' | 'failed'

export const STAGES = ['brief', 'script', 'compliance', 'storyboard', 'frames', 'qa', 'clips', 'cut'] as const
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
  return resolve(process.env.CINELOOM_PROJECTS ?? 'projects')
}

export function projectDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid project id ${JSON.stringify(id)}; use lowercase letters, digits and dashes.`)
  return join(projectsRoot(), id)
}

export async function createProject(input: Pick<ProjectState, 'id' | 'title' | 'brief' | 'ratio' | 'durationSeconds'>): Promise<ProjectState> {
  const now = new Date().toISOString()
  const state: ProjectState = {
    ...input,
    createdAt: now,
    updatedAt: now,
    stages: Object.fromEntries(STAGES.map((stage) => [stage, { status: 'pending' }])) as ProjectState['stages'],
    assets: [],
  }
  state.stages.brief = { status: 'done', updatedAt: now }
  for (const folder of ['script', 'storyboard', 'frames', 'clips', 'cut', 'reports']) {
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
  // Write-then-rename so the studio never reads a half-written file.
  await writeFile(`${target}.tmp`, JSON.stringify(state, null, 2))
  await rename(`${target}.tmp`, target)
}

export async function setStage(id: string, stage: Stage, status: StageStatus, note?: string): Promise<ProjectState> {
  const state = await loadProject(id)
  state.stages[stage] = { status, note, updatedAt: new Date().toISOString() }
  await saveProject(state)
  return state
}

export async function addAsset(id: string, asset: Omit<Asset, 'createdAt'>): Promise<ProjectState> {
  const state = await loadProject(id)
  state.assets = state.assets.filter((existing) => existing.id !== asset.id)
  state.assets.push({ ...asset, createdAt: new Date().toISOString() })
  await saveProject(state)
  return state
}
