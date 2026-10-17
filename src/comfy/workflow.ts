import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export type WorkflowGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>

const WORKFLOW_DIR = process.env.CINEFOUNDRY_WORKFLOWS ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'workflows')

export async function loadWorkflow(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(WORKFLOW_DIR, `${name}.json`), 'utf8')) as Record<string, unknown>
}

/**
 * Fill `{{key}}` placeholders. A string that is exactly one placeholder takes the
 * value's own type, so numeric graph inputs stay numeric. Keys starting with `_`
 * are template comments and are dropped.
 */
export function renderWorkflow(template: unknown, values: Record<string, unknown>): WorkflowGraph {
  const fill = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(fill)
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => !key.startsWith('_'))
          .map(([key, value]) => [key, fill(value)]),
      )
    }
    if (typeof node !== 'string' || !node.includes('{{')) return node
    const whole = /^\s*\{\{\s*([\w-]+)\s*\}\}\s*$/.exec(node)
    if (whole) {
      const key = whole[1]!
      if (!(key in values)) throw new Error(`Workflow placeholder {{${key}}} has no value.`)
      return values[key]
    }
    return node.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => {
      if (!(key in values)) throw new Error(`Workflow placeholder {{${key}}} has no value.`)
      return String(values[key])
    })
  }
  return fill(template) as WorkflowGraph
}
