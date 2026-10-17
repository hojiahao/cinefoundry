import { DEFAULT_FPS, DEFAULT_RESOLUTION, deliverySize, isUpscaled } from '../lib/formats.js'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Brief, Storyboard } from './checks.js'

interface Row { ts: string; stage: string; agent: string; execution?: string; model?: string; [key: string]: unknown }

/**
 * The delivery report the final-cut skill promises: what was made, per-shot evidence, measured
 * totals, where each asset came from, and what is still open. Built from run.jsonl, so every
 * number in it was recorded by the harness while it happened.
 */
export async function writeDeliveryReport(dir: string, brief: Brief, storyboard: Storyboard, finalCut: string): Promise<string> {
  const all = (await readFile(join(dir, 'reports', 'run.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row)
  // One run only: run.jsonl is appended to, and a re-run or a re-cut must not mix its numbers with an earlier run's.
  const runId = [...all].reverse().find((row) => row.stage === 'brief' && row.agent === 'intake')?.runId
  const thisRun = runId ? all.filter((row) => row.runId === runId) : all
  // A re-cut appends new voice and music rows: keep the latest per beat.
  // Cutdowns voice their own beats: the key carries the version so a cutdown's beat 1 never hides the master's.
  const audioKey = (row: Row) => `${row.agent}:${row.version ?? ''}:${row.beat ?? ''}`
  const latestAudio = new Map<string, Row>()
  for (const row of thisRun) if (row.agent === 'voiceover' || row.agent === 'music') latestAudio.set(audioKey(row), row)
  const rows = thisRun.filter((row) => !(row.agent === 'voiceover' || row.agent === 'music') || latestAudio.get(audioKey(row)) === row)
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
  const audio = rows.filter((row) => (row.agent === 'voiceover' || row.agent === 'music') && row.version === undefined)
  // The latest cut of each version, and the latest QC of the run.
  const versionCuts = [...new Map(rows.filter((row) => row.stage === 'versions' && row.agent === 'cut').map((row) => [row.version as string, row])).values()]
  const versionVoices = rows.filter((row) => row.stage === 'versions' && row.agent === 'voiceover')
  const versionVoiced = versionVoices.length > 0
  const versionVoice = (versionVoices.find((row) => typeof row.voice === 'string')?.voice as string | undefined) ?? '默认播音员'
  const qc = [...rows].reverse().find((row) => row.stage === 'qc' && row.agent === 'delivery-qc')
  const qcFiles = (qc?.files as Array<{ label: string; verdict: string; fails: string[]; warns: string[] }> | undefined) ?? []
  const versionRows = versionCuts.map((row) => {
    const shots = (row.shots as Array<{ shot: number; seconds: number; why: string }>).map((s) => `${s.shot}（${s.seconds} s，${s.why}）`).join(' · ')
    return `| ${row.version} | \`${row.path}\` | ${seconds(row.fileSeconds)} | ${shots} | ${((row.copy as string[] | undefined) ?? []).join(' / ')} |`
  }).join('\n')
  const qcRows = qcFiles.map((file) => `| ${file.label} | ${file.verdict} | ${file.fails.join('、') || '-'} | ${file.warns.join('、') || '-'} |`).join('\n')
  const resolution = brief.resolution ?? DEFAULT_RESOLUTION
  const fps = brief.fps ?? DEFAULT_FPS
  const [width, height] = deliverySize(resolution, brief.ratio)
  const interpolated = rows.filter((row) => row.agent === 'interpolate')
  const report = `# 交付报告 · ${brief.title}

- 成片：\`${finalCut.slice(dir.length + 1)}\` · ${brief.ratio} · ${brief.durationSeconds} 秒正片 + 3 秒定版
- 交付规格：${width}×${height} · ${fps} fps · ${isUpscaled(resolution) ? `${resolution}，由原生 1080p 生成后放大` : `原生 ${resolution}`}${interpolated.length ? ` · 画面由 24 fps 经 RIFE 4.26 插帧（${interpolated.length} 段，共 ${interpolated.reduce((sum, row) => sum + ((row.seconds as number) || 0), 0).toFixed(1)} s）` : ''} · H.264 High${audio.length ? ' · 音频响度 -16 LUFS' : ' · 无声'}
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

## 版本

${versionRows ? `| 版本 | 文件 | 时长 | 镜头（时长，用途） | 字幕 |
|---|---|---:|---|---|
${versionRows}

每个版本的文案单独撰写并单独通过合规审核，${versionVoiced ? `由母版的配音（${versionVoice}）重新配音，` : '无声，'}沿用母版的素材、定版、调色、字幕样式与 AI 标识${versionVoiced ? '，响度相同，配乐倒算对齐至定版结束' : ''}。剪辑决策见 \`cut/version_<版本>.json\`。` : (rows.find((row) => row.stage === 'versions' && typeof row.skipped === 'string') ? '本片时长不足以剪出 15 秒或 6 秒版本（版本最长为母版的一半）。' : '无。')}

## 技术质检

${qcRows ? `| 文件 | 结论 | 未通过 | 警告 |
|---|---|---|---|
${qcRows}

逐项测量值见 \`reports/qc.json\`（ffprobe / ffmpeg ebur128、astats、blackdetect、silencedetect、freezedetect）。` : '未运行。'}

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
  ...rows.filter((row) => row.stage === 'compliance' && row.agent === 'reviewer').flatMap((row) => [
    ...((row.unrevisedFlaggedBeats as number[] | undefined) ?? []).map((beat) => `- 合规审稿点名了第 ${beat} 拍，但没有得到合格的改写稿，发布前请人工复核该句`),
    ...(row.unapprovedWithoutBeats ? [`- 合规审稿未通过文案但没有指明具体拍号（${((row.issues as string[] | undefined) ?? []).join('；').slice(0, 120)}），发布前请人工复核全部文案`] : []),
  ]),
  ...rows.filter((row) => row.stage === 'versions' && row.agent === 'reviewer').flatMap((row) => [
    ...((row.unrevisedFlaggedBeats as number[] | undefined) ?? []).map((beat) => `- ${row.version} 版本：合规审稿点名了第 ${beat} 拍，但没有得到合格的改写稿，发布前请人工复核该句`),
    ...(row.unapprovedWithoutBeats ? [`- ${row.version} 版本：合规审稿未通过文案但没有指明具体拍号（${((row.issues as string[] | undefined) ?? []).join('；').slice(0, 120)}），发布前请人工复核该版本文案`] : []),
  ]),
  // Cutdowns that could not be made and every QC fail or warn, recorded as they happened.
  ...rows.filter((row) => (row.stage === 'versions' || (row.stage === 'qc' && row === qc)) && Array.isArray(row.openItems)).flatMap((row) => (row.openItems as unknown[]).filter((item): item is string => typeof item === 'string').map((item) => `- ${item}`)),
  userPhoto ? '- 本片的画面由 AI 依据用户提供的产品照片生成，配音与音乐为 AI 生成；对外发布时须按平台规范标注' : '- 本片的画面、配音与音乐均为 AI 生成；对外发布时须按平台规范标注',
].join('\n')}
`
  const path = join(dir, 'reports', 'delivery.md')
  await writeFile(path, report)
  return path
}
