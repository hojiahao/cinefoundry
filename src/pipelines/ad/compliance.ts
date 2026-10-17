import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkScript, type Brief, type Script } from '../../agent/checks.js'
import { chatJson } from '../../agent/llm.js'
import { scanBrandWords, scanCopy, type Finding } from '../../lib/compliance.js'
import { need, type AdContext } from './context.js'
import { flaggedBeats } from './request.js'

type Revision = { beat: number; vo: string; zh: string; text: string }
type ReviewReply = { approve: boolean; issues: string[]; revised?: Revision[] }

export interface CopyReviewInput {
  brief: Brief
  script: Script
  /** Every check the copy must still pass after a reviewer's rewrite: the master's checkScript, or a cutdown's own. */
  check: (script: Script) => string[]
  /** Lines the structured judge was unsure of, for the reviewer to decide. */
  judgeFlags?: AdContext['jevReview']
  /** What the reviewer is reading, e.g. "Script copy" or "Copy of the 15-second cutdown". */
  subject?: string
}

export interface CopyReview {
  /** The copy after every reviewer rewrite that passed the checks. */
  script: Script
  /** The copy as one text: per beat the English line, the Chinese subtitle and the title. */
  copy: string
  /** The deterministic scan of the final copy. */
  findings: Finding[]
  /** Findings with severity `block`: copy with any of these never reaches media generation. */
  blocked: Finding[]
  reviewer: ReviewReply | null
  seconds: number
  revisedBeats: number[]
  /** Beats the reviewer flagged without a compliant rewrite coming back. */
  unrevisedFlaggedBeats: number[]
  /** The reviewer did not approve and named no beat. */
  unapprovedWithoutBeats: boolean
  /** Open items for the log and the delivery report. */
  openItems: string[]
}

const REVIEWER_ROLE = 'compliance reviewer and bilingual copy editor. You did not write this script'

/**
 * Compliance for one piece of ad copy - the master's script or a cutdown's: a deterministic scan, then an independent
 * reviewer on a different model who did not write the copy. Reviewer rewrites are kept only if they pass `check`.
 * Writes nothing; the caller decides where the result is recorded and what a block means.
 */
