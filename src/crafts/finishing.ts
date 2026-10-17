import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Finishing choices a client can change after delivery without touching picture or performance: a grade adjustment laid
 * over the format's grade, and the score's direction. They are recorded once per project (cut/finishing.json) and every
 * later cut of the project - master, cutdowns, episodes - is finished with them.
 */
export interface Finishing {
  /** A grade adjustment by name (GRADE_ADJUSTMENTS); "neutral" or absent is the format's own grade. */
  grade?: string
  /** The score's direction, replacing the creative director's or the sound designer's. */
  music?: string
}

/**
 * Restrained adjustments in the colourist's vocabulary, appended to the format's grade (src/lib/ffmpeg.ts GRADES). Each is
 * one notch: a client who wants more asks again and the notes stack in the revision history, not in one extreme filter.
 */
export const GRADE_ADJUSTMENTS: Record<string, string> = {
  neutral: '',
  warmer: 'colorbalance=rs=0.04:gs=0.01:bs=-0.04:rm=0.03:bm=-0.02:rh=0.02:bh=-0.02',
  cooler: 'colorbalance=rs=-0.03:gs=0.005:bs=0.04:rm=-0.02:bm=0.03:rh=-0.01:bh=0.02',
  brighter: 'eq=brightness=0.025:gamma=1.04',
  darker: 'eq=brightness=-0.025:gamma=0.95',
  punchier: 'eq=contrast=1.08:saturation=1.04',
  softer: 'eq=contrast=0.94:gamma=1.02',
  richer: 'eq=saturation=1.12',
  muted: 'eq=saturation=0.85',
}
export const GRADE_NAMES = Object.keys(GRADE_ADJUSTMENTS)

export function checkGrade(name: string): string[] {
  return name in GRADE_ADJUSTMENTS ? [] : [`--grade ${name}: use ${GRADE_NAMES.join(', ')}`]
}

/** The format's grade with the project's adjustment laid over it. */
export function gradeWith(base: string, adjustment: string | undefined): string {
  const extra = adjustment ? GRADE_ADJUSTMENTS[adjustment] : ''
  return extra ? `${base},${extra}` : base
}

export const finishingPath = (dir: string) => join(dir, 'cut', 'finishing.json')

export async function loadFinishing(dir: string): Promise<Finishing> {
  if (!existsSync(finishingPath(dir))) return {}
  return JSON.parse(await readFile(finishingPath(dir), 'utf8')) as Finishing
}

export async function saveFinishing(dir: string, finishing: Finishing): Promise<void> {
  await mkdir(join(dir, 'cut'), { recursive: true })
  await writeFile(finishingPath(dir), `${JSON.stringify(finishing, null, 2)}\n`)
}
