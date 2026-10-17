import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeComfy } from './fake-comfy.js'

const run = promisify(execFile)
let fake: Awaited<ReturnType<typeof startFakeComfy>>
const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-projects-'))

/** Runs the built CLI as the agent would: a separate process, configured by environment. */
async function cinefoundry(...args: string[]) {
  const { stdout } = await run('node', ['dist/cli.js', ...args], { env: { ...process.env, COMFYUI_URL: fake.url, CINEFOUNDRY_PROJECTS: projects } })
  return JSON.parse(stdout)
}

beforeAll(async () => { fake = await startFakeComfy() })
afterAll(() => fake.close())

describe('brief to final cut through the CLI', () => {
  it('runs project -> frames -> clips -> cut and records every asset', async () => {
    await cinefoundry('project', 'init', '--id', 'coffee', '--brief', '拾豆冷萃咖啡 15 秒竖版', '--ratio', '9:16')

    const frame = await cinefoundry('image', '--project', 'coffee', '--shot', '1', '--prompt', 'a can on ice', '--size', '1080x1920')
    expect(frame.detail.upscaled).toBe(true)
    expect([frame.width, frame.height]).toEqual([1080, 1920])
    expect(fake.graphs[0]!['8'].inputs.width * fake.graphs[0]!['8'].inputs.height).toBeLessThanOrEqual(1328 * 1328)

    // A reference switches to the edit graph and fills all three slots.
    await cinefoundry('image', '--project', 'coffee', '--shot', '2', '--prompt', 'can on a beach', '--size', '704x1280', '--ref', frame.path)
    expect(fake.graphs[1]!['6'].class_type).toBe('TextEncodeQwenImageEditPlus')

    // With a first frame the default video model is LTX-2.5 Fast (its first-frame LoadImage is node 9).
    const clip = await cinefoundry('video', '--project', 'coffee', '--shot', '1', '--prompt', 'slow push-in', '--first-frame', frame.path, '--duration', '10')
    expect(clip.detail.model).toBe('ltx25-fast')
    expect(clip.detail.segments).toBe(2)
    expect(fake.graphs[2]!['1'].inputs.unet_name).toMatch(/^ltx-2\.5-22b/)
    expect(fake.graphs[2]!['9'].class_type).toBe('LoadImage')
    expect(fake.graphs[3]!['9'].class_type).toBe('LoadImage') // second segment continues from the last frame
    expect(fake.graphs[2]!['12'].inputs.length).toBe(121) // 5 s at 24 fps, 8n+1 frames
    expect(fake.freed()).toBe(1)

    await cinefoundry('video', '--project', 'coffee', '--shot', '2', '--prompt', 'waves', '--duration', '5')
    expect(fake.graphs[4]!['20']).toBeUndefined() // no first frame -> Wan2.2 5B text-to-video graph
    expect(fake.graphs[4]!['9']?.class_type).not.toBe('LoadImage')

    // Wan2.2 image-to-video is still selectable (its first-frame LoadImage is node 20); written outside the project.
    const wan = await cinefoundry('video', '--out', join(projects, 'wan.mp4'), '--prompt', 'slow push-in', '--first-frame', frame.path, '--model', 'wan22-5b')
    expect(wan.detail.model).toBe('wan22-5b')
    expect(fake.graphs[5]!['20'].class_type).toBe('LoadImage')

    const cut = await cinefoundry('cut', '--project', 'coffee')
    expect(cut.clips).toBe(2)
    expect(cut.mode).toBe('picture only')
    expect(cut.duration).toBeGreaterThan(1.2)

    const state = await cinefoundry('project', 'status', '--id', 'coffee')
    expect(state.stages.cut.status).toBe('done')
    expect(state.assets.map((asset: any) => asset.id).sort()).toEqual(['clip-1', 'clip-2', 'final-cut', 'frame-1', 'frame-2'])
    expect(state.assets.every((asset: any) => asset.execution === 'local-dgx-spark' && !asset.path.startsWith('/'))).toBe(true)
  })

  it('splits a reference video into shots', async () => {
    const video = join(projects, 'ref.mp4')
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=2', '-f', 'lavfi', '-i', 'testsrc=s=320x240:d=3', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1.5', '-filter_complex', '[0][1][2]concat=n=3:v=1', video])
    expect(await cinefoundry('shots', video, '--out', join(projects, 'breakdown'))).toMatchObject({ shotCount: 3, duration: 6.52 })
  })

  it('exits 1 on blocked copy and 0 on clean copy', async () => {
    const bad = join(projects, 'bad.txt'); writeFileSync(bad, '全网第一')
    await expect(cinefoundry('copy-check', bad)).rejects.toMatchObject({ code: 1 })
    const good = join(projects, 'good.txt'); writeFileSync(good, '冷萃醇香，清晨慢饮')
    expect((await cinefoundry('copy-check', good)).verdict).toBe('pass')
  })
})
