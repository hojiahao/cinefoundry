import { DEFAULT_FPS, DEFAULT_RESOLUTION, deliverySize, isUpscaled } from '../lib/formats.js'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Brief, Script, Storyboard } from './checks.js'

interface Row { ts: string; stage: string; agent: string; execution?: string; model?: string; [key: string]: unknown }

/**
 * The delivery report the final-cut skill promises: what was made, per-shot evidence, measured
 * totals, where each asset came from, and what is still open. Built from run.jsonl, so every
 * number in it was recorded by the harness while it happened.
 */
export async function writeDeliveryReport(dir: string, brief: Brief, script: Script, storyboard: Storyboard, finalCut: string): Promise<string> {
  const rows = (await readFile(join(dir, 'reports', 'run.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row)
  const gates = rows.filter((row) => row.agent === 'quality-gate' || row.agent === 'product-hero')
  const clips = rows.filter((row) => row.agent === 'video')
  const cloud = rows.filter((row) => row.execution === 'cloud')
  const director = rows.find((row) => row.agent === 'director')
  const unverified = gates.filter((row) => row.score === -1)
  const userPhoto = rows.find((row) => row.agent === 'product-hero' && row.source === 'user photo')
  // The frame the harness kept: the highest score, the later attempt on a tie (harness.ts, consider).
  const keptGate = (shot: number) => gates.filter((row) => row.shot === shot)
    .reduce<Row | undefined>((top, row) => (!top || (row.pass && !top.pass) || (!!row.pass === !!top.pass && (row.score as number) >= (top.score as number)) ? row : top), undefined)
  const keptAfterFail = storyboard.shots.filter((shot) => {
    const attempts = gates.filter((row) => row.shot === shot.shot)
    return attempts.length > 0 && !attempts.some((row) => row.pass)
  })
  const seconds = (value: unknown) => (typeof value === 'number' ? `${value.toFixed(1)} s` : '-')
  const shotRows = storyboard.shots.map((shot) => {
    const attempts = gates.filter((row) => row.shot === shot.shot)
    const best = keptGate(shot.shot)
    const clip = clips.find((row) => row.shot === shot.shot)
    const frameSeconds = attempts.reduce((sum, row) => sum + ((row.imageSeconds as number) || 0), 0)
    return `| ${shot.shot} | ${shot.framing} · ${shot.camera} | ${attempts.length} | ${best ? `${best.pass ? 'pass' : 'kept after fail'} ${best.score}` : '-'} | ${frameSeconds.toFixed(1)} s | ${seconds(clip?.seconds)} |`
  }).join('\n')
  const stageSeconds = (stage: string) => rows.filter((row) => row.stage === stage && typeof row.seconds === 'number').reduce((sum, row) => sum + (row.seconds as number), 0)
  const memory = rows.filter((row) => row.agent === 'scheduler' && typeof row.availableBeforeGb === 'number').map((row) => `| ${row.phase} | ${row.availableBeforeGb} GB | ${row.availableAfterFreeGb} GB |`).join('\n')
  const audio = rows.filter((row) => row.agent === 'voiceover' || row.agent === 'music')
  const resolution = brief.resolution ?? DEFAULT_RESOLUTION
  const fps = brief.fps ?? DEFAULT_FPS
  const [width, height] = deliverySize(resolution, brief.ratio)
  const interpolated = rows.filter((row) => row.agent === 'interpolate')
  const report = `# 交付报告 · ${brief.title}

- 成片：\`${finalCut.slice(dir.length + 1)}\` · ${brief.ratio} · ${brief.durationSeconds} 秒正片 + 3 秒定版
- 交付规格：${width}×${height} · ${fps} fps · ${isUpscaled(resolution) ? `${resolution}，由原生 1080p 生成后放大` : `原生 ${resolution}`}${interpolated.length ? ` · 画面由 24 fps 经 RIFE 4.26 插帧（${interpolated.length} 段，共 ${interpolated.reduce((sum, row) => sum + ((row.seconds as number) || 0), 0).toFixed(1)} s）` : ''} · H.264 High · 音频响度 -16 LUFS
- AI 生成标识：显式（片头 3 秒与定版右上角“内容由 AI 生成”）+ 隐式（文件元数据 AIGC 字段）
- 创意原话记录于 \`state.json\`；需求单 \`brief.json\`；脚本 \`script/script.json\`；分镜 \`storyboard/storyboard.json\`
- 品类 ${brief.category} · 拍摄行业 ${brief.industry ?? '未记录'} · 品牌字「${brief.brandText}」 · 受众 ${brief.audience} · 核心信息「${brief.message}」${brief.tagline ? ` · 定版字幕（用户原话）「${brief.tagline}」` : ''}${brief.proof ? `
- 卖点依据（用户提供）：${brief.proof}` : ''}

## 逐镜头

| 镜头 | 景别 · 运镜 | 质检次数 | 最终判定 | 生图耗时合计 | 视频耗时 |
|---:|---|---:|---|---:|---:|
${shotRows}

## 各阶段实测

| 阶段 | 记录 |
|---|---|
| 需求 → 分镜（模型调用） | ${(stageSeconds('brief') + stageSeconds('script') + stageSeconds('compliance') + stageSeconds('storyboard')).toFixed(1)} s |
| 定妆图 | ${userPhoto ? `用户提供的产品照片，质检 ${userPhoto.pass ? 'pass' : 'reject'} ${userPhoto.score}` : `${gates.filter((row) => row.agent === 'product-hero').length} 次生成与质检`} |
| 首帧与质检 | ${gates.filter((row) => row.agent === 'quality-gate').length} 次质检，${director?.qaRegenerations ?? new Set(gates.filter((row) => row.agent === 'quality-gate' && (row.attempt as number) > 0).map((row) => `${row.shot}/${row.attempt}`)).size} 次重生成 |
| 视频 | ${clips.map((row) => `${(row.seconds as number).toFixed(0)} s`).join(' / ')} |
| 配音 · 音乐 | ${audio.map((row) => `${row.agent} ${seconds(row.seconds)}${row.model ? ` (${row.model})` : ''}`).join(' · ') || '无声'} |
| 总耗时 | ${director ? `${(director.wallSeconds as number).toFixed(0)} s` : '-'} |

## 内存（阶段切换时）

| 阶段 | 释放前可用 | 释放后可用 |
|---|---:|---:|
${memory || '| - | - | - |'}

## 生成位置

- 本地（DGX Spark）：${rows.filter((row) => row.execution !== 'cloud' && row.model).length} 次模型调用
- 云端：${cloud.length ? cloud.map((row) => `${row.stage}/${row.agent} (${row.model})`).join('，') : '无'}

## 待确认事项

${[
  ...keptAfterFail.map((shot) => `- 镜头 ${shot.shot} 在质检未通过的情况下保留了最高分候选 ${keptGate(shot.shot)?.candidate ?? ''}（${keptGate(shot.shot)?.score} 分：${(keptGate(shot.shot)?.issues as string[] | undefined)?.[0] ?? ''}）`),
  ...(userPhoto && !userPhoto.pass ? [`- 定妆图使用用户提供的产品照片；质检未通过（${(userPhoto.issues as string[] | undefined)?.[0] ?? ''}），照片仍作为全片产品依据`] : []),
  ...unverified.map((row) => `- 镜头 ${row.shot ?? '定妆图'} 的一次质检未能得到判定，该帧按未验证处理`),
  userPhoto ? '- 本片的画面由 AI 依据用户提供的产品照片生成，配音与音乐为 AI 生成；对外发布时须按平台规范标注' : '- 本片的画面、配音与音乐均为 AI 生成；对外发布时须按平台规范标注',
].join('\n')}
`
  const path = join(dir, 'reports', 'delivery.md')
  await writeFile(path, report)
  return path
}
