import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import { loadRules } from '../agent/skills.js'
import { loadProject, projectDir, type ProjectState, type Stage } from '../lib/project.js'
import { takeRunLock } from './lock.js'
import type { EngineContext } from './pipeline.js'
import { createEngineContext, newRunId, onInterrupt, stageBoard } from './run.js'

/**
 * Revisions: the changes a client asks for after delivery ("redo shot 3", "change this line", "make it warmer"), made as
 * partial pipeline runs on the project's recorded state. A revision takes the run lock like any run, gets its own runId
 * (every run.jsonl row it writes carries kind "revision", its number and the run it revises), re-runs only the stages
 * the change touches, keeps every file it replaces under a versioned name (clips/shot_003.v1.mp4), and is recorded in
 * reports/revisions.json, which the delivery report turns into its revision history. Each format supplies a
 * RevisionDef: how to load its state, what a request re-runs, and how to run it with the pipeline's own stage functions.
 */

export type RevisionKind = 'shot' | 'line' | 'grade' | 'music'

export interface RevisionRequest {
  kind: RevisionKind
  /** Shot to redo (`--shot`), in the episode for a narrative film. */
  shot?: number
  /** Episode of a narrative film (default 1 for shot and line revisions, every cut episode for finishing). */
  episode?: number
  /** What to change in the shot, applied by the storyboard artist to the frame prompt; none is a new seed. */
  note?: string
  /** The line: an ad beat ("2") or a narrative scene.line ("3.1", both from 1). */
  line?: string
  /** The new English line, and its Chinese subtitle (translated by the copy editor when absent). */
  text?: string
  zh?: string
  /** Grade adjustment by name (src/crafts/finishing.ts). */
  grade?: string
  /** The score's new direction. */
  music?: string
}

/** A revision that would break a rule (a non-compliant line, a shot that does not exist): nothing was changed. */
export class RevisionRefused extends Error {}

export interface RevisionChange {
  /** Relative to the project. */
  path: string
  /** Where the replaced file was kept; absent for a file the revision created. */
  previous?: string
}

export interface RevisionRecord {
  revision: number
  runId: string
  /** The run that made the project. */
  baseRunId?: string
  request: RevisionRequest
  summary: string
  status: 'done' | 'refused' | 'failed'
  reason?: string
  startedAt: string
  finishedAt: string
  wallSeconds: number
  stages: Stage[]
  changed: RevisionChange[]
  /** The deliverables re-cut ("master", "15s", "ep01"). */
  deliverables: string[]
  qc?: string
  notes: string[]
}

/** What a revision context adds to the engine's: its number and the versioning of every file it replaces. */
export interface RevisionTools {
  revision: number
  /** Before a file is overwritten: keep a copy under its next versioned name and record the change. */
  keep: (...paths: string[]) => Promise<void>
  /** Record a file the revision created (a new frame). */
  created: (...paths: string[]) => void
}

export interface RevisionPlan {
  /** Board stages the revision re-runs; they are marked running, then done (or failed). */
  stages: Stage[]
  summary: string
}

export interface RevisionOutcome {
  deliverables: string[]
  qc?: string
  notes?: string[]
}

export interface RevisionDef<C extends EngineContext> {
  /** The pipeline context from the project's recorded state (its files, state.json, run.jsonl). */
  load: (engine: EngineContext & RevisionTools, state: ProjectState) => Promise<C & RevisionTools>
  /** Everything checked before any media work; a request that cannot be honoured throws RevisionRefused. */
  plan: (ctx: C & RevisionTools, request: RevisionRequest) => Promise<RevisionPlan>
  run: (ctx: C & RevisionTools, request: RevisionRequest) => Promise<RevisionOutcome>
  /** Rewrite the delivery report (with the revision history). */
  report: (ctx: C & RevisionTools) => Promise<void>
}

export const revisionsPath = (dir: string) => join(dir, 'reports', 'revisions.json')

export async function loadRevisions(dir: string): Promise<RevisionRecord[]> {
  if (!existsSync(revisionsPath(dir))) return []
  return JSON.parse(await readFile(revisionsPath(dir), 'utf8')) as RevisionRecord[]
}

