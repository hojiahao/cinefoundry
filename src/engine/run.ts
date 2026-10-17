import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sleepService } from '../lib/rest.js'
import { memoryStatus } from '../lib/memory.js'
import { createProject, projectDir, setStage, type Stage } from '../lib/project.js'
import { agentSystem } from '../agent/prompts.js'
import { loadRules, loadSkill } from '../agent/skills.js'
import { takeRunLock } from './lock.js'
import type { EngineContext, PipelineDef } from './pipeline.js'

export interface EngineOptions {
  /** The client's request, verbatim. */
  brief: string
  /** Run the agents without their skills. Exists for the with/without-skill comparison only. */
  withoutSkills?: boolean
  log?: (line: string) => void
}

export type OpenProject = EngineContext['openProject']

/** A run's id: the start time to the second and the process, so two runs never share one. */
export const newRunId = () => `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`

/** The options worth keeping with the project (values, no functions): a revision reruns stages with the same ones. */
export function recordedOptions(options: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined && typeof value !== 'function'))
}

/**
 * The engine's half of every context: the run log, agent prompts, model scheduling and the project record. A pipeline
 * run and a revision (src/engine/revise.ts) build it the same way; `tags` go into every run.jsonl row of the run (a
 * revision tags its rows with its kind, its number and the run it revises).
 */
export function createEngineContext(input: { format: string; request: string; runId: string; rules: string; withoutSkills?: boolean; log: (line: string) => void; tags?: Record<string, unknown> }): EngineContext {
  const { format, runId, rules, log } = input
  const engine: EngineContext = {
    format,
    request: input.request,
    runId,
    started: Date.now(),
    log,
    record: async (stage, agent, endpoint, detail) => {
      if (!engine.dir) return
      await appendFile(join(engine.dir, 'reports', 'run.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), runId, format, ...(input.tags ?? {}), stage, agent, model: endpoint?.model, execution: endpoint?.execution ?? 'local-dgx-spark', ...detail })}\n`)
    },
    agentPrompt: async (role, skills) =>
      agentSystem(role, rules, input.withoutSkills ? undefined : await Promise.all((Array.isArray(skills) ? skills : [skills]).map(async (name) => ({ name, body: await loadSkill(name) })))),
    rest: async (phase, targets) => {
      const slept: string[] = []
      for (const target of targets) if (await sleepService(target.baseUrl).catch(() => false)) slept.push(target.name)
      if (slept.length) await engine.record('run', 'scheduler', undefined, { phase, sleeping: slept, availableAfterSleepGb: (await memoryStatus()).availableGb })
    },
    openProject: async () => { throw new Error('internal: this run works on an existing project and cannot open a new one') },
  }
  return engine
}

/**
 * Runs a pipeline: preflight, the one-film-at-a-time lock, then every stage in order. The engine keeps the studio
 * board truthful - a stage is marked running before it starts and done (with its note) after - and when a run throws
 * or is interrupted (Ctrl-C, a stopped unit), whatever stage was running is marked failed with the reason, because a
 * stage left "running" looks like a stalled job to whoever watches the board.
 */
export async function runPipeline<O extends EngineOptions, C extends EngineContext, R>(pipeline: PipelineDef<O, C, R>, options: O): Promise<R> {
  await pipeline.preflight(options)
  const release = await takeRunLock(options.brief)
  const rules = await loadRules()
  const runId = newRunId()
  const log = options.log ?? ((line: string) => console.error(line))
  let current: { id?: string } = {}

  const engine = createEngineContext({ format: pipeline.id, request: options.brief, runId, rules, withoutSkills: options.withoutSkills, log })
  engine.openProject = async ({ id, title, ratio, durationSeconds }) => {
    await createProject({ id, title, brief: options.brief, ratio, durationSeconds, runId, format: pipeline.id, stages: pipeline.stages.flatMap((s) => [s.id, ...(s.alsoMarks ?? [])]), folders: pipeline.folders, options: recordedOptions(options) })
    engine.projectId = id
    engine.dir = projectDir(id)
    current = { id }
    return engine.dir
  }
  const board = stageBoard(() => current.id)
  // A run stopped from outside (Ctrl-C, systemctl stop) never reaches the catch below; mark its stage before exiting.
  const detach = onInterrupt(board.failRunning, release)

  try {
    const ctx = await pipeline.init(options, engine)
    for (const stage of pipeline.stages) {
      if (stage.when && !stage.when(ctx)) continue
      for (const id of [stage.id, ...(stage.alsoMarks ?? [])]) await board.mark(id, 'running')
      const note = await stage.run(ctx)
      // The stage that opened the project could not mark itself running; it is done now all the same.
      for (const id of [stage.id, ...(stage.alsoMarks ?? [])]) await board.mark(id, 'done', note ?? undefined)
    }
    return await pipeline.finish(ctx)
  } catch (error) {
    await board.failRunning(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    detach()
    await release()
  }
}

/** The studio board of one run: stages marked running, done or failed, and whatever is running failed on a stop. */
export function stageBoard(projectId: () => string | undefined) {
  const running = new Set<Stage>()
  const mark = async (stage: Stage, status: 'running' | 'done' | 'failed', note?: string) => {
    const id = projectId()
    if (!id) return
    if (status === 'running') running.add(stage)
    else running.delete(stage)
    await setStage(id, stage, status, note)
  }
  const failRunning = async (reason: string) => {
    for (const stage of [...running]) await mark(stage, 'failed', reason.slice(0, 300)).catch(() => undefined)
  }
  return { mark, failRunning, running }
}

/** Ctrl-C or a stopped unit: fail the running stages, release the lock, exit. Returns the detach function. */
export function onInterrupt(failRunning: (reason: string) => Promise<void>, release: () => Promise<void>): () => void {
  const onSignal = (signal: NodeJS.Signals) => {
    void failRunning(`interrupted (${signal})`).finally(async () => {
      await release()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  return () => {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}
