import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { scanCopy } from '../lib/compliance.js'
import { probeDuration } from '../lib/ffmpeg.js'
import { generateImage, generateVideo, videoSize, VIDEO_NEGATIVE, type VideoModel } from '../lib/media.js'
import { sleepService, wakeService } from '../lib/rest.js'
import { memoryStatus } from '../lib/memory.js'
import { addAsset, createProject, projectDir, setStage, type Stage } from '../lib/project.js'
import { checkBrief, checkScript, checkStoryboard, composeImagePrompt, composeProductPrompt, composeVideoNegative, composeVideoPrompt, industryOf, type Brief, type Script, type Shot, type Storyboard } from './checks.js'
import { writeDeliveryReport } from './delivery.js'
import { enterPhase, finishFilm } from './finish.js'
import { qualityGate, type QaVerdict } from './gate.js'
import { jevConfig, judgeCopy, judgeStoryboard } from './jev.js'
import { chatJson, endpoints, type ModelEndpoint } from './llm.js'
import { agentSystem, scriptUser, storyboardUser } from './prompts.js'
import { loadRules, loadSkill } from './skills.js'

export interface HarnessOptions {
  brief: string
  id?: string
  ratio?: string
  durationSeconds?: number
  /** Stop after the storyboard; useful for evals and for reviewing the plan before spending GPU time. */
  planOnly?: boolean
  /** Run the agents without their skills. Exists for the with/without-skill comparison only. */
  withoutSkills?: boolean
  resolution?: string
  videoModel?: VideoModel
  /** Use this music file instead of generating a bed. Only a file the user supplied or has rights to. */
  audio?: string
  /** Leave the film silent (no voiceover, no music). */
  silent?: boolean
  /** Frames generated per shot before the gate picks one. */
  candidates?: number
  /** Generate every candidate even after one passed, and keep the best score. Default: stop at the first pass. */
  bestOf?: boolean
  /** Serial scheduling only: render the next shot's first candidate while the current one is judged (default true). */
  prefetch?: boolean
  /** 'queue' (default): every shot's gate loop runs at once. 'serial': one shot after another, as before. */
  frameScheduling?: 'queue' | 'serial'
  log?: (line: string) => void
}

export interface HarnessResult {
  projectId: string
  dir: string
  finalCut?: string
  rejectedAttempts: Record<string, number>
  qaRegenerations: number
  wallSeconds: number
}

/** Frames are generated at the video model's working size: the clip is made at that size, so a larger still only costs time (1920x1080 took 77 s a frame; 1280x704 about half). */
const frameSize = (resolution: string, ratio: string) => videoSize(resolution, ratio).join('x')
const MAX_QA_REGENERATIONS = 2

/**
 * CineLoom Harness: the runtime that hosts the director and its sub-agents. Eight stages in
 * a fixed order, each handed to an agent that works under one skill. Code owns the order and
 * the acceptance checks; models own the judgement.
 */
