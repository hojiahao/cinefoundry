import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../lib/config.js'
import { INTERPOLATION_MODEL, VIDEO_MODELS } from '../lib/media.js'
import { REPO_ROOT } from './manifest.js'

/** The ComfyUI model folder each loader node reads its file from. */
export const LOADER_FOLDERS: Record<string, string> = {
  UNETLoader: 'diffusion_models',
  CLIPLoader: 'text_encoders',
  VAELoader: 'vae',
  LoraLoaderModelOnly: 'loras',
  CheckpointLoaderSimple: 'checkpoints',
  LatentUpscaleModelLoader: 'latent_upscale_models',
  FrameInterpolationModelLoader: 'frame_interpolation',
}

type Graph = Record<string, { class_type?: string; inputs?: Record<string, unknown> } | string>

export const workflowDir = () => env('CINEFOUNDRY_WORKFLOWS') ?? join(REPO_ROOT, 'workflows')

export function loadWorkflows(dir = workflowDir()): Record<string, Graph> {
  return Object.fromEntries(readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => [name.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, name), 'utf8')) as Graph]))
}

/** Values the code fills into a workflow's model placeholders (src/lib/media.ts): every candidate, per placeholder. */
export function placeholderCandidates(workflow: string): Record<string, string[]> {
  const candidates: Record<string, Set<string>> = {}
  for (const model of Object.values(VIDEO_MODELS)) {
    if (![model.i2v, model.t2v, model.lipsync].includes(workflow)) continue
    for (const [key, value] of Object.entries(model.values ?? {})) (candidates[key] ??= new Set()).add(String(value))
  }
  if (workflow === 'rife_interpolate') (candidates.model ??= new Set()).add(INTERPOLATION_MODEL)
  return Object.fromEntries(Object.entries(candidates).map(([key, set]) => [key, [...set]]))
}

export interface ModelRef { workflow: string; node: string; classType: string; input: string; folder: string; filename: string }

/** Every model file a workflow can load: literal loader inputs plus each placeholder value the code may pass. */
export function workflowModelRefs(workflow: string, graph: Graph): ModelRef[] {
  const refs: ModelRef[] = []
  const candidates = placeholderCandidates(workflow)
  for (const [node, value] of Object.entries(graph)) {
    if (node.startsWith('_') || typeof value !== 'object' || !value.class_type) continue
    const folder = LOADER_FOLDERS[value.class_type]
    if (!folder) continue
    for (const [input, raw] of Object.entries(value.inputs ?? {})) {
      if (!/_name$/.test(input) || typeof raw !== 'string') continue
      const placeholder = /^\{\{\s*([\w-]+)\s*\}\}$/.exec(raw)?.[1]
      const names = placeholder ? candidates[placeholder] ?? [] : [raw]
      if (placeholder && !names.length) throw new Error(`${workflow} node ${node}: no value known for {{${placeholder}}}`)
      for (const filename of names) refs.push({ workflow, node, classType: value.class_type, input, folder, filename })
    }
  }
  return refs
}

export function allModelRefs(workflows = loadWorkflows()): ModelRef[] {
  return Object.entries(workflows).flatMap(([name, graph]) => workflowModelRefs(name, graph))
}

type ObjectInfo = Record<string, { input: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>

/**
 * Every workflow against the running ComfyUI: unknown nodes, unknown inputs, model files ComfyUI does not list.
 * A missing file that belongs to a feature this machine did not install is a warning, not a problem.
 */
export function checkWorkflows(info: ObjectInfo, workflows: Record<string, Graph>, optional: (filename: string) => string | undefined): { problems: string[]; warnings: string[] } {
  const problems: string[] = []
  const warnings: string[] = []
  for (const [name, graph] of Object.entries(workflows)) {
    for (const [nodeId, node] of Object.entries(graph)) {
      if (nodeId.startsWith('_') || typeof node !== 'object' || !node.class_type) continue
      const spec = info[node.class_type]
      if (!spec) {
        problems.push(`${name} node ${nodeId}: unknown class ${node.class_type}`)
        continue
      }
      const declared = { ...spec.input.required, ...spec.input.optional }
      for (const input of Object.keys(node.inputs ?? {})) {
        // "format.codec.encoding.crf" is a dynamic input: it exists once its root ("format") takes a value, so the
        // static schema does not list it. Only the root has to be declared.
        const root = input.split('.')[0]!
        if (!(input in declared) && !(input.includes('.') && root in declared)) problems.push(`${name} node ${nodeId}: ${node.class_type} has no input "${input}"`)
      }
    }
    for (const ref of workflowModelRefs(name, graph)) {
      const options = (info[ref.classType]?.input.required?.[ref.input] ?? info[ref.classType]?.input.optional?.[ref.input])?.[0]
      if (!Array.isArray(options) || options.includes(ref.filename)) continue
      const feature = optional(ref.filename)
      const message = `${name} node ${ref.node}: model file not installed: ${ref.filename}`
      if (feature) warnings.push(`${message} (optional: scripts/install.sh --with ${feature})`)
      else problems.push(message)
    }
  }
  return { problems: [...new Set(problems)], warnings: [...new Set(warnings)] }
}