export async function reviewCopy(ctx: Pick<AdContext, 'editor' | 'agentPrompt' | 'log'>, input: CopyReviewInput): Promise<CopyReview> {
  const { brief, check } = input
  let script = input.script
  const { editor } = ctx
  const judgeFlags = input.judgeFlags ?? []
  const openItems: string[] = []
  const system = await ctx.agentPrompt(REVIEWER_ROLE, 'ad-compliance-review')
  const reviewRun = await chatJson<ReviewReply>(
    editor,
    {
      system,
      thinking: false,
      maxTokens: 2000,
      temperature: 0.2,
      user: `Product category: ${brief.category}. Proof points the brand can substantiate: ${brief.proof ?? 'none supplied'}.${brief.proof ? ' A line that states one of these facts is substantiated; anything stronger is not.' : ''}${brief.brand ? `\nThese are the ${brief.brand.name} brand kit's substantiated claims and the only proof any line may rest on. The kit also forbids these words: ${brief.brand.forbiddenWords.join(', ') || 'none'}; and these topics: ${brief.brand.forbiddenTopics.join(', ') || 'none'}.` : ''}
${input.subject ?? 'Script copy'} (the announcer speaks the English line; the Chinese subtitle and title are on screen):\n${script.beats.map((beat) => `Beat ${beat.beat} VO (English): ${beat.vo}\nBeat ${beat.beat} subtitle (Chinese): ${beat.zh}\nBeat ${beat.beat} title: ${beat.text}`).join('\n')}

${judgeFlags.length ? `A structured judge flagged these lines as uncertain; decide each one:\n${judgeFlags.map((f) => `- beat ${f.beat} "${f.line}": ${f.issue} (p=${f.probability.toFixed(2)})`).join('\n')}\n\n` : ''}Judge three things only, briefly: (1) wording a keyword scan would miss, in either language - implied superlatives, implied comparison with competitors, effects nobody could prove; (2) English that a native broadcast copywriter would not write; (3) a Chinese subtitle that does not say what the English says, or reads as translationese.
Line lengths are checked elsewhere; do not count characters. Return JSON only:
{"approve": true|false, "issues": ["..."], "revised": [{"beat": 1, "vo": "English", "zh": "中文字幕", "text": "标题"}]}  ("revised" only for lines you would change)`,
    },
    (review) => (typeof review.approve === 'boolean' ? [] : ['"approve" must be true or false']),
    2,
  ).catch((error: Error) => {
    ctx.log(`  reviewer unavailable (${error.message.slice(0, 120)}); continuing with the deterministic scan only`)
    return undefined
  })
  // A flagged beat needs a replacement line: the earphone review flagged "一键开启全网降噪" as an unprovable absolute
  // claim but revised only another beat, and the flagged line went into the film unchanged. Ask once more for the
  // flagged beats it left alone.
  const revised = [...(reviewRun?.value.revised ?? [])]
  const flagged = reviewRun && !reviewRun.value.approve ? flaggedBeats(reviewRun.value.issues ?? [], script.beats.length) : []
  const missing = flagged.filter((beat) => !revised.some((item) => item.beat === beat))
  if (missing.length) {
    const followUp = await chatJson<{ revised: Revision[] }>(
      editor,
      {
        system,
        thinking: false,
        maxTokens: 1500,
        temperature: 0.2,
        user: `You flagged these lines but gave no replacement:\n${missing.map((beat) => { const line = script.beats.find((b) => b.beat === beat)!; return `Beat ${beat} VO: ${line.vo}\nBeat ${beat} subtitle: ${line.zh}\nBeat ${beat} text: ${line.text}\nIssue: ${(reviewRun!.value.issues ?? []).filter((issue) => flaggedBeats([issue], script.beats.length).includes(beat)).join(' ')}` }).join('\n')}
Proof points the brand can substantiate: ${brief.proof ?? 'none supplied'}.
Rewrite each line so the issue is gone, keeping its meaning, rhythm and length. Return JSON only: {"revised": [{"beat": 2, "vo": "English", "zh": "中文字幕", "text": "标题"}]}`,
      },
      (reply) => (Array.isArray(reply.revised) && missing.every((beat) => reply.revised.some((item) => item.beat === beat)) ? [] : [`return a revised line for every beat in ${missing.join(', ')}`]),
      2,
    ).catch(() => undefined)
    for (const item of followUp?.value.revised ?? []) if (missing.includes(item.beat)) revised.push(item)
  }
  const merge = (items: Revision[]) => script.beats.map((beat) => {
    const change = items.find((item) => item.beat === beat.beat)
    return change ? { ...beat, vo: change.vo ?? beat.vo, zh: change.zh ?? beat.zh, text: change.text ?? beat.text } : beat
  })
  if (revised.length) {
    // The reviewer's edits are accepted only if they still pass every script check. A rewrite that fails them goes
    // back to the reviewer with the failures: "脆爽一夏" was too short for a voiceover, so "补脑增强免疫力" stood.
    let problems = check({ ...script, beats: merge(revised) })
    if (problems.length) {
      const fix = await chatJson<{ revised: Revision[] }>(
        editor,
        {
          system,
          thinking: false,
          maxTokens: 1500,
          temperature: 0.3,
          user: `Your rewrites:\n${revised.map((item) => `Beat ${item.beat} VO: ${item.vo}\nBeat ${item.beat} subtitle: ${item.zh}\nBeat ${item.beat} text: ${item.text}`).join('\n')}
They fail the script checks: ${problems.join('; ')}
Original lines and your reasons: ${(reviewRun?.value.issues ?? []).join(' ')}
Proof points the brand can substantiate: ${brief.proof ?? 'none supplied'}.
Rewrite the same beats so the compliance issue stays fixed AND every check passes. Return JSON only: {"revised": [{"beat": 1, "vo": "English", "zh": "中文字幕", "text": "标题"}]}`,
        },
        (reply) => (Array.isArray(reply.revised) ? check({ ...script, beats: merge([...revised.filter((r) => !reply.revised.some((x) => x.beat === r.beat)), ...reply.revised]) }) : ['"revised" must be an array']),
        3,
      ).catch(() => undefined)
      if (fix && Array.isArray(fix.value.revised)) {
        const next = [...revised.filter((r) => !fix.value.revised.some((x) => x.beat === r.beat)), ...fix.value.revised]
        if (check({ ...script, beats: merge(next) }).length === 0) { revised.splice(0, revised.length, ...next); problems = [] }
      }
    }
    if (problems.length === 0) script = { ...script, beats: merge(revised) }
    else ctx.log(`  reviewer rewrites still fail the script checks (${problems[0]}); the copywriter's lines stand and the scan decides`)
  }
  const unrevised = flagged.filter((beat) => !revised.some((item) => item.beat === beat))
  if (unrevised.length) openItems.push(`the reviewer flagged beat ${unrevised.join(', ')} but no compliant rewrite came back; check those lines before release`)
  // "Not approved" without naming a beat used to pass silently: keep it as an open item for the delivery report.
  const unapprovedWithoutBeats = !!reviewRun && !reviewRun.value.approve && flagged.length === 0 && !revised.length
  if (unapprovedWithoutBeats) openItems.push(`the reviewer did not approve the copy but named no beat (${(reviewRun!.value.issues ?? []).join(' ').slice(0, 160)}); review the copy before release`)
  // The end card is copy too: the client's closing line, or the message it falls back to, is scanned with the beats.
  const copy = [...script.beats.map((beat) => `${beat.vo}\n${beat.zh}\n${beat.text}`), brief.tagline ?? brief.message].join('\n')
  // The kit's forbidden words are block findings like the law's: copy with one never reaches media generation.
  const findings = [...scanCopy(copy, brief.category), ...(brief.brand ? scanBrandWords(copy, brief.brand.forbiddenWords, brief.brand.name) : [])]
  return {
    script, copy, findings, blocked: findings.filter((finding) => finding.severity === 'block'), reviewer: reviewRun?.value ?? null, seconds: reviewRun?.seconds ?? 0,
    revisedBeats: revised.map((item) => item.beat), unrevisedFlaggedBeats: unrevised, unapprovedWithoutBeats, openItems,
  }
}

/** Compliance: a deterministic scan, then an independent reviewer on a different model who did not write the copy. */
export async function complianceStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const { editor } = ctx
  ctx.log(`▸ compliance   scan + independent reviewer · ${editor.name}`)
  const review = await reviewCopy(ctx, { brief, script: need(ctx.script, 'script'), check: (script) => checkScript(script, brief), judgeFlags: ctx.jevReview })
  for (const item of review.openItems) ctx.log(`  open item: ${item}`)
  await writeFile(join(ctx.dir!, 'script', 'script.json'), JSON.stringify(review.script, null, 2))
  await writeFile(join(ctx.dir!, 'script', 'copy.txt'), review.copy)
  await writeFile(join(ctx.dir!, 'reports', 'compliance.json'), JSON.stringify({ scan: review.findings, reviewer: review.reviewer }, null, 2))
  await ctx.record('compliance', 'reviewer', editor, { seconds: review.seconds, approve: review.reviewer?.approve, issues: review.reviewer?.issues, scanFindings: review.findings.length, revisedBeats: review.revisedBeats, unrevisedFlaggedBeats: review.unrevisedFlaggedBeats, unapprovedWithoutBeats: review.unapprovedWithoutBeats })
  if (review.blocked.length) throw new Error(`Compliance blocked the script: ${review.blocked.map((finding) => finding.text).join(', ')}`)
  ctx.script = review.script
  return `${review.findings.length} review-level findings`
}
