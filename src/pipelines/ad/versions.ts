import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { subtitleMax, TEXT_MAX_CHARS, VO_MIN_WORDS, type Brief, type Script, type Storyboard } from '../../agent/checks.js'
import { cutFilm, END_CARD_SECONDS, END_DISSOLVE_SECONDS, endCardPath, shotClipPaths, type CutResult } from '../../agent/finish.js'
import { chatJson } from '../../agent/llm.js'
import { treatmentForCopy } from '../../crafts/treatment.js'
import { checkVersion, cutdownsFor, maxVoWords, MIN_SHOT_SECONDS, CLIP_SECONDS, shotSecondsFor, versionLength, type VersionPlan, type VersionSpec } from '../../crafts/versions.js'
import { DEFAULT_FPS } from '../../lib/formats.js'
import { probeDuration } from '../../lib/ffmpeg.js'
import { addAsset } from '../../lib/project.js'
import { reviewCopy } from './compliance.js'
import { brandFinish, brandForCopy, type BrandKit } from '../../crafts/brand.js'
import { need, type AdContext } from './context.js'

/** The versioning editor's attempts at a plan whose edit and copy pass every check. */
const PLAN_ATTEMPTS = 4

/** The best gate score each shot's kept frame reached in this run, read from run.jsonl: the editor picks the strongest frames. */
async function gateScores(dir: string, runId: string): Promise<Map<number, number>> {
  const rows = (await readFile(join(dir, 'reports', 'run.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
  const scores = new Map<number, number>()
  for (const row of rows) {
    if (row.runId !== runId || row.agent !== 'quality-gate' || typeof row.shot !== 'number' || typeof row.score !== 'number') continue
    scores.set(row.shot, Math.max(scores.get(row.shot) ?? -Infinity, row.score))
  }
  return scores
}

/** The editor's brief for one cutdown. */
export function versionUser(spec: VersionSpec, brief: Brief, script: Script, storyboard: Storyboard, scores: Map<number, number>, fps: number, treatment?: Parameters<typeof treatmentForCopy>[0], kit?: BrandKit): string {
  const total = shotSecondsFor(spec)
  const example = spec.shots === 1 ? `[{"shot": 4, "seconds": ${total}, "why": "hero: the one image that carries the proposition"}]` : `[{"shot": 2, "seconds": 4.0, "why": "hook"}, {"shot": 4, "seconds": 4.0, "why": "proof"}, {"shot": 6, "seconds": 4.5, "why": "product hero"}]`
  return `Cut the ${spec.seconds}-second version of this ${brief.durationSeconds}-second ad from the master's shots.

Product: ${brief.product} · brand on the product: ${brief.brandText} · audience: ${brief.audience} · tone: ${brief.tone}
The one message: ${brief.message}${brief.proof ? `\nProof points the brand can substantiate (the copy may claim these and nothing stronger): ${brief.proof}` : ''}
The end card closes every version (${END_CARD_SECONDS} s, dissolved in over ${END_DISSOLVE_SECONDS} s) with: ${brief.tagline?.trim() || brief.message}
${treatment ? `\n${treatmentForCopy(treatment)}\n` : ''}${kit ? `\n${brandForCopy(kit)}\n` : ''}
The master, shot by shot (each clip is ${CLIP_SECONDS} s; a shot is used from its first frame, so only its tail can be trimmed):
${storyboard.shots.map((shot, index) => { const beat = script.beats[index]; return `Shot ${shot.shot}: ${shot.framing}, ${shot.camera}. Shows: ${shot.must_show}.${scores.has(shot.shot) ? ` Gate score ${scores.get(shot.shot)}.` : ''}${beat ? ` Master line: "${beat.vo}" / ${beat.zh} / title ${beat.text} (job: ${beat.job})` : ''}` }).join('\n')}

The edit:
- exactly ${spec.shots} shot${spec.shots === 1 ? '' : 's'} before the end card, each used once, in the order the version plays them;
- each shot ${MIN_SHOT_SECONDS}-${CLIP_SECONDS} s, on a frame at ${fps} fps (multiples of 0.5 s are safe), and together exactly ${total} s, so that shots + ${END_CARD_SECONDS} s end card - ${END_DISSOLVE_SECONDS} s dissolve = ${spec.seconds}.0 s;
- ${spec.shots === 1 ? 'keep the one image that carries the proposition, normally the product hero' : 'keep the hook, the single proof and the product hero'}; choose the strongest frames, not the first ones.
The copy, written new for ${spec.seconds} seconds (not the master's lines cut short), one beat per shot in the same order:
- "vo": the English announcer line, ${VO_MIN_WORDS} words at least and no more than the shot holds (${[3, 3.5, 4, 4.5, 5].map((s) => `${s} s: ${maxVoWords(s)}`).join(', ')} words);
- "zh": its Chinese subtitle, at most ${subtitleMax(brief.ratio)} characters, a space instead of commas and full stops;
- "text": the Chinese title on screen, at most ${TEXT_MAX_CHARS} characters, no closing punctuation.
A claim that was safe with the master's qualifiers can become absolute in fewer words: no superlatives, no guarantees, nothing the proof points do not support.
Return JSON only:
{"version": "${spec.id}", "target_seconds": ${spec.seconds}, "shots": ${example}, "script": {"structure": "...", "beats": [{"beat": 1, "job": "hook", "see": "what is on screen", "vo": "English line", "zh": "中文字幕", "text": "标题"}]}, "notes": ["..."]}`
}

/**
 * Versions: the 15- and 6-second cutdowns of the master. The versioning editor chooses the shots and writes each
 * version's copy; the copy goes through the same compliance review as the master; the announcer re-voices it in the cast
 * voice; the cut reuses the master's clips, end card, grade, typography, labels, loudness and score (back-timed so it
 * resolves on the new end card). A version whose plan or copy cannot be made to pass is not cut and is reported open.
 */
export async function versionsStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const script = need(ctx.script, 'script')
  const storyboard = need(ctx.storyboard, 'storyboard')
  const master = need(ctx.masterCut, 'master cut')
  const dir = ctx.dir!
  const fps = brief.fps ?? DEFAULT_FPS
  const specs = cutdownsFor(brief.durationSeconds, storyboard.shots.length)
  if (!specs.length) {
    await ctx.record('versions', 'versioning-editor', undefined, { skipped: `no cutdown of a ${brief.durationSeconds} s master: a version is at most half the master's length` })
    return `no cutdowns of a ${brief.durationSeconds} s master`
  }
  const clips = shotClipPaths(dir, storyboard, fps)
  const brand = ctx.brand ? await brandFinish(ctx.brand) : undefined
  const scores = await gateScores(dir, ctx.runId)
  const made: string[] = []
  for (const spec of specs) {
    const openItem = async (detail: Record<string, unknown>, message: string) => {
      ctx.log(`  open item: ${spec.id} version not cut - ${message}`)
      await ctx.record('versions', 'versioning-editor', ctx.planner, { version: spec.id, ...detail, openItems: [`${spec.id} 版本未剪出：${message}`] })
    }
    ctx.log(`▸ version ${spec.id}  versioning editor · ${ctx.planner.name}`)
    const planRun = await chatJson<VersionPlan>(
      ctx.planner,
      {
        system: await ctx.agentPrompt('versioning editor and copywriter', ['editing-and-versioning', 'ad-script-writing']),
        thinking: false,
        maxTokens: 3000,
        temperature: 0.6,
        user: versionUser(spec, brief, script, storyboard, scores, fps, ctx.treatment, ctx.brand?.kit),
      },
      (plan) => checkVersion(plan, spec, storyboard, brief, fps),
      PLAN_ATTEMPTS,
    ).catch((error: Error) => error)
    if (planRun instanceof Error) { await openItem({ error: planRun.message.slice(0, 300) }, `the editor returned no usable plan (${planRun.message.slice(0, 120)})`); continue }
    if (planRun.unresolved.length) { await openItem({ attempts: planRun.attempts, rejected: planRun.rejected }, `the plan still fails its checks after ${planRun.attempts} attempts: ${planRun.unresolved.join('; ').slice(0, 300)}`); continue }
    let plan = planRun.value
    await ctx.record('versions', 'versioning-editor', ctx.planner, { version: spec.id, seconds: planRun.seconds, attempts: planRun.attempts, rejected: planRun.rejected, shots: plan.shots, notes: plan.notes ?? [] })

    // The same compliance path as the master, by a different agent than the one that wrote the copy.
    ctx.log(`▸ version ${spec.id}  compliance · ${ctx.editor.name}`)
    const review = await reviewCopy(ctx, { brief, script: plan.script, check: (copy) => checkVersion({ ...plan, script: copy }, spec, storyboard, brief, fps), subject: `Copy of the ${spec.seconds}-second cutdown` })
    for (const item of review.openItems) ctx.log(`  open item: ${spec.id} ${item}`)
    await ctx.record('versions', 'reviewer', ctx.editor, { version: spec.id, seconds: review.seconds, approve: review.reviewer?.approve, issues: review.reviewer?.issues, scanFindings: review.findings.length, revisedBeats: review.revisedBeats, unrevisedFlaggedBeats: review.unrevisedFlaggedBeats, unapprovedWithoutBeats: review.unapprovedWithoutBeats })
    if (review.blocked.length) { await openItem({ blocked: review.blocked.map((f) => f.text) }, `compliance blocked the copy (${review.blocked.map((f) => f.text).join(', ')})`); continue }
    plan = { ...plan, script: review.script }
    await writeFile(join(dir, 'cut', `version_${spec.id}.json`), JSON.stringify({ ...plan, fps, compliance: { scan: review.findings, reviewer: review.reviewer } }, null, 2))

    const length = versionLength(plan.shots)
    // The score is back-timed: the version takes the last `length` seconds of the master's bed, so it resolves on its end card.
    const music = master.music ? { kind: 'file' as const, path: master.music.path, offset: master.music.offset + Math.max(0, master.seconds - length) } : undefined
    const cut: CutResult = await cutFilm({
      dir, brief, script: plan.script, shots: plan.shots.map((shot) => ({ clip: clips[storyboard.shots.findIndex((s) => s.shot === shot.shot)]!, seconds: shot.seconds })),
      endCard: endCardPath(dir), output: join(dir, 'cut', `final_${spec.id}.mp4`), ass: join(dir, 'cut', `titles_${spec.id}.ass`), voicePrefix: `v${spec.id}_vo`,
      music, silent: ctx.options.silent || !master.music, comfy: need(ctx.comfy, 'comfy'), record: ctx.record, log: ctx.log, treatment: ctx.treatment, ...(brand ? { brand } : {}),
      stage: 'versions', recordTags: { version: spec.id }, produceId: `${brief.id}-${spec.id}`,
    })
    const measured = await probeDuration(cut.path)
    await addAsset(brief.id, { id: `final-${spec.id}`, kind: 'video', stage: 'versions', path: `cut/final_${spec.id}.mp4`, execution: 'local-dgx-spark', model: 'ffmpeg', seconds: measured, note: `${spec.seconds} s cutdown of the master` })
    await ctx.record('versions', 'cut', undefined, { version: spec.id, path: `cut/final_${spec.id}.mp4`, editSeconds: cut.seconds, fileSeconds: measured, shots: plan.shots.map((s) => ({ shot: s.shot, seconds: s.seconds, why: s.why })), copy: plan.script.beats.map((b) => b.zh), voice: cut.voice ?? null, musicOffset: cut.music?.offset ?? null })
    ctx.log(`▸ version ${spec.id}  ${cut.path} (${measured.toFixed(2)} s)`)
    ctx.versions.push({ spec, plan, cut })
    made.push(spec.id)
  }
  return made.length ? `${made.join(' · ')} cut` : 'no version cut (see open items)'
}