export async function runHarness(options: HarnessOptions): Promise<HarnessResult> {
  const started = Date.now()
  const log = options.log ?? ((line: string) => console.error(line))
  const { planner, reviewer, editor } = endpoints()
  const rules = await loadRules()
  const rejectedAttempts: Record<string, number> = {}

  const agentPrompt = async (role: string, skill: string) =>
    agentSystem(role, rules, options.withoutSkills ? undefined : { name: skill, body: await loadSkill(skill) })

  // ---- brief -----------------------------------------------------------------------------
  log('▸ brief        intake agent · nemotron')
  const briefRun = await chatJson<Brief>(
    planner,
    {
      system: await agentPrompt('intake producer', 'ad-brief-intake'),
      thinking: false,
      temperature: 0.3,
      user: `This run is non-interactive: nobody can answer questions, so decide every open point yourself.
Request: ${options.brief}
${options.ratio ? `The user fixed the aspect ratio: ${options.ratio}.` : ''}${options.durationSeconds ? ` The user fixed the duration: ${options.durationSeconds} seconds.` : ''}

Return JSON only:
{"id": "lowercase-dashed-project-id", "title": "short Chinese title", "product": "what is being advertised", "category": "general|food|health_food|cosmetics|medical",
 "audience": "...", "message": "the one thing the viewer should remember, in Chinese", "ratio": "9:16|16:9|1:1", "durationSeconds": 15,
 "tone": "tone and visual style in English", "brandText": "the brand name as it should appear on the product, at most 4 common characters",
 "appearance": "the product's look copied word for word from the request (container, material, colours, label); empty if the request says nothing about it"}`,
    },
    checkBrief,
  )
  // What the request states outright is not the model's to decide: the coffee brief asked for
  // 横版 and the intake agent still chose 9:16. Explicit user words win over the agent's choice.
  const stated = statedFormat(options.brief)
  const brief = { ...briefRun.value, id: options.id ?? briefRun.value.id, ...(options.ratio ? { ratio: options.ratio as Brief['ratio'] } : stated.ratio ? { ratio: stated.ratio } : {}), ...(options.durationSeconds ? { durationSeconds: options.durationSeconds } : stated.durationSeconds ? { durationSeconds: stated.durationSeconds } : {}) }
  rejectedAttempts.brief = briefRun.rejected.length
  await createProject({ id: brief.id, title: brief.title, brief: options.brief, ratio: brief.ratio, durationSeconds: brief.durationSeconds })
  const dir = projectDir(brief.id)
  const jev = jevConfig()
  let jevReview: Array<{ beat: number; line: string; issue: string; probability: number }> = []
  const record = async (stage: Stage | 'run', agent: string, endpoint: ModelEndpoint | undefined, detail: Record<string, unknown>) =>
    appendFile(
      join(dir, 'reports', 'run.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), stage, agent, model: endpoint?.model, execution: endpoint?.execution ?? 'local-dgx-spark', ...detail })}\n`,
    )
  await writeFile(join(dir, 'brief.json'), JSON.stringify(brief, null, 2))
  await record('brief', 'intake', planner, { seconds: briefRun.seconds, attempts: briefRun.attempts, skills: !options.withoutSkills })

  // ---- script ----------------------------------------------------------------------------
  await setStage(brief.id, 'script', 'running')
  log('▸ script       copywriter agent · nemotron')
  const scriptRun = await chatJson<Script>(
    planner,
    {
      system: await agentPrompt('copywriter', 'ad-script-writing'),
      // Thinking mode spent the whole token budget reasoning about the length limits and returned nothing.
      thinking: false,
      maxTokens: 3000,
      temperature: 0.8,
      user: scriptUser(brief),
    },
    async (script) => {
      const problems = checkScript(script, brief)
      // Structured judge (optional, cloud): semantic problems the regex scan cannot see, at a
      // calibrated threshold. Certain findings go straight back to the copywriter as rewrite reasons.
      if (problems.length === 0 && jev) {
        const judged = await judgeCopy(jev, brief, script)
        await record('script', 'jev', undefined, { execution: 'cloud', model: judged.model, seconds: judged.seconds, inputTokens: judged.inputTokens, findings: judged.findings })
        problems.push(...judged.findings.filter((f) => f.severity === 'block').map((f) => `beat ${f.beat} "${f.line}": ${f.issue} (p=${f.probability.toFixed(2)})`))
        jevReview = judged.findings.filter((f) => f.severity === 'review')
      }
      return problems
    },
    6,
  )
  failIfHardProblems('script', checkScript(scriptRun.value, brief), scriptRun.attempts)
  if (scriptRun.unresolved.length) log(`  script accepted with ${scriptRun.unresolved.length} unresolved semantic finding(s) after ${scriptRun.attempts} attempts`)
  let script = scriptRun.value
  rejectedAttempts.script = scriptRun.rejected.length
  await record('script', 'copywriter', planner, { seconds: scriptRun.seconds, attempts: scriptRun.attempts, rejected: scriptRun.rejected })
  await setStage(brief.id, 'script', 'done', `${script.beats.length} beats · ${script.structure}`)

  // ---- compliance: deterministic scan, then an independent reviewer on a different model ----
  await setStage(brief.id, 'compliance', 'running')
  log(`▸ compliance   scan + independent reviewer · ${editor.name}`)
  const reviewRun = await chatJson<{ approve: boolean; issues: string[]; revised?: Array<{ beat: number; vo: string; text: string }> }>(
    editor,
    {
      system: await agentPrompt('compliance reviewer and Chinese copy editor. You did not write this script', 'ad-compliance-review'),
      thinking: false,
      maxTokens: 2000,
      temperature: 0.2,
      user: `Product category: ${brief.category}. Proof points the brand can substantiate: none supplied.
Script copy:\n${script.beats.map((beat) => `Beat ${beat.beat} VO: ${beat.vo}\nBeat ${beat.beat} text: ${beat.text}`).join('\n')}

${jevReview.length ? `A structured judge flagged these lines as uncertain; decide each one:\n${jevReview.map((f) => `- beat ${f.beat} "${f.line}": ${f.issue} (p=${f.probability.toFixed(2)})`).join('\n')}\n\n` : ''}Judge two things only, briefly: (1) wording a keyword scan would miss - implied superlatives, implied comparison with competitors, effects nobody could prove; (2) Chinese that sounds unnatural when read aloud.
Line lengths are checked elsewhere; do not count characters. Return JSON only:
{"approve": true|false, "issues": ["..."], "revised": [{"beat": 1, "vo": "...", "text": "..."}]}  ("revised" only for lines you would change)`,
    },
    (review) => (typeof review.approve === 'boolean' ? [] : ['"approve" must be true or false']),
    2,
  ).catch((error: Error) => {
    log(`  reviewer unavailable (${error.message.slice(0, 120)}); continuing with the deterministic scan only`)
    return undefined
  })
  if (reviewRun?.value.revised?.length) {
    const revisedBeats = script.beats.map((beat) => {
      const change = reviewRun.value.revised!.find((item) => item.beat === beat.beat)
      return change ? { ...beat, vo: change.vo ?? beat.vo, text: change.text ?? beat.text } : beat
    })
    // The reviewer's edits are accepted only if they still pass every script check.
    if (checkScript({ ...script, beats: revisedBeats }, brief).length === 0) script = { ...script, beats: revisedBeats }
  }
  const copy = script.beats.map((beat) => `${beat.vo}\n${beat.text}`).join('\n')
  const findings = scanCopy(copy, brief.category)
  await writeFile(join(dir, 'script', 'script.json'), JSON.stringify(script, null, 2))
  await writeFile(join(dir, 'script', 'copy.txt'), copy)
  await writeFile(join(dir, 'reports', 'compliance.json'), JSON.stringify({ scan: findings, reviewer: reviewRun?.value ?? null }, null, 2))
  await record('compliance', 'reviewer', editor, { seconds: reviewRun?.seconds ?? 0, approve: reviewRun?.value.approve, issues: reviewRun?.value.issues, scanFindings: findings.length })
  if (findings.some((finding) => finding.severity === 'block')) {
    await setStage(brief.id, 'compliance', 'failed', 'blocked wording remains after review')
    throw new Error(`Compliance blocked the script: ${findings.filter((finding) => finding.severity === 'block').map((finding) => finding.text).join(', ')}`)
  }
  await setStage(brief.id, 'compliance', 'done', `${findings.length} review-level findings`)

  // ---- storyboard ------------------------------------------------------------------------
  await setStage(brief.id, 'storyboard', 'running')
  log('▸ storyboard   storyboard agent · nemotron')
  const storyboardUserPrompt = storyboardUser(brief, script)
  const storyboardRun = await chatJson<Storyboard>(
    planner,
    { system: await agentPrompt('storyboard artist', 'storyboard-design'), thinking: false, maxTokens: 5000, temperature: 0.4, user: storyboardUserPrompt },
    async (storyboard) => {
      const problems = checkStoryboard(storyboard, script, brief)
      if (problems.length === 0 && jev) {
        const judged = await judgeStoryboard(jev, storyboard)
        await record('storyboard', 'jev', undefined, { execution: 'cloud', model: judged.model, seconds: judged.seconds, inputTokens: judged.inputTokens, problems: judged.problems, notes: judged.notes })
        for (const note of judged.notes) log(`  note: ${note}`)
        problems.push(...judged.problems)
      }
      return problems
    },
    6,
  )
  failIfHardProblems('storyboard', checkStoryboard(storyboardRun.value, script, brief), storyboardRun.attempts)
  if (storyboardRun.unresolved.length) log(`  storyboard accepted with ${storyboardRun.unresolved.length} unresolved semantic finding(s) after ${storyboardRun.attempts} attempts`)
  const storyboard = storyboardRun.value
  rejectedAttempts.storyboard = storyboardRun.rejected.length
  await writeFile(join(dir, 'storyboard', 'storyboard.json'), JSON.stringify(storyboard, null, 2))
  await record('storyboard', 'storyboard', planner, { seconds: storyboardRun.seconds, attempts: storyboardRun.attempts, rejected: storyboardRun.rejected })
  await setStage(brief.id, 'storyboard', 'done', `${storyboard.shots.length} shots`)

  const result: HarnessResult = { projectId: brief.id, dir, rejectedAttempts, qaRegenerations: 0, wallSeconds: 0 }
  if (options.planOnly) {
    result.wallSeconds = (Date.now() - started) / 1000
    return result
  }

  // ---- frames + quality gate -------------------------------------------------------------
  const comfy = new ComfyClient()
  await setStage(brief.id, 'frames', 'running')
  await setStage(brief.id, 'qa', 'running')
  // The planner is not needed while pictures are made (a prompt repair wakes it on demand);
  // releasing its memory lets ComfyUI keep the image model resident between frames.
  const rest = async (phase: string, targets: ModelEndpoint[]) => {
    const slept: string[] = []
    for (const target of targets) if (await sleepService(target.baseUrl).catch(() => false)) slept.push(target.name)
    if (slept.length) await record('run', 'scheduler', undefined, { phase, sleeping: slept, availableAfterSleepGb: (await memoryStatus()).availableGb })
  }
  await rest('product hero (Qwen-Image)', [planner])
  await enterPhase(comfy, 'product hero (Qwen-Image)', record)
  // The hero still: one approved picture of the product that every shot is generated from,
  // so the can in shot 3 is the can in shot 1. A text description alone let it drift.
  await mkdir(join(dir, 'refs'), { recursive: true })
  const heroShot: Shot = { shot: 0, seconds: 0, framing: 'product', camera: 'static', image_prompt: '', video_prompt: '', on_screen_text: '', must_show: `exactly one ${brief.product}, fully visible and centred, matching this description: ${storyboard.product}. Its brand lettering reads "${brief.brandText}" clearly and correctly. Finish, proportions and size are not judged here` }
  let hero: { path: string; verdict: QaVerdict } | undefined
  let heroPrompt = composeProductPrompt(storyboard, industryOf(brief.product), brief.brandText)
  for (let attempt = 0; attempt <= MAX_QA_REGENERATIONS; attempt++) {
    const path = join(dir, 'refs', `product${attempt ? `_r${attempt}` : ''}.png`)
    const image = await generateImage(comfy, { prompt: heroPrompt, size: '1328x1328', output: path })
    const verdict = await qualityGate(reviewer, path, heroShot, undefined, industryOf(brief.product))
    log(`▸ product hero ${image.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
    await record('frames', 'product-hero', reviewer, { attempt, imageSeconds: image.seconds, ...verdict })
    if (!hero || verdict.score > hero.verdict.score) hero = { path, verdict }
    if (verdict.pass) break
    if (attempt < MAX_QA_REGENERATIONS) heroPrompt = await repairPrompt(planner, await agentPrompt('storyboard artist', 'shot-quality-gate'), heroShot, heroPrompt, verdict.issues)
  }
  // Every frame is anchored to this picture; a wrong product here makes the whole film wrong.
  if (!hero!.verdict.pass && hero!.verdict.score >= 0) {
    await setStage(brief.id, 'frames', 'failed', `product hero still rejected ${MAX_QA_REGENERATIONS + 1} times: ${hero!.verdict.issues[0] ?? ''}`)
    throw new Error(`The product hero still never passed the gate: ${hero!.verdict.issues.join('; ')}`)
  }
  if (!hero!.verdict.pass) {
    await setStage(brief.id, 'frames', 'failed', `hero still rejected ${MAX_QA_REGENERATIONS + 1} times: ${hero!.verdict.issues[0] ?? ''}`)
    throw new Error(`The product hero still failed the gate ${MAX_QA_REGENERATIONS + 1} times (${hero!.verdict.issues.join('; ')}). Every frame is anchored to it, so the film cannot continue with the wrong product.`)
  }
  await addAsset(brief.id, { id: 'product-hero', kind: 'image', stage: 'frames', path: hero!.path.slice(dir.length + 1), execution: 'local-dgx-spark', model: 'qwen_image_lightning', note: `gate ${hero!.verdict.score}` })

  await enterPhase(comfy, 'frames (Qwen-Image-Edit)', record)
  const frames = new Map<number, string>()
  const frameSizeFor = frameSize(options.resolution ?? '720p', brief.ratio)
  const framePath = (shot: Shot, suffix: string) => join(dir, 'frames', `shot_${String(shot.shot).padStart(3, '0')}${suffix}.png`)
  const render = (shot: Shot, prompt: string, suffix: string) => {
    const path = framePath(shot, suffix)
    // imageSeconds counts from the request, so it includes any wait in ComfyUI's queue.
    const renderStartedAt = new Date().toISOString()
    return generateImage(comfy, { prompt, size: frameSizeFor, output: path, references: [hero!.path] }).then((image) => ({ path, image, renderStartedAt }))
  }
  type Rendered = { path: string; image: { seconds: number }; renderStartedAt: string }
  /** One shot's whole gate loop: first candidate, further seeds, then prompt repairs. */
  const makeFrame = async (shot: Shot, first: Promise<Rendered>, onFirstJudging?: () => void) => {
    let prompt = composeImagePrompt(shot, storyboard, true, industryOf(brief.product))
    let best: { path: string; verdict: QaVerdict } | undefined
    const consider = (path: string, verdict: QaVerdict) => {
      if (!best || (verdict.pass && !best.verdict.pass) || (verdict.pass === best.verdict.pass && verdict.score > best.verdict.score)) best = { path, verdict }
    }
    const judge = async (rendered: Rendered, suffix: string, attempt: number) => {
      const gateStarted = Date.now()
      const verdict = await qualityGate(reviewer, rendered.path, shot, hero!.path, industryOf(brief.product))
      const gateSeconds = (Date.now() - gateStarted) / 1000
      log(`▸ frame ${shot.shot}${suffix.padEnd(5)} ${rendered.image.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
      await record('qa', 'quality-gate', reviewer, { shot: shot.shot, attempt, candidate: suffix || '_a', renderStartedAt: rendered.renderStartedAt, imageSeconds: rendered.image.seconds, gateSeconds, ...verdict })
      consider(rendered.path, verdict)
    }
    const shoot = async (suffix: string, attempt: number) => judge(await render(shot, prompt, suffix), suffix, attempt)
    const judging = judge(await first, '', 0)
    onFirstJudging?.()
    await judging
    // Best of N: the same prompt with different seeds. A diffusion model's spread between
    // seeds is often larger than what a prompt edit buys, and the gate can rank the results.
    // By default the next seed is only spent when the previous one failed the gate (a frame that
    // passed is a frame); `bestOf` generates every candidate and keeps the highest score.
    const candidates = Math.max(1, options.candidates ?? 2)
    for (let candidate = 1; candidate < candidates; candidate++) {
      if (!options.bestOf && best?.verdict.pass) break
      await shoot(`_c${candidate + 1}`, 0)
    }
    for (let attempt = 1; attempt <= MAX_QA_REGENERATIONS && !best!.verdict.pass; attempt++) {
      result.qaRegenerations++
      prompt = await repairPrompt(planner, await agentPrompt('storyboard artist', 'shot-quality-gate'), shot, prompt, best!.verdict.issues)
      await shoot(`_r${attempt}`, attempt)
    }
    frames.set(shot.shot, best!.path)
    await addAsset(brief.id, {
      id: `frame-${shot.shot}`, kind: 'image', stage: 'frames', path: best!.path.slice(dir.length + 1), shot: shot.shot,
      execution: 'local-dgx-spark', model: 'qwen_image_edit_lightning', note: best!.verdict.score < 0 ? 'unverified: the reviewer never concluded' : `gate ${best!.verdict.score}${best!.verdict.pass ? '' : ' (kept after failed gate)'}`,
    })
  }
  const firstRender = (shot: Shot) => render(shot, composeImagePrompt(shot, storyboard, true, industryOf(brief.product)), '')
  if ((options.frameScheduling ?? 'queue') === 'queue') {
    // Every shot runs its own gate loop at once. ComfyUI renders its queue in order and the
    // reviewer judges whatever is ready, so a shot that keeps failing no longer holds the image
    // model idle while the others wait their turn. Same prompts, gate, seeds rule and limits.
    await Promise.all(storyboard.shots.map((shot) => makeFrame(shot, firstRender(shot))))
  } else {
    // Serial: while the reviewer judges this shot's first candidate, the next shot's first
    // candidate is already rendering.
    let prefetched: Promise<Rendered> | undefined
    for (const [index, shot] of storyboard.shots.entries()) {
      const next = storyboard.shots[index + 1]
      const first = prefetched ?? firstRender(shot)
      prefetched = undefined
      await makeFrame(shot, first, () => {
        if (next && options.prefetch !== false) prefetched = firstRender(next)
      })
    }
  }
  await setStage(brief.id, 'frames', 'done')
  await setStage(brief.id, 'qa', 'done', `${result.qaRegenerations} regenerations`)

  // ---- clips -----------------------------------------------------------------------------
  await setStage(brief.id, 'clips', 'running')
  await rest('clips (Wan2.2)', [planner, reviewer])
  await enterPhase(comfy, 'clips (Wan2.2)', record)
  for (const [index, shot] of storyboard.shots.entries()) {
    const output = join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}.mp4`)
    const clip = await generateVideo(comfy, {
      prompt: composeVideoPrompt(shot, industryOf(brief.product)), negative: composeVideoNegative(VIDEO_NEGATIVE, industryOf(brief.product)), output, resolution: options.resolution ?? '720p', ratio: brief.ratio, durationSeconds: shot.seconds || 5,
      firstFrame: frames.get(shot.shot), freeAfter: index === storyboard.shots.length - 1, model: options.videoModel ?? 'wan22-14b',
    })
    log(`▸ clip ${shot.shot}       ${clip.seconds.toFixed(1)}s`)
    await record('clips', 'video', undefined, { shot: shot.shot, seconds: clip.seconds })
    await addAsset(brief.id, { id: `clip-${shot.shot}`, kind: 'video', stage: 'clips', path: `clips/shot_${String(shot.shot).padStart(3, '0')}.mp4`, shot: shot.shot, execution: clip.workflow.startsWith('cloud:') ? 'cloud' : 'local-dgx-spark', model: clip.workflow, seconds: clip.seconds })
  }
  await setStage(brief.id, 'clips', 'done')

  // ---- cut -------------------------------------------------------------------------------
  await setStage(brief.id, 'cut', 'running')
  // Finishing (voice, music, titles, grade) needs neither language model, so their ~100 s weight
  // reload runs underneath it instead of after it.
  const waking = Promise.all([planner, reviewer].map((target) => wakeService(target.baseUrl).then((woke) => record('run', 'scheduler', undefined, { phase: 'cut', woke: target.name, wokeSeconds: woke.wokeSeconds ?? 0 })).catch(() => undefined)))
  const finalCut = await finishFilm({ dir, brief, script, storyboard, heroPath: hero!.path, comfy, audio: options.audio, silent: options.silent, record, log })
  await addAsset(brief.id, { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg' })
  await setStage(brief.id, 'cut', 'done', `${(await probeDuration(finalCut)).toFixed(1)}s`)
  result.finalCut = finalCut
  // The language models were woken while the film was being finished; make sure both are back before we return.
  await waking
  result.wallSeconds = (Date.now() - started) / 1000
  await record('run', 'director', undefined, { wallSeconds: result.wallSeconds, frameScheduling: options.frameScheduling ?? 'queue', qaRegenerations: result.qaRegenerations, rejectedAttempts, memoryAtEnd: await memoryStatus() })
  // The report written inside finishFilm predates this final record; write it again so it carries the total.
  await writeDeliveryReport(dir, brief, script, storyboard, finalCut)
  log(`▸ cut          ${finalCut}`)
  return result
}

async function repairPrompt(planner: ModelEndpoint, system: string, shot: Shot, prompt: string, issues: string[]): Promise<string> {
  const run = await chatJson<{ image_prompt: string }>(
    planner,
    {
      system,
      thinking: false,
      temperature: 0.4,
      user: `The quality gate rejected shot ${shot.shot}.\nIssues: ${issues.join('; ') || 'required content missing'}\nMust show: ${shot.must_show}\nCurrent prompt: ${prompt}
Change the prompt according to the issue type; do not resubmit it unchanged. Rewrite only the scene description at the start. Keep every sentence from "Image 1 is the product" or "The product:" onward exactly as it is. Keep it in English.
Return JSON only: {"image_prompt": "..."}`,
    },
    (value) => (value.image_prompt?.trim() ? [] : ['image_prompt is empty']),
    2,
  )
  return run.value.image_prompt
}

/** A hard validator problem that survived every attempt would break the film (wrong beat count, restricted wording, Chinese in an image prompt): stop here, truthfully. */
function failIfHardProblems(stage: string, problems: string[], attempts: number): void {
  if (problems.length) throw new Error(`${stage} still fails its checks after ${attempts} attempts: ${problems.join('; ')}`)
}

/** Aspect ratio and duration stated in plain words in the request itself. */
export function statedFormat(request: string): { ratio?: Brief['ratio']; durationSeconds?: number } {
  const ratio = /横版|横屏|16:9|16：9/.test(request) ? '16:9' : /竖版|竖屏|9:16|9：16/.test(request) ? '9:16' : /方形|方版|1:1|1：1/.test(request) ? '1:1' : undefined
  const seconds = /(\d+)\s*秒/.exec(request)?.[1]
  const durationSeconds = seconds && Number(seconds) % 5 === 0 && Number(seconds) >= 5 && Number(seconds) <= 30 ? Number(seconds) : undefined
  return { ratio, durationSeconds }
}
