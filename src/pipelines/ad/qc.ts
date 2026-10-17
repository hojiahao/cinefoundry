import type { CutResult } from '../../agent/finish.js'
import { loudnessFor, qcOpenItems, qcSummary, runQc, writeQcReport, type QcReport, type QcSpec } from '../../crafts/qc.js'
import { DEFAULT_FPS, DEFAULT_RESOLUTION, deliverySize } from '../../lib/formats.js'
import { need, type AdContext } from './context.js'

/** The QC spec of one finished ad film: delivery size and rate from the brief, length and line windows from its edit. */
export function adQcSpec(label: string, cut: CutResult, brief: NonNullable<AdContext['brief']>, silent: boolean): QcSpec {
  const [width, height] = deliverySize(brief.resolution ?? DEFAULT_RESOLUTION, brief.ratio)
  return {
    label, file: cut.path, width, height, fps: brief.fps ?? DEFAULT_FPS, seconds: cut.seconds,
    ...(silent ? {} : { loudness: loudnessFor('ad') }),
    speech: cut.speech, ass: cut.ass, produceId: cut.produceId, stillWindows: [cut.endCard],
  }
}

/**
 * Delivery QC on every ad deliverable (skill `delivery-qc`): the master and each cutdown, measured as delivered.
 * Writes reports/qc.json; every fail and warn becomes an open item in the log and the delivery report. A failing file is
 * reported, not deleted: the fix goes back to the stage that owns it.
 */
export async function adQcStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const master = need(ctx.masterCut, 'master cut')
  const silent = !!ctx.options.silent
  const deliverables = [{ label: 'master', cut: master }, ...ctx.versions.map((version) => ({ label: version.spec.id, cut: version.cut }))]
  const reports: QcReport[] = []
  for (const { label, cut } of deliverables) reports.push(await runQc(adQcSpec(label, cut, brief, silent)))
  await writeQcReport(ctx.dir!, reports)
  const open = qcOpenItems(reports)
  for (const item of open) ctx.log(`  open item: qc ${item}`)
  const summary = qcSummary(reports)
  await ctx.record('qc', 'delivery-qc', undefined, { verdict: summary.verdict, files: summary.files, openItems: open.map((item) => `技术质检 ${item}`) })
  ctx.qc = summary.verdict
  return `${reports.length} file(s) · ${summary.verdict}`
}