async function saveRevision(dir: string, record: RevisionRecord): Promise<void> {
  const all = (await loadRevisions(dir)).filter((r) => r.revision !== record.revision)
  await mkdir(join(dir, 'reports'), { recursive: true })
  await writeFile(revisionsPath(dir), `${JSON.stringify([...all, record].sort((a, b) => a.revision - b.revision), null, 2)}\n`)
}

/** One line for logs, the lock and the board. */
export function describeRevision(request: RevisionRequest): string {
  const where = request.episode !== undefined ? ` of episode ${request.episode}` : ''
  if (request.kind === 'shot') return `redo shot ${request.shot}${where}${request.note ? `: ${request.note}` : ' (new seed)'}`
  if (request.kind === 'line') return `line ${request.line}${where}: "${request.text}"${request.zh ? ` / ${request.zh}` : ''}`
  if (request.kind === 'grade') return `grade ${request.grade}`
  return `music: ${request.music}`
}

/** The versioned name a replaced file is kept under: shot_003.mp4 -> shot_003.v1.mp4 (the first free number). */
export function versionedName(path: string, n: number): string {
  const ext = extname(path)
  return join(dirname(path), `${basename(path, ext)}.v${n}${ext}`)
}

export function nextVersionedName(path: string): string {
  let n = 1
  while (existsSync(versionedName(path, n))) n++
  return versionedName(path, n)
}

function versioner(dir: string): RevisionTools & { changes: RevisionChange[] } {
  const changes: RevisionChange[] = []
  const shown = (path: string) => (isAbsolute(path) && path.startsWith(`${dir}/`) ? relative(dir, path) : path)
  const seen = new Set<string>()
  return {
    revision: 0,
    changes,
    keep: async (...paths) => {
      for (const raw of paths) {
        const path = isAbsolute(raw) ? raw : join(dir, raw)
        if (seen.has(path)) continue
        seen.add(path)
        if (!existsSync(path)) { changes.push({ path: shown(path) }); continue }
        const previous = nextVersionedName(path)
        await copyFile(path, previous)
        changes.push({ path: shown(path), previous: shown(previous) })
      }
    },
    created: (...paths) => {
      for (const raw of paths) {
        const path = isAbsolute(raw) ? raw : join(dir, raw)
        if (!seen.has(path)) { seen.add(path); changes.push({ path: shown(path) }) }
      }
    },
  }
}

/**
 * Run one revision of a finished project: the lock, a revision runId, the format's plan (refusals happen here, before
 * anything is touched), its stages marked on the board, the run, the record and the delivery report. A refused or failed
 * revision is recorded too, with its reason; the deliverables it did not reach are left as they were.
 */
