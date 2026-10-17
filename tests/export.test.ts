import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { exportCut } from '../src/crafts/export.js'
import { fcpTime, rateOf, timecode, toEdl, toFcpxml, toFrames, toOtio, toSrt, toXmeml, type InterchangeInput } from '../src/crafts/interchange.js'
import { pictureTrack, type Timeline } from '../src/crafts/timeline.js'
import { probeDuration } from '../src/lib/ffmpeg.js'
import { narrativeFixture } from './fixtures.js'

/** Well-formed XML: every tag closes in order, attributes are quoted, text has no bare <, > or &. Throws with the first fault. */
function wellFormed(text: string): string[] {
  const body = text.replace(/^<\?xml[^?]*\?>\s*/, '').replace(/^<!DOCTYPE [a-z]+>\s*/i, '')
  const stack: string[] = []
  const tags: string[] = []
  let at = 0
  for (const match of body.matchAll(/<[^>]*>/g)) {
    const between = body.slice(at, match.index)
    if (/[<>]|&(?!(amp|lt|gt|quot|apos);)/.test(between)) throw new Error(`bad text before ${match[0].slice(0, 60)}: ${between.slice(0, 60)}`)
    at = match.index! + match[0].length
    const tag = /^<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>$/.exec(match[0])
    if (!tag) throw new Error(`malformed tag ${match[0].slice(0, 80)}`)
    if (/&(?!(amp|lt|gt|quot|apos);)/.test(tag[3] ?? '')) throw new Error(`unescaped & in ${match[0].slice(0, 80)}`)
    const [, close, name, , self] = tag
    tags.push(name!)
    if (close) { if (stack.pop() !== name) throw new Error(`</${name}> closes ${stack.at(-1) ?? 'nothing'}`) }
    else if (!self) stack.push(name!)
  }
  if (stack.length) throw new Error(`unclosed <${stack.join('>, <')}>`)
  if (body.slice(at).trim()) throw new Error('text after the root element')
  return tags
}

const attrs = (xml: string, element: string) => [...xml.matchAll(new RegExp(`<${element}\\b([^>]*)>`, 'g'))].map((m) => Object.fromEntries([...m[1]!.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])))

/** A 30 s ad master at the given rate: six 5 s shots, hard cuts, a 0.5 s dissolve into a 3 s end card. */
function adTimeline(fps: number): Timeline {
  const durations = [5, 5, 5, 5, 5, 5, 3]
  const overlaps = [0, 0, 0, 0, 0, 0.5]
  return {
    version: 1, label: 'master', format: 'ad', projectId: 'ad-test', title: '拾豆 & co', fps, width: 1920, height: 1080, seconds: 32.5, file: 'cut/final.mp4', ass: 'cut/titles.ass',
    mix: { file: 'audio/soundtrack.wav', kind: 'voice-over-music' },
    picture: pictureTrack([...[1, 2, 3, 4, 5, 6].map((shot) => ({ kind: 'shot' as const, shot, source: `clips/shot_00${shot}.mp4` })), { kind: 'endcard' as const, source: 'clips/endcard.mp4' }], durations, overlaps),
    audio: { dialogue: [], music: [], effects: [], ambience: [] },
    subtitles: [{ start: 0.45, end: 3.1, zh: '冰块轻响', en: 'Ice cracks.' }, { start: 5.45, end: 8.9, zh: '冷萃一夜', en: 'Steeped overnight <slowly> & cold.' }],
    endCard: { start: 29.5, end: 32.5, text: '一口慢下来' },
    markers: [...[1, 2, 3, 4, 5, 6].map((shot) => ({ at: (shot - 1) * 5, name: `Shot ${shot}`, kind: 'shot' as const })), { at: 29.5, name: 'End card: 一口慢下来', kind: 'endcard' as const }],
  }
}

const adInput = (fps: number, sourceSeconds = 5.04): InterchangeInput => {
  const stems = { dialogue: '/p/exports/master/master_dialogue.wav', music: '/p/exports/master/master_music.wav', effects: '/p/exports/master/master_effects.wav', ambience: '/p/exports/master/master_ambience.wav' }
  const media = new Map<string, { seconds: number; width?: number; height?: number; fps?: number }>()
  for (const shot of [1, 2, 3, 4, 5, 6]) media.set(`/p/clips/shot_00${shot}.mp4`, { seconds: sourceSeconds, width: 1920, height: 1088, fps: 24 })
  media.set('/p/clips/endcard.mp4', { seconds: 3, width: 1920, height: 1080, fps })
  for (const path of Object.values(stems)) media.set(path, { seconds: 32.5 })
  return { timeline: adTimeline(fps), resolve: (path) => `/p/${path}`, stems, media }
}

