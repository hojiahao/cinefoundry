/**
 * Delivery formats: aspect ratio, resolution preset and frame rate.
 *
 * A film is generated at most at native 1080p - what the image and video models and one DGX Spark's memory
 * allow today - and delivered at the preset's size. Presets above 1080p are upscaled in the cut and say so
 * in the delivery report (`upscaled`), so a 4K file never pretends to be native 4K. A future video upscaler
 * plugs in at that one step without touching the rest of the pipeline.
 */

export type Ratio = '16:9' | '9:16' | '1:1'
export const RATIOS: Ratio[] = ['16:9', '9:16', '1:1']

/** Landscape is the default delivery: broadcast, web pre-roll and the big screen. Vertical is opt-in. */
export const DEFAULT_RATIO: Ratio = '16:9'
export const DEFAULT_RESOLUTION = '1080p'
/** Delivery frame rate. Clips are generated at 24 fps and interpolated (RIFE) up to it; 24 keeps the film look. */
export const DEFAULT_FPS = 60
export const FRAME_RATES = [24, 30, 60, 120] as const

interface Preset {
  /** Pixels on the short side of the delivered frame. */
  short: number
  /** The generation preset the models run at (see VIDEO_SIZES in media.ts). */
  generation: '720p' | '1080p'
}

const PRESETS: Record<string, Preset> = {
  '720p': { short: 720, generation: '720p' },
  '1080p': { short: 1080, generation: '1080p' },
  '2k': { short: 1440, generation: '1080p' },
  '4k': { short: 2160, generation: '1080p' },
  '6k': { short: 3456, generation: '1080p' },
}
export const RESOLUTIONS = Object.keys(PRESETS)

function preset(resolution: string): Preset {
  const found = PRESETS[resolution.toLowerCase()]
  if (!found) throw new Error(`Unknown resolution ${resolution}; use ${RESOLUTIONS.join(', ')}`)
  return found
}

export function isRatio(value: string | undefined): value is Ratio {
  return value !== undefined && (RATIOS as string[]).includes(value)
}

/** Delivered frame size: 1080p 16:9 is 1920x1080, 4k 16:9 is 3840x2160, 1080p 9:16 is 1080x1920. */
export function deliverySize(resolution: string, ratio: Ratio): [number, number] {
  const { short } = preset(resolution)
  const long = Math.round((short * 16) / 9 / 2) * 2
  return ratio === '16:9' ? [long, short] : ratio === '9:16' ? [short, long] : [short, short]
}

/** The resolution the image and video models generate at for a delivery preset. */
export function generationResolution(resolution: string): '720p' | '1080p' {
  return preset(resolution).generation
}

/** True when the delivered frame is larger than what was generated, i.e. the cut upscales. */
export function isUpscaled(resolution: string): boolean {
  return preset(resolution).short > 1080
}

export function checkFps(fps: number): number {
  if (!(FRAME_RATES as readonly number[]).includes(fps)) throw new Error(`Unsupported frame rate ${fps}; use ${FRAME_RATES.join(', ')}`)
  return fps
}
