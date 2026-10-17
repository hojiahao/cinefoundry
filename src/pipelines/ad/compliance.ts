import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkScript } from '../../agent/checks.js'
import { chatJson } from '../../agent/llm.js'
import { scanCopy } from '../../lib/compliance.js'
import { need, type AdContext } from './context.js'
import { flaggedBeats } from './request.js'

/** Compliance: a deterministic scan, then an independent reviewer on a different model who did not write the copy. */
export async function complianceStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  let script = need(ctx.script, 'script')
  const { editor } = ctx
  ctx.log(`▸ compliance   scan + independent reviewer · ${editor.name}`)
  const reviewRun = await chatJson<{ approve: boolean; issues: string[]; revised?: Array<{ beat: number; vo: string; zh: string; text: string }> }>(
    editor,
    {
      system: await ctx.agentPrompt('compliance reviewer and bilingual copy editor. You did not write this script', 'ad-compliance-review'),
      thinking: false,
      maxTokens: 2000,
      temperature: 0.2,
      user: `Product category: ${brief.category}. Proof points the brand can substantiate: ${brief.proof ?? 'none supplied'}.${brief.proof ? ' A line that states one of these facts is substantiated; anything stronger is not.' : ''}
Script copy (the announcer speaks the English line; the Chinese subtitle and title are on screen):\n${script.beats.map((beat) => `Beat ${beat.beat} VO (English): ${beat.vo}\nBeat ${beat.beat} subtitle (Chinese): ${beat.zh}\nBeat ${beat.beat} title: ${beat.text}`).join('\n')}

${ctx.jevReview.length ? `A structured judge flagged these lines as uncertain; decide each one:\n${ctx.jevReview.map((f) => `- beat ${f.beat} "${f.line}": ${f.issue} (p=${f.probability.toFixed(2)})`).join('\n')}\n\n` : ''}Judge three things only, briefly: (1) wording a keyword scan would miss, in either language - implied superlatives, implied comparison with competitors, effects nobody could prove; (2) English that a native broadcast copywriter would not write; (3) a Chinese subtitle that does not say what the English says, or reads as translationese.
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
    const followUp = await chatJson<{ revised: Array<{ beat: number; vo: string; zh: string; text: string }> }>(
      editor,
      {
        system: await ctx.agentPrompt('compliance reviewer and bilingual copy editor. You did not write this script', 'ad-compliance-review'),
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
  const merge = (items: Array<{ beat: number; vo: string; zh: string; text: string }>) => script.beats.map((beat) => {
    const change = items.find((item) => item.beat === beat.beat)
    return change ? { ...beat, vo: change.vo ?? beat.vo, zh: change.zh ?? beat.zh, text: change.text ?? beat.text } : beat
  })
  if (revised.length) {
    // The reviewer's edits are accepted only if they still pass every script check. A rewrite that fails them goes
    // back to the reviewer with the failures: "脆爽一夏" was too short for a voiceover, so "补脑增强免疫力" stood.
    let problems = checkScript({ ...script, beats: merge(revised) }, brief)
    if (problems.length) {
      const fix = await chatJson<{ revised: Array<{ beat: number; vo: string; zh: string; text: string }> }>(
        editor,
        {
          system: await ctx.agentPrompt('compliance reviewer and bilingual copy editor. You did not write this script', 'ad-compliance-review'),
          thinking: false,
          maxTokens: 1500,
          temperature: 0.3,
          user: `Your rewrites:\n${revised.map((item) => `Beat ${item.beat} VO: ${item.vo}\nBeat ${item.beat} subtitle: ${item.zh}\nBeat ${item.beat} text: ${item.text}`).join('\n')}
They fail the script checks: ${problems.join('; ')}
Original lines and your reasons: ${(reviewRun?.value.issues ?? []).join(' ')}
Proof points the brand can substantiate: ${brief.proof ?? 'none supplied'}.
Rewrite the same beats so the compliance issue stays fixed AND every check passes. Return JSON only: {"revised": [{"beat": 1, "vo": "English", "zh": "中文字幕", "text": "标题"}]}`,
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
    else ctx.log(`  reviewer rewrites still fail the script checks (${problems[0]}); the copywriter's lines stand and the scan decides`)
  }
  const unrevised = flagged.filter((beat) => !revised.some((item) => item.beat === beat))
  if (unrevised.length) ctx.log(`  open item: the reviewer flagged beat ${unrevised.join(', ')} but no compliant rewrite came back; check those lines before release`)
  // "Not approved" without naming a beat used to pass silently: keep it as an open item for the delivery report.
  if (reviewRun && !reviewRun.value.approve && flagged.length === 0 && !revised.length) ctx.log(`  open item: the reviewer did not approve the copy but named no beat (${(reviewRun.value.issues ?? []).join(' ').slice(0, 160)}); review the copy before release`)
  const copy = script.beats.map((beat) => `${beat.vo}\n${beat.zh}\n${beat.text}`).join('\n')
  const findings = scanCopy(copy, brief.category)
  await writeFile(join(ctx.dir!, 'script', 'script.json'), JSON.stringify(script, null, 2))
  await writeFile(join(ctx.dir!, 'script', 'copy.txt'), copy)
  await writeFile(join(ctx.dir!, 'reports', 'compliance.json'), JSON.stringify({ scan: findings, reviewer: reviewRun?.value ?? null }, null, 2))
  await ctx.record('compliance', 'reviewer', editor, { seconds: reviewRun?.seconds ?? 0, approve: reviewRun?.value.approve, issues: reviewRun?.value.issues, scanFindings: findings.length, revisedBeats: revised.map((item) => item.beat), unrevisedFlaggedBeats: unrevised, unapprovedWithoutBeats: !!reviewRun && !reviewRun.value.approve && flagged.length === 0 && !revised.length })
  if (findings.some((finding) => finding.severity === 'block')) {
    throw new Error(`Compliance blocked the script: ${findings.filter((finding) => finding.severity === 'block').map((finding) => finding.text).join(', ')}`)
  }
  ctx.script = script
  return `${findings.length} review-level findings`
}
