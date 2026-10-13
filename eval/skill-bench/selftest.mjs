// Ideal answers written straight from each skill's rules must score clean; otherwise a rule is unfair.
process.env.BENCH_SELFTEST = '1'
const { TASKS, cases } = await import('./run.mjs')
const { composeImagePrompt, industryOf } = await import('../../dist/agent/checks.js')
const { statedFormat } = await import('../../dist/agent/harness.js')
const size = (r) => ({ '9:16': '1080x1920', '16:9': '1920x1080', '1:1': '1080x1080' })[r]
const ideal = {
  brief: (c) => { const st = statedFormat(c.request); return { id: 'case-one', title: '标题', product: 'p', category: 'food', audience: 'a', message: 'm', ratio: st.ratio ?? '9:16', durationSeconds: st.durationSeconds ?? 15, tone: 't', brandText: '冷', industry: 'drink', appearance: '' } },
  compliance: (c) => c.inject ? { approve: false, issues: ['x'], revised: [{ beat: c.inject.beat, vo: '清爽一口', text: '清爽' }] } : { approve: true, issues: [], revised: [] },
  repair: (c) => { c._prompt = composeImagePrompt(c.shot, { ...c.storyboard, shots: [c.shot] }, true, industryOf(`${c.storyboard.product ?? ''}`)); const k = c._prompt.search(/Image 1 is the product|The product:/); const words = [...new Set(String(c.shot.must_show ?? '').toLowerCase().match(/[a-z]{5,}/g) ?? [])]; return { image_prompt: `${words.join(' ')}, product-only, no people and no hands, no captions or text. ${c._prompt.slice(k)}` } },
  media: (c) => ({ hero_command: c.productPhoto ? null : `cineloom image --out projects/${c.project}/refs/product.png --size 1328x1328 --prompt "Studio product photograph"`, frame_command: `cineloom image --project ${c.project} --shot ${c.shot.shot} --size ${size(c.ratio)} --prompt "Scene. Image 1 is the product: keep its label. No captions, no lettering." --ref projects/${c.project}/refs/product.png`, video_command: `cineloom video --project ${c.project} --shot ${c.shot.shot} --duration 5 --ratio ${c.ratio} --prompt "Slow push-in. No people and no hands enter the frame." --first-frame projects/${c.project}/frames/shot_00${c.shot.shot}.png` }),
  cut: (c) => ({ titles: c.beats.map((b) => ({ beat: b.beat, text: String(b.text).replace(/[。！!？?.，,]$/, '') })), voiceover: c.beats.map((b, i) => ({ beat: b.beat, start_seconds: (b.beat - 1) * 5 + 0.45, speed: Math.max(1, Math.min(1.25, c.voSeconds[i] / 4.55)) })), end_card: { seconds: 3, picture: 'product hero still, slow push-in', title: c.brief.brandText, subtitle: c.brief.message }, crossfade_seconds: 0.4, fps: 24, size: size(c.brief.ratio), grade: 'after_join', music: { source: 'ACE-Step, generated locally' }, total_seconds: c.brief.durationSeconds + 3, ai_generated_label: true }),
  scheduler: (c) => !c.kind ? { fits_now: true, action: 'free_then_load', command: 'cineloom mem free' } : c.kind === 'cgroup' ? { fits_now: false, action: 'do_not_run_now', command: 'cineloom mem status' } : { fits_now: false, action: 'do_not_run_now', command: 'cineloom mem status' },
  film: (c) => { const core = c.message.replace(/\s*先给我看脚本和分镜，我确认了再生成视频。$/, ''); return { preflight: ['pgrep -af "cli.js harness"'], command: `node dist/cli.js harness "${core}"${c.photo ? ` --product-image ${c.photo}` : ''}${c.planOnly ? ' --plan-only' : ''}`, run_in_background: !c.planOnly, after: 'projects/<id>/reports/delivery.md' } },
}
const { readFile } = await import('node:fs/promises')
for (const [name, task] of Object.entries(TASKS)) {
  if (!ideal[name]) continue
  let bad = 0
  for (const c0 of task.items()) {
    const c = structuredClone(c0)
    if (name === 'compliance') c._beats = c.beats.map((b) => (c.inject && b.beat === c.inject.beat ? { ...b, vo: `${c.inject.phrase}，${b.vo}` } : b))
    const p = task.score(c, ideal[name](c))
    if (p.length) { bad++; if (bad <= 3) console.log(name, c.project, p) }
  }
  console.log(`${name}: ${bad} ideal answers rejected of ${task.items().length}`)
}
