import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Projects on disk as each format leaves them, for the studio tests (and for looking at the studio without a GPU):
 * a finished ad with both cutdowns and delivery QC, a finished short with its packaging, a micro-drama with episode 1
 * made and two more planned, and an ad made before formats existed (no `format`, the old stage list).
 * Media files are a one-pixel PNG and a few bytes standing in for MP4: the studio only links to them.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 17, 8, minutes)).toISOString()
const done = (note?: string, minutes = 0) => ({ status: 'done', ...(note ? { note } : {}), updatedAt: at(minutes) })
const pending = { status: 'pending' }
const pad2 = (n: number) => String(n).padStart(2, '0')
const pad3 = (n: number) => String(n).padStart(3, '0')

async function put(root: string, path: string, content: string | Buffer | object): Promise<void> {
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2))
}

function qc(label: string, file: string, width: number, height: number, fps: number, seconds: number, verdict: 'pass' | 'pass-with-warnings' | 'fail', loudness: number) {
  const results = [
    { check: 'container', status: 'pass', detail: 'mov,mp4' }, { check: 'resolution', status: 'pass', detail: `${width}x${height}` },
    { check: 'frame_rate', status: 'pass', detail: `${fps} fps constant` }, { check: 'duration', status: 'pass', detail: `${seconds} s` },
    { check: 'loudness', status: verdict === 'pass' ? 'pass' : 'warn', detail: `${loudness} LUFS` }, { check: 'true_peak', status: 'pass', detail: '-1.8 dBTP' },
    { check: 'ai_label', status: 'pass', detail: 'AI生成 on 0-3 s, on the closing seconds' }, { check: 'aigc_metadata', status: 'pass', detail: 'Label 1' },
    ...(verdict === 'fail' ? [{ check: 'frozen_picture', status: 'fail', detail: 'frozen 2.1-4.3 s' }] : []),
  ]
  return { label, file, spec: { width, height, fps, seconds, speech: [], produceId: label }, measured: { probe: { formatName: 'mov,mp4', seconds, sizeBytes: 1, bitrateMbps: 8, tags: {}, video: { codec: 'h264', profile: 'High', pixFmt: 'yuv420p', width, height, rFrameRate: fps, avgFrameRate: fps, seconds, frames: Math.round(seconds * fps), bitrateMbps: 8 } }, loudness: { integrated: loudness, lra: 5, truePeak: -1.8 }, black: [], silence: [], freeze: [] }, results, verdict }
}

