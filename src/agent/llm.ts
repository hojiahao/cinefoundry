import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { extractJson } from '../lib/vision.js'
import { ensureAwake } from '../lib/rest.js'

export interface ModelEndpoint {
  name: string
  baseUrl: string
  model: string
  apiKey: string
  /** Where requests to this endpoint execute; recorded with every call. */
  execution: 'local-dgx-spark' | 'cloud'
}

export function endpoints(): { planner: ModelEndpoint; reviewer: ModelEndpoint; editor: ModelEndpoint } {
  const planner = plannerEndpoint()
  return {
    // Text review goes to StepFun's hosted Step-3.7-Flash when a key is configured. The local 10B vision
    // model always reasons first at ~18 tok/s and cannot finish a text review inside a request timeout,
    // so without a key a separate Nemotron agent reviews instead.
    editor: process.env.STEPFUN_API_KEY
      ? { name: 'step-3.7-flash', baseUrl: 'https://api.stepfun.com/v1', model: process.env.CINELOOM_EDITOR_MODEL ?? 'step-3.7-flash', apiKey: process.env.STEPFUN_API_KEY, execution: 'cloud' }
      : { ...planner, name: 'nemotron-reviewer' },
    planner,
    reviewer: {
      name: 'step3-vl',
      baseUrl: (process.env.CINELOOM_VISION_URL ?? 'http://127.0.0.1:8002/v1').replace(/\/+$/, ''),
      model: process.env.CINELOOM_VISION_MODEL ?? 'step3-vl-10b',
      apiKey: process.env.CINELOOM_VISION_KEY ?? 'local',
      execution: 'local-dgx-spark',
    },
  }
}

function plannerEndpoint(): ModelEndpoint {
  return {
    name: 'nemotron',
    baseUrl: (process.env.CINELOOM_PLANNER_URL ?? 'http://127.0.0.1:8001/v1').replace(/\/+$/, ''),
    model: process.env.CINELOOM_PLANNER_MODEL ?? 'nemotron-3.5-lightning',
    apiKey: process.env.CINELOOM_PLANNER_KEY ?? 'local',
    execution: 'local-dgx-spark',
  }
}

export interface ChatResult {
  content: string
  seconds: number
  completionTokens: number
  /** 'stop' for a finished answer, 'length' when max_tokens ran out first. */
  finishReason?: string
}

export interface ChatOptions {
  system: string
  user: string
  images?: string[]
  /** Reasoning models spend completion tokens on thinking first; leave room for the answer. */
  maxTokens?: number
  thinking?: boolean
  temperature?: number
}

export async function chat(endpoint: ModelEndpoint, options: ChatOptions): Promise<ChatResult> {
  const content: unknown[] = [{ type: 'text', text: options.user }]
  for (const image of options.images ?? []) {
    const mime = extname(image).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${(await readFile(image)).toString('base64')}` } })
  }
  if (endpoint.execution !== 'cloud') await ensureAwake(endpoint.baseUrl)
  const started = Date.now()
  const request = () =>
    fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.apiKey}` },
      body: JSON.stringify({
        model: endpoint.model,
        max_tokens: options.maxTokens ?? 6000,
        temperature: options.temperature ?? 0.7,
        chat_template_kwargs: { enable_thinking: options.thinking ?? true },
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.images?.length ? content : options.user },
        ],
      }),
    })
  // A transport failure (connection reset, or a reply slower than Node's 5-minute header timeout
  // when the GPU is contended) is retried once; an HTTP error from the model is not.
  const response = await request().catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    return request()
  })
  if (!response.ok) throw new Error(`${endpoint.name} returned ${response.status}: ${(await response.text()).slice(0, 400)}`)
  const body = (await response.json()) as { choices: Array<{ message: { content: string | null }; finish_reason?: string }>; usage?: { completion_tokens?: number } }
  return {
    content: body.choices[0]?.message.content ?? '',
    seconds: (Date.now() - started) / 1000,
    completionTokens: body.usage?.completion_tokens ?? 0,
    finishReason: body.choices[0]?.finish_reason ?? undefined,
  }
}

export interface JsonAttempt<T> {
  value: T
  /** Problems still present on the accepted value when every attempt was used up. Empty on a clean acceptance. */
  unresolved: string[]
  attempts: number
  seconds: number
  completionTokens: number
  /** Problems found on each rejected attempt, in order. Empty when the first answer was accepted. */
  rejected: string[][]
  /** finish_reason of the last reply. */
  finishReason?: string
}

/** Every attempt came back without usable JSON. Carries the last reply's accounting so callers can say why. */
export class JsonReplyError extends Error {
  constructor(message: string, readonly seconds: number, readonly completionTokens: number, readonly finishReason: string | undefined) {
    super(message)
  }
}

/**
 * Ask for JSON, validate it with `check`, and on failure ask again with the concrete
 * problems. The validator is code, so "did the agent follow the skill" is measured, not judged.
 */
export async function chatJson<T>(
  endpoint: ModelEndpoint,
  options: ChatOptions,
  check: (value: T) => string[] | Promise<string[]>,
  maxAttempts = 3,
): Promise<JsonAttempt<T>> {
  let user = options.user
  let seconds = 0
  let completionTokens = 0
  const rejected: string[][] = []
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // The last attempts get the model's reasoning mode: a small model that has been told the same
    // rule three times usually needs to think, not to be told a fourth time.
    const careful = attempt >= maxAttempts - 1 && options.thinking === false
    const result = await chat(endpoint, { ...options, user, ...(careful ? { thinking: true, maxTokens: Math.max(options.maxTokens ?? 6000, 16000) } : {}) })
    seconds += result.seconds
    completionTokens += result.completionTokens
    let problems: string[]
    let value: T | undefined
    try {
      value = extractJson<T>(result.content)
      problems = await check(value)
    } catch (error) {
      problems = [`reply was not valid JSON: ${(error as Error).message.slice(0, 160)}`]
    }
    const finishReason = result.finishReason
    if (problems.length === 0) return { value: value!, unresolved: [], attempts: attempt, seconds, completionTokens, rejected, finishReason }
    rejected.push(problems)
    if (attempt === maxAttempts) {
      if (value !== undefined) return { value, unresolved: problems, attempts: attempt, seconds, completionTokens, rejected, finishReason }
      throw new JsonReplyError(`${endpoint.name} did not return usable JSON after ${maxAttempts} attempts: ${problems.join('; ')}`, seconds, completionTokens, finishReason)
    }
    // Send the rejected answer back with the problems, so the model edits it instead of starting over
    // (a fresh rewrite drifted: fewer shots, new mistakes).
    user = `${options.user}\n\nYour previous answer:\n${result.content.trim().slice(0, 6000)}\n\nIt was rejected for these reasons:\n${problems.map((problem) => `- ${problem}`).join('\n')}\nFix exactly these points, keep everything else, and return the corrected JSON only.`
  }
  throw new Error('unreachable')
}