export async function runRevision<C extends EngineContext>(def: RevisionDef<C>, input: { id: string; request: RevisionRequest; log?: (line: string) => void; withoutSkills?: boolean }): Promise<RevisionRecord> {
  const { id, request } = input
  const dir = projectDir(id)
  if (!existsSync(join(dir, 'state.json'))) throw new RevisionRefused(`no project ${id} in ${dirname(dir)}`)
  const state = await loadProject(id)
  const summary = describeRevision(request)
  const log = input.log ?? ((line: string) => console.error(line))
  const release = await takeRunLock(`revise ${id}: ${summary}`)
  const board = stageBoard(() => id)
  const detach = onInterrupt(board.failRunning, release)
  const started = Date.now()
  try {
    const number = (await loadRevisions(dir)).reduce((max, r) => Math.max(max, r.revision), 0) + 1
    const runId = newRunId()
    const format = state.format ?? 'ad'
    const engine = createEngineContext({ format, request: summary, runId, rules: await loadRules(), withoutSkills: input.withoutSkills, log, tags: { kind: 'revision', revision: number, ...(state.runId ? { baseRunId: state.runId } : {}) } })
    engine.projectId = id
    engine.dir = dir
    const tools = versioner(dir)
    tools.revision = number
    const record = (status: RevisionRecord['status'], extra: Partial<RevisionRecord>): RevisionRecord => ({
      revision: number, runId, ...(state.runId ? { baseRunId: state.runId } : {}), request, summary, status, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(),
      wallSeconds: (Date.now() - started) / 1000, stages: [], changed: tools.changes, deliverables: [], notes: [], ...extra,
    })
    log(`▸ revision ${number}  ${summary}`)
    await engine.record('revision', 'revision', undefined, { status: 'started', request })
    let ctx: C & RevisionTools
    let plan: RevisionPlan
    try {
      ctx = await def.load(Object.assign(engine, { revision: number, keep: tools.keep, created: tools.created }), state)
      plan = await def.plan(ctx, request)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const refused = error instanceof RevisionRefused
      const entry = record(refused ? 'refused' : 'failed', { reason })
      await saveRevision(dir, entry)
      await engine.record('revision', 'revision', undefined, { status: entry.status, reason })
      log(`  revision ${number} ${entry.status}: ${reason}`)
      if (refused) await def.report(ctx!).catch(() => undefined)
      throw error
    }
    const stages = plan.stages.filter((stage) => stage in state.stages)
    for (const stage of stages) await board.mark(stage, 'running', `revision ${number}: ${plan.summary}`)
    try {
      const outcome = await def.run(ctx, request)
      for (const stage of stages) await board.mark(stage, 'done', `revision ${number}: ${plan.summary}`)
      const entry = record('done', { stages, deliverables: outcome.deliverables, ...(outcome.qc ? { qc: outcome.qc } : {}), notes: outcome.notes ?? [] })
      await saveRevision(dir, entry)
      await engine.record('revision', 'revision', undefined, { status: 'done', wallSeconds: entry.wallSeconds, changed: entry.changed, deliverables: entry.deliverables, qc: entry.qc ?? null })
      await def.report(ctx)
      log(`▸ revision ${number}  done in ${entry.wallSeconds.toFixed(1)} s · ${entry.deliverables.join(' · ') || 'no deliverable re-cut'}`)
      return entry
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await board.failRunning(`revision ${number}: ${reason}`)
      const entry = record(error instanceof RevisionRefused ? 'refused' : 'failed', { stages, reason })
      await saveRevision(dir, entry)
      await engine.record('revision', 'revision', undefined, { status: entry.status, reason })
      throw error
    }
  } finally {
    detach()
    await release()
  }
}

/** The revision history for a delivery report (Chinese, as the report is), built from reports/revisions.json. */
export async function revisionHistoryMarkdown(dir: string): Promise<string> {
  const all = await loadRevisions(dir)
  if (!all.length) return '无。'
  const what = (r: RevisionRequest) => {
    const where = r.episode !== undefined ? `第 ${r.episode} 集` : ''
    if (r.kind === 'shot') return `${where}重做镜头 ${r.shot}${r.note ? `：“${r.note}”` : '（换种子重生成）'}`
    if (r.kind === 'line') return `${where}修改台词 ${r.line}：“${r.text}”${r.zh ? ` / ${r.zh}` : ''}`
    if (r.kind === 'grade') return `调色：${r.grade}`
    return `配乐方向：“${r.music}”`
  }
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const result = (r: RevisionRecord) => (r.status === 'done' ? `完成${r.qc ? ` · 质检 ${r.qc}` : ''}` : `${r.status === 'refused' ? '拒绝' : '失败'}：${cell((r.reason ?? '').slice(0, 160))}`)
  const rows = all.map((r) => `| ${r.revision} | ${r.finishedAt.slice(0, 16).replace('T', ' ')} | ${cell(what(r.request))} | ${result(r)} | ${r.deliverables.join('、') || '-'} | ${r.changed.length ? cell(r.changed.map((c) => `\`${c.path}\``).join('、')) : '-'} | ${r.changed.filter((c) => c.previous).map((c) => `\`${c.previous}\``).join('、') || '-'} |`)
  return `| 修订 | 时间 (UTC) | 要求 | 结果 | 重新交付 | 改动的文件 | 保留的旧版本 |
|---:|---|---|---|---|---|---|
${rows.join('\n')}

每次修订单独记录于 \`reports/revisions.json\` 与 \`reports/run.jsonl\`（kind: revision）。`
}
