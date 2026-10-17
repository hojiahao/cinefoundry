import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createEngineContext } from '../src/engine/run.js'
import type { RevisionTools } from '../src/engine/revise.js'
import { exec } from '../src/lib/exec.js'
import { addAsset, createProject, projectDir, setStage } from '../src/lib/project.js'
import { loadNarrativeContext } from '../src/crafts/narrative/revise.js'
import { cutEpisode, qcEpisodes } from '../src/crafts/narrative/production.js'
import { NARRATIVE_FOLDERS } from '../src/crafts/narrative/pipeline.js'
import type { NarrativeShot, Screenplay, SeriesBible } from '../src/crafts/narrative/types.js'

/**
 * Fixtures shared by the revision and export tests: a fake `docker` for the voice containers (Qwen3-TTS cloning and the
 * Whisper check), a casting library with designed voices, and a finished micro-drama episode on disk.
 */

const ff = (...args: string[]) => exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
export const tone = (path: string, seconds: number, frequency: number) => ff('-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}`, '-ar', '48000', path)

/**
 * A `docker` on PATH that stands in for the audio containers: qwen-clone.py writes each line as a tone whose length
 * follows its word count, asr-score.py hears every line right. Every call is appended to `log` as JSON.
 */
export function installFakeDocker(binDir: string, log: string): void {
  mkdirSync(binDir, { recursive: true })
  const script = `#!/usr/bin/env node
const { execFileSync } = require('node:child_process')
const { appendFileSync, readFileSync, mkdirSync } = require('node:fs')
const { dirname, join } = require('node:path')
const args = process.argv.slice(2)
let work = ''
for (let i = 0; i < args.length; i++) if (args[i] === '-v' && args[i + 1].endsWith(':/work')) work = args[i + 1].slice(0, -':/work'.length)
const host = (p) => join(work, p.replace(/^\\/work\\//, ''))
const script = args.find((a) => a.startsWith('/repo/scripts/')) || ''
const jobs = JSON.parse(readFileSync(host(args[args.indexOf('--jobs') + 1]), 'utf8'))
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ script: script.split('/').pop(), jobs }) + '\\n')
if (script.endsWith('qwen-clone.py')) {
  for (const line of jobs.lines) {
    const out = host(line.output)
    mkdirSync(dirname(out), { recursive: true })
    const seconds = Math.max(1, line.text.split(/\\s+/).length * 0.3)
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=' + (300 + ([...line.text].reduce((sum, ch) => sum + ch.charCodeAt(0), line.seed) % 300)) + ':duration=' + seconds, '-ar', '48000', out])
  }
  console.log(JSON.stringify({ ok: true }))
} else if (script.endsWith('asr-score.py')) {
  console.log(JSON.stringify({ results: jobs.map((j) => ({ path: j.path, heard: j.text, cer: 0 })) }))
} else {
  console.error('fake docker: unsupported ' + script)
  process.exit(2)
}
`
  writeFileSync(join(binDir, 'docker'), script)
  chmodSync(join(binDir, 'docker'), 0o755)
}

/** The casting library with the given designed voices, their reference clips in the audio work folder. */
export async function installVoiceLibrary(file: string, voices: Array<{ id: string; gender: 'female' | 'male'; age: number; uses: string[] }>): Promise<void> {
  writeFileSync(file, JSON.stringify({
    referenceText: { English: 'This is how I sound when I read a line.', Chinese: '这是我的声音。' }, pitchHz: { female: [160, 260], male: [85, 160] },
    voices: voices.map((v) => ({ ...v, language: 'English', accent: 'General American', ageBand: '26-35', timbre: 'warm clear', design: 'a warm clear voice', description: `test voice ${v.id}` })),
  }, null, 2))
  const dir = join(process.env.CINEFOUNDRY_STEP_AUDIO_DIR!, 'voices')
  mkdirSync(dir, { recursive: true })
  for (const voice of voices) await tone(join(dir, `${voice.id}.wav`), 3, voice.gender === 'female' ? 220 : 120)
}

/** Every file of a project (reports and kept versions aside) with the hash of its bytes. */
export function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else files.set(relative(dir, path), createHash('sha1').update(readFileSync(path)).digest('hex'))
    }
  }
  walk(dir)
  return files
}

