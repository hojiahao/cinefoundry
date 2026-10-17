import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ComfyClient } from '../../comfy/client.js'
import { checkScript, subtitleMax, type Brief, type Script, type Storyboard } from '../../agent/checks.js'
import { END_CARD_SECONDS, END_DISSOLVE_SECONDS, enterPhase, finishMaster, type CutMusic, type CutResult } from '../../agent/finish.js'
import { writeDeliveryReport } from '../../agent/delivery.js'
import { endpoints } from '../../agent/llm.js'
import { checkGrade, loadFinishing, saveFinishing, finishingPath } from '../../crafts/finishing.js'
import { qcOpenItems, qcSummary, runQc, mergeQcReport, type QcReport } from '../../crafts/qc.js'
import { reviseShotPrompt, translateSubtitle } from '../../crafts/revisions.js'
import { readTimeline, resolved } from '../../crafts/timeline.js'
import { brandFinish, loadBrand } from '../../crafts/brand.js'
import type { Treatment } from '../../crafts/treatment.js'
import { CUTDOWNS, type VersionPlan } from '../../crafts/versions.js'
import { scanCopy } from '../../lib/compliance.js'
import { wakeAll } from '../../lib/rest.js'
import type { VideoModel } from '../../lib/media.js'
import { addAsset, type ProjectState } from '../../lib/project.js'
import { RevisionRefused, type RevisionDef, type RevisionRequest, type RevisionTools } from '../../engine/revise.js'
import type { EngineContext } from '../../engine/pipeline.js'
import { clipsPhase, interpolates, interpolateShot, shotClip } from './clips.js'
import { reviewCopy } from './compliance.js'
import { need, type AdContext, type AdOptions, type VersionCut } from './context.js'
import { shotFrame } from './frames.js'
import { adQcSpec } from './qc.js'
import { cutVersion } from './versions.js'

/**
 * Revisions of a finished ad film, on the ad pipeline's own stage functions:
 * - a shot: its first frame again (a new seed, or the client's note applied to the frame prompt by the storyboard artist),
 *   its gate, its clip and interpolation, then the master and only the cutdowns that use the shot;
 * - a line: the beat's new copy through the same compliance path as the script (refused if it does not pass), re-voiced
 *   by the cast announcer (the other lines keep their takes), then the master; cutdowns carry their own copy;
 * - the grade or the score: finishing only, master and every cutdown.
 * Then delivery QC on everything re-cut, merged into reports/qc.json, and the delivery report with its revision history.
 */

type AdRevisionContext = AdContext & RevisionTools & { pending?: { script: Script } }

const pad3 = (n: number) => String(n).padStart(3, '0')
/** ComfyUI workflow of a clip asset -> the video model that renders it. */
const VIDEO_WORKFLOWS: Record<string, VideoModel> = { ltx25_fast_i2v: 'ltx25-fast-nvfp4', wan22_i2v_14b_4step: 'wan22-14b', wan22_ti2v_5b_i2v: 'wan22-5b' }

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

