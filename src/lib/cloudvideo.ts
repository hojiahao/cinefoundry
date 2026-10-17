import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { env } from './config.js'

/**
 * Optional cloud video route through a Volcengine Ark-compatible endpoint (Seedance family).
 * Off unless ARK_API_KEY is set. Every asset it produces is recorded with execution: cloud,
 * because the first frame leaves the machine. Wire format: POST .../contents/generations/tasks
 * with a content array (text + image_url), then GET .../tasks/{id} until status is succeeded.
 */
export interface CloudVideoConfig {
  apiKey: string
  endpoint: string
  model: string
}

export function cloudVideoConfig(): CloudVideoConfig | undefined {
  const apiKey = env('ARK_API_KEY')
  if (!apiKey) return undefined
  return {
    apiKey,
    endpoint: env('ARK_VIDEO_ENDPOINT')!.replace(/\/+$/, ''),
    model: env('ARK_VIDEO_MODEL')!,
  }
}

export interface CloudVideoRequest {
  prompt: string
  firstFrame: string
  output: string
  ratio: string
  resolution: string
  durationSeconds: number
}

export async function generateCloudVideo(config: CloudVideoConfig, request: CloudVideoRequest, pollMs = 5000, timeoutMs = 900_000): Promise<{ seconds: number; taskId: string }> {
  const started = Date.now()
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` }
  const frame = await readFile(request.firstFrame)
  const body = {
    model: config.model,
    content: [
      { type: 'text', text: request.prompt },
      { type: 'image_url', role: 'first_frame', image_url: { url: `data:image/png;base64,${frame.toString('base64')}` } },
    ],
    resolution: request.resolution,
    ratio: request.ratio,
    duration: request.durationSeconds,
    generate_audio: false,
    watermark: false,
  }
  const created = await fetch(config.endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!created.ok) throw new Error(`cloud video request failed ${created.status}: ${(await created.text()).slice(0, 400)}`)
  const taskId = ((await created.json()) as { id: string }).id
  if (!taskId) throw new Error('cloud video service returned no task id')

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    const polled = await fetch(`${config.endpoint}/${taskId}`, { headers })
    if (!polled.ok) throw new Error(`cloud video poll failed ${polled.status}`)
    const task = (await polled.json()) as { status: string; content?: { video_url?: string }; error?: { message?: string } }
    if (task.status === 'failed' || task.status === 'cancelled') throw new Error(`cloud video task ${task.status}: ${task.error?.message ?? 'no detail'}`)
    if (task.status === 'succeeded' && task.content?.video_url) {
      const video = await fetch(task.content.video_url)
      if (!video.ok) throw new Error(`cloud video download failed ${video.status}`)
      await mkdir(dirname(request.output), { recursive: true })
      await writeFile(request.output, new Uint8Array(await video.arrayBuffer()))
      return { seconds: (Date.now() - started) / 1000, taskId }
    }
  }
  throw new Error(`cloud video task ${taskId} timed out`)
}
