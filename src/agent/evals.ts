import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { checkBrief, checkScript, checkStoryboard, industryOf, type Brief, type Script, type Storyboard } from './checks.js'
import { chatJson, endpoints } from './llm.js'
import { agentSystem, scriptUser, storyboardUser } from './prompts.js'
import { loadRules, loadSkill } from './skills.js'

/**
 * With/without-skill comparison. Same model, same briefs, same prompts; the only variable
 * is whether the agent's system prompt contains its skill. Each stage gets ONE attempt and
 * is scored by the director's own validators: the number is rule violations on the first
 * answer, which is what the retry loop would otherwise have to clean up.
 */

interface ArmResult {
  scriptViolations: number
  scriptProblems: string[]
  storyboardViolations: number
  storyboardProblems: string[]
  seconds: number
}

const FIXED_BRIEF = (request: string, index: number): Brief => {
  const duration = Number(/(\d+)\s*秒/.exec(request)?.[1] ?? 15)
  return {
    id: `eval-${index + 1}`, title: request.slice(0, 12), product: request, category: /面霜/.test(request) ? 'cosmetics' : /水|咖啡|茶|榨汁/.test(request) ? 'food' : 'general',
    audience: 'see request', message: 'see request', ratio: /横版/.test(request) ? '16:9' : '9:16', durationSeconds: duration, tone: 'see request',
    brandText: /[“"]([^”"]{1,4})[”"]/.exec(request)?.[1] ?? '牌', industry: industryOf(request),
  }
}

async function runArm(brief: Brief, withSkills: boolean): Promise<ArmResult> {
  const { planner } = endpoints()
  const rules = await loadRules()
  const system = async (role: string, skill: string) => agentSystem(role, rules, withSkills ? { name: skill, body: await loadSkill(skill) } : undefined)
  const started = Date.now()

  let script: Script | undefined
  let scriptProblems: string[]
  try {
    const run = await chatJson<Script>(planner, { system: await system('copywriter', 'ad-script-writing'), thinking: false, maxTokens: 3000, temperature: 0.8, user: scriptUser(brief) }, (value) => checkScript(value, brief), 1)
    script = run.value
    scriptProblems = run.rejected[0] ?? []
  } catch (error) {
    scriptProblems = [`no usable JSON: ${(error as Error).message.slice(0, 100)}`]
  }

  let storyboardProblems: string[] = ['skipped: no script to storyboard']
  if (script && Array.isArray(script.beats) && script.beats.length > 0) {
    try {
      const run = await chatJson<Storyboard>(planner, { system: await system('storyboard artist', 'storyboard-design'), thinking: false, maxTokens: 5000, temperature: 0.6, user: storyboardUser(brief, script) }, (value) => [...checkStoryboard(value, script!), ...styleAndTextProblems(value)], 1)
      storyboardProblems = run.rejected[0] ?? []
    } catch (error) {
      storyboardProblems = [`no usable JSON: ${(error as Error).message.slice(0, 100)}`]
    }
  }
  return { scriptViolations: scriptProblems.length, scriptProblems, storyboardViolations: storyboardProblems.length, storyboardProblems, seconds: (Date.now() - started) / 1000 }
}

/** Two failure modes measured on real frames: numeric style tokens and captions requested inside the image. */
function styleAndTextProblems(storyboard: Storyboard): string[] {
  const problems: string[] = []
  if (/\d/.test(storyboard.style ?? '')) problems.push('style line contains numbers, which the image model paints into the frame')
  for (const shot of storyboard.shots ?? []) {
    if (/\b(text|caption|slogan|subtitle|title|words?|reads?|saying)\b/i.test(shot.image_prompt ?? '') || /"[^"]+"/.test(shot.image_prompt ?? ''))
      problems.push(`shot ${shot.shot}: image_prompt asks the model to draw text`)
    if (/\b(bottle|can|jar|cup|box|tube|label)\b[^.]{0,60}\b(silver|teal|white|red|blue|green|gold|black|pink)\b/i.test(shot.image_prompt ?? ''))
      problems.push(`shot ${shot.shot}: image_prompt re-describes the product instead of referring to "the product"`)
  }
  return problems
}