/** The ad's recorded state as the pipeline context the stages work on. */
export async function loadAdContext(engine: EngineContext & RevisionTools, state: ProjectState): Promise<AdRevisionContext> {
  const dir = engine.dir!
  const brief = await readJson<Brief>(join(dir, 'brief.json'))
  const script = await readJson<Script>(join(dir, 'script', 'script.json'))
  const storyboard = await readJson<Storyboard>(join(dir, 'storyboard', 'storyboard.json'))
  const treatment = existsSync(join(dir, 'creative', 'treatment.json')) ? await readJson<Treatment>(join(dir, 'creative', 'treatment.json')) : undefined
  const hero = state.assets.find((asset) => asset.id === 'product-hero')
  if (!hero || !existsSync(join(dir, hero.path))) throw new RevisionRefused(`${state.id} has no approved product hero still: it was not produced to the end, so there is nothing to revise`)
  if (!existsSync(join(dir, 'cut', 'final.mp4'))) throw new RevisionRefused(`${state.id} has no finished master (cut/final.mp4) to revise`)
  const recorded = (state.options ?? {}) as Partial<AdOptions>
  // A project made before options were recorded: silent if it has no soundtrack.
  const options: AdOptions = { ...recorded, brief: state.brief, silent: recorded.silent ?? !existsSync(join(dir, 'audio', 'soundtrack.wav')) }
  // The clips' model, read from the clip assets when the options were not recorded. A revision generates locally: the
  // cloud route needs the client's consent in the conversation that asks for it, so a cloud-made film is revised on LTX.
  const clipModel = state.assets.find((asset) => asset.stage === 'clips' && asset.model)?.model ?? ''
  options.videoModel ??= VIDEO_WORKFLOWS[clipModel]
  if (options.videoModel === 'seedance' || clipModel.startsWith('cloud:')) {
    engine.log('  this film\'s clips were made on the cloud route; the revision generates locally (LTX-2.5)')
    options.videoModel = 'ltx25-fast-nvfp4'
  }
  const frames = new Map(state.assets.filter((asset) => asset.stage === 'frames' && asset.id.startsWith('frame-') && asset.shot !== undefined).map((asset) => [asset.shot!, join(dir, asset.path)]))
  const masterLine = await readTimeline(dir, 'master')
  const music = masterLine?.audio.music[0]
    ? { path: resolved(dir, masterLine.audio.music[0].source), offset: masterLine.audio.music[0].in }
    : existsSync(join(dir, 'audio', 'music.mp3')) && !options.silent ? { path: join(dir, 'audio', 'music.mp3'), offset: 0 } : undefined
  const seconds = masterLine?.seconds ?? storyboard.shots.length * 5 + END_CARD_SECONDS - END_DISSOLVE_SECONDS
  const masterCut: CutResult = {
    path: join(dir, 'cut', 'final.mp4'), ass: join(dir, 'cut', 'titles.ass'), seconds, durations: [], overlaps: [], speech: [],
    endCard: { start: seconds - END_CARD_SECONDS, end: seconds }, produceId: brief.id, ...(music ? { music } : {}),
  }
  const versions: VersionCut[] = []
  for (const spec of CUTDOWNS) {
    const file = join(dir, 'cut', `version_${spec.id}.json`)
    if (!existsSync(file) || !existsSync(join(dir, 'cut', `final_${spec.id}.mp4`))) continue
    const plan = await readJson<VersionPlan>(file)
    versions.push({ spec, plan, cut: { ...masterCut, path: join(dir, 'cut', `final_${spec.id}.mp4`), ass: join(dir, 'cut', `titles_${spec.id}.ass`), produceId: `${brief.id}-${spec.id}` } })
  }
  // A film made under a brand kit is revised under the kit as it is now (as `cinefoundry cut` does); a changed kit is said.
  const brandId = recorded.brand ?? brief.brand?.id
  const brand = brandId ? await loadBrand(brandId) : undefined
  if (brand && brief.brand && brand.version !== brief.brand.version) engine.log(`  note: the ${brand.id} kit changed since this film was made (${brief.brand.version} -> ${brand.version}); revising with the current kit`)
  const { planner, reviewer, editor } = endpoints()
  return Object.assign(engine, {
    options, planner, reviewer, editor, jev: undefined, jevReview: [], rejectedAttempts: {}, qaRegenerations: 0,
    brief, treatment, script, storyboard, comfy: new ComfyClient(), hero: { path: join(dir, hero.path), verdict: { pass: true, score: Number(/gate (\d+)/.exec(hero.note ?? '')?.[1] ?? 0), issues: [] } },
    frames, finalCut: masterCut.path, masterCut, versions, ...(brand ? { brand } : {}),
  }) as AdRevisionContext
}

/** The beat a line revision names: "2", from 1. */
function beatOf(ctx: AdRevisionContext, line: string | undefined): number {
  const script = need(ctx.script, 'script')
  if (!line || !/^\d+$/.test(line)) throw new RevisionRefused(`--line ${line ?? ''}: an ad line is its beat number, 1 to ${script.beats.length}`)
  const beat = Number(line)
  if (!script.beats.some((b) => b.beat === beat)) throw new RevisionRefused(`--line ${line}: the script has beats 1 to ${script.beats.length}`)
  return beat
}

/**
 * The changed line through the same checks as the script: the script validators (only what this change introduces), the
 * deterministic scan of the copy, then the independent reviewer, who did not write the line. Anything short of a pass
 * refuses the revision with the reason; the reviewer's rewrite is offered, never applied to the client's words.
 */
