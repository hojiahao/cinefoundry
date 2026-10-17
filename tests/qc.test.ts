import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  checkAigc, checkAss, isFaststart, judge, LOUDNESS, loudnessFor, parseAss, parseAstats, parseBlack, parseEbur128, parseFreeze, parseProbe, parseRate, parseSilence,
  qcOpenItems, runQc, topLevelBoxes, verdictOf, writeQcReport, type QcMeasured, type QcSpec,
} from '../src/crafts/qc.js'
import { AI_LABEL, TITLE_FONT } from '../src/agent/finish.js'
import { exec } from '../src/lib/exec.js'
import { assembleFilm } from '../src/lib/ffmpeg.js'
import { buildAss } from '../src/lib/titles.js'
import { episodeQcSpec } from '../src/crafts/narrative/production.js'
import type { NarrativeContext } from '../src/crafts/narrative/context.js'

const EBUR128 = `[Parsed_ebur128_0 @ 0x1] t: 2.9 TARGET:-23 LUFS M: -16.2 S: -16.1 I: -16.0 LUFS LRA: 2.0 LU
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -16.1 LUFS
    Threshold: -26.4 LUFS

  Loudness range:
    LRA:         6.2 LU
    Threshold: -36.5 LUFS
    LRA low:   -19.1 LUFS
    LRA high:  -12.9 LUFS

  True peak:
    Peak:       -1.6 dBFS
`
const ASTATS = `[Parsed_astats_1 @ 0x2] Overall
[Parsed_astats_1 @ 0x2] DC offset: -0.000001
[Parsed_astats_1 @ 0x2] Peak level dB: -2.301030
[Parsed_astats_1 @ 0x2] RMS level dB: -19.0
[Parsed_astats_1 @ 0x2] Flat factor: 0.000000
[Parsed_astats_1 @ 0x2] Number of samples: 144384
`

describe('QC parsers', () => {
  it('reads the ebur128 summary, ignoring the per-frame lines', () => {
    expect(parseEbur128(EBUR128)).toEqual({ integrated: -16.1, lra: 6.2, truePeak: -1.6 })
    expect(parseEbur128('no summary here')).toBeUndefined()
    // A silent programme: -70 LUFS and a peak of -inf.
    expect(parseEbur128(EBUR128.replace('-16.1 LUFS', '-70.0 LUFS').replace('-1.6 dBFS', '-inf dBFS'))).toEqual({ integrated: -70, lra: 6.2, truePeak: -Infinity })
  })

  it('reads the astats overall block', () => {
    expect(parseAstats(ASTATS)).toEqual({ peakDb: -2.30103, flatFactor: 0 })
    expect(parseAstats('[Parsed_astats_1 @ 0x2] Channel: 1\nPeak level dB: -3')).toBeUndefined()
  })

  it('pairs detector starts and ends, closing an open run at the end of the file', () => {
    expect(parseBlack('[blackdetect @ 0x3] black_start:0 black_end:0.5 black_duration:0.5\n[blackdetect @ 0x3] black_start:4.2 black_end:4.6 black_duration:0.4')).toEqual([{ start: 0, end: 0.5 }, { start: 4.2, end: 4.6 }])
    const silence = '[silencedetect @ 0x4] silence_start: 1.501375\n[silencedetect @ 0x4] silence_end: 2.508 | silence_duration: 1.0066\n[silencedetect @ 0x4] silence_start: 5.25'
    expect(parseSilence(silence, 6)).toEqual([{ start: 1.501375, end: 2.508 }, { start: 5.25, end: 6 }])
    const freeze = '[freezedetect @ 0x5] lavfi.freezedetect.freeze_start: 3\n[freezedetect @ 0x5] lavfi.freezedetect.freeze_duration: 2\n[freezedetect @ 0x5] lavfi.freezedetect.freeze_end: 5'
    expect(parseFreeze(freeze, 10)).toEqual([{ start: 3, end: 5 }])
  })

  it('reads ffprobe JSON, frame rates and ASS events', () => {
    expect(parseRate('30000/1001')).toBeCloseTo(29.97, 2)
    expect(parseRate('0/0')).toBeNaN()
    const probe = parseProbe(JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', width: 1920, height: 1080, r_frame_rate: '60/1', avg_frame_rate: '60/1', duration: '15.000000', nb_frames: '900', bit_rate: '18400000', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709' },
        { codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '48000', channels: 2, bit_rate: '320000', duration: '15.000000' },
      ],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '15.010000', size: '34500000', bit_rate: '18700000', tags: { AIGC: '{"Label":"1"}', comment: AI_LABEL } },
    }))
    expect(probe.video).toMatchObject({ codec: 'h264', rFrameRate: 60, frames: 900, bitrateMbps: 18.4, colorPrimaries: 'bt709' })
    expect(probe.audio).toMatchObject({ codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 320 })
    expect(probe.tags.AIGC).toBe('{"Label":"1"}')
    const ass = parseAss(buildAss([{ start: 0, end: 3, label: AI_LABEL }, { start: 0, end: 5, subtitle: '冰块轻响, 清晨', subtitleStart: 0.45, subtitleEnd: 3.2 }], 1920, 1080))
    expect(ass).toContainEqual({ start: 0, end: 3, style: 'Label', text: AI_LABEL })
    // The text keeps its commas; override tags are stripped.
    expect(ass).toContainEqual({ start: 0.45, end: 3.2, style: 'Sub', text: '冰块轻响, 清晨' })
  })

  it('picks the format loudness target', () => {
    expect(loudnessFor('ad')).toEqual(LOUDNESS.web)
    expect(loudnessFor('drama').integrated).toBe(-14)
    expect(loudnessFor('short').truePeak).toBe(-1.0)
  })
})

