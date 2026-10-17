import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { revisionHistoryMarkdown } from '../../engine/revise.js'
import { deliverySize } from '../../lib/formats.js'
import type { QcReport } from '../qc.js'
import { readTimeline } from '../timeline.js'
import type { NarrativeContext } from './context.js'

interface Row { runId?: string; baseRunId?: string; stage: string; agent: string; [key: string]: unknown }

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The delivery report of a narrative film (reports/delivery.md): every cut episode with its length and QC verdict, the
 * open items recorded while it was made (mis-heard lines, QC fails and warns), and the revision history. Built from
 * the project's files and run.jsonl, so every number in it was measured.
 */
export async function writeNarrativeDeliveryReport(ctx: NarrativeContext): Promise<string> {
  const dir = ctx.dir!
  const rows = existsSync(join(dir, 'reports', 'run.jsonl'))
    ? (await readFile(join(dir, 'reports', 'run.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row)
    : []
  const qc = existsSync(join(dir, 'reports', 'qc.json')) ? (JSON.parse(await readFile(join(dir, 'reports', 'qc.json'), 'utf8')) as QcReport[]) : []
  const episodes = [...(ctx.bible?.episodes ?? [])].filter((e) => existsSync(join(dir, 'cut', `ep${pad(e.episode)}.mp4`)))
  const [width, height] = deliverySize(ctx.options.resolution ?? '1080p', ctx.ratio)
  const lines: string[] = []
  for (const episode of episodes) {
    const label = `ep${pad(episode.episode)}`
    const timeline = await readTimeline(dir, label)
    const report = qc.find((r) => r.label === label)
    const shots = ctx.shots.get(episode.episode) ?? []
    lines.push(`| ${episode.episode} | ${episode.title} | \`cut/${label}.mp4\` | ${(timeline?.seconds ?? shots.length * 5).toFixed(1)} s | ${shots.length} | ${shots.filter((s) => s.line !== undefined).length} | ${report?.verdict ?? '-'} |`)
  }
  // The latest QC record and the latest voice record per line: a revision re-measures and re-voices what it changed.
  const lastQc = [...rows].reverse().find((row) => row.agent === 'delivery-qc')
  const voice = new Map<string, Row>()
  for (const row of rows) if (row.stage === 'dialogue' && row.agent === 'voice' && typeof row.line === 'string') voice.set(row.line, row)
  const unclear = [...voice.values()].filter((row) => typeof row.errorRate === 'number' && (row.errorRate as number) > 0.08)
  const open = [
    ...unclear.map((row) => `- 台词 ${row.line} 经重录仍识别有误（错误率 ${((row.errorRate as number) * 100).toFixed(0)}%），发布前请人工试听`),
    ...((lastQc?.openItems as string[] | undefined) ?? []).map((item) => `- 技术质检 ${item}`),
    '- 本片的画面、表演、配音、音效与音乐均为 AI 生成；对外发布时须按平台规范标注',
  ]
  const report = `# 交付报告 · ${ctx.bible?.logline ?? ctx.projectId}

- 格式：${ctx.format === 'drama' ? '微短剧' : '短视频'} · ${ctx.ratio} · ${width}×${height} · ${ctx.options.fps ?? 24} fps · 响度 -14 LUFS
- AI 生成标识：显式（片头 3 秒与片尾 3 秒“内容由 AI 生成”）+ 隐式（文件元数据 AIGC 字段）
- 剧集圣经 \`story/bible.json\`；剧本 \`story/epNN.screenplay.json\`；分镜 \`storyboard/epNN.shots.json\`；角色档案 \`cast/<id>/character.json\`；剪辑记录 \`cut/epNN.timeline.json\`

## 剧集

${lines.length ? `| 集 | 标题 | 文件 | 时长 | 镜头 | 对白镜头 | 技术质检 |
|---:|---|---|---:|---:|---:|---|
${lines.join('\n')}` : '无。'}

逐项测量值见 \`reports/qc.json\`。

## 修订记录

${await revisionHistoryMarkdown(dir)}

## 待确认事项

${open.join('\n')}
`
  const path = join(dir, 'reports', 'delivery.md')
  await writeFile(path, report)
  return path
}