async function clearLine(ctx: AdRevisionContext, beat: number, text: string, zh: string): Promise<Script> {
  const brief = need(ctx.brief, 'brief')
  const script = need(ctx.script, 'script')
  const next: Script = { ...script, beats: script.beats.map((b) => (b.beat === beat ? { ...b, vo: text, zh } : b)) }
  const before = new Set(checkScript(script, brief))
  const introduced = checkScript(next, brief).filter((problem) => !before.has(problem))
  if (introduced.length) throw new RevisionRefused(`line ${beat} does not pass the script checks: ${introduced.join('; ')}`)
  const blocked = scanCopy(`${text}\n${zh}`, brief.category).filter((finding) => finding.severity === 'block')
  if (blocked.length) throw new RevisionRefused(`line ${beat} does not pass compliance: ${blocked.map((f) => `"${f.text}" (${f.rule}: ${f.reason})`).join('; ')}`)
  ctx.log(`▸ compliance   line ${beat} · scan + independent reviewer · ${ctx.editor.name}`)
  const review = await reviewCopy(ctx, { brief, script: next, check: (copy) => checkScript(copy, brief) })
  await ctx.record('compliance', 'reviewer', ctx.editor, { line: beat, seconds: review.seconds, approve: review.reviewer?.approve, issues: review.reviewer?.issues, scanFindings: review.findings.length, revisedBeats: review.revisedBeats, unrevisedFlaggedBeats: review.unrevisedFlaggedBeats })
  if (review.blocked.length) throw new RevisionRefused(`line ${beat} does not pass compliance: ${review.blocked.map((f) => `"${f.text}" (${f.rule})`).join('; ')}`)
  const rewrite = review.script.beats.find((b) => b.beat === beat)
  if (review.revisedBeats.includes(beat) || review.unrevisedFlaggedBeats.includes(beat)) {
    const issues = (review.reviewer?.issues ?? []).join(' ').slice(0, 300)
    throw new RevisionRefused(`the compliance reviewer did not clear line ${beat}: ${issues || 'flagged without a reason'}${rewrite && rewrite.vo !== text ? ` (suggested: "${rewrite.vo}" / ${rewrite.zh})` : ''}`)
  }
  if (review.unapprovedWithoutBeats) throw new RevisionRefused(`the compliance reviewer did not approve the copy with line ${beat} changed: ${(review.reviewer?.issues ?? []).join(' ').slice(0, 300)}`)
  return next
}

/** The cutdowns whose edit uses the shot. */
const usingShot = (ctx: AdRevisionContext, shot: number) => ctx.versions.filter((version) => version.plan.shots.some((s) => s.shot === shot))