/** What changed between two snapshots: files whose bytes differ, and files that are new. Reports are left out. */
export function changedFiles(before: Map<string, string>, after: Map<string, string>): { changed: string[]; added: string[] } {
  const relevant = (path: string) => !path.startsWith('reports/')
  return {
    changed: [...after].filter(([path, hash]) => relevant(path) && before.has(path) && before.get(path) !== hash).map(([path]) => path).sort(),
    added: [...after.keys()].filter((path) => relevant(path) && !before.has(path)).sort(),
  }
}

export const bible: SeriesBible = {
  logline: '一位调香师在旧城重逢初恋', genre: 'urban romance, warm and witty', world: 'a quiet old quarter of Shanghai in early spring', look: 'soft window light, warm amber and sage, gentle film grain',
  characters: [
    { id: 'mia', name: 'Mia / 米娅', role: 'lead', age: 29, gender: 'female', look: 'a woman in her late twenties with shoulder-length dark hair and a calm gaze', wardrobe: 'cream linen shirt', arc: '她想重开香水店。她要先原谅自己。', voice: 'warm low alto, unhurried' },
    { id: 'leo', name: 'Leo / 李奥', role: 'love interest', age: 31, gender: 'male', look: 'a man in his early thirties with short black hair and a soft stubble', wardrobe: 'navy wool coat', arc: '他回来卖掉老宅。他留了下来。', voice: 'clear baritone, dry humour' },
  ],
  episodes: [{ episode: 1, title: '重逢', synopsis: '米娅在店里遇见李奥。', hook: '一瓶摔碎的香水', cliffhanger: '他说他要卖掉这条街' }],
}

export const play: Screenplay = {
  episode: 1, title: '重逢',
  scenes: [{ scene: 1, heading: 'INT. PERFUME SHOP - MORNING', characters: ['mia', 'leo'], action: 'A glass bottle shatters on the tiled floor; Mia looks up.', lines: [
    { speaker: 'leo', en: 'I guess some things never change.', zh: '有些事真是一点没变' },
    { speaker: 'mia', en: 'You still knock things over.', zh: '你还是这么毛手毛脚', delivery: 'dry, hiding a smile' },
  ] }],
}

export const shots: NarrativeShot[] = [
  { shot: 1, scene: 1, framing: 'insert', camera: 'locked-off', characters: [], image_prompt: 'a perfume bottle shattering on old green tiles, liquid catching the morning light', video_prompt: 'glass fragments scatter and settle', seconds: 5 },
  { shot: 2, scene: 1, framing: 'medium', camera: 'slow push-in', characters: ['leo'], image_prompt: 'a man in a navy coat in the doorway of a small perfume shop, morning light behind him', video_prompt: 'he smiles faintly', line: 0, seconds: 5 },
  { shot: 3, scene: 1, framing: 'close-up', camera: 'locked-off', characters: ['mia'], image_prompt: 'a woman behind a wooden counter lined with amber bottles, window light on her face', video_prompt: 'she looks up from the counter', line: 1, seconds: 5 },
]

/**
 * A finished 15-second micro-drama episode at 720p 9:16, 24 fps: bible, screenplay, shots, two cast characters with
 * library voices, gated frames, 5-second clips, spoken lines, ambience, an effect and a score in the folders the
 * pipeline uses, and the episode cut by the pipeline's own cutEpisode (which writes its timeline) and measured by QC.
 * Expects CINEFOUNDRY_PROJECTS, CINEFOUNDRY_STEP_AUDIO_DIR and CINEFOUNDRY_VOICE_LIBRARY to be set.
 */
