// With/without-skill benchmark for the eight stage skills that had no ablation yet.
// Same model, same historical cases (eval/skill-bench/cases.json, built by prep.py from projects/*),
// same prompts and the same CLI reference for both arms; the only variable is whether the agent's
// system prompt carries the skill. One attempt per case, scored by code against the skill's own rules.
//   node eval/skill-bench/run.mjs [--repeats 2] [--only brief,compliance] [--concurrency 4]
import { readFile, writeFile } from 'node:fs/promises'
import { chat, endpoints } from '../../dist/agent/llm.js'
import { extractJson } from '../../dist/lib/vision.js'
import { checkBrief, composeImagePrompt, industryOf } from '../../dist/agent/checks.js'
import { agentSystem } from '../../dist/agent/prompts.js'
import { loadRules, loadSkill } from '../../dist/agent/skills.js'
import { scanCopy } from '../../dist/lib/compliance.js'
import { statedFormat } from '../../dist/agent/harness.js'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const REPEATS = Number(arg('repeats', 2))
const CONCURRENCY = Number(arg('concurrency', 4))
const ONLY = arg('only', '')?.split(',').filter(Boolean)
const HERE = new URL('.', import.meta.url).pathname
const cases = JSON.parse(await readFile(HERE + 'cases.json', 'utf8'))
const rules = await loadRules()
const { planner, reviewer } = endpoints()
const CLI = `Cinefoundry CLI (run from the repository root as \`node dist/cli.js ...\` or \`cinefoundry ...\`):
  cinefoundry harness "<brief>" [--id id] [--ratio 9:16] [--duration 15] [--product-image photo] [--plan-only]
  cinefoundry image --prompt <text> [--size 1328x1328] [--ref img ...] [--project id --shot n | --out file]
  cinefoundry video --prompt <text> [--first-frame img] [--duration 5] [--ratio 9:16] [--resolution 720p] [--project id --shot n | --out file]
  cinefoundry qa --frame <img> [--ref img ...] [--expect text] [--project id --shot n]
  cinefoundry mem <status|plan|free> [--need name=GB ...]
  cinefoundry shots <video> [--out dir] [--threshold 0.30]`

const system = async (role, skill, withSkill) => agentSystem(role, rules, withSkill ? { name: skill, body: await loadSkill(skill) } : undefined)
const ask = async (endpoint, sys, user, opts = {}) => {
  try {
    // chat() directly: chatJson with a single attempt treats it as the last one and switches thinking on
    const run = await chat(endpoint, { system: sys, user, thinking: false, temperature: 0.3, maxTokens: 3000, ...opts })
    return { value: extractJson(run.content), seconds: run.seconds, tokens: run.completionTokens }
  } catch (error) {
    return { error: String(error.message ?? error).slice(0, 200) }
  }
}
const CJK = /[㐀-鿿]/
const PEOPLE = /\b(hand|hands|finger|person|people|man|woman|girl|boy|model|student|face|holding|drinking|sipping)\b/i