describe('timecode and rates', () => {
  it('converts seconds to whole frames and refuses a time between frames', () => {
    expect(rateOf(60)).toMatchObject({ num: 1, den: 60, timebase: 60, ntsc: false })
    expect(rateOf(29.97)).toMatchObject({ num: 1001, den: 30000, timebase: 30, ntsc: true })
    expect(toFrames(29.5, rateOf(60))).toBe(1770)
    expect(toFrames(29.5, rateOf(24))).toBe(708)
    expect(() => toFrames(0.45, rateOf(24), 'voice')).toThrow('voice: 0.45 s does not land on a frame at 24 fps')
    expect(fcpTime(300, rateOf(60))).toBe('300/60s')
    expect(fcpTime(0, rateOf(60))).toBe('0s')
    expect(fcpTime(150, rateOf(29.97))).toBe('150150/30000s')
    expect(timecode(3600 * 60 + 9 * 60 + 30, rateOf(60))).toBe('01:00:09:30')
    expect(timecode(3600 * 120 + 119, rateOf(120))).toBe('01:00:00:119')
  })

  it('lays the picture out as the assembler renders it: the dissolve begins where the end card does', () => {
    const picture = adTimeline(60).picture
    expect(picture.map((c) => [c.start, c.duration])).toEqual([[0, 5], [5, 5], [10, 5], [15, 5], [20, 5], [25, 4.5], [29.5, 3]])
    expect(picture[6]!.transitionIn).toEqual({ seconds: 0.5 })
    expect(picture.slice(0, 6).every((c) => !c.transitionIn)).toBe(true)
  })
})

describe('EDL', () => {
  it('writes CMX 3600 events exact to the frame, the dissolve on the edit, the stems on A and A2', () => {
    const edl = toEdl(adInput(60)).split('\n')
    expect(edl[0]).toBe('TITLE: 拾豆 & co · master')
    expect(edl[1]).toBe('FCM: NON-DROP FRAME')
    expect(edl).toContain('001  AX       V     C        00:00:00:00 00:00:05:00 01:00:00:00 01:00:05:00')
    expect(edl).toContain('006  AX       V     C        00:00:00:00 00:00:04:30 01:00:25:00 01:00:29:30')
    // The dissolve: a zero-length cut on the outgoing clip's out point, then 30 frames into the end card.
    expect(edl).toContain('007  AX       V     C        00:00:04:30 00:00:04:30 01:00:29:30 01:00:29:30')
    expect(edl).toContain('007  AX       V     D    030 00:00:00:00 00:00:03:00 01:00:29:30 01:00:32:30')
    expect(edl).toContain('* TO CLIP NAME: endcard.mp4')
    expect(edl).toContain('* SOURCE FILE: /p/clips/shot_003.mp4')
    expect(edl).toContain('* LOC: 01:00:10:00 RED     Shot 3')
    expect(edl).toContain('* LOC: 01:00:29:30 YELLOW  End card: 一口慢下来')
    expect(edl).toContain('008  AX       A     C        00:00:00:00 00:00:32:30 01:00:00:00 01:00:32:30')
    expect(edl).toContain('009  AX       A2    C        00:00:00:00 00:00:32:30 01:00:00:00 01:00:32:30')
    const effects = toEdl(adInput(60), 'effects')
    expect(effects).toContain('* FROM CLIP NAME: master_effects.wav')
    expect(effects).toContain('* FROM CLIP NAME: master_ambience.wav')
    expect(effects).not.toContain(' V     ')
  })

  it('counts frames at 24 and 30 fps as well', () => {
    expect(toEdl(adInput(24))).toContain('007  AX       V     D    012 00:00:00:00 00:00:03:00 01:00:29:12 01:00:32:12')
    expect(toEdl(adInput(30))).toContain('007  AX       V     D    015 00:00:00:00 00:00:03:00 01:00:29:15 01:00:32:15')
  })

  it('refuses an edit that is not frame-accurate or a dissolve without a handle', () => {
    const input = adInput(24)
    const broken = { ...input, timeline: { ...input.timeline, picture: input.timeline.picture.map((c, i) => (i === 1 ? { ...c, duration: 5.01 } : c)) } }
    expect(() => toEdl(broken)).toThrow(/does not land on a frame at 24 fps/)
    expect(() => toEdl(adInput(24, 4.6))).toThrow(/shot_006\.mp4 has no 12-frame handle for the dissolve into End card/)
  })
})

