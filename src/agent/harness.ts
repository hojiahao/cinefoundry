import { access, appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { scanCopy } from '../lib/compliance.js'
import { normalizeImage, probeDuration } from '../lib/ffmpeg.js'
import { generateImage, generateVideo, videoSize, VIDEO_NEGATIVE, type VideoModel } from '../lib/media.js'
import { sleepService, wakeService } from '../lib/rest.js'
import { memoryStatus } from '../lib/memory.js'
import { addAsset, createProject, projectDir, projectsRoot, setStage as saveStage, type Stage } from '../lib/project.js'
import { captionProblems, checkBrief, checkProductPhoto, checkRepairedPrompt, checkScript, checkStoryboard, composeImagePrompt, composeProductPrompt, composeVideoNegative, composeVideoPrompt, briefIndustry, photoLettering, type Brief, type ProductPhoto, type Script, type Shot, type Storyboard } from './checks.js'
import { writeDeliveryReport } from './delivery.js'
import { enterPhase, finishFilm } from './finish.js'
import { qualityGate, type QaVerdict } from './gate.js'
import { jevConfig, judgeCopy, judgeStoryboard } from './jev.js'
import { chatJson, endpoints, JsonReplyError, type ModelEndpoint } from './llm.js'
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
  /** A photo of the real product, used as the hero still instead of generating one from text. Only a photo the user has rights to. */
  productImage?: string
  /** Facts the client can substantiate (specs, figures, sources). The copy may claim these and nothing stronger. */
  proof?: string
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
 * Spotfoundry Harness: the runtime that hosts the director and its sub-agents. Eight stages in
 * a fixed order, each handed to an agent that works under one skill. Code owns the order and
 * the acceptance checks; models own the judgement.
 */
export async function runHarness(options: HarnessOptions): Promise<HarnessResult> {
  const release = await takeRunLock(options.brief)
  try {
    return await runHarnessUnlocked(options)
  } finally {
    await release()
  }
}

/**
 * One GPU, one film at a time, enforced here rather than left to whoever starts the run: a second run
 * makes both slow and can fail a model load, and agents asked to check first with pgrep skipped it
 * (eval/skill-bench, spotfoundry-ad-film: 32 of 32 plans). A lock whose process is gone is stale and is taken over.
 */
async function takeRunLock(brief: string): Promise<() => Promise<void>> {
  const lock = join(projectsRoot(), '.harness.lock')
  const held = await readFile(lock, 'utf8').then((text) => JSON.parse(text) as { pid: number; startedAt: string; brief: string }).catch(() => undefined)
  if (held && held.pid !== process.pid && alive(held.pid)) {
    throw new Error(`Another film is generating (pid ${held.pid}, started ${held.startedAt}: "${held.brief.slice(0, 60)}"). One film at a time on this GPU: wait for it to finish, or stop it first.`)
  }
  await mkdir(projectsRoot(), { recursive: true })
  await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), brief }))
  return async () => {
    const now = await readFile(lock, 'utf8').then((text) => JSON.parse(text) as { pid: number }).catch(() => undefined)
    if (now?.pid === process.pid) await rm(lock, { force: true })
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function runHarnessUnlocked(options: HarnessOptions): Promise<HarnessResult> {
  // Any stage still marked running when the run throws is marked failed with the reason: the studio
  // board reads this record, and a stage left running looks like a stalled job.
  const running = new Map<string, Set<Stage>>()
  const setStage: typeof saveStage = async (id, stage, status, note) => {
    const stages = running.get(id) ?? new Set<Stage>()
    if (status === 'running') stages.add(stage)
    else stages.delete(stage)
    running.set(id, stages)
    return saveStage(id, stage, status, note)
  }
  try {
    return await runStages(options, setStage)
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300)
    for (const [id, stages] of running) for (const stage of stages) await saveStage(id, stage, 'failed', reason).catch(() => undefined)
    throw error
  }
}

