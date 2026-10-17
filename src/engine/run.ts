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
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`
  const log = options.log ?? ((line: string) => console.error(line))
  const running = new Set<Stage>()
  let current: { id?: string } = {}

  const engine: EngineContext = {
    format: pipeline.id,
    request: options.brief,
    runId,
    started: Date.now(),
    log,
    record: async (stage, agent, endpoint, detail) => {
      if (!engine.dir) return
      await appendFile(join(engine.dir, 'reports', 'run.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), runId, format: pipeline.id, stage, agent, model: endpoint?.model, execution: endpoint?.execution ?? 'local-dgx-spark', ...detail })}\n`)
    },
    agentPrompt: async (role, skills) =>
      agentSystem(role, rules, options.withoutSkills ? undefined : await Promise.all((Array.isArray(skills) ? skills : [skills]).map(async (name) => ({ name, body: await loadSkill(name) })))),
    rest: async (phase, targets) => {
      const slept: string[] = []
      for (const target of targets) if (await sleepService(target.baseUrl).catch(() => false)) slept.push(target.name)
      if (slept.length) await engine.record('run', 'scheduler', undefined, { phase, sleeping: slept, availableAfterSleepGb: (await memoryStatus()).availableGb })
    },
    openProject: async ({ id, title, ratio, durationSeconds }) => {
      await createProject({ id, title, brief: options.brief, ratio, durationSeconds, runId, format: pipeline.id, stages: pipeline.stages.flatMap((s) => [s.id, ...(s.alsoMarks ?? [])]), folders: pipeline.folders })
      engine.projectId = id
      engine.dir = projectDir(id)
      current = { id }
      return engine.dir
    },
  }

  const mark = async (stage: Stage, status: 'running' | 'done' | 'failed', note?: string) => {
    if (!current.id) return
    if (status === 'running') running.add(stage)
    else running.delete(stage)
    await setStage(current.id, stage, status, note)
  }
  const failRunning = async (reason: string) => {
    for (const stage of [...running]) await mark(stage, 'failed', reason.slice(0, 300)).catch(() => undefined)
  }
  // A run stopped from outside (Ctrl-C, systemctl stop) never reaches the catch below; mark its stage before exiting.
  const onSignal = (signal: NodeJS.Signals) => {
    void failRunning(`interrupted (${signal})`).finally(async () => {
      await release()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    const ctx = await pipeline.init(options, engine)
    for (const stage of pipeline.stages) {
      if (stage.when && !stage.when(ctx)) continue
      for (const id of [stage.id, ...(stage.alsoMarks ?? [])]) await mark(id, 'running')
      const note = await stage.run(ctx)
      // The stage that opened the project could not mark itself running; it is done now all the same.
      for (const id of [stage.id, ...(stage.alsoMarks ?? [])]) await mark(id, 'done', note ?? undefined)
    }
    return await pipeline.finish(ctx)
  } catch (error) {
    await failRunning(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    await release()
  }
}