export async function narrativeFixture(id: string): Promise<string> {
  await installVoiceLibrary(process.env.CINEFOUNDRY_VOICE_LIBRARY!, [{ id: 'test-mia', gender: 'female', age: 28, uses: ['character'] }, { id: 'test-leo', gender: 'male', age: 32, uses: ['character'] }])
  await createProject({ id, title: '重逢', brief: '调香师重逢初恋的微短剧', ratio: '9:16', durationSeconds: 15, runId: 'run-drama', format: 'drama', stages: ['development', 'screenplay', 'compliance', 'shots', 'casting', 'frames', 'dialogue', 'clips', 'sound', 'cut'], folders: NARRATIVE_FOLDERS, options: { fps: 24, resolution: '720p', candidates: 1, episodes: 1 } })
  const dir = projectDir(id)
  writeFileSync(join(dir, 'story', 'bible.json'), JSON.stringify(bible, null, 2))
  writeFileSync(join(dir, 'story', 'ep01.screenplay.json'), JSON.stringify(play, null, 2))
  writeFileSync(join(dir, 'storyboard', 'ep01.shots.json'), JSON.stringify(shots, null, 2))
  for (const character of bible.characters) {
    const home = join(dir, 'cast', character.id)
    mkdirSync(home, { recursive: true })
    await ff('-f', 'lavfi', '-i', `color=c=${character.id === 'mia' ? 'pink' : 'navy'}:s=512x512`, '-frames:v', '1', join(home, 'master.png'))
    writeFileSync(join(home, 'character.json'), JSON.stringify({
      version: 1, id: character.id, name: character.name, gender: character.gender, age: character.age, look: character.look, wardrobe: character.wardrobe,
      brief: {}, voice: { description: character.voice, library: `test-${character.id}` }, images: { master: { path: 'master.png', score: 90, pass: true, model: 'qwen_image_2512' } }, candidates: [], castAt: new Date().toISOString(),
    }, null, 2))
  }
  for (const shot of shots) {
    const name = `ep01_shot_${String(shot.shot).padStart(3, '0')}`
    await ff('-f', 'lavfi', '-i', `color=c=0x${(shot.shot * 3355443).toString(16).padStart(6, '0')}:s=704x1280`, '-frames:v', '1', join(dir, 'frames', `${name}.png`))
    await addAsset(id, { id: `frame-1-${shot.shot}`, kind: 'image', stage: 'frames', path: `frames/${name}.png`, shot: shot.shot, execution: 'local-dgx-spark', model: 'qwen_image_edit_2511_lightning', note: 'gate 90' })
    await ff('-f', 'lavfi', '-i', `testsrc2=s=704x1280:r=24:d=5.042,hue=h=${shot.shot * 60}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'clips', `${name}.mp4`))
  }
  const work = process.env.CINEFOUNDRY_STEP_AUDIO_DIR!
  mkdirSync(join(work, 'lines', id), { recursive: true })
  for (const [n, seconds] of [[0, 2.2], [1, 1.8]] as const) {
    await tone(join(work, 'lines', id, `ep01_s1_l${n}.wav`), seconds, 440 + n * 110)
    await tone(join(work, 'lines', id, `ep01_s1_l${n}.trim.wav`), seconds, 440 + n * 110)
  }
  mkdirSync(join(work, 'sound', id, 'ep01'), { recursive: true })
  await tone(join(work, 'sound', id, 'ep01', 'amb_s1.wav'), 15, 110)
  await tone(join(work, 'sound', id, 'ep01', 'fx_1.wav'), 1.5, 900)
  await tone(join(dir, 'audio', 'ep01_score.wav'), 17, 220)
  // The episode as the pipeline cuts it, from the context a revision loads.
  const engine = createEngineContext({ format: 'drama', request: 'fixture', runId: 'run-drama', rules: '', log: () => undefined })
  engine.projectId = id
  engine.dir = dir
  const tools: RevisionTools = { revision: 0, keep: async () => undefined, created: () => undefined }
  const ctx = await loadNarrativeContext(Object.assign(engine, tools), JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')))
  await cutEpisode(ctx, 1)
  await qcEpisodes(ctx, [1])
  for (const stage of ['development', 'screenplay', 'compliance', 'shots', 'casting', 'frames', 'dialogue', 'clips', 'sound', 'cut']) await setStage(id, stage, 'done')
  if (!existsSync(join(dir, 'cut', 'ep01.timeline.json'))) throw new Error('fixture: the episode cut wrote no timeline')
  return dir
}
