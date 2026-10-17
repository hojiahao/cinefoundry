import type { WorkflowGraph } from './workflow.js'

export interface ComfyOutputFile {
  filename: string
  subfolder?: string
  type?: string
}

export class ComfyError extends Error {}

/** Minimal client for ComfyUI's HTTP API: upload, queue, wait, download, free. */
export class ComfyClient {
  private readonly baseUrl: string

  constructor(
    baseUrl = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188',
    private readonly timeoutMs = 3_600_000,
    private readonly pollMs = 1_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async objectInfo(): Promise<Record<string, { input: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>> {
    return (await this.request('/object_info')).json() as never
  }

  async systemStats(): Promise<unknown> {
    return (await this.request('/system_stats')).json()
  }

  async uploadImage(data: Uint8Array, filename: string): Promise<string> {
    const form = new FormData()
    form.append('image', new Blob([Buffer.from(data)]), filename)
    form.append('overwrite', 'true')
    const body = (await (await this.request('/upload/image', { method: 'POST', body: form })).json()) as { name: string; subfolder?: string }
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name
  }

  async run(workflow: WorkflowGraph): Promise<ComfyOutputFile[]> {
    const queued = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: 'spotfoundry' }),
    })
    if (!queued.ok) throw new ComfyError(`ComfyUI rejected the workflow: ${(await queued.text()).slice(0, 2000)}`)
    const { prompt_id: promptId } = (await queued.json()) as { prompt_id: string }

    const deadline = Date.now() + this.timeoutMs
    while (Date.now() < deadline) {
      const history = (await (await this.request(`/history/${promptId}`)).json()) as Record<string, HistoryEntry>
      const entry = history[promptId]
      if (entry) {
        if (entry.status?.status_str === 'error') throw new ComfyError(`ComfyUI workflow failed: ${JSON.stringify(entry.status).slice(0, 2000)}`)
        // Wait for the whole graph: a LoadVideo/LoadImage preview shows up in `outputs` long before the saving node runs.
        if (entry.status?.completed || (entry.status === undefined && Object.keys(entry.outputs ?? {}).length > 0)) return outputFiles(entry.outputs ?? {})
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs))
    }
    throw new ComfyError(`ComfyUI workflow ${promptId} timed out.`)
  }

  async download(file: ComfyOutputFile): Promise<Uint8Array> {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' })
    return new Uint8Array(await (await this.request(`/view?${query}`)).arrayBuffer())
  }

  /** Unload diffusion models so the LLM services get unified memory back. */
  async free(): Promise<void> {
    await this.request('/free', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    })
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, init)
    if (!response.ok) throw new ComfyError(`ComfyUI ${path} returned ${response.status}: ${(await response.text()).slice(0, 500)}`)
    return response
  }
}

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean }
  outputs?: Record<string, Record<string, unknown>>
}

function outputFiles(outputs: Record<string, Record<string, unknown>>): ComfyOutputFile[] {
  const files: ComfyOutputFile[] = []
  for (const nodeOutput of Object.values(outputs)) {
    for (const key of ['images', 'gifs', 'videos', 'video', 'audio']) {
      for (const record of (nodeOutput[key] as ComfyOutputFile[] | undefined) ?? []) {
        // Previews of loaded inputs (type 'input') are not results.
        if (record?.filename && record.type !== 'input') files.push(record)
      }
    }
  }
  if (files.length === 0) throw new ComfyError('ComfyUI workflow finished without output files.')
  return files
}