const spec: QcSpec = {
  label: 'master', file: '/x/final.mp4', width: 1920, height: 1080, fps: 60, seconds: 15, loudness: LOUDNESS.web,
  speech: [{ start: 0.45, end: 3.0 }, { start: 4.45, end: 7.0 }], ass: '/x/titles.ass', produceId: 'spark', stillWindows: [{ start: 12, end: 15 }],
}
const passing = (): QcMeasured => ({
  probe: {
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2', seconds: 15.01, sizeBytes: 1, bitrateMbps: 18.7,
    tags: { AIGC: JSON.stringify({ Label: '1', ContentProducer: 'Cinefoundry', ProduceID: 'spark', ReservedCode1: '', ContentPropagator: '', PropagateID: '', ReservedCode2: '' }), comment: `${AI_LABEL} · Cinefoundry · spark` },
    video: { codec: 'h264', profile: 'High', pixFmt: 'yuv420p', width: 1920, height: 1080, rFrameRate: 60, avgFrameRate: 60, seconds: 15, frames: 900, bitrateMbps: 18.4, colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709' },
    audio: { codec: 'aac', profile: 'LC', sampleRate: 48000, channels: 2, bitrateKbps: 320, seconds: 15 },
  },
  faststart: true,
  loudness: { integrated: -16.1, lra: 6.2, truePeak: -1.6 },
  astats: { peakDb: -2.3, flatFactor: 0 },
  black: [{ start: 0, end: 0.2 }],
  silence: [{ start: 14.4, end: 15 }],
  freeze: [{ start: 12.1, end: 14.9 }],
  ass: [
    { start: 0, end: 3, style: 'Label', text: AI_LABEL }, { start: 12, end: 15, style: 'Label', text: AI_LABEL },
    { start: 0.45, end: 3.2, style: 'Sub', text: '冰块轻响' }, { start: 4.45, end: 7.2, style: 'Sub', text: '冷萃一夜' },
  ],
})
const status = (m: QcMeasured, name: string, s: QcSpec = spec) => judge(s, m).find((r) => r.check === name)?.status

describe('QC verdict', () => {
  it('passes a deliverable on spec, with the fades, the end card still and the tail silence allowed', () => {
    const results = judge(spec, passing())
    expect(results.filter((r) => r.status !== 'pass')).toEqual([])
    expect(verdictOf(results)).toBe('pass')
  })

  it('fails loudness, true peak and clipping outside the profile', () => {
    expect(status({ ...passing(), loudness: { integrated: -18.2, lra: 6, truePeak: -1.6 } }, 'loudness')).toBe('fail')
    expect(status({ ...passing(), loudness: { integrated: -16, lra: 6, truePeak: -0.9 } }, 'true_peak')).toBe('fail')
    // -14 LUFS passes a drama (web-platform) and fails an ad (web).
    expect(status({ ...passing(), loudness: { integrated: -14, lra: 6, truePeak: -1.2 } }, 'loudness', { ...spec, loudness: LOUDNESS['web-platform'] })).toBe('pass')
    expect(status({ ...passing(), loudness: { integrated: -14, lra: 6, truePeak: -1.2 } }, 'loudness')).toBe('fail')
    expect(status({ ...passing(), loudness: { integrated: -16, lra: 12.5, truePeak: -1.6 } }, 'loudness_range')).toBe('warn')
    expect(status({ ...passing(), astats: { peakDb: -0.05, flatFactor: 0 } }, 'clipping')).toBe('fail')
    expect(status({ ...passing(), astats: { peakDb: -3, flatFactor: 2 } }, 'clipping')).toBe('fail')
  })

  it('fails silence where a line is placed and warns on a dropped bed elsewhere', () => {
    expect(status({ ...passing(), silence: [{ start: 1.0, end: 2.0 }] }, 'silence')).toBe('fail')
    expect(status({ ...passing(), silence: [{ start: 9.0, end: 10.0 }] }, 'silence')).toBe('warn')
    expect(status({ ...passing(), silence: [{ start: 0, end: 0.25 }] }, 'silence')).toBe('pass')
  })

  it('fails black frames outside the fades and warns on a frozen shot outside the end card', () => {
    expect(status({ ...passing(), black: [{ start: 6.0, end: 6.4 }] }, 'black_frames')).toBe('fail')
    expect(status({ ...passing(), black: [{ start: 14.6, end: 15.0 }] }, 'black_frames')).toBe('pass')
    expect(status({ ...passing(), freeze: [{ start: 5, end: 7 }] }, 'frozen_picture')).toBe('warn')
  })

  it('fails picture off spec: size, variable frame rate, duration off by more than a frame, codec, colour, bitrate, faststart', () => {
    const m = passing()
    expect(status({ ...m, probe: { ...m.probe, video: { ...m.probe.video!, width: 1280, height: 720 } } }, 'resolution')).toBe('fail')
    expect(status({ ...m, probe: { ...m.probe, video: { ...m.probe.video!, avgFrameRate: 59.2 } } }, 'frame_rate')).toBe('fail')
    expect(status({ ...m, probe: { ...m.probe, video: { ...m.probe.video!, seconds: 15.0166 } } }, 'duration')).toBe('pass')
    expect(status({ ...m, probe: { ...m.probe, video: { ...m.probe.video!, seconds: 15.05 } } }, 'duration')).toBe('fail')
    expect(status({ ...m, probe: { ...m.probe, video: { ...m.probe.video!, frames: 880 } } }, 'frame_count')).toBe('fail')
    expect(status({ ...m, probe: { ...m.probe, video: { ...m.probe.video!, profile: 'Main' } } }, 'codec')).toBe('fail')
    const { colorPrimaries: _drop, ...untagged } = m.probe.video!
    expect(status({ ...m, probe: { ...m.probe, video: untagged } }, 'colour')).toBe('fail')
    expect(status({ ...m, probe: { ...m.probe, video: { ...m.probe.video!, bitrateMbps: 30 } } }, 'bitrate')).toBe('fail')
    expect(status({ ...m, probe: { ...m.probe, video: { ...m.probe.video!, bitrateMbps: 6 } } }, 'bitrate')).toBe('warn')
    expect(status({ ...m, faststart: false }, 'faststart')).toBe('fail')
  })

  it('checks the audio stream against the spec: AAC 48 kHz stereo, or none for a silent delivery', () => {
    const m = passing()
    expect(status({ ...m, probe: { ...m.probe, audio: { ...m.probe.audio!, sampleRate: 44100 } } }, 'audio')).toBe('fail')
    expect(status({ ...m, probe: { ...m.probe, audio: undefined } }, 'audio')).toBe('fail')
    const silent = { ...spec, loudness: undefined }
    expect(status({ ...m, probe: { ...m.probe, audio: undefined } }, 'audio', silent)).toBe('pass')
    expect(judge(silent, { ...m, probe: { ...m.probe, audio: undefined } }).some((r) => r.check === 'loudness')).toBe(false)
  })

  it('fails the implicit and explicit AI labels when missing or wrong', () => {
    const tags = passing().probe.tags
    expect(checkAigc(tags, 'spark').status).toBe('pass')
    expect(checkAigc({ comment: AI_LABEL }, 'spark').status).toBe('fail')
    expect(checkAigc({ ...tags, AIGC: '{not json' }, 'spark').status).toBe('fail')
    expect(checkAigc(tags, 'other-project').detail).toContain('ProduceID')
    expect(checkAigc({ ...tags, AIGC: JSON.stringify({ Label: '1', ContentProducer: 'Cinefoundry', ProduceID: 'spark' }) }, 'spark').detail).toContain('ContentPropagator key is missing')
    const events = passing().ass!
    expect(checkAss(spec, events).every((r) => r.status === 'pass')).toBe(true)
    expect(checkAss(spec, events.filter((e) => !(e.style === 'Label' && e.start === 0)))[0]!.status).toBe('fail')
    expect(checkAss(spec, events.filter((e) => e.text !== '冷萃一夜')).find((r) => r.check === 'subtitles')!.status).toBe('fail')
    expect(checkAss(spec, undefined)[0]!.status).toBe('fail')
    expect(checkAss({ ...spec, ass: undefined }, events)[0]!.status).toBe('fail')
  })

  it('surfaces every fail and warn as an open item with its deliverable', () => {
    const results = judge(spec, { ...passing(), black: [{ start: 6, end: 6.4 }], freeze: [{ start: 5, end: 7 }] })
    expect(verdictOf(results)).toBe('fail')
    expect(verdictOf(results.filter((r) => r.status !== 'fail'))).toBe('pass-with-warnings')
    const open = qcOpenItems([{ label: '15s', file: spec.file, spec, measured: passing(), results, verdict: 'fail' }])
    expect(open).toEqual([expect.stringMatching(/^15s: fail black_frames - black 6\.00-6\.40 s$/), expect.stringMatching(/^15s: warn frozen_picture/)])
  })
})

describe('QC specs per format', () => {
  it('derives an episode spec: platform loudness, five seconds a shot, a window per spoken line', () => {
    const ctx = {
      format: 'drama', options: { brief: 'x', fps: 24 }, ratio: '9:16', dir: '/p/drama-x', projectId: 'drama-x',
      shots: new Map([[1, [{ shot: 1, scene: 1, line: 0 }, { shot: 2, scene: 1 }, { shot: 3, scene: 1, line: 1 }]]]),
      lines: new Map([['1:1:0', { wav: 'a.wav', seconds: 1.8, cer: 0 }], ['1:1:1', { wav: 'b.wav', seconds: 2.2, cer: 0 }]]),
      outputs: new Map([[1, '/p/drama-x/cut/ep01.mp4']]),
    } as unknown as NarrativeContext
    const s = episodeQcSpec(ctx, 1)
    expect(s).toMatchObject({ label: 'ep01', file: '/p/drama-x/cut/ep01.mp4', width: 1080, height: 1920, fps: 24, seconds: 15, ass: '/p/drama-x/cut/ep01.ass', produceId: 'drama-x-ep01', loudness: LOUDNESS['web-platform'] })
    expect(s.speech).toEqual([{ start: 0.4, end: expect.closeTo(2.2, 6) }, { start: 10.4, end: expect.closeTo(12.6, 6) }])
  })
})

/** Small fixtures generated with ffmpeg's lavfi sources: no GPU, a few seconds of encoding. */
describe('QC on ffmpeg-generated files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cinefoundry-qc-'))
  const ff = (...args: string[]) => exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  const width = 320, height = 180, fps = 30
  let good: QcSpec

  beforeAll(async () => {
    // A finished film made by the cut's own assembler: two moving clips, a stereo bed, labels, subtitles and metadata.
    await ff('-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=${fps}:d=2`, '-c:v', 'libx264', '-preset', 'ultrafast', join(dir, 'a.mp4'))
    await ff('-f', 'lavfi', '-i', `testsrc=s=${width}x${height}:r=${fps}:d=2`, '-c:v', 'libx264', '-preset', 'ultrafast', join(dir, 'b.mp4'))
    await ff('-f', 'lavfi', '-i', 'sine=f=330:r=48000:d=4', '-f', 'lavfi', '-i', 'sine=f=495:r=48000:d=4', '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]', '-map', '[a]', join(dir, 'bed.wav'))
    const ass = join(dir, 'titles.ass')
    writeFileSync(ass, buildAss([
      { start: 0, end: 2, title: '冷萃', subtitle: '冰块轻响', subtitleEn: 'Ice cracks.', subtitleStart: 0.45, subtitleEnd: 1.8 },
      { start: 0, end: 3, label: AI_LABEL }, { start: 1.6, end: 3.6, label: AI_LABEL },
    ], width, height, TITLE_FONT))
    const aigc = JSON.stringify({ Label: '1', ContentProducer: 'Cinefoundry', ProduceID: 'qc-fixture', ReservedCode1: '', ContentPropagator: '', PropagateID: '', ReservedCode2: '' })
    await assembleFilm([join(dir, 'a.mp4'), join(dir, 'b.mp4')], join(dir, 'good.mp4'), {
      width, height, fps, durations: [2, 2], crossfadeSeconds: [0.4], ass, audio: join(dir, 'bed.wav'), loudness: -16,
      metadata: { AIGC: aigc, comment: `${AI_LABEL} · Cinefoundry · qc-fixture` },
    })
    good = { label: 'master', file: join(dir, 'good.mp4'), width, height, fps, seconds: 3.6, loudness: LOUDNESS.web, speech: [{ start: 0.45, end: 1.6 }], ass, produceId: 'qc-fixture' }

    // Everything wrong at once: 25 fps, mono 44.1 kHz, black in the middle, a silent hole under the line, no tags, no faststart.
    await ff('-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=25:d=1.5`, '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=25:d=1`, '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=25:d=1.5`,
      '-f', 'lavfi', '-i', 'sine=f=440:r=44100:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.5', '-f', 'lavfi', '-i', 'sine=f=440:r=44100:d=1.5',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]', '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'main', '-c:a', 'aac', join(dir, 'bad.mp4'))
  }, 120_000)

  it('measures the assembler output on spec: loudness, labels, metadata, colour tags, duration', async () => {
    const report = await runQc(good)
    const byName = Object.fromEntries(report.results.map((r) => [r.check, r]))
    expect(report.measured.loudness!.integrated).toBeGreaterThan(-17)
    expect(report.measured.loudness!.integrated).toBeLessThan(-15)
    for (const name of ['container', 'faststart', 'codec', 'colour', 'resolution', 'frame_rate', 'duration', 'frame_count', 'bitrate', 'audio', 'loudness', 'true_peak', 'clipping', 'silence', 'black_frames', 'aigc_metadata', 'ai_label', 'subtitles']) {
      expect(byName[name], name).toBeDefined()
      expect(byName[name]!.status, `${name}: ${byName[name]!.detail}`).toBe('pass')
    }
    expect(report.verdict).not.toBe('fail')
    expect(isFaststart(await topLevelBoxes(good.file))).toBe(true)
    await writeQcReport(dir, [report])
    const written = JSON.parse(readFileSync(join(dir, 'reports', 'qc.json'), 'utf8'))
    expect(written[0].file).toBe('good.mp4')
    expect(written[0].spec.ass).toBe('titles.ass')
  }, 60_000)

  it('fails a file that breaks the spec, check by check', async () => {
    const report = await runQc({ ...good, label: 'bad', file: join(dir, 'bad.mp4'), seconds: 4, speech: [{ start: 1.6, end: 2.4 }], ass: join(dir, 'missing.ass') })
    const failed = report.results.filter((r) => r.status === 'fail').map((r) => r.check)
    expect(report.verdict).toBe('fail')
    expect(failed).toEqual(expect.arrayContaining(['faststart', 'codec', 'frame_rate', 'audio', 'black_frames', 'silence', 'aigc_metadata', 'ai_label']))
    expect(report.measured.black.some((b) => b.start > 1 && b.end < 3)).toBe(true)
    expect(report.measured.silence.some((s) => s.start < 2 && s.end > 2)).toBe(true)
  }, 60_000)
})
