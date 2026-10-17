import { checkScript, VO_MAX_WORDS, VO_MIN_WORDS, type Brief, type Script, type Storyboard } from '../agent/checks.js'
import { END_CARD_SECONDS, END_DISSOLVE_SECONDS, VOICE_SLOT_MARGIN_SECONDS } from '../agent/finish.js'

/**
 * Ad cutdowns (skill `editing-and-versioning`): the 15- and 6-second versions an agency cuts from the 30-second master.
 * A cutdown is a new film made from the master's clips - chosen shots trimmed at the tail, new copy for its own length,
 * the same end card - and it is exact: the sum of shot seconds plus the end card minus the dissolve is 15.0 or 6.0 s.
 */

export type VersionId = '15s' | '06s'

export interface VersionSpec {
  id: VersionId
  /** Running time of the finished version, end card included. */
  seconds: number
  /** How many of the master's shots it uses, one beat of copy each. */
  shots: number
}

export const CUTDOWNS: VersionSpec[] = [
  { id: '15s', seconds: 15, shots: 3 },
  { id: '06s', seconds: 6, shots: 1 },
]

/** Generated clips are 5 s; the assembler takes each shot's seconds from the head of its clip, so tails trim and heads cannot. */
export const CLIP_SECONDS = 5
/** The shortest shot a cutdown may hold: below it the announcer's shortest line (4 words) has no room. */
export const MIN_SHOT_SECONDS = 3

/**
 * The cutdowns a master gets: a version at most half the master's length, with enough shots to choose from. Anything
 * closer to the master's length is a trimmed master, not a new film.
 */
export function cutdownsFor(masterSeconds: number, masterShots: number): VersionSpec[] {
  return CUTDOWNS.filter((spec) => spec.seconds * 2 <= masterSeconds && spec.shots <= masterShots)
}

/** Shot seconds a version must add up to: its length minus the end card plus the dissolve into the end card. */
export const shotSecondsFor = (spec: VersionSpec) => spec.seconds - END_CARD_SECONDS + END_DISSOLVE_SECONDS

/**
 * The most words an English line may have in a shot of `seconds`: the master's 13 words in a 5 s shot, scaled to the
 * shot's voice slot (the shot minus the breath before and after the line).
 */
export const maxVoWords = (seconds: number) =>
  Math.max(VO_MIN_WORDS, Math.min(VO_MAX_WORDS, Math.floor((VO_MAX_WORDS * (seconds - VOICE_SLOT_MARGIN_SECONDS)) / (CLIP_SECONDS - VOICE_SLOT_MARGIN_SECONDS) + 1e-9)))

export interface VersionShot {
  /** The master storyboard's shot number. */
  shot: number
  /** Seconds the shot holds, from the head of its clip. */
  seconds: number
  /** The editor's reason: hook, proof, hero... */
  why: string
}

/** The versioning editor's decision list and the version's own copy (one beat per shot, in shot order). */
export interface VersionPlan {
  version: VersionId
  target_seconds: number
  shots: VersionShot[]
  script: Script
  notes?: string[]
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** Length of a version on the timeline: shots cut hard, the end card dissolved in. */
export const versionLength = (shots: Array<Pick<VersionShot, 'seconds'>>) =>
  shots.reduce((sum, shot) => sum + shot.seconds, 0) + END_CARD_SECONDS - END_DISSOLVE_SECONDS

/** The edit: the shots exist, none is used twice, each fits its clip and lands on a frame, and the lengths add up. */
export function checkVersionPlan(plan: VersionPlan, spec: VersionSpec, storyboard: Pick<Storyboard, 'shots'>, fps: number): string[] {
  const problems: string[] = []
  if (plan.version !== spec.id) problems.push(`"version" must be "${spec.id}"`)
  if (plan.target_seconds !== spec.seconds) problems.push(`"target_seconds" must be ${spec.seconds}`)
  const shots = Array.isArray(plan.shots) ? plan.shots : []
  if (shots.length !== spec.shots) problems.push(`the ${spec.seconds}-second version uses exactly ${spec.shots} shot${spec.shots === 1 ? '' : 's'} before the end card; the plan has ${shots.length}`)
  const known = new Set(storyboard.shots.map((shot) => shot.shot))
  const seen = new Set<number>()
  for (const [index, shot] of shots.entries()) {
    const label = `shots[${index}]`
    if (!Number.isInteger(shot.shot) || !known.has(shot.shot)) problems.push(`${label}: shot ${JSON.stringify(shot.shot)} is not a shot of the master (${[...known].join(', ')})`)
    else if (seen.has(shot.shot)) problems.push(`${label}: shot ${shot.shot} is used twice; a version uses each shot once`)
    else seen.add(shot.shot)
    if (typeof shot.seconds !== 'number' || !Number.isFinite(shot.seconds)) { problems.push(`${label}: "seconds" must be a number`); continue }
    if (shot.seconds > CLIP_SECONDS + 1e-9) problems.push(`${label}: ${shot.seconds} s is longer than the ${CLIP_SECONDS} s clip; trim tails, never extend`)
    if (shot.seconds < MIN_SHOT_SECONDS - 1e-9) problems.push(`${label}: ${shot.seconds} s is shorter than ${MIN_SHOT_SECONDS} s; the line has no room`)
    if (!near(shot.seconds * fps, Math.round(shot.seconds * fps))) problems.push(`${label}: ${shot.seconds} s does not land on a frame at ${fps} fps`)
    if (!shot.why?.trim()) problems.push(`${label}: "why" is empty; say what the shot does in this version (hook, proof, hero)`)
  }
  if (shots.length === spec.shots && shots.every((shot) => typeof shot.seconds === 'number')) {
    const length = versionLength(shots)
    if (!near(length, spec.seconds)) problems.push(`the shots add up to ${shots.reduce((sum, shot) => sum + shot.seconds, 0).toFixed(3)} s; with the ${END_CARD_SECONDS} s end card and its ${END_DISSOLVE_SECONDS} s dissolve the version runs ${length.toFixed(3)} s, not ${spec.seconds} s. The shots must add up to exactly ${shotSecondsFor(spec)} s`)
  }
  return problems
}

/** The version's copy: the master's beat checks for its own beat count, numbered in order, each line fitting its shot. */
export function checkVersionCopy(plan: Pick<VersionPlan, 'shots' | 'script'>, spec: VersionSpec, brief: Brief): string[] {
  const script = plan.script ?? ({ structure: '', beats: [] } as Script)
  const problems = checkScript(script, brief, { beats: spec.shots })
  const beats = Array.isArray(script.beats) ? script.beats : []
  for (const [index, beat] of beats.entries()) {
    if (beat.beat !== index + 1) problems.push(`beat ${beat.beat}: beats are numbered 1 to ${beats.length} in shot order`)
    const seconds = plan.shots?.[index]?.seconds
    if (typeof seconds !== 'number' || !beat.vo?.trim()) continue
    const words = beat.vo.trim().split(/\s+/).length
    const most = maxVoWords(seconds)
    if (words > most) problems.push(`beat ${beat.beat}: the voiceover has ${words} words; a ${seconds} s shot holds at most ${most}`)
  }
  return problems
}

/** Everything a version must pass before it is voiced and cut. */
export const checkVersion = (plan: VersionPlan, spec: VersionSpec, storyboard: Pick<Storyboard, 'shots'>, brief: Brief, fps: number): string[] =>
  [...checkVersionPlan(plan, spec, storyboard, fps), ...checkVersionCopy(plan, spec, brief)]
