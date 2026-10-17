import { probeDuration } from '../../lib/ffmpeg.js'
import { wakeService } from '../../lib/rest.js'
import { addAsset } from '../../lib/project.js'
import { finishMaster } from '../../agent/finish.js'
import { writeDeliveryReport } from '../../agent/delivery.js'
import { need, type AdContext } from './context.js'

/** Cut: voice, music, titles, grade, end card and delivery report; the language models wake underneath it. */
export async function cutStage(ctx: AdContext): Promise<string> {
  const brief = need(ctx.brief, 'brief')
  const script = need(ctx.script, 'script')
  const storyboard = need(ctx.storyboard, 'storyboard')
  const { planner, reviewer } = ctx
  const dir = ctx.dir!
  // Finishing (voice, music, titles, grade) needs neither language model, so their ~100 s weight
  // reload runs underneath it instead of after it.
  ctx.waking = Promise.all([planner, reviewer].map((target) => wakeService(target.baseUrl).then((woke) => ctx.record('run', 'scheduler', undefined, { phase: 'cut', woke: target.name, wokeSeconds: woke.wokeSeconds ?? 0 })).catch(() => undefined)))
  const master = await finishMaster({ dir, brief, script, storyboard, heroPath: need(ctx.hero, 'hero').path, comfy: need(ctx.comfy, 'comfy'), audio: ctx.options.audio, silent: ctx.options.silent, record: ctx.record, log: ctx.log, treatment: ctx.treatment })
  await writeDeliveryReport(dir, brief, storyboard, master.path)
  await addAsset(brief.id, { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg' })
  ctx.masterCut = master
  ctx.finalCut = master.path
  return `${(await probeDuration(master.path)).toFixed(1)}s`
}