describe('FCPXML and FCP 7 XML', () => {
  it('is well-formed FCPXML 1.10 with frame-rate rationals and frame-accurate durations', () => {
    const xml = toFcpxml(adInput(60))
    const tags = wellFormed(xml)
    expect(tags[0]).toBe('fcpxml')
    expect(xml).toContain('<fcpxml version="1.10">')
    const [sequenceFormat] = attrs(xml, 'format')
    expect(sequenceFormat).toMatchObject({ id: 'r1', frameDuration: '1/60s', width: '1920', height: '1080' })
    // The 24 fps generated clips keep their own format.
    expect(attrs(xml, 'format').some((f) => f.frameDuration === '1/24s' && f.height === '1088')).toBe(true)
    expect(attrs(xml, 'sequence')[0]).toMatchObject({ format: 'r1', duration: '1950/60s', tcStart: '216000/60s', tcFormat: 'NDF' })
    const clips = attrs(xml, 'asset-clip').filter((c) => !c.lane)
    expect(clips.map((c) => [c.offset, c.start, c.duration])).toEqual([
      ['216000/60s', '0s', '300/60s'], ['216300/60s', '0s', '300/60s'], ['216600/60s', '0s', '300/60s'], ['216900/60s', '0s', '300/60s'], ['217200/60s', '0s', '300/60s'], ['217500/60s', '0s', '270/60s'], ['217770/60s', '0s', '180/60s'],
    ])
    // Durations add up to the sequence, to the frame.
    expect(clips.reduce((sum, c) => sum + Number(c.duration!.split('/')[0]), 0)).toBe(1950)
    expect(attrs(xml, 'transition')[0]).toMatchObject({ name: 'Cross Dissolve', offset: '217770/60s', duration: '30/60s' })
    const lanes = attrs(xml, 'asset-clip').filter((c) => c.lane)
    expect(lanes.map((c) => [c.lane, c.audioRole, c.duration])).toEqual([['-1', 'dialogue', '1950/60s'], ['-2', 'music', '1950/60s'], ['-3', 'effects', '1950/60s'], ['-4', 'effects.ambience', '1950/60s']])
    expect(attrs(xml, 'marker').map((m) => m.value)).toEqual(['Shot 1', 'Shot 2', 'Shot 3', 'Shot 4', 'Shot 5', 'Shot 6', 'End card: 一口慢下来'])
    expect(attrs(xml, 'media-rep').map((r) => r.src)).toEqual(expect.arrayContaining(['file:///p/clips/shot_001.mp4', 'file:///p/clips/endcard.mp4', 'file:///p/exports/master/master_ambience.wav']))
    expect(xml).toContain('name="拾豆 &amp; co · master"')
  })

  it('writes FCP 7 XML (xmeml) for Premiere with frame counts on the sequence timebase', () => {
    const xml = toXmeml(adInput(24))
    wellFormed(xml)
    expect(xml).toContain('<xmeml version="5">')
    expect(xml).toContain('<duration>780</duration>')
    expect(xml).toContain('<timebase>24</timebase><ntsc>FALSE</ntsc>')
    expect(xml).toContain('<string>01:00:00:00</string><frame>86400</frame>')
    expect(xml).toMatch(/<name>Shot 6<\/name><enabled>TRUE<\/enabled><duration>120<\/duration><rate>.*?<\/rate><start>600<\/start><end>708<\/end><in>0<\/in><out>108<\/out>/)
    expect(xml).toContain('<transitionitem><start>708</start><end>720</end><alignment>start</alignment>')
    expect(xml).toMatch(/<name>End card<\/name>.*?<start>708<\/start><end>780<\/end><in>0<\/in><out>72<\/out>/)
    expect(xml.match(/<track><clipitem id="clipitem-a/g)).toHaveLength(4)
    expect(xml).toContain('<pathurl>file:///p/clips/shot_001.mp4</pathurl>')
  })
})

describe('OpenTimelineIO', () => {
  it('matches the schema shape: Timeline.1, a Stack of tracks, Clip.2 with external references, a dissolve transition', () => {
    const otio = toOtio(adInput(60)) as any
    expect(otio.OTIO_SCHEMA).toBe('Timeline.1')
    expect(otio.global_start_time).toEqual({ OTIO_SCHEMA: 'RationalTime.1', rate: 60, value: 216000 })
    expect(otio.tracks.OTIO_SCHEMA).toBe('Stack.1')
    expect(otio.tracks.children.map((t: any) => [t.OTIO_SCHEMA, t.kind, t.name])).toEqual([['Track.1', 'Video', 'V1'], ['Track.1', 'Audio', 'Dialogue'], ['Track.1', 'Audio', 'Music'], ['Track.1', 'Audio', 'Effects'], ['Track.1', 'Audio', 'Ambience']])
    const video = otio.tracks.children[0].children
    expect(video.map((item: any) => item.OTIO_SCHEMA)).toEqual(['Clip.2', 'Clip.2', 'Clip.2', 'Clip.2', 'Clip.2', 'Clip.2', 'Transition.1', 'Clip.2'])
    const transition = video[6]
    expect(transition).toMatchObject({ transition_type: 'SMPTE_Dissolve', in_offset: { rate: 60, value: 0 }, out_offset: { rate: 60, value: 30 } })
    const clip = video[5]
    expect(clip.source_range).toEqual({ OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate: 60, value: 0 }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate: 60, value: 270 } })
    expect(clip.active_media_reference_key).toBe('DEFAULT_MEDIA')
    expect(clip.media_references.DEFAULT_MEDIA).toMatchObject({ OTIO_SCHEMA: 'ExternalReference.1', target_url: 'file:///p/clips/shot_006.mp4', available_range: { duration: { value: 302 } } })
    expect(clip.markers[0]).toMatchObject({ OTIO_SCHEMA: 'Marker.2', name: 'Shot 6', marked_range: { OTIO_SCHEMA: 'TimeRange.1' } })
    // Clip lengths on the video track add up to the edit.
    expect(video.filter((i: any) => i.OTIO_SCHEMA === 'Clip.2').reduce((sum: number, c: any) => sum + c.source_range.duration.value, 0)).toBe(1950)
    for (const track of otio.tracks.children.slice(1)) expect(track.children[0].source_range.duration.value).toBe(1950)
    for (const item of JSON.stringify(otio).match(/"OTIO_SCHEMA":"[^"]+"/g)!) expect(item).toMatch(/"(Timeline\.1|Stack\.1|Track\.1|Clip\.2|Transition\.1|Marker\.2|ExternalReference\.1|TimeRange\.1|RationalTime\.1)"/)
  })
})

describe('SRT', () => {
  it('writes each language separately, to the millisecond', () => {
    const subtitles = adTimeline(24).subtitles
    expect(toSrt(subtitles, 'zh')).toBe('1\n00:00:00,450 --> 00:00:03,100\n冰块轻响\n\n2\n00:00:05,450 --> 00:00:08,900\n冷萃一夜\n')
    expect(toSrt(subtitles, 'en')).toContain('2\n00:00:05,450 --> 00:00:08,900\nSteeped overnight <slowly> & cold.\n')
  })
})

describe('cinefoundry export on a finished episode', () => {
  const projects = mkdtempSync(join(tmpdir(), 'cinefoundry-export-'))
  let dir = ''

  beforeAll(async () => {
    Object.assign(process.env, { CINEFOUNDRY_PROJECTS: projects, CINEFOUNDRY_STEP_AUDIO_DIR: join(projects, 'audio-work'), CINEFOUNDRY_VOICE_LIBRARY: join(projects, 'voices.json') })
    dir = await narrativeFixture('export-drama')
  }, 120_000)

  it('records the cut as a timeline: picture, four buses, subtitles and markers', () => {
    const timeline = JSON.parse(readFileSync(join(dir, 'cut', 'ep01.timeline.json'), 'utf8')) as Timeline
    expect(timeline).toMatchObject({ label: 'ep01', format: 'drama', fps: 24, width: 720, height: 1280, seconds: 15, file: 'cut/ep01.mp4', mix: { kind: 'four-bus' } })
    expect(timeline.picture.map((c) => [c.shot, c.start, c.duration, c.source])).toEqual([[1, 0, 5, 'clips/ep01_shot_001.mp4'], [2, 5, 5, 'clips/ep01_shot_002.mp4'], [3, 10, 5, 'clips/ep01_shot_003.mp4']])
    expect(timeline.audio.dialogue.map((d) => [d.start, d.line])).toEqual([[5.4, '1:1:0'], [10.4, '1:1:1']])
    expect(timeline.audio.ambience).toHaveLength(1)
    expect(timeline.audio.effects).toHaveLength(1)
    expect(timeline.audio.music[0]!.source).toBe('audio/ep01_score.wav')
    expect(timeline.subtitles.map((s) => s.zh)).toEqual(['有些事真是一点没变', '你还是这么毛手毛脚'])
  })

  it('exports EDL, FCPXML + FCP 7 XML and OTIO with the stems, SRT and ASS beside them', async () => {
    const edl = await exportCut(dir, { label: 'ep01', format: 'edl' })
    const out = join(dir, 'exports', 'ep01')
    expect(edl.files).toEqual(expect.arrayContaining(['exports/ep01/ep01.edl', 'exports/ep01/ep01.effects.edl', 'exports/ep01/ep01_mix.wav', 'exports/ep01/ep01.zh.srt', 'exports/ep01/ep01.en.srt', 'exports/ep01/ep01.ass', 'exports/ep01/manifest.json']))
    // Four stems and the mix, each exactly the length of the cut.
    for (const name of ['mix', 'dialogue', 'music', 'effects', 'ambience']) expect(Math.abs((await probeDuration(join(out, `ep01_${name}.wav`))) - 15)).toBeLessThan(0.002)
    const lines = readFileSync(join(out, 'ep01.edl'), 'utf8').split('\n')
    expect(lines).toContain('002  AX       V     C        00:00:00:00 00:00:05:00 01:00:05:00 01:00:10:00')
    expect(lines).toContain(`* SOURCE FILE: ${join(dir, 'clips', 'ep01_shot_002.mp4')}`)
    expect(lines).toContain('004  AX       A     C        00:00:00:00 00:00:15:00 01:00:00:00 01:00:15:00')
    expect(readFileSync(join(out, 'ep01.zh.srt'), 'utf8')).toMatch(/^1\n00:00:05,400 --> 00:00:0\d,\d{3}\n有些事真是一点没变\n/)
    expect(readFileSync(join(out, 'ep01.en.srt'), 'utf8')).toContain('I guess some things never change.')
    expect(readFileSync(join(out, 'ep01.ass'), 'utf8')).toContain('内容由 AI 生成')

    await exportCut(dir, { label: 'ep01', format: 'fcpxml' })
    const fcpxml = readFileSync(join(out, 'ep01.fcpxml'), 'utf8')
    wellFormed(fcpxml)
    expect(attrs(fcpxml, 'sequence')[0]).toMatchObject({ duration: '360/24s', tcStart: '86400/24s' })
    expect(attrs(fcpxml, 'asset-clip').filter((c) => !c.lane).map((c) => [c.offset, c.duration])).toEqual([['86400/24s', '120/24s'], ['86520/24s', '120/24s'], ['86640/24s', '120/24s']])
    for (const rep of attrs(fcpxml, 'media-rep')) expect(existsSync(fileURLToPath(rep.src!))).toBe(true)
    wellFormed(readFileSync(join(out, 'ep01.xml'), 'utf8'))

    await exportCut(dir, { label: 'ep01', format: 'otio' })
    const otio = JSON.parse(readFileSync(join(out, 'ep01.otio'), 'utf8'))
    expect(otio.tracks.children.map((t: any) => t.name)).toEqual(['V1', 'Dialogue', 'Music', 'Effects', 'Ambience'])
    expect(otio.tracks.children[0].children.map((c: any) => c.metadata.cinefoundry.shot)).toEqual([1, 2, 3])
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    expect(manifest.stems.effects).toEqual({ file: 'exports/ep01/ep01_effects.wav', empty: false })
  }, 120_000)

  it('refuses a cut that has no timeline', async () => {
    await expect(exportCut(dir, { label: 'ep02', format: 'otio' })).rejects.toThrow(/no timeline for ep02/)
  })
})
