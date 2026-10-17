import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { ensureAwake } from './rest.js'

export interface VisionConfig {
  baseUrl: string
  model: string
  apiKey: string
}

export function visionConfig(): VisionConfig {
  return {
    baseUrl: (process.env.SPOTFOUNDRY_VISION_URL ?? 'http://127.0.0.1:8002/v1').replace(/\/+$/, ''),
    model: process.env.SPOTFOUNDRY_VISION_MODEL ?? 'step3-vl-10b',
    apiKey: process.env.SPOTFOUNDRY_VISION_KEY ?? 'local',
  }
}

/** Ask the local vision model about one or more images through the OpenAI-compatible chat API. */
export async function askVision(question: string, images: string[], config = visionConfig()): Promise<string> {
  await ensureAwake(config.baseUrl)
  const content: unknown[] = [{ type: 'text', text: question }]
  for (const image of images) {
    const mime = extname(image).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${(await readFile(image)).toString('base64')}` } })
  }
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: 1200, messages: [{ role: 'user', content }] }),
  })
  if (!response.ok) throw new Error(`Vision model returned ${response.status}: ${(await response.text()).slice(0, 500)}`)
  const body = (await response.json()) as { choices: Array<{ message: { content: string } }> }
  return body.choices[0]?.message.content ?? ''
}

/** Pull the first JSON object out of a model reply that may wrap it in prose or a code fence. */
export function extractJson<T>(reply: string): T {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`No JSON object in model reply: ${reply.slice(0, 200)}`)
  const raw = reply.slice(start, end + 1)
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    // Small models trip over trailing commas and typographic quotes; repair those before giving up.
    const repaired = raw.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"')
    try {
      return JSON.parse(repaired) as T
    } catch {
      throw error
    }
  }
}