// ---------------------------------------------------------------- tasks ----------------------------------------------------------------
const TASKS = {
  // ad-brief-intake: the harness's own intake prompt; checkBrief + the request's stated format.
  brief: {
    skill: 'ad-brief-intake', role: 'intake producer', items: () => cases.brief,
    run: (c, sys) => ask(planner, sys, `This run is non-interactive: nobody can answer questions, so decide every open point yourself.
Request: ${c.request}
${c.photo ? 'The user attached a photo of the real product.' : ''}
Return JSON only:
{"id": "lowercase-dashed-project-id", "title": "short Chinese title", "product": "what is being advertised", "category": "general|food|health_food|cosmetics|medical",
 "audience": "...", "message": "the one thing the viewer should remember, in Chinese", "ratio": "9:16|16:9|1:1", "durationSeconds": 15,
 "tone": "tone and visual style in English", "brandText": "the lettering printed on the product",
 "industry": "electronics|drink|skincare|food|general",
 "appearance": "the product's look as described in the request; empty if it says nothing about it"}`),
    score: (c, v) => {
      const problems = checkBrief(v)
      const stated = statedFormat(c.request)
      if (stated.ratio && v.ratio !== stated.ratio) problems.push(`ratio ${v.ratio} overrides the stated ${stated.ratio}`)
      if (stated.durationSeconds && v.durationSeconds !== stated.durationSeconds) problems.push(`duration ${v.durationSeconds} overrides the stated ${stated.durationSeconds}`)
      return problems
    },
  },

  // ad-compliance-review: the harness's reviewer prompt on historical copy; half the cases carry one injected restricted claim.
  compliance: {
    skill: 'ad-compliance-review', role: 'compliance reviewer and Chinese copy editor. You did not write this script', items: () => cases.compliance,
    run: (c, sys) => {
      const beats = c.beats.map((b) => (c.inject && b.beat === c.inject.beat ? { ...b, vo: `${c.inject.phrase}，${b.vo}` } : b))
      c._beats = beats
      return ask(planner, sys, `Product category: ${c.category}. Proof points the brand can substantiate: none supplied.
Script copy:\n${beats.map((b) => `Beat ${b.beat} VO: ${b.vo}\nBeat ${b.beat} text: ${b.text}`).join('\n')}

Judge two things only, briefly: (1) wording a keyword scan would miss - implied superlatives, implied comparison with competitors, effects nobody could prove; (2) Chinese that sounds unnatural when read aloud.
Line lengths are checked elsewhere; do not count characters. Return JSON only:
{"approve": true|false, "issues": ["..."], "revised": [{"beat": 1, "vo": "...", "text": "..."}]}  ("revised" only for lines you would change)`, { temperature: 0.2, maxTokens: 2000 })
    },
    score: (c, v) => {
      if (typeof v.approve !== 'boolean') return ['"approve" missing']
      if (!c.inject) return v.approve ? [] : ['clean historical copy rejected (false positive)']
      const problems = []
      if (v.approve) problems.push(`approved copy containing "${c.inject.phrase}"`)
      const fix = (v.revised ?? []).find((r) => r.beat === c.inject.beat)
      const after = c._beats.map((b) => { const r = (v.revised ?? []).find((x) => x.beat === b.beat); return r ? { vo: r.vo ?? b.vo, text: r.text ?? b.text } : b })
      if (!fix) problems.push(`beat ${c.inject.beat} not rewritten`)
      else if (`${fix.vo ?? ''}${fix.text ?? ''}`.includes(c.inject.phrase)) problems.push('rewrite keeps the restricted phrase')
      if (scanCopy(after.map((b) => `${b.vo}\n${b.text}`).join('\n'), c.category).some((f) => f.severity === 'block')) problems.push('block-level wording remains')
      return problems
    },
  },

  // shot-quality-gate: the harness's prompt-repair call on frames the gate really rejected; the change must match the issue type.
  repair: {
    skill: 'shot-quality-gate', role: 'storyboard artist', items: () => cases.repair.slice(0, 16),
    run: async (c, sys) => {
      const board = { ...c.storyboard, shots: [c.shot] }
      c._prompt = composeImagePrompt(c.shot, board, true, industryOf(`${c.storyboard.product ?? ''}`))
      // the model writes only the scene and names the fix for every issue first; the fixed product sentences are re-attached by code
      const keepAt = c._prompt.search(/Image 1 is the product|The product:/)
      const scene = keepAt >= 0 ? c._prompt.slice(0, keepAt).trim() : c._prompt
      const reply = await ask(planner, sys, `The quality gate rejected shot ${c.shot.shot}.\nIssues: ${c.issues.join('; ')}\nMust show: ${c.shot.must_show}\nCurrent scene description: ${scene}
The product sentences that follow the scene are fixed and will be re-attached unchanged; do not write them.
For each issue, first say in one short sentence what you change in the scene to fix it. Then list the exact phrases of the current scene you delete, and write the new scene: the current scene without those phrases, plus only what the fixes add. The new scene must differ from the current one; resubmitting it unchanged, or with a word or two moved, would produce the same rejected frame again. Keep it in English.
Return JSON only: {"fixes": [{"issue": "...", "change": "..."}], "delete": ["phrase copied from the current scene", "..."], "scene": "..."}`, { temperature: 0.4 })
      if (reply.value && typeof reply.value.scene === 'string') reply.value = { ...reply.value, image_prompt: keepAt >= 0 ? `${reply.value.scene.trim()} ${c._prompt.slice(keepAt)}` : reply.value.scene }
      return reply
    },
    score: (c, v) => {
      const p = String(v.image_prompt ?? '').trim(), old = c._prompt
      if (!p) return ['empty prompt']
      const problems = []
      const keepAt = old.search(/Image 1 is the product|The product:/)
      const scene = (s) => { const k = s.search(/Image 1 is the product|The product:/); return k >= 0 ? s.slice(0, k) : s }
      const norm = (x) => scene(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      if (norm(p) === norm(old)) problems.push('resubmitted unchanged')
      if (keepAt >= 0 && !p.includes(old.slice(keepAt).slice(0, 80))) problems.push('product sentence not kept')
      if (CJK.test(scene(p).replace(/"[^"]*"/g, ''))) problems.push('scene not in English')
      const issues = c.issues.join(' ').toLowerCase()
      const sceneNew = scene(p), sceneOld = scene(old)
      if (/text|letter|caption|subtitle|watermark|number|slogan|garbled|wordmark|logo/.test(issues)) {
        if (/\d/.test(sceneNew)) problems.push('stray text: numbers left in the scene')
        if (!/no (captions?|text|lettering|subtitles?|words)|without (any )?(text|captions?|lettering)/i.test(p)) problems.push('stray text: no explicit no-text instruction')
      }
      if (/hand|finger|person|people|limb|face/.test(issues) && !PEOPLE.test(c.shot.must_show ?? '')) {
        if (PEOPLE.test(sceneNew.replace(/\b(no|without)\s+(people|hands?|person|fingers?)(\s+(and|or)\s+(no\s+)?(people|hands?|person|fingers?))*/gi, ''))) problems.push('unwanted hands: people still described')
        if (!/no (people|hands|person)|product[- ]only|without (hands|people)/i.test(p)) problems.push('unwanted hands: not reframed as product-only')
      }
      // "simplify the scene around it": fewer scene words than before, not counting the negative instructions the other rules ask for
      const sceneWords = (s) => s.replace(/\b(no|without)\s+[a-z ,-]*?(people|hands?|fingers?|person|captions?|text|lettering|subtitles?|words)\b/gi, '').replace(/product[- ]only/gi, '').split(/\s+/).filter(Boolean).length
      if (/different product|mismatch|brand lettering|different (main )?colou?rs?|colou?rs? differ|different cap/.test(issues) && sceneWords(sceneNew) >= sceneWords(sceneOld)) problems.push('product mismatch: scene not simplified')
      if (/missing|not visible|absent|lacks|required content/.test(issues)) {
        const words = String(c.shot.must_show ?? '').toLowerCase().match(/[a-z]{5,}/g) ?? []
        const head = p.toLowerCase().slice(0, Math.ceil(p.length / 3))
        if (words.length && words.filter((w) => head.includes(w)).length < Math.ceil(words.length / 2)) problems.push('missing content: not moved to the front')
      }
      return problems
    },
  },

  // spark-local-media-generation: commands for one historical storyboard shot.
  media: {
    skill: 'spark-local-media-generation', role: 'media producer', items: () => cases.media,
    run: (c, sys) => ask(planner, sys, `${CLI}

Project "${c.project}", aspect ratio ${c.ratio}. ${c.productPhoto ? 'The user supplied a photo of the real product, already saved as projects/' + c.project + '/refs/product.png.' : 'No product photo exists yet.'}
Storyboard product: ${c.product}
Storyboard style: ${c.style}
Shot ${c.shot.shot}: ${JSON.stringify({ framing: c.shot.framing, camera: c.shot.camera, image_prompt: c.shot.image_prompt, video_prompt: c.shot.video_prompt, must_show: c.shot.must_show })}

Write the local generation commands for this shot. Return JSON only:
{"hero_command": "command that makes the product hero still, or null if none is needed", "frame_command": "command for this shot's first frame", "video_command": "command for this shot's 5-second clip"}`),
    score: (c, v) => {
      const problems = [], n = c.shot.shot, size = { '9:16': '1080x1920', '16:9': '1920x1080', '1:1': '1080x1080' }[c.ratio]
      const hero = v.hero_command ? String(v.hero_command) : '', frame = String(v.frame_command ?? ''), video = String(v.video_command ?? '')
      if (c.productPhoto && hero) problems.push('regenerates a hero still although the real photo exists')
      if (!c.productPhoto && !/refs\/product\.png/.test(hero)) problems.push('no hero still written to refs/product.png')
      if (!/--ref\s+\S*refs\/product\.png/.test(frame)) problems.push('frame not anchored to the hero still (--ref)')
      if (!frame.includes(size)) problems.push(`frame size is not ${size}`)
      const fp = /--prompt\s+(["'])([\s\S]*?)\1/.exec(frame)?.[2] ?? frame
      if (!/image 1 is the product/i.test(fp)) problems.push('reference not named ("Image 1 is the product")')
      if (!/no (captions?|subtitles?|lettering|text)/i.test(fp)) problems.push('no ban on captions / lettering')
      if (/\d/.test(fp.replace(/image 1/gi, ''))) problems.push('numbers in the image prompt')
      if (!new RegExp(`--first-frame\\s+\\S*frames/shot_0*${n}\\.png`).test(video)) problems.push('clip not driven by this shot\'s gated frame')
      if (!/--duration\s+5\b/.test(video)) problems.push('clip duration is not 5 s')
      if (!video.includes(c.ratio)) problems.push('clip ratio missing')
      const vp = /--prompt\s+(["'])([\s\S]*?)\1/.exec(video)?.[2] ?? video
      if (!PEOPLE.test(`${c.shot.must_show} ${c.shot.video_prompt}`) && !/no people and no hands|no (hands|people)/i.test(vp)) problems.push('product-only clip without "no people and no hands"')
      return problems
    },
  },

  // final-cut-assembly: the cut plan for a historical approved script with its measured voiceover lengths.
  cut: {
    skill: 'final-cut-assembly', role: 'editor', items: () => cases.cut,
    run: (c, sys) => ask(planner, sys, `Brief: ${JSON.stringify(c.brief)}
Approved script beats (each beat is one 5-second clip, in order): ${JSON.stringify(c.beats.map((b) => ({ beat: b.beat, vo: b.vo, text: b.text })))}
Measured voiceover length per beat, seconds: ${JSON.stringify(c.voSeconds)}

Plan the final cut. Return JSON only:
{"titles": [{"beat": 1, "text": "..."}], "voiceover": [{"beat": 1, "start_seconds": 0.0, "speed": 1.0}],
 "end_card": {"seconds": 0, "picture": "...", "title": "...", "subtitle": "..."}, "crossfade_seconds": 0.0, "fps": 0, "size": "WxH",
 "grade": "before_join|after_join", "music": {"source": "..."}, "total_seconds": 0, "ai_generated_label": true|false}`),
    score: (c, v) => {
      const problems = [], size = { '9:16': '1080x1920', '16:9': '1920x1080', '1:1': '1080x1080' }[c.brief.ratio]
      for (const b of c.beats) {
        const t = (v.titles ?? []).find((x) => x.beat === b.beat)
        if (!t) { problems.push(`beat ${b.beat}: no title`); continue }
        if (/[。！!？?.，,]$/.test(t.text ?? '')) problems.push(`beat ${b.beat}: title ends with punctuation`)
        const vo = (v.voiceover ?? []).find((x) => x.beat === b.beat)
        if (!vo) { problems.push(`beat ${b.beat}: no voiceover`); continue }
        // the beat start with or without the 0.4 s crossfades taken off (finish.ts places it on the joined timeline)
        if (![5, 4.6].some((step) => Math.abs((vo.start_seconds ?? -9) - ((b.beat - 1) * step + 0.45)) <= 0.06)) problems.push(`beat ${b.beat}: voiceover not 0.45 s after the beat starts`)
        const need = c.voSeconds[b.beat - 1] / 4.55
        if ((vo.speed ?? 0) > 1.25 + 1e-6 || (need > 1 && (vo.speed ?? 1) < Math.min(need, 1.25) - 0.02) || (need <= 1 && Math.abs((vo.speed ?? 0) - 1) > 0.05)) problems.push(`beat ${b.beat}: speed ${vo.speed} wrong for a ${c.voSeconds[b.beat - 1]} s line`)
      }
      const e = v.end_card ?? {}
      if (Math.abs((e.seconds ?? 0) - 3) > 0.01) problems.push('end card is not 3 s')
      if (!/hero|product/i.test(e.picture ?? '')) problems.push('end card does not close on the product hero still')
      if ((e.title ?? '').trim() !== (c.brief.brandText ?? '').trim()) problems.push('end card title is not the brand')
      if (Math.abs((v.crossfade_seconds ?? 0) - 0.4) > 0.01) problems.push('crossfade is not 0.4 s')
      if (v.fps !== 24) problems.push('fps is not 24')
      if (v.size !== size) problems.push(`size is not ${size}`)
      if (v.grade !== 'after_join') problems.push('graded before the join')
      if (!/ace|local|generat/i.test(v.music?.source ?? '') || /周杰伦|jay|commercial|popular|licensed song/i.test(v.music?.source ?? '')) problems.push('music not generated locally')
      // brief + 3 s end card, with or without the crossfade overlaps taken off (the real films measure 16.8 s for 15 s briefs)
      if (![0, 0.4 * c.beats.length].some((overlap) => Math.abs((v.total_seconds ?? 0) - (c.brief.durationSeconds + 3 - overlap)) <= 0.25)) problems.push('total is not the brief + 3 s end card')
      if (v.ai_generated_label !== true) problems.push('no AI-generated label')
      return problems
    },
  },

  // spark-model-scheduler: memory situations measured at this project's phase boundaries, plus three known traps.
  scheduler: {
    skill: 'spark-model-scheduler', role: 'platform engineer', items: () => [...cases.scheduler, ...cases.schedulerFixed],
    run: (c, sys) => ask(planner, sys, `${CLI}

DGX Spark, 121.7 GB unified memory shared by CPU and GPU. Nemotron (vLLM) and Step3-VL (vLLM) are resident.
${c.kind ? c.question : `ComfyUI currently holds ${c.resident} from the previous phase. Measured available memory (/proc/meminfo): ${c.availableGb} GB. The next phase (${c.nextPhase}) needs ${c.next}.`}
Decide what to do before starting the next step. Return JSON only:
{"fits_now": true|false, "action": "load|free_then_load|do_not_run_now", "command": "the first command you would run", "reason": "..."}`),
    score: (c, v) => {
      const problems = []
      if (!c.kind) {
        if (v.action !== 'free_then_load') problems.push(`action "${v.action}": another diffusion family is resident, release it first`)
        if (!/mem free|\/free/.test(v.command ?? '')) problems.push('first command is not cinefoundry mem free')
      } else if (c.kind === 'cgroup') {
        if (v.fits_now !== false || v.action === 'load') problems.push('trusted docker stats instead of available memory')
      } else if (v.action !== 'do_not_run_now') problems.push(`action "${v.action}" for ${c.kind}`)
      return problems
    },
  },

  // cinefoundry-ad-film: how an outside agent should call the harness for a historical request.
  film: {
    skill: 'cinefoundry-ad-film', role: 'assistant that drives the Cinefoundry harness for a user', items: () => cases.film,
    run: (c, sys) => ask(planner, sys, `${CLI}

User: ${c.message}${c.photo ? `\n(Attached: a photo of the real product, saved at ${c.photo})` : ''}

Plan your tool calls. Return JSON only:
{"preflight": ["shell commands to run before starting"], "command": "the shell command that makes the film", "run_in_background": true|false, "after": "what you read and report when it finishes"}`),
    score: (c, v) => {
      const problems = [], cmd = String(v.command ?? '')
      if (!/(cli\.js|cinefoundry) harness/.test(cmd)) problems.push('does not call the harness')
      const core = c.message.replace(/\s*先给我看脚本和分镜，我确认了再生成视频。$/, '')
      if (!cmd.includes(core.slice(0, Math.min(24, core.length)))) problems.push('brief not passed verbatim')
      if (c.photo && !cmd.includes(`--product-image ${c.photo}`) && !cmd.includes(`--product-image "${c.photo}"`)) problems.push('product photo not passed as --product-image')
      if (!c.photo && /--product-image/.test(cmd)) problems.push('invented a product image')
      if (c.planOnly !== /--plan-only/.test(cmd)) problems.push(c.planOnly ? 'no --plan-only although the user wants to approve first' : 'unrequested --plan-only')
      const stated = statedFormat(core)
      const ratio = /--ratio\s+(\S+)/.exec(cmd)?.[1], dur = /--duration\s+(\d+)/.exec(cmd)?.[1]
      if (ratio && stated.ratio && ratio !== stated.ratio) problems.push('ratio contradicts the request')
      if (dur && stated.durationSeconds && Number(dur) !== stated.durationSeconds) problems.push('duration contradicts the request')
      if (!(v.preflight ?? []).some((p) => /pgrep|ps .*harness|cli\.js harness/.test(p))) problems.push('no check that another film is running')
      if (!c.planOnly && !/delivery\.md/.test(v.after ?? '')) problems.push('does not read the delivery report')
      return problems
    },
  },

  // ad-reference-breakdown: the local vision model breaks down a finished film from its shot list and keyframes.
  breakdown: {
    skill: 'ad-reference-breakdown', role: 'reference film analyst', items: () => cases.breakdown, vision: true,
    run: async (c, sys) => {
      const shots = JSON.parse(await readFile(`${c.shotsDir}/shots.json`, 'utf8'))
      c._shots = shots
      return ask(reviewer, sys, `shots.json from \`cinefoundry shots\`:\n${JSON.stringify({ duration: shots.duration, shots: shots.shots.map(({ keyframe, ...s }) => s) })}
The images are the keyframes of shots 1-${shots.shots.length}, in order.
Break this reference ad down into an editable shot list. Return JSON only:
{"source": {"duration": 0, "shot_count": 0, "avg_shot_seconds": 0}, "shots": [{"index": 1, "start": 0, "end": 0, "framing": "...", "camera": "...", "subject": "...", "action": "...", "on_screen_text": "...", "lighting": "...", "role": "hook|product_reveal|benefit|social_proof|cta"}]}`,
        { images: shots.shots.map((s) => s.keyframe), maxTokens: 4000, temperature: 0 })
    },
    score: (c, v) => {
      const problems = [], truth = c._shots.shots
      const avg = truth.reduce((a, s) => a + s.duration, 0) / truth.length
      if (v.source?.shot_count !== truth.length) problems.push(`shot_count ${v.source?.shot_count} != ${truth.length}`)
      if (Math.abs((v.source?.avg_shot_seconds ?? 0) - avg) > 0.15) problems.push('avg_shot_seconds not derived from shots.json')
      if ((v.shots ?? []).length !== truth.length) problems.push('one entry per shot expected')
      for (const [i, s] of (v.shots ?? []).entries()) {
        const t = truth[i]
        if (t && (Math.abs((s.start ?? -9) - t.start) > 0.1 || Math.abs((s.end ?? -9) - t.end) > 0.1)) problems.push(`shot ${i + 1}: timing not from shots.json`)
        for (const f of ['framing', 'camera', 'subject', 'action', 'lighting']) if (!String(s[f] ?? '').trim()) problems.push(`shot ${i + 1}: ${f} empty`)
        if (!('on_screen_text' in s)) problems.push(`shot ${i + 1}: on_screen_text missing`)
        if (!['hook', 'product_reveal', 'benefit', 'social_proof', 'cta'].includes(s.role)) problems.push(`shot ${i + 1}: role "${s.role}"`)
        if (/,| and |\+| then /i.test(s.camera ?? '')) problems.push(`shot ${i + 1}: more than one camera move`)
      }
      return problems
    },
  },
}

// ---------------------------------------------------------------- runner ----------------------------------------------------------------
async function pool(jobs, size) {
  const out = []; let next = 0
  await Promise.all(Array.from({ length: size }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i]() } }))
  return out
}

export { TASKS, cases }
if (!process.env.BENCH_SELFTEST) {
const report = { date: new Date().toISOString(), model: { text: planner.model, vision: reviewer.model }, repeats: REPEATS, method: 'one attempt, thinking off, both arms get the same prompt and CLI reference; the with-skill arm also carries SKILL.md; scored by code against the skill rules', tasks: {} }
for (const [name, task] of Object.entries(TASKS)) {
  if (ONLY.length && !ONLY.includes(name)) continue
  const items = task.items()
  const jobs = []
  for (let r = 1; r <= (task.vision ? 1 : REPEATS); r++) for (const withSkill of [false, true]) for (const [i, c0] of items.entries()) {
    jobs.push(async () => {
      const c = structuredClone(c0)
      const reply = await task.run(c, await system(task.role, task.skill, withSkill))
      const problems = reply.error ? [`no usable reply: ${reply.error}`] : task.score(c, reply.value)
      return { case: i, project: c.project, repeat: r, withSkill, problems, seconds: reply.seconds, tokens: reply.tokens }
    })
  }
  const started = Date.now()
  const rows = await pool(jobs, task.vision ? 2 : CONCURRENCY)
  const arm = (w) => { const x = rows.filter((r) => r.withSkill === w); return { runs: x.length, clean: x.filter((r) => r.problems.length === 0).length, meanViolations: +(x.reduce((a, r) => a + r.problems.length, 0) / x.length).toFixed(2) } }
  const top = (w) => Object.entries(rows.filter((r) => r.withSkill === w).flatMap((r) => r.problems.map((p) => p.replace(/^beat \d+: |^shot \d+: /, '').replace(/"[^"]*"/g, '""').replace(/[\d.]+ s line/, 'N s line'))).reduce((m, p) => ((m[p] = (m[p] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5)
  report.tasks[name] = { skill: task.skill, cases: items.length, withoutSkill: arm(false), withSkill: arm(true), topWithout: top(false), topWith: top(true), minutes: +((Date.now() - started) / 60000).toFixed(1), rows }
  const t = report.tasks[name]
  console.log(`${task.skill.padEnd(30)} without ${t.withoutSkill.clean}/${t.withoutSkill.runs} (${t.withoutSkill.meanViolations})  with ${t.withSkill.clean}/${t.withSkill.runs} (${t.withSkill.meanViolations})  ${t.minutes} min`)
  await writeFile(HERE + '../results/' + arg('out', 'skill-bench.json'), JSON.stringify(report, null, 1))
}
}
