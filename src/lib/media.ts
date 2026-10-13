import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { loadWorkflow, renderWorkflow } from '../comfy/workflow.js'
import { cloudVideoConfig, generateCloudVideo } from './cloudvideo.js'
import { concatCopy, extractLastFrame, scaleImage } from './ffmpeg.js'

export const IMAGE_NATIVE_MAX_PIXELS = Number(process.env.CINELOOM_IMAGE_NATIVE_MAX_PIXELS ?? 1328 * 1328)
export const VIDEO_FPS = 24

export type VideoModel = 'wan22-5b' | 'wan22-14b' | 'ltx25-fast' | 'ltx25-fast-nvfp4' | 'seedance'
/**
 * The 14B image-to-video model runs at its native 16 fps and needs a first frame.
 * LTX-2.5 Fast is image-to-video here too, at 24 fps; its frame count must be 8n+1 (5 s = 121).
 */
const VIDEO_MODELS: Record<Exclude<VideoModel, 'seedance'>, { fps: number; i2v: string; t2v?: string; values?: Record<string, unknown> }> = {
  'wan22-5b': { fps: 24, i2v: 'wan22_ti2v_5b_i2v', t2v: 'wan22_ti2v_5b_t2v' },
  'wan22-14b': { fps: 16, i2v: 'wan22_i2v_14b_4step' },
  'ltx25-fast': { fps: 24, i2v: 'ltx25_fast_i2v', values: { unet_name: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors' } },
  'ltx25-fast-nvfp4': { fps: 24, i2v: 'ltx25_fast_i2v', values: { unet_name: 'ltx-2.5-22b-distilled-transformer-nvfp4.safetensors' } },
}
export const VIDEO_SEGMENT_SECONDS = 5
/** What the video models drift into on their own; industry anchors extend it (src/agent/checks.ts). */
export const VIDEO_NEGATIVE = 'blurry, overexposed, static frame, warped product, morphing label, changing text, subtitles, watermark, extra fingers, deformed hands, jitter, low quality'

const VIDEO_SIZES: Record<string, [number, number]> = {
  '480p/16:9': [832, 480],
  '480p/9:16': [480, 832],
  '480p/1:1': [624, 624],
  '720p/16:9': [1280, 704],
  '720p/9:16': [704, 1280],
  '720p/1:1': [960, 960],
}

export interface MediaResult {
  path: string
  /** ComfyUI template name, or `cloud:<model>` for the opt-in cloud video route. */
  workflow: string
  seconds: number
  width: number
  height: number
  detail: Record<string, unknown>
}

export function parseSize(size: string): [number, number] {
  const match = /^(\d+)x(\d+)$/i.exec(size)
  if (!match) throw new Error(`Unsupported size ${JSON.stringify(size)}; use WIDTHxHEIGHT.`)
  return [Number(match[1]), Number(match[2])]
}

/** Largest 16-aligned size with the requested aspect that stays inside the native pixel budget. */
export function nativeSize(width: number, height: number, maxPixels = IMAGE_NATIVE_MAX_PIXELS): [number, number] {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  const align = (value: number) => Math.max(256, Math.floor((value * scale) / 16) * 16)
  return [align(width), align(height)]
}

export function videoSize(resolution: string, ratio: string): [number, number] {
  const size = VIDEO_SIZES[`${resolution}/${ratio}`]
  if (!size) throw new Error(`Unsupported video format ${resolution} ${ratio}; supported: ${Object.keys(VIDEO_SIZES).join(', ')}`)
  return size
}

const seed = () => Math.floor(Math.random() * 2 ** 31)

export async function generateImage(
  comfy: ComfyClient,
  request: { prompt: string; size: string; output: string; references?: string[]; seed?: number },
): Promise<MediaResult> {
  const started = Date.now()
  const [width, height] = parseSize(request.size)
  const [nativeWidth, nativeHeight] = nativeSize(width, height)
  const references = request.references ?? []
  const workflow = references.length > 0 ? 'qwen_image_edit_lightning' : 'qwen_image_lightning'

  const values: Record<string, unknown> = {
    prompt: request.prompt,
    width: nativeWidth,
    height: nativeHeight,
    seed: request.seed ?? seed(),
    filename_prefix: `cineloom/${Date.now()}`,
  }
  // The edit graph has three reference slots; with fewer references the last one repeats.
  for (let slot = 0; slot < 3 && references.length > 0; slot++) {
    const source = references[Math.min(slot, references.length - 1)]!
    values[`image_${slot + 1}`] = await comfy.uploadImage(await readFile(source), `ref_${Date.now()}_${slot}.png`)
  }

  const outputs = await comfy.run(renderWorkflow(await loadWorkflow(workflow), values))
  await mkdir(dirname(request.output), { recursive: true })
  const upscaled = nativeWidth !== width || nativeHeight !== height
  if (upscaled) {
    const native = `${request.output}.native.png`
    await writeFile(native, await comfy.download(outputs[0]!))
    await scaleImage(native, request.output, width, height)
  } else {
    await writeFile(request.output, await comfy.download(outputs[0]!))
  }
  return {
    path: request.output,
    workflow,
    seconds: (Date.now() - started) / 1000,
    width,
    height,
    detail: { nativeSize: `${nativeWidth}x${nativeHeight}`, upscaled, references: references.length },
  }
}

export async function generateVideo(
  comfy: ComfyClient,
  request: { prompt: string; negative?: string; output: string; resolution: string; ratio: string; durationSeconds: number; firstFrame?: string; freeAfter?: boolean; model?: VideoModel },
): Promise<MediaResult> {
  const started = Date.now()
  const modelName = request.model ?? (process.env.CINELOOM_VIDEO_MODEL as VideoModel | undefined) ?? (request.firstFrame ? 'ltx25-fast' : 'wan22-5b')
  if (modelName === 'seedance') {
    // Opt-in cloud route. The first frame leaves the machine, so callers record this asset as cloud.
    const config = cloudVideoConfig()
    if (!config) throw new Error('The seedance route needs ARK_API_KEY (and optionally ARK_VIDEO_ENDPOINT / ARK_VIDEO_MODEL).')
    if (!request.firstFrame) throw new Error('The seedance route is image-to-video here; pass a first frame.')
    const [width, height] = videoSize(request.resolution, request.ratio)
    const cloud = await generateCloudVideo(config, { prompt: request.prompt, firstFrame: request.firstFrame, output: request.output, ratio: request.ratio, resolution: request.resolution, durationSeconds: request.durationSeconds })
    return { path: request.output, workflow: `cloud:${config.model}`, seconds: cloud.seconds, width, height, detail: { model: 'seedance', execution: 'cloud', taskId: cloud.taskId, durationSeconds: request.durationSeconds } }
  }
  const model = VIDEO_MODELS[modelName as Exclude<VideoModel, 'seedance'>]
  if (!model) throw new Error(`Unknown video model ${modelName}; use ${Object.keys(VIDEO_MODELS).join(', ')} or seedance.`)
  if (!model.t2v && !request.firstFrame) throw new Error(`${modelName} is image-to-video only; pass a first frame.`)
  const [width, height] = videoSize(request.resolution, request.ratio)
  const segmentCount = Math.max(1, Math.ceil(request.durationSeconds / VIDEO_SEGMENT_SECONDS))
  await mkdir(dirname(request.output), { recursive: true })

  let startFrame = request.firstFrame
  const segments: string[] = []
  for (let index = 0; index < segmentCount; index++) {
    const workflow = startFrame ? model.i2v : model.t2v!
    const values: Record<string, unknown> = {
      ...model.values,
      prompt: request.prompt,
      width,
      height,
      // LTX samples at half size, then upscales the latent x2.
      half_width: width / 2,
      half_height: height / 2,
      // Wan expects 4n+1 frames.
      length: VIDEO_SEGMENT_SECONDS * model.fps + 1,
      negative: request.negative ?? VIDEO_NEGATIVE,
      fps: model.fps,
      seed: seed(),
      filename_prefix: `cineloom/${Date.now()}_${index}`,
    }
    if (startFrame) values.start_image = await comfy.uploadImage(await readFile(startFrame), `start_${Date.now()}_${index}.png`)
    const outputs = await comfy.run(renderWorkflow(await loadWorkflow(workflow), values))
    const segment = `${request.output}.seg${index}.mp4`
    await writeFile(segment, await comfy.download(outputs[0]!))
    segments.push(segment)
    if (index + 1 < segmentCount) {
      // Continue the next segment from this one's last frame to keep the shot continuous.
      startFrame = `${segment}.last.png`
      await extractLastFrame(segment, startFrame)
    }
  }
  if (segments.length === 1) await rename(segments[0]!, request.output)
  else await concatCopy(segments, request.output)
  if (request.freeAfter ?? true) await comfy.free()

  return {
    path: request.output,
    workflow: model.i2v,
    seconds: (Date.now() - started) / 1000,
    width,
    height,
    detail: { model: modelName, fps: model.fps, segments: segmentCount, durationSeconds: segmentCount * VIDEO_SEGMENT_SECONDS, firstFrame: Boolean(request.firstFrame) },
  }
}