export const adRevision: RevisionDef<AdContext> = {
  load: loadAdContext,

  plan: async (ctx: AdRevisionContext, request) => {
    const storyboard = need(ctx.storyboard, 'storyboard')
    const versions = (list: VersionCut[]) => (list.length ? ['versions'] : [])
    if (request.kind === 'shot') {
      if (!storyboard.shots.some((shot) => shot.shot === request.shot)) throw new RevisionRefused(`--shot ${request.shot}: the master has shots 1 to ${storyboard.shots.length}`)
      if (request.episode !== undefined) throw new RevisionRefused('--episode is for narrative films; an ad has one master')
      const dependents = usingShot(ctx, request.shot!)
      return { stages: ['frames', 'qa', 'clips', 'cut', ...versions(dependents), 'qc'], summary: `shot ${request.shot}${request.note ? ` · ${request.note}` : ' · new seed'} → master${dependents.map((v) => ` · ${v.spec.id}`).join('')}` }
    }
    if (request.kind === 'line') {
      const beat = beatOf(ctx, request.line)
      const text = request.text?.trim()
      if (!text) throw new RevisionRefused('--text is required: the new English line')
      const brief = need(ctx.brief, 'brief')
      const zh = request.zh?.trim() || await translateSubtitle(ctx.editor, await ctx.agentPrompt('bilingual copy editor', ['bilingual-subtitles', 'ad-script-writing']), { en: text, maxChars: subtitleMax(brief.ratio), context: `Ad for ${brief.product}; the one message: ${brief.message}.` })
      ctx.pending = { script: await clearLine(ctx, beat, text, zh) }
      return { stages: ['compliance', 'cut', 'qc'], summary: `line ${beat} · "${text}" / ${zh} → master` }
    }
    if (request.kind === 'grade') {
      const problems = checkGrade(request.grade ?? '')
      if (problems.length) throw new RevisionRefused(problems.join('; '))
      return { stages: ['cut', ...versions(ctx.versions), 'qc'], summary: `grade ${request.grade} → master${ctx.versions.map((v) => ` · ${v.spec.id}`).join('')}` }
    }
    if (!request.music?.trim()) throw new RevisionRefused('--music needs a direction ("sparse piano, slower, resolves warmly")')
    if (ctx.options.silent || !ctx.masterCut?.music) throw new RevisionRefused('this film was delivered silent: it has no score to change')
    return { stages: ['cut', ...versions(ctx.versions), 'qc'], summary: `music "${request.music}" → master${ctx.versions.map((v) => ` · ${v.spec.id}`).join('')}` }
  },

  run: async (ctx: AdRevisionContext, request) => {
    const dir = ctx.dir!
    const finishing = await loadFinishing(dir)
    if (request.kind === 'shot') return redoShot(ctx, request, finishing.grade)
    if (request.kind === 'line') {
      const beat = beatOf(ctx, request.line)
      const script = ctx.pending!.script
      await ctx.keep(join(dir, 'script', 'script.json'), join(dir, 'script', 'copy.txt'))
      await writeFile(join(dir, 'script', 'script.json'), JSON.stringify(script, null, 2))
      await writeFile(join(dir, 'script', 'copy.txt'), [...script.beats.map((b) => `${b.vo}\n${b.zh}\n${b.text}`), need(ctx.brief, 'brief').tagline ?? need(ctx.brief, 'brief').message].join('\n'))
      ctx.script = script
      return recut(ctx, { versions: [], revoice: [beat], grade: finishing.grade })
    }
    if (request.kind === 'grade') {
      await ctx.keep(finishingPath(dir))
      await saveFinishing(dir, { ...finishing, grade: request.grade === 'neutral' ? undefined : request.grade })
      return recut(ctx, { versions: ctx.versions, grade: request.grade === 'neutral' ? undefined : request.grade })
    }
    await ctx.keep(finishingPath(dir))
    await saveFinishing(dir, { ...finishing, music: request.music })
    return recut(ctx, { versions: ctx.versions, grade: finishing.grade, music: request.music })
  },

  report: async (ctx: AdRevisionContext) => {
    await writeDeliveryReport(ctx.dir!, need(ctx.brief, 'brief'), need(ctx.storyboard, 'storyboard'), join(ctx.dir!, 'cut', 'final.mp4'))
  },
}

/** A shot again: frame (note applied, or a new seed) and gate, clip, interpolation, then the cuts that use it. */
async function redoShot(ctx: AdRevisionContext, request: RevisionRequest, grade: string | undefined) {
  const dir = ctx.dir!
  const storyboard = need(ctx.storyboard, 'storyboard')
  const shot = storyboard.shots.find((s) => s.shot === request.shot)!
  const notes: string[] = []
  if (request.note) {
    const revised = await reviseShotPrompt(ctx.planner, await ctx.agentPrompt('storyboard artist', ['storyboard-design', 'cinematography-and-art-direction']), { shot: shot.shot, prompt: shot.image_prompt, note: request.note, mustShow: shot.must_show, framing: shot.framing })
    await ctx.keep(join(dir, 'storyboard', 'storyboard.json'))
    await ctx.record('storyboard', 'storyboard', ctx.planner, { shot: shot.shot, note: request.note, change: revised.change, from: shot.image_prompt, to: revised.prompt })
    ctx.log(`▸ storyboard   shot ${shot.shot}: ${revised.change || revised.prompt.slice(0, 120)}`)
    shot.image_prompt = revised.prompt
    await writeFile(join(dir, 'storyboard', 'storyboard.json'), JSON.stringify(storyboard, null, 2))
    notes.push(`shot ${shot.shot} prompt: ${revised.change || revised.prompt}`)
  }
  const comfy = need(ctx.comfy, 'comfy')
  await ctx.rest('frames (Qwen-Image-Edit)', [ctx.planner])
  await enterPhase(comfy, 'frames (Qwen-Image-Edit)', ctx.record)
  const before = new Set(await readdir(join(dir, 'frames')))
  const frame = await shotFrame(ctx, shot, { tag: `.rev${ctx.revision}` })
  ctx.created(...(await readdir(join(dir, 'frames'))).filter((name) => !before.has(name)).map((name) => join(dir, 'frames', name)))
  if (!frame.verdict.pass) notes.push(`shot ${shot.shot}: kept the best frame after a failed gate (${frame.verdict.score}: ${frame.verdict.issues[0] ?? ''})`)
  await ctx.rest(clipsPhase(ctx), [ctx.planner, ctx.reviewer])
  await enterPhase(comfy, clipsPhase(ctx), ctx.record)
  const base = join(dir, 'clips', `shot_${pad3(shot.shot)}`)
  await ctx.keep(`${base}.mp4`)
  await shotClip(ctx, shot, { freeAfter: true })
  if (interpolates(ctx)) {
    await enterPhase(comfy, 'interpolate (RIFE)', ctx.record)
    await ctx.keep(`${base}.hfr.mp4`)
    await interpolateShot(ctx, shot)
    await comfy.free()
  }
  const waking = wakeAll([ctx.planner, ctx.reviewer])
  const outcome = await recut(ctx, { versions: usingShot(ctx, shot.shot), grade })
  await waking
  return { ...outcome, notes: [...notes, ...outcome.notes] }
}

