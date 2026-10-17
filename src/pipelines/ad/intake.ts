import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { captionProblems, checkBrief, checkProductPhoto, briefIndustry, photoLettering, type Brief, type ProductPhoto } from '../../agent/checks.js'
import { chatJson } from '../../agent/llm.js'
import { normalizeImage } from '../../lib/ffmpeg.js'
import { DEFAULT_DURATION, DEFAULT_FPS, DEFAULT_RATIO, DEFAULT_RESOLUTION, checkFps, generationResolution } from '../../lib/formats.js'
import { archiveProject, projectExists } from '../../lib/project.js'
import type { AdContext } from './context.js'
import { closingLine, faithfulLabel, statedFormat, statedTagline } from './request.js'

/** Brief: the intake producer reads the request into a brief; the client's own words fix ratio, length and closing line. */
export async function intakeStage(ctx: AdContext): Promise<string> {
  const { options, planner, reviewer, log } = ctx
  log('▸ brief        intake agent · nemotron')
  const briefRun = await chatJson<Brief>(
    planner,
    {
      system: await ctx.agentPrompt('intake producer', 'ad-brief-intake'),
      thinking: false,
      temperature: 0.3,
      user: `This run is non-interactive: nobody can answer questions, so decide every open point yourself.
Request: ${options.brief}
${options.ratio ? `The user fixed the aspect ratio: ${options.ratio}.` : ''}${options.durationSeconds ? ` The user fixed the duration: ${options.durationSeconds} seconds.` : ''}

Return JSON only:
{"id": "lowercase-dashed-project-id", "title": "short Chinese title", "product": "what is being advertised", "category": "general|food|health_food|cosmetics|medical",
 "audience": "...", "message": "the one thing the viewer should remember, in Chinese", "ratio": "9:16|16:9|1:1", "durationSeconds": 30,
 "tone": "tone and visual style in English", "brandText": "the lettering actually printed on the product, copied exactly: at most 4 common Chinese characters or 12 Latin letters; never an abbreviation or model name that is not printed on it",
 "industry": "computing|electronics|automotive|fragrance|drink|skincare|food|general: how this product is shot and sold (a computer, workstation, server or GPU is computing; earphones, a phone or a camera is electronics; a car is automotive; a perfume is fragrance)",
 "tagline": "the closing line the request quotes for the end card (after 字幕/口号/广告语/slogan), copied character for character in the request's language; empty if the request quotes none",
 "appearance": "the product's look copied word for word from the request (container, material, colours, label); empty if the request says nothing about it"}`,
    },
    checkBrief,
  )
  // What the request states outright is not the model's to decide: the coffee brief asked for
  // 横版 and the intake agent still chose 9:16. Explicit user words win over the agent's choice.
  const stated = statedFormat(options.brief)
  const brief: Brief = { ...briefRun.value, id: options.id ?? briefRun.value.id, ratio: (options.ratio as Brief['ratio'] | undefined) ?? stated.ratio ?? DEFAULT_RATIO, durationSeconds: options.durationSeconds ?? stated.durationSeconds ?? DEFAULT_DURATION }
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
  brief.resolution = (options.resolution ?? DEFAULT_RESOLUTION).toLowerCase()
  generationResolution(brief.resolution) // throws on an unknown preset before any model runs
  brief.fps = checkFps(options.fps ?? DEFAULT_FPS)
  ctx.rejectedAttempts.brief = briefRun.rejected.length
  // A project id is never silently reused: a run asked for by id replaces the previous run of that id, which is archived
  // (projects/.archive) rather than overwritten; an id the intake model made up that collides with another film gets a suffix.
  if (projectExists(brief.id)) {
    if (options.id) log(`  previous run of ${brief.id} archived to ${await archiveProject(brief.id)}`)
    else {
      let n = 2
      while (projectExists(`${brief.id}-${n}`)) n++
      brief.id = `${brief.id}-${n}`
    }
  }
  const dir = await ctx.openProject({ id: brief.id, title: brief.title, ratio: brief.ratio, durationSeconds: brief.durationSeconds })
  await ctx.record('brief', 'intake', planner, { seconds: briefRun.seconds, attempts: briefRun.attempts, skills: !options.withoutSkills })
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
      await ctx.record('brief', 'photo-reader', reviewer, { brandText: { from: brief.brandText, to: printed[0], printed } })
      log(`▸ photo        brand lettering "${brief.brandText}" -> "${printed[0]}", as printed on the product`)
      brief.brandText = printed[0]!
    }
    await ctx.record('brief', 'photo-reader', reviewer, { seconds: reading.seconds, attempts: reading.attempts, unresolved: reading.unresolved, ...brief.photo })
    log(brief.photo ? `▸ photo        ${brief.photo.description.slice(0, 140)}` : `▸ photo        reading unusable (${reading.unresolved[0]}); writers use the request's words`)
  }
  // One industry for the whole run, written into the brief so a wrong read is visible.
  brief.industry = briefIndustry(brief)
  await writeFile(join(dir, 'brief.json'), JSON.stringify(brief, null, 2))
  ctx.brief = brief
  return `${brief.durationSeconds}s ${brief.ratio} · ${brief.industry}`
}