export async function writeAdFixture(root: string, id = 'leng-soda-30s'): Promise<void> {
  const dir = join(root, id)
  const shots = [1, 2, 3, 4, 5, 6]
  await put(dir, 'state.json', {
    id, format: 'ad', title: '冷 · 夏日气泡水', brief: '给一款叫“冷”的无糖气泡水做一支 30 秒广告，面向大学生，夏天，清爽。银色铝罐，青绿色标签上有白色书法字“冷”。',
    ratio: '16:9', durationSeconds: 30, runId: 'r1', createdAt: at(0), updatedAt: at(50),
    stages: { brief: done(undefined, 1), creative: done('一口下去，整个夏天安静了', 2), script: done('6 beats', 4), compliance: done('0 review-level findings', 5), storyboard: done('6 shots', 6), frames: done(undefined, 20), qa: done('1 regeneration', 20), clips: done(undefined, 40), cut: done('31.2s', 45), versions: done('15s, 06s', 48), qc: done('pass-with-warnings', 50) },
    assets: [
      { id: 'product-hero', kind: 'image', stage: 'frames', path: 'refs/product.png', execution: 'local-dgx-spark', model: 'qwen_image_2512', note: 'gate 92', createdAt: at(8) },
      ...shots.map((n) => ({ id: `frame-${n}`, kind: 'image', stage: 'frames', path: `frames/shot_${pad3(n)}.png`, shot: n, execution: 'local-dgx-spark', model: 'qwen_image_edit_2511_lightning', note: n === 4 ? 'gate 71 (kept after failed gate)' : 'gate 90', createdAt: at(10 + n) })),
      ...shots.map((n) => ({ id: `clip-${n}`, kind: 'video', stage: 'clips', path: `clips/shot_${pad3(n)}.mp4`, shot: n, execution: 'local-dgx-spark', model: 'ltx25_fast_i2v', seconds: 61.4, createdAt: at(30 + n) })),
      { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg', createdAt: at(45) },
      { id: 'final-15s', kind: 'video', stage: 'versions', path: 'cut/final_15s.mp4', execution: 'local-dgx-spark', model: 'ffmpeg', seconds: 15.0, note: '15 s cutdown of the master', createdAt: at(47) },
      { id: 'final-06s', kind: 'video', stage: 'versions', path: 'cut/final_06s.mp4', execution: 'local-dgx-spark', model: 'ffmpeg', seconds: 6.0, note: '6 s cutdown of the master', createdAt: at(48) },
    ],
  })
  await put(dir, 'brief.json', { id, title: '冷 · 夏日气泡水', product: '无糖气泡水“冷”', category: 'food', audience: '大学生', message: '夏日清爽', ratio: '16:9', durationSeconds: 30, tone: 'cinematic macro, icy, restrained', brandText: '冷' })
  await put(dir, 'creative/treatment.json', { insight: '期末周的午后，宿舍里最吵的是自己的心跳。', proposition: '一口下去，整个夏天安静了', concept: '从嘈杂的夏日声音切到开罐的一声轻响，世界随之安静。', brandVoice: 'restrained and premium', visual: { concept: '', light: '', palette: [], texture: '' }, rhythm: '', sound: { voice: 'en-f-warm', voiceDirection: '', music: '', ambience: '' } })
  const framings = ['macro', 'close-up', 'medium', 'wide', 'close-up', 'medium']
  const texts = ['冰爽开启', '细腻气泡', '', '一口安静', '0 糖 0 卡', '冷']
  await put(dir, 'storyboard/storyboard.json', { style: 'cinematic macro', product: 'silver can', shots: shots.map((n) => ({ shot: n, seconds: 5, framing: framings[n - 1], camera: 'slow push-in', image_prompt: `shot ${n}`, video_prompt: 'slow push-in', on_screen_text: texts[n - 1], must_show: 'the can' })) })
  await put(dir, 'script/script.json', { structure: 'noise -> hush', beats: shots.map((n) => ({ beat: n, job: 'beat', see: '', vo: `Line ${n}.`, zh: `第 ${n} 句旁白`, text: texts[n - 1] })) })
  await put(dir, 'reports/qc.json', [qc('master', 'cut/final.mp4', 1920, 1080, 60, 31.2, 'pass', -16.1), qc('15s', 'cut/final_15s.mp4', 1920, 1080, 60, 15, 'pass-with-warnings', -17.3), qc('06s', 'cut/final_06s.mp4', 1920, 1080, 60, 6, 'pass', -16.0)])
  await put(dir, 'reports/delivery.md', '# 交付报告\n')
  await put(dir, 'reports/run.jsonl', '')
  await put(dir, 'refs/product.png', PNG)
  for (const n of shots) {
    await put(dir, `frames/shot_${pad3(n)}.png`, PNG)
    await put(dir, `clips/shot_${pad3(n)}.mp4`, MP4)
  }
  for (const file of ['final.mp4', 'final_15s.mp4', 'final_06s.mp4']) await put(dir, `cut/${file}`, MP4)
}

const narrativeStages = (format: 'short' | 'drama', all: boolean) => ({
  development: done(format === 'short' ? '1 presenter' : '2 characters · 3 episodes', 1), screenplay: done('1 episode(s)', 3), compliance: done('approved', 4), shots: done('12 shots', 6),
  casting: done('2 cast', 14), frames: done('12 frames', 24), dialogue: done('6 lines', 28), clips: all ? done('12 clips', 50) : { status: 'running', updatedAt: at(52) },
  sound: all ? done(undefined, 54) : pending, cut: all ? done('pass', 58) : pending, ...(format === 'short' ? { packaging: all ? done('咖啡师一分钟讲透手冲', 59) : pending } : {}),
})

async function writeNarrative(root: string, id: string, format: 'short' | 'drama', bible: object, characters: Array<{ id: string; voice: string }>, produced: boolean): Promise<void> {
  const dir = join(root, id)
  const shots = Array.from({ length: 12 }, (_, i) => ({ shot: i + 1, scene: i < 6 ? 1 : 2, framing: i % 3 === 0 ? 'wide' : i % 3 === 1 ? 'medium' : 'close-up', camera: 'locked-off', characters: [characters[i % characters.length]!.id], image_prompt: 'frame', video_prompt: 'motion', ...(i % 2 === 1 ? { line: Math.floor(i / 2) % 3 } : {}), seconds: 5 }))
  const play = {
    episode: 1, title: format === 'short' ? '手冲还是美式' : '签约',
    scenes: [1, 2].map((scene) => ({ scene, heading: 'INT. SHOP - NIGHT', characters: characters.map((c) => c.id), action: 'They face each other.', lines: [0, 1, 2].map((n) => ({ speaker: characters[n % characters.length]!.id, en: `Line ${scene}.${n}`, zh: ['这店是外婆的记忆', '三个月，就三个月', '你到底想要什么'][n] })) })),
  }
  const state = {
    id, format, title: format === 'short' ? '一分钟讲透手冲' : '假三个月', brief: format === 'short' ? '一位咖啡师用一分钟讲清手冲和美式的区别，轻松、有梗。' : '都市甜宠微短剧：年轻调香师林夏和地产继承人顾言签下三个月的假恋爱协议。',
    ratio: '9:16', durationSeconds: format === 'short' ? 60 : 120, runId: 'r2', createdAt: at(0), updatedAt: at(produced ? 59 : 52),
    stages: narrativeStages(format, produced),
    assets: [
      ...characters.map((c) => ({ id: `cast-${c.id}`, kind: 'image', stage: 'casting', path: `cast/${c.id}/master.png`, execution: 'local-dgx-spark', model: 'qwen_image_2512', note: 'gate 88', createdAt: at(12) })),
      ...shots.map((s) => ({ id: `frame-1-${s.shot}`, kind: 'image', stage: 'frames', path: `frames/ep01_shot_${pad3(s.shot)}${s.shot === 5 ? '_r1' : ''}.png`, shot: s.shot, execution: 'local-dgx-spark', model: 'qwen_image_edit_2511_lightning', note: s.shot === 5 ? 'gate 74 (kept after failed gate)' : 'gate 89', createdAt: at(20) })),
      ...(produced ? [{ id: 'episode-1', kind: 'video', stage: 'cut', path: 'cut/ep01.mp4', execution: 'local-dgx-spark', model: 'ffmpeg', createdAt: at(58) }] : []),
    ],
  }
  await put(dir, 'state.json', state)
  await put(dir, 'story/bible.json', bible)
  await put(dir, 'story/ep01.screenplay.json', play)
  await put(dir, `storyboard/ep${pad2(1)}.shots.json`, shots)
  for (const c of characters) {
    await put(dir, `cast/${c.id}/master.png`, PNG)
    await put(dir, `cast/${c.id}/character.json`, { version: 1, id: c.id, name: c.id, gender: 'female', age: 28, look: 'look', wardrobe: 'cream knit, gold necklace', brief: {}, voice: { description: 'warm alto', ...(c.voice === 'designed' ? { wav: 'voice.wav', text: 'hello' } : { library: c.voice }) }, images: { master: { path: 'master.png', score: 88, pass: true, model: 'qwen_image_2512' } }, candidates: [], castAt: at(12) })
  }
  for (const s of shots) {
    await put(dir, `frames/ep01_shot_${pad3(s.shot)}${s.shot === 5 ? '_r1' : ''}.png`, PNG)
    if (produced || s.shot <= 4) await put(dir, `clips/ep01_shot_${pad3(s.shot)}.mp4`, MP4)
  }
  await put(dir, 'reports/run.jsonl', '')
  if (produced) {
    await put(dir, 'cut/ep01.mp4', MP4)
    await put(dir, 'reports/qc.json', [qc('ep01', 'cut/ep01.mp4', 1080, 1920, format === 'short' ? 30 : 24, state.durationSeconds, 'pass', -14.2)])
  }
}

export async function writeShortFixture(root: string, id = 'barista-pour-over'): Promise<void> {
  await writeNarrative(root, id, 'short', {
    logline: '一位咖啡师用一分钟讲清手冲和美式到底差在哪。', genre: 'explainer skit, light and witty', world: 'A small specialty coffee bar at morning rush.', look: 'Warm window light, walnut and cream, soft grain.',
    characters: [{ id: 'barista-an', name: 'An Ran / 安然', role: 'presenter', age: 29, gender: 'female', look: 'look', wardrobe: 'denim apron', arc: '把专业讲成人话，让观众第二天就想试一杯手冲。', voice: 'bright mezzo, quick' }],
    episodes: [{ episode: 1, title: '手冲还是美式', synopsis: '咖啡师对着镜头比较两杯咖啡。', hook: '“你喝的美式，可能根本不是你以为的那杯。”', cliffhanger: '下期讲冷萃。' }],
  }, [{ id: 'barista-an', voice: 'en-f-bright-02' }], true)
  const dir = join(root, id)
  await put(dir, 'reports/packaging.json', { titles: ['咖啡师一分钟讲透手冲', '手冲和美式，差的不只是价格', 'Pour-over vs Americano in 60s'], cover: { shot: 1, text: '手冲 vs 美式' }, description: '一分钟分清手冲和美式。本视频由 AI 生成。', hashtags: ['#咖啡', '#手冲咖啡', '#涨知识'] })
  await put(dir, 'cut/cover.jpg', PNG)
}

export async function writeDramaFixture(root: string, id = 'scent-contract'): Promise<void> {
  await writeNarrative(root, id, 'drama', {
    logline: '为了保住外婆留下的老香水店，年轻调香师林夏和要收购整条街的地产继承人顾言签下三个月的假恋爱协议。', genre: 'urban romance, warm and gradual', world: 'A rain-slick lane of old brick apartments in a coastal city.', look: 'Soft warm light with cool moonlight contrast; rose gold, amber, slate blue.',
    characters: [
      { id: 'lin-xia', name: 'Lin Xia / 林夏', role: 'lead', age: 28, gender: 'female', look: 'look', wardrobe: 'cream knit', arc: '林夏学会在守护所爱与接受关怀之间找到平衡。', voice: 'warm alto' },
      { id: 'gu-yan', name: 'Gu Yan / 顾言', role: 'love interest', age: 30, gender: 'male', look: 'look', wardrobe: 'charcoal coat', arc: '顾言在家族期待与真实感情之间做出选择。', voice: 'low baritone' },
    ],
    episodes: [
      { episode: 1, title: '签约', synopsis: '林夏为保住老香水店，与顾言签下假恋爱协议。', hook: '雨夜，林夏握着过期的租约站在店门口。', cliffhanger: '顾言递来协议：“三个月，就三个月。”' },
      { episode: 2, title: '对立', synopsis: '两人搬进同一公寓，第一天就因生活习惯起了冲突。', hook: '地上洒满了香水。', cliffhanger: '“这味道……是外婆的。”' },
      { episode: 3, title: '动心', synopsis: '林夏为顾言调了一款专属的香，家族开始调查她。', hook: '店里弥漫着新调的香气。', cliffhanger: '传真机开始打印文件。' },
    ],
  }, [{ id: 'lin-xia', voice: 'en-f-warm-01' }, { id: 'gu-yan', voice: 'designed' }], false)
}

/** An ad from before formats existed: no `format`, the old stage list (qa, no creative/versions/qc), a master only. */
export async function writeLegacyAdFixture(root: string, id = 'summer-soda'): Promise<void> {
  const dir = join(root, id)
  await put(dir, 'state.json', {
    id, title: '夏日气泡水', brief: '给一款无糖气泡水做一条 15 秒竖版广告。', ratio: '9:16', durationSeconds: 15, createdAt: at(0), updatedAt: '2026-10-10T05:19:51.383Z',
    stages: { brief: done(), script: done('3 beats'), compliance: done(), storyboard: done('3 shots'), frames: done(), qa: done('0 regenerations'), clips: done(), cut: done('16.8s') },
    assets: [
      { id: 'frame-1', kind: 'image', stage: 'frames', path: 'frames/shot_001.png', shot: 1, execution: 'local-dgx-spark', model: 'qwen_image_edit_lightning', note: 'gate 90', createdAt: at(1) },
      { id: 'clip-1', kind: 'video', stage: 'clips', path: 'clips/shot_001.mp4', shot: 1, execution: 'local-dgx-spark', model: 'wan22_i2v_14b_4step', seconds: 386, createdAt: at(2) },
      { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg', createdAt: at(3) },
    ],
  })
  await put(dir, 'frames/shot_001.png', PNG)
  await put(dir, 'clips/shot_001.mp4', MP4)
  await put(dir, 'cut/final.mp4', MP4)
}

export async function writeStudioFixtures(root: string): Promise<void> {
  await writeAdFixture(root)
  await writeShortFixture(root)
  await writeDramaFixture(root)
  await writeLegacyAdFixture(root)
}