async function runStages(options: HarnessOptions, setStage: typeof saveStage): Promise<HarnessResult> {
  const started = Date.now()
  const log = options.log ?? ((line: string) => console.error(line))
  const { planner, reviewer, editor } = endpoints()
  const rules = await loadRules()
  const rejectedAttempts: Record<string, number> = {}
  // Fail before any model time is spent, not half an hour later at the hero still.
  if (options.productImage) await access(options.productImage).catch(() => { throw new Error(`Product image not found: ${options.productImage}`) })

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
 "tone": "tone and visual style in English", "brandText": "the lettering actually printed on the product, copied exactly: at most 4 common Chinese characters or 12 Latin letters; never an abbreviation or model name that is not printed on it",
 "industry": "computing|electronics|drink|skincare|food|general: how this product is shot and sold (a computer, workstation, server or GPU is computing; a keyboard, earphones or a phone is electronics)",
 "tagline": "the closing line the request quotes for the end card (after 字幕/口号/广告语/slogan), copied character for character in the request's language; empty if the request quotes none",
 "appearance": "the product's look copied word for word from the request (container, material, colours, label); empty if the request says nothing about it"}`,
    },
    checkBrief,
  )
  // What the request states outright is not the model's to decide: the coffee brief asked for
  // 横版 and the intake agent still chose 9:16. Explicit user words win over the agent's choice.
  const stated = statedFormat(options.brief)
  const brief = { ...briefRun.value, id: options.id ?? briefRun.value.id, ...(options.ratio ? { ratio: options.ratio as Brief['ratio'] } : stated.ratio ? { ratio: stated.ratio } : {}), ...(options.durationSeconds ? { durationSeconds: options.durationSeconds } : stated.durationSeconds ? { durationSeconds: stated.durationSeconds } : {}) }
  // A closing line the client quoted is theirs, word for word: the copywriter never saw the request, so
  // "DGX Spark，把 AI 超算放上你的桌面" became "AI supercomputing on your desk". The model's copy counts only if it is in the request.
  const modelTagline = briefRun.value.tagline?.trim()
  const tagline = statedTagline(options.brief) ?? (modelTagline && options.brief.includes(modelTagline) ? closingLine(modelTagline) : undefined)
  delete brief.tagline
  if (tagline) {
    const problems = captionProblems('tagline', tagline, true)
    if (problems.length) log(`  tagline "${tagline}" cannot be typeset (${problems[0]}); the end card shows the message instead`)
    else brief.tagline = tagline
  }
  if (brief.appearance) brief.appearance = faithfulLabel(brief.appearance, options.brief, brief.brandText)
  if (options.proof?.trim()) brief.proof = options.proof.trim()
  rejectedAttempts.brief = briefRun.rejected.length
  await createProject({ id: brief.id, title: brief.title, brief: options.brief, ratio: brief.ratio, durationSeconds: brief.durationSeconds })
  const dir = projectDir(brief.id)
  let jev = jevConfig()
  let jevReview: Array<{ beat: number; line: string; issue: string; probability: number }> = []
  const record = async (stage: Stage | 'run', agent: string, endpoint: ModelEndpoint | undefined, detail: Record<string, unknown>) =>
    appendFile(
      join(dir, 'reports', 'run.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), stage, agent, model: endpoint?.model, execution: endpoint?.execution ?? 'local-dgx-spark', ...detail })}\n`,
    )
  // The judge is an optional cloud service. When it cannot be reached (HTTP 451 "not available in
  // your region" once spent all six script attempts) it is switched off for this run and the local
  // checks and the reviewer agent carry on; an outage is not a reason to rewrite the copy.
  const judgeWith = async <T>(judge: (config: NonNullable<typeof jev>) => Promise<T>, stage: Stage): Promise<T | undefined> => {
    if (!jev) return undefined
    try {
      return await judge(jev)
    } catch (error) {
      jev = undefined
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200)
      log(`  jev unavailable, continuing without it: ${reason}`)
      await record(stage, 'jev', undefined, { execution: 'cloud', unavailable: reason })
      return undefined
    }
  }
  await record('brief', 'intake', planner, { seconds: briefRun.seconds, attempts: briefRun.attempts, skills: !options.withoutSkills })
  // With a product photo the photo is the product's look; without one the hero still is generated from text.
  // The photo is read before anyone writes: the copywriter and the storyboard artist only see text, and a
  // style line of "cool-toned, smooth" made each shot repaint a gold foam front its own way.
  const photoPath = join(dir, 'refs', 'product.png')
  if (options.productImage) {
    await mkdir(join(dir, 'refs'), { recursive: true })
    // Written beside and renamed over: an agent once passed refs/product.png itself (read-only), and ffmpeg cannot overwrite its own input.
    await normalizeImage(options.productImage, `${photoPath}.tmp.png`, 1328)
    await rename(`${photoPath}.tmp.png`, photoPath)
    log('▸ photo        reader · step3-vl')
    const reading = await chatJson<ProductPhoto>(
      reviewer,
      {
        system: 'You describe product photos for an advertising studio. Describe only the product, never the background.',
        images: [photoPath],
        maxTokens: 3000,
        temperature: 0,
        user: `This is a photo of the real product (${brief.product}). Describe how the product itself looks, so a storyboard artist who cannot see the photo knows exactly this object. Describe the object only: not how it is placed, not the light, not the background.
Return JSON only: {"description": "one to three English sentences: overall shape and proportions, main colours, materials and surface texture of each face, and any visible lettering or logo (quote it) and where it sits on the product"}`,
      },
      checkProductPhoto,
      2,
    )
    // An unusable reading leaves the writers on the request's words; the frames still use the photo itself.
    if (reading.unresolved.length === 0) brief.photo = { description: reading.value.description.trim() }
    // The photo shows what is printed on the product. The intake agent once wrote "DGX" for a
    // device whose only lettering is "NVIDIA", and the gate then failed the real photo for it.
    const printed = brief.photo ? photoLettering(brief.photo.description) : []
    if (printed.length && !printed.some((text) => text.toLowerCase() === brief.brandText.trim().toLowerCase())) {
      await record('brief', 'photo-reader', reviewer, { brandText: { from: brief.brandText, to: printed[0], printed } })
      log(`▸ photo        brand lettering "${brief.brandText}" -> "${printed[0]}", as printed on the product`)
      brief.brandText = printed[0]!
    }
    await record('brief', 'photo-reader', reviewer, { seconds: reading.seconds, attempts: reading.attempts, unresolved: reading.unresolved, ...brief.photo })
    log(brief.photo ? `▸ photo        ${brief.photo.description.slice(0, 140)}` : `▸ photo        reading unusable (${reading.unresolved[0]}); writers use the request's words`)
  }
  // One industry for the whole run, written into the brief so a wrong read is visible.
  const industry = briefIndustry(brief)
  brief.industry = industry
  await writeFile(join(dir, 'brief.json'), JSON.stringify(brief, null, 2))

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
      user: scriptUser(brief, options.brief),
    },
    async (script) => {
      const problems = checkScript(script, brief)
      // Structured judge (optional, cloud): semantic problems the regex scan cannot see, at a
      // calibrated threshold. Certain findings go straight back to the copywriter as rewrite reasons.
      const judged = problems.length === 0 ? await judgeWith((config) => judgeCopy(config, brief, script), 'script') : undefined
      if (judged) {
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
  // The copywriter's draft, kept so a report (or a demo video) can show what compliance changed.
  await writeFile(join(dir, 'script', 'script.draft.json'), JSON.stringify(script, null, 2))
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
      user: `Product category: ${brief.category}. Proof points the brand can substantiate: ${brief.proof ?? 'none supplied'}.${brief.proof ? ' A line that states one of these facts is substantiated; anything stronger is not.' : ''}
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
  // A flagged beat needs a replacement line: the earphone review flagged "一键开启全网降噪" as an unprovable absolute
  // claim but revised only another beat, and the flagged line went into the film unchanged. Ask once more for the
  // flagged beats it left alone.
  const revised = [...(reviewRun?.value.revised ?? [])]
  const flagged = reviewRun && !reviewRun.value.approve ? flaggedBeats(reviewRun.value.issues ?? [], script.beats.length) : []
  const missing = flagged.filter((beat) => !revised.some((item) => item.beat === beat))
  if (missing.length) {
    const followUp = await chatJson<{ revised: Array<{ beat: number; vo: string; text: string }> }>(
      editor,
      {
        system: await agentPrompt('compliance reviewer and Chinese copy editor. You did not write this script', 'ad-compliance-review'),
        thinking: false,
        maxTokens: 1500,
        temperature: 0.2,
        user: `You flagged these lines but gave no replacement:\n${missing.map((beat) => { const line = script.beats.find((b) => b.beat === beat)!; return `Beat ${beat} VO: ${line.vo}\nBeat ${beat} text: ${line.text}\nIssue: ${(reviewRun!.value.issues ?? []).filter((issue) => flaggedBeats([issue], script.beats.length).includes(beat)).join(' ')}` }).join('\n')}
Proof points the brand can substantiate: ${brief.proof ?? 'none supplied'}.
Rewrite each line so the issue is gone, keeping its meaning, rhythm and length. Return JSON only: {"revised": [{"beat": 2, "vo": "...", "text": "..."}]}`,
      },
      (reply) => (Array.isArray(reply.revised) && missing.every((beat) => reply.revised.some((item) => item.beat === beat)) ? [] : [`return a revised line for every beat in ${missing.join(', ')}`]),
      2,
    ).catch(() => undefined)
    for (const item of followUp?.value.revised ?? []) if (missing.includes(item.beat)) revised.push(item)
  }
  const merge = (items: Array<{ beat: number; vo: string; text: string }>) => script.beats.map((beat) => {
    const change = items.find((item) => item.beat === beat.beat)
    return change ? { ...beat, vo: change.vo ?? beat.vo, text: change.text ?? beat.text } : beat
  })
  if (revised.length) {
    // The reviewer's edits are accepted only if they still pass every script check. A rewrite that fails them goes
    // back to the reviewer with the failures: "脆爽一夏" was too short for a voiceover, so "补脑增强免疫力" stood.
    let problems = checkScript({ ...script, beats: merge(revised) }, brief)
    if (problems.length) {
      const fix = await chatJson<{ revised: Array<{ beat: number; vo: string; text: string }> }>(
        editor,
        {
          system: await agentPrompt('compliance reviewer and Chinese copy editor. You did not write this script', 'ad-compliance-review'),
          thinking: false,
          maxTokens: 1500,
          temperature: 0.3,
          user: `Your rewrites:\n${revised.map((item) => `Beat ${item.beat} VO: ${item.vo}\nBeat ${item.beat} text: ${item.text}`).join('\n')}
They fail the script checks: ${problems.join('; ')}
Original lines and your reasons: ${(reviewRun?.value.issues ?? []).join(' ')}
Proof points the brand can substantiate: ${brief.proof ?? 'none supplied'}.
Rewrite the same beats so the compliance issue stays fixed AND every check passes. Return JSON only: {"revised": [{"beat": 1, "vo": "...", "text": "..."}]}`,
        },
        (reply) => (Array.isArray(reply.revised) ? checkScript({ ...script, beats: merge([...revised.filter((r) => !reply.revised.some((x) => x.beat === r.beat)), ...reply.revised]) }, brief) : ['"revised" must be an array']),
        3,
      ).catch(() => undefined)
      if (fix && Array.isArray(fix.value.revised)) {
        const next = [...revised.filter((r) => !fix.value.revised.some((x) => x.beat === r.beat)), ...fix.value.revised]
        if (checkScript({ ...script, beats: merge(next) }, brief).length === 0) { revised.splice(0, revised.length, ...next); problems = [] }
      }
    }
    if (problems.length === 0) script = { ...script, beats: merge(revised) }
    else log(`  reviewer rewrites still fail the script checks (${problems[0]}); the copywriter's lines stand and the scan decides`)
  }
  const unrevised = flagged.filter((beat) => !revised.some((item) => item.beat === beat))
  if (unrevised.length) log(`  open item: the reviewer flagged beat ${unrevised.join(', ')} but no compliant rewrite came back; check those lines before release`)
  const copy = script.beats.map((beat) => `${beat.vo}\n${beat.text}`).join('\n')
  const findings = scanCopy(copy, brief.category)
  await writeFile(join(dir, 'script', 'script.json'), JSON.stringify(script, null, 2))
  await writeFile(join(dir, 'script', 'copy.txt'), copy)
  await writeFile(join(dir, 'reports', 'compliance.json'), JSON.stringify({ scan: findings, reviewer: reviewRun?.value ?? null }, null, 2))
  await record('compliance', 'reviewer', editor, { seconds: reviewRun?.seconds ?? 0, approve: reviewRun?.value.approve, issues: reviewRun?.value.issues, scanFindings: findings.length, revisedBeats: revised.map((item) => item.beat), unrevisedFlaggedBeats: unrevised })
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
      const judged = problems.length === 0 ? await judgeWith((config) => judgeStoryboard(config, storyboard), 'storyboard') : undefined
      if (judged) {
        await record('storyboard', 'jev', undefined, { execution: 'cloud', model: judged.model, seconds: judged.seconds, inputTokens: judged.inputTokens, problems: judged.problems, notes: judged.notes })
        for (const note of judged.notes) log(`  note: ${note}`)
        problems.push(...judged.problems)
      }
      return problems
    },
    6,
  ).catch(async (error: unknown) => {
    // A storyboard that never came back usable: keep why each attempt was turned down.
    if (error instanceof JsonReplyError) await record('storyboard', 'storyboard', planner, { seconds: error.seconds, failed: error.message, finishReason: error.finishReason, rejected: error.rejected })
    throw error
  })
  const storyboardProblems = checkStoryboard(storyboardRun.value, script, brief)
  if (storyboardProblems.length) await record('storyboard', 'storyboard', planner, { seconds: storyboardRun.seconds, attempts: storyboardRun.attempts, failed: 'hard problems left', rejected: storyboardRun.rejected })
  failIfHardProblems('storyboard', storyboardProblems, storyboardRun.attempts)
  if (storyboardRun.unresolved.length) log(`  storyboard accepted with ${storyboardRun.unresolved.length} unresolved semantic finding(s) after ${storyboardRun.attempts} attempts`)
  // With a photo the product's look is the photo's, not the storyboard artist's paraphrase of it.
  const storyboard = brief.photo ? { ...storyboardRun.value, product: brief.photo.description } : storyboardRun.value
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
  let heroPrompt = composeProductPrompt(storyboard, industry, brief.brandText)
  if (options.productImage) {
    // The user's photo is the ground truth for the product: the gate is run and recorded, but a
    // reject (a brand name that is not printed on the real product, say) does not replace the photo.
    const path = photoPath
    const verdict = await qualityGate(reviewer, path, heroShot, undefined, industry)
    log(`▸ product hero user photo · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
    await record('frames', 'product-hero', reviewer, { source: 'user photo', input: options.productImage, ...verdict })
    hero = { path, verdict: { ...verdict, pass: true } }
  }
  for (let attempt = 0; !options.productImage && attempt <= MAX_QA_REGENERATIONS; attempt++) {
    const path = join(dir, 'refs', `product${attempt ? `_r${attempt}` : ''}.png`)
    const image = await generateImage(comfy, { prompt: heroPrompt, size: '1328x1328', output: path })
    const verdict = await qualityGate(reviewer, path, heroShot, undefined, industry)
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
  await addAsset(brief.id, { id: 'product-hero', kind: 'image', stage: 'frames', path: hero!.path.slice(dir.length + 1), execution: options.productImage ? 'user-supplied' : 'local-dgx-spark', model: options.productImage ? 'user photo' : 'qwen_image_lightning', note: `gate ${hero!.verdict.score}` })

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
    let prompt = composeImagePrompt(shot, storyboard, true, industry)
    let best: { path: string; verdict: QaVerdict; attempt: number } | undefined
    // On a tied score the later repair wins: it was written against the gate's issues, and the
    // gate's coarse scores (most rejects land on 30) used to keep the untouched first frame.
    const consider = (path: string, verdict: QaVerdict, attempt: number) => {
      const better = (top: NonNullable<typeof best>) => verdict.score > top.verdict.score || (verdict.score === top.verdict.score && attempt > top.attempt)
      if (!best || (verdict.pass && !best.verdict.pass) || (verdict.pass === best.verdict.pass && better(best))) best = { path, verdict, attempt }
    }
    const judge = async (rendered: Rendered, suffix: string, attempt: number) => {
      const gateStarted = Date.now()
      const verdict = await qualityGate(reviewer, rendered.path, shot, hero!.path, industry)
      const gateSeconds = (Date.now() - gateStarted) / 1000
      log(`▸ frame ${shot.shot}${suffix.padEnd(5)} ${rendered.image.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
      await record('qa', 'quality-gate', reviewer, { shot: shot.shot, attempt, candidate: suffix || '_a', renderStartedAt: rendered.renderStartedAt, imageSeconds: rendered.image.seconds, gateSeconds, ...verdict })
      consider(rendered.path, verdict, attempt)
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
  const firstRender = (shot: Shot) => render(shot, composeImagePrompt(shot, storyboard, true, industry), '')
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
  const videoModel = options.videoModel ?? 'ltx25-fast'
  const clipsPhase = `clips (${videoModel.startsWith('ltx25') ? 'LTX-2.5 Fast' : videoModel === 'seedance' ? 'Seedance' : 'Wan2.2'})`
  await rest(clipsPhase, [planner, reviewer])
  await enterPhase(comfy, clipsPhase, record)
  for (const [index, shot] of storyboard.shots.entries()) {
    const output = join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}.mp4`)
    const clip = await generateVideo(comfy, {
      prompt: composeVideoPrompt(shot, industry), negative: composeVideoNegative(VIDEO_NEGATIVE, industry), output, resolution: options.resolution ?? '720p', ratio: brief.ratio, durationSeconds: shot.seconds || 5,
      firstFrame: frames.get(shot.shot), freeAfter: index === storyboard.shots.length - 1, model: videoModel,
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
  // The model writes only the scene; the fixed product sentences are re-attached here, so they cannot drift.
  // It names the fix and the phrases it deletes first: asked for a "simpler scene" alone, it described the product again
  // and resubmitted the old scene with a word moved (eval/skill-bench, repair group).
  const anchor = /Image 1 is the product|The product:/.exec(prompt)
  const scene = (anchor ? prompt.slice(0, anchor.index) : prompt).trim()
  const assemble = (value: { scene: string }) => (anchor ? `${value.scene.trim()} ${prompt.slice(anchor.index)}` : value.scene.trim())
  const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const run = await chatJson<{ fixes?: Array<{ issue: string; change: string }>; delete?: string[]; scene: string }>(
    planner,
    {
      system,
      thinking: false,
      temperature: 0.4,
      user: `The quality gate rejected shot ${shot.shot}.\nIssues: ${issues.join('; ') || 'required content missing'}\nMust show: ${shot.must_show}\nCurrent scene description: ${scene}
${anchor ? 'The product sentences that follow the scene are fixed and will be re-attached unchanged; do not write them.\n' : ''}For each issue, first say in one short sentence what you change in the scene to fix it. Then list the exact phrases of the current scene you delete, and write the new scene: the current scene without those phrases, plus only what the fixes add. The new scene must differ from the current one; resubmitting it unchanged, or with a word or two moved, would produce the same rejected frame again. Keep it in English.
Keep the framing (wide, close-up, macro...) and copy the quoted label text character for character. The product always stays in the picture: if something is missing next to it, place that object beside, behind or in front of the product, never around or inside it, and never replace the product with it.
Return JSON only: {"fixes": [{"issue": "...", "change": "..."}], "delete": ["phrase copied from the current scene", "..."], "scene": "..."}`,
    },
    (value) => {
      if (!value.scene?.trim()) return ['scene is empty']
      if (words(value.scene) === words(scene)) return ['the new scene is the current one again; delete the phrases that caused the issues']
      return checkRepairedPrompt(prompt, assemble(value))
    },
    3,
  )
  // A repair that broke the label, the framing or the fixed sentences is worse than another seed on the old prompt.
  return run.unresolved.length ? prompt : assemble(run.value)
}

/** A hard validator problem that survived every attempt would break the film (wrong beat count, restricted wording, Chinese in an image prompt): stop here, truthfully. */
function failIfHardProblems(stage: string, problems: string[], attempts: number): void {
  if (problems.length) throw new Error(`${stage} still fails its checks after ${attempts} attempts: ${problems.join('; ')}`)
}

/** Aspect ratio and duration stated in plain words in the request itself. */
/** The closing line a request quotes after 字幕/口号/广告语/slogan, without its closing punctuation. */
export function statedTagline(request: string): string | undefined {
  const quoted = /(?:定版字幕|字幕|口号|广告语|标语|slogan|tagline|subtitle|caption)[^“"「『\n]{0,8}[“"「『]([^”"」』\n]{2,40})[”"」』]/i.exec(request)?.[1]
  if (quoted) return closingLine(quoted)
  // An agent passing the request through a shell dropped the quotes: "字幕：DGX Spark，把 AI 超算放上你的桌面。"
  // Another dropped only the closing one: 字幕："DGX Spark，把 AI 超算放上你的桌面。
  const bare = /(?:定版字幕|字幕|口号|广告语|标语|slogan|tagline)\s*[：:]\s*["“「『]?([^。！？\n“”"「」『』]{2,40})/i.exec(request)?.[1]
  return bare ? closingLine(bare) : undefined
}
const closingLine = (text: string) => text.trim().replace(/[。！？.!?，,]+$/, '')

export function statedFormat(request: string): { ratio?: Brief['ratio']; durationSeconds?: number } {
  const ratio = /横版|横屏|16:9|16：9/.test(request) ? '16:9' : /竖版|竖屏|9:16|9：16/.test(request) ? '9:16' : /方形|方版|1:1|1：1/.test(request) ? '1:1' : undefined
  const seconds = /(\d+)\s*秒/.exec(request)?.[1]
  const durationSeconds = seconds && Number(seconds) % 5 === 0 && Number(seconds) >= 5 && Number(seconds) <= 30 ? Number(seconds) : undefined
  return { ratio, durationSeconds }
}

/**
 * The lettering quoted in the intake agent's `appearance` must be lettering the request actually quotes: asked for
 * 黑色书法字“岩”, the agent wrote “岁”, and the storyboard check then demanded both "岩" (the label) and "岁" (the look),
 * which no storyboard can satisfy. A quoted string the request never contains is replaced by the label text when the
 * request does contain that.
 */
export function faithfulLabel(appearance: string, request: string, brandText?: string): string {
  if (!brandText || !request.includes(brandText)) return appearance
  return appearance.replace(/([“"「『])([^”"」』]{1,12})([”"」』])/g, (all, open: string, text: string, close: string) =>
    request.includes(text) ? all : `${open}${brandText}${close}`)
}

/** Beat numbers a reviewer's issues name ("Beat 2 VO ...", "beat 3:", "第2拍"). */
export function flaggedBeats(issues: string[], beats: number): number[] {
  const found = new Set<number>()
  for (const issue of issues) for (const m of issue.matchAll(/\bbeat\s*(\d+)|第\s*(\d+)\s*[拍幕]/gi)) {
    const n = Number(m[1] ?? m[2])
    if (n >= 1 && n <= beats) found.add(n)
  }
  return [...found].sort((a, b) => a - b)
}