export async function runAblation(briefsPath: string, output: string, repeats: number, log: (line: string) => void): Promise<unknown> {
  const requests = JSON.parse(await readFile(briefsPath, 'utf8')) as string[]
  const rows: Array<{ brief: string; repeat: number; withSkills: ArmResult; withoutSkills: ArmResult }> = []
  for (const [index, request] of requests.entries()) {
    const brief = FIXED_BRIEF(request, index)
    if (checkBrief(brief).length) throw new Error(`eval brief ${index + 1} is invalid: ${checkBrief(brief).join('; ')}`)
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const withSkills = await runArm(brief, true)
      const withoutSkills = await runArm(brief, false)
      rows.push({ brief: request, repeat, withSkills, withoutSkills })
      log(`brief ${index + 1}/${requests.length} run ${repeat}: with skills ${withSkills.scriptViolations}+${withSkills.storyboardViolations} violations · without ${withoutSkills.scriptViolations}+${withoutSkills.storyboardViolations}`)
    }
  }
  const summarise = (pick: (row: (typeof rows)[number]) => ArmResult) => {
    const arms = rows.map(pick)
    // A storyboard that was never attempted (no usable script) is not scored, here or in the BENCHMARK reports.
    const boards = arms.filter((arm) => !arm.storyboardProblems.some((problem) => problem.startsWith('skipped')))
    const mean = (values: number[]) => Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
    return {
      runs: arms.length,
      scriptCleanFirstTry: `${arms.filter((arm) => arm.scriptViolations === 0).length}/${arms.length}`,
      storyboardCleanFirstTry: `${boards.filter((arm) => arm.storyboardViolations === 0).length}/${boards.length}`,
      meanScriptViolations: mean(arms.map((arm) => arm.scriptViolations)),
      meanStoryboardViolations: mean(boards.map((arm) => arm.storyboardViolations)),
      meanSeconds: mean(arms.map((arm) => arm.seconds)),
    }
  }
  const report = {
    date: new Date().toISOString(), model: endpoints().planner.model, briefs: requests.length, repeats,
    method: 'one attempt per stage, thinking off, scored by src/agent/checks.ts plus two frame-level failure modes',
    withSkills: summarise((row) => row.withSkills), withoutSkills: summarise((row) => row.withoutSkills), rows,
  }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  return { withSkills: report.withSkills, withoutSkills: report.withoutSkills, output }
}

interface StoredReport {
  date: string
  model: string
  briefs: number
  repeats: number
  method: string
  rows: Array<{ brief: string; repeat: number; withSkills: ArmResult; withoutSkills: ArmResult }>
}

/** Turn a stored comparison into one BENCHMARK.md per evaluated skill, so every number traces back to the JSON. */
export async function writeBenchmarks(reportPath: string, skillsRoot = '.agents/skills'): Promise<string[]> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as StoredReport
  const stages = [
    { skill: 'ad-script-writing', count: (arm: ArmResult) => arm.scriptViolations, problems: (arm: ArmResult) => arm.scriptProblems },
    { skill: 'storyboard-design', count: (arm: ArmResult) => arm.storyboardViolations, problems: (arm: ArmResult) => arm.storyboardProblems },
  ]
  const written: string[] = []
  for (const stage of stages) {
    const stats = (pick: (row: StoredReport['rows'][number]) => ArmResult) => {
      const arms = report.rows.map(pick).filter((arm) => !stage.problems(arm).some((problem) => problem.startsWith('skipped')))
      const total = arms.reduce((sum, arm) => sum + stage.count(arm), 0)
      const tally = new Map<string, number>()
      for (const arm of arms) for (const problem of stage.problems(arm)) {
        const key = problem.replace(/^(beat|shot) \d+: /, '').replace(/\d+ characters/g, 'N characters').replace(/has only N/, 'has only N').slice(0, 90)
        tally.set(key, (tally.get(key) ?? 0) + 1)
      }
      return { runs: arms.length, clean: arms.filter((arm) => stage.count(arm) === 0).length, mean: Math.round((total / arms.length) * 100) / 100, top: [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) }
    }
    const withSkill = stats((row) => row.withSkills)
    const without = stats((row) => row.withoutSkills)
    const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`
    const list = (items: Array<[string, number]>) => (items.length ? items.map(([text, count]) => `| ${count} | ${text} |`).join('\n') : '| 0 | none |')
    const body = `# Skill Benchmark: ${stage.skill}

Baseline versus skill on the same model and the same briefs. The only variable is whether the
agent's system prompt contains this skill. Each run gets **one attempt** and is scored by the
validators in \`src/agent/checks.ts\` - the same code the director uses to accept or reject work -
so a violation is a rule the retry loop would otherwise have to clean up.

## Evaluation metadata

- Date: ${report.date.slice(0, 10)}
- Model: \`${report.model}\` served locally by vLLM on one DGX Spark (GB10), thinking off
- Briefs: ${report.briefs} advertising requests in \`eval/briefs.json\`, ${report.repeats} runs each
- Raw data: \`${reportPath}\` · Reproduce: \`spotfoundry eval --repeats ${report.repeats} && spotfoundry eval --report-only\`

## Results

| Measure | Baseline (no skill) | With skill |
|---|---:|---:|
| Runs scored | ${without.runs} | ${withSkill.runs} |
| Clean on the first attempt | ${without.clean}/${without.runs} (${percent(without.clean, without.runs)}) | ${withSkill.clean}/${withSkill.runs} (${percent(withSkill.clean, withSkill.runs)}) |
| Mean rule violations per run | ${without.mean} | ${withSkill.mean} |

### Most frequent violations without the skill

| Count | Violation |
|---:|---|
${list(without.top)}

### Violations that remain with the skill

| Count | Violation |
|---:|---|
${list(withSkill.top)}

## Reading these numbers

- The validators check form - beat count, line length, language, one camera move, no text drawn
  inside frames - not whether the copy is good. A clean run is a usable draft, not a good ad.
- Timings from this run are not reported: it shared the GPU with a film generation job.
- Remaining violations are the skill's to-do list; they are fed back into the skill text.
`
    const target = `${skillsRoot}/${stage.skill}/BENCHMARK.md`
    await writeFile(target, body)
    written.push(target)
  }
  return written
}
