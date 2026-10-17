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

/**
 * Remove the reference slots a request does not fill: every LoadImage node whose image is `{{image_N}}` with N above
 * `used`, and every input that links to a removed node. Optional inputs (the edit encoder's image2/image3) then stay
 * unconnected instead of repeating a reference, which would weigh one person twice.
 */
export function dropUnusedImages(template: Record<string, unknown>, used: number): Record<string, unknown> {
  const removed = new Set<string>()
  for (const [id, node] of Object.entries(template)) {
    if (id.startsWith('_') || !node || typeof node !== 'object') continue
    const { class_type, inputs } = node as { class_type?: string; inputs?: Record<string, unknown> }
    const slot = class_type === 'LoadImage' ? /^\{\{\s*image_(\d+)\s*\}\}$/.exec(String(inputs?.image ?? '')) : null
    if (slot && Number(slot[1]) > used) removed.add(id)
  }
  const links = (value: unknown) => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number'
  return Object.fromEntries(
    Object.entries(template)
      .filter(([id]) => !removed.has(id))
      .map(([id, node]) => {
        if (id.startsWith('_') || !node || typeof node !== 'object') return [id, node]
        const graphNode = node as { inputs?: Record<string, unknown> }
        const inputs = Object.fromEntries(Object.entries(graphNode.inputs ?? {}).filter(([, value]) => !(links(value) && removed.has((value as [string, number])[0]))))
        return [id, { ...graphNode, inputs }]
      }),
  )
}