/**
 * Finishing again from the clips on disk: the master (voice lines kept unless re-voiced, the end card kept, the score
 * kept unless a new direction is given) and the given cutdowns from their saved plans, then delivery QC on all of them.
 */
async function recut(ctx: AdRevisionContext, input: { versions: VersionCut[]; revoice?: number[]; grade?: string; music?: string }) {
  const dir = ctx.dir!
  const brief = need(ctx.brief, 'brief')
  const silent = !!ctx.options.silent
  await ctx.keep(join(dir, 'cut', 'final.mp4'), join(dir, 'cut', 'titles.ass'), join(dir, 'cut', 'master.timeline.json'), ...(silent ? [] : [join(dir, 'audio', 'soundtrack.wav')]))
  if (!silent) await ctx.keep(...(input.revoice ?? []).map((beat) => join(dir, 'audio', `vo_${beat}.wav`)))
  let music: CutMusic | undefined = ctx.masterCut?.music ? { kind: 'file', path: ctx.masterCut.music.path, offset: ctx.masterCut.music.offset } : undefined
  let treatment = ctx.treatment
  if (input.music) {
    await ctx.keep(join(dir, 'audio', 'music.mp3'))
    music = { kind: 'generate' }
    treatment = treatment ? { ...treatment, sound: { ...treatment.sound, music: input.music } } : treatment
    if (!treatment) brief.tone = `${input.music}; ${brief.tone}`
  }
  const master = await finishMaster({
    dir, brief, script: need(ctx.script, 'script'), storyboard: need(ctx.storyboard, 'storyboard'), heroPath: need(ctx.hero, 'hero').path, comfy: need(ctx.comfy, 'comfy'),
    silent, record: ctx.record, log: ctx.log, treatment, music, ...(ctx.brand ? { brand: await brandFinish(ctx.brand) } : {}), reuseVoices: true, revoice: input.revoice, reuseEndCard: true, grade: input.grade,
  })
  await addAsset(brief.id, { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg' })
  ctx.masterCut = master
  ctx.finalCut = master.path
  const recut: VersionCut[] = []
  for (const version of input.versions) {
    const id = version.spec.id
    await ctx.keep(join(dir, 'cut', `final_${id}.mp4`), join(dir, 'cut', `titles_${id}.ass`), join(dir, 'cut', `${id}.timeline.json`), ...(silent ? [] : [join(dir, 'audio', `v${id}_vo_soundtrack.wav`)]))
    recut.push(await cutVersion(ctx, version.spec, version.plan, { reuseVoices: true, grade: input.grade }))
  }
  ctx.versions = ctx.versions.map((version) => recut.find((r) => r.spec.id === version.spec.id) ?? version)
  // Delivery QC on everything re-cut; the other deliverables keep their reports.
  const reports: QcReport[] = [await runQc(adQcSpec('master', master, brief, silent))]
  for (const version of recut) reports.push(await runQc(adQcSpec(version.spec.id, version.cut, brief, silent)))
  await ctx.keep(join(dir, 'reports', 'qc.json'))
  const all = await mergeQcReport(dir, reports)
  const summary = qcSummary(all)
  for (const item of qcOpenItems(reports)) ctx.log(`  open item: qc ${item}`)
  await ctx.record('qc', 'delivery-qc', undefined, { verdict: summary.verdict, files: summary.files, openItems: qcOpenItems(all).map((item) => `技术质检 ${item}`), measured: reports.map((r) => r.label) })
  return { deliverables: ['master', ...recut.map((v) => v.spec.id)], qc: qcSummary(reports).verdict, notes: [] as string[] }
}
