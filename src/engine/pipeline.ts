import type { ModelEndpoint } from '../agent/llm.js'
import type { Stage } from '../lib/project.js'

/**
 * Cinefoundry Engine: one agent runtime for every kind of film. A format (ad, short video, micro-drama...) is a
 * Pipeline: an ordered list of stages, each run by an agent that works under one or more skills. The engine owns what
 * every production needs - the run lock, the project record, stage status, the run log, agent prompts, model
 * scheduling, failure handling - and the pipeline owns its craft: what each stage asks, checks and writes.
 */

/** Everything a stage can use. A pipeline extends it with its own artefacts (brief, script, storyboard...). */
export interface EngineContext {
  /** The format this run belongs to. */
  format: string
  /** The client's request, verbatim. */
  request: string
  runId: string
  started: number
  log: (line: string) => void
  /** One line in reports/run.jsonl: every model call, measurement and decision, tagged with this run. */
  record: (stage: Stage | 'run', agent: string, endpoint: ModelEndpoint | undefined, detail: Record<string, unknown>) => Promise<void>
  /** System prompt for an agent: its role, the studio rules, and the skills it works under (none in the without-skill eval). */
  agentPrompt: (role: string, skills: string | string[]) => Promise<string>
  /** Put language models to sleep while diffusion models work; they wake on demand. */
  rest: (phase: string, targets: ModelEndpoint[]) => Promise<void>
  /** The first stage calls this once it knows the project's id: creates the project record with this format's stages. */
  openProject: (input: { id: string; title: string; ratio: string; durationSeconds: number }) => Promise<string>
  /** Set once the project exists (after the stage that names it). */
  projectId?: string
  dir?: string
}

export interface StageDef<C extends EngineContext> {
  id: Stage
  /** Shown on the studio board and in the log. */
  label: string
  /** Stages whose status is set together with this one (frames + qa run as one loop), each with its board label. */
  alsoMarks?: Array<{ id: Stage; label: string }>
  /** Skip the stage (e.g. no clips in a plan-only run). A skipped stage stays pending. */
  when?: (ctx: C) => boolean
  /** Runs the stage. The returned string is the note on the studio board. */
  run: (ctx: C) => Promise<string | void>
}

export interface PipelineDef<O, C extends EngineContext, R> {
  id: string
  title: string
  /** Stage ids in order, as recorded in the project state (the first stage creates the project). */
  stages: StageDef<C>[]
  /** Folders every project of this format has. */
  folders: string[]
  /** Everything checkable before the first model call. Throws with every problem at once. */
  preflight: (options: O) => Promise<void>
  /** Extend the engine's context with the pipeline's own state (the same object: stages and the engine share it). */
  init: (options: O, engine: EngineContext) => Promise<C>
  /** The run's result, after the last stage (or after a plan-only stop). */
  finish: (ctx: C) => Promise<R>
}
