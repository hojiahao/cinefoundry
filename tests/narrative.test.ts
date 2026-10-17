import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkBible, checkScreenplay, checkShots } from '../src/crafts/narrative/checks.js'
import { checkPackaging } from '../src/crafts/narrative/packaging.js'
import { mixNarrative } from '../src/crafts/narrative/mix.js'
import { buildAss } from '../src/lib/titles.js'
import { exec } from '../src/lib/exec.js'
import { probeDuration } from '../src/lib/ffmpeg.js'
import type { NarrativeShot, Screenplay, SeriesBible } from '../src/crafts/narrative/types.js'

const bible: SeriesBible = {
  logline: '一位调香师在旧城重逢初恋', genre: 'urban romance, warm and witty', world: 'a quiet old quarter of Shanghai in early spring', look: 'soft window light, warm amber and sage, gentle film grain',
  characters: [
    { id: 'mia', name: 'Mia / 米娅', role: 'lead', age: 29, gender: 'female', look: 'a woman in her late twenties with shoulder-length dark hair and a calm gaze', wardrobe: 'cream linen shirt', arc: '她想重开香水店。她要先原谅自己。', voice: 'warm low alto, unhurried' },
    { id: 'leo', name: 'Leo / 李奥', role: 'love interest', age: 31, gender: 'male', look: 'a man in his early thirties with short black hair and a soft stubble', wardrobe: 'navy wool coat', arc: '他回来卖掉老宅。他留了下来。', voice: 'clear baritone, dry humour' },
  ],
  episodes: [{ episode: 1, title: '重逢', synopsis: '米娅在店里遇见李奥。', hook: '一瓶摔碎的香水', cliffhanger: '他说他要卖掉这条街' }],
}

const play: Screenplay = {
  episode: 1, title: '重逢',
  scenes: [
    { scene: 1, heading: 'INT. PERFUME SHOP - MORNING', characters: ['mia', 'leo'], action: 'A glass bottle shatters on the tiled floor; Mia looks up.', lines: [
      { speaker: 'leo', en: 'I guess some things never change.', zh: '有些事真是一点没变' },
      { speaker: 'mia', en: 'You still knock things over.', zh: '你还是这么毛手毛脚', delivery: 'dry, hiding a smile' },
    ] },
  ],
}

const shots: NarrativeShot[] = [
  { shot: 1, scene: 1, framing: 'insert', camera: 'locked-off', characters: [], image_prompt: 'a perfume bottle shattering on old green tiles, liquid catching the morning light', video_prompt: 'glass fragments scatter and settle', seconds: 5 },
  { shot: 2, scene: 1, framing: 'medium', camera: 'slow push-in', characters: ['leo'], image_prompt: 'a man in a navy coat in the doorway of a small perfume shop, morning light behind him', video_prompt: 'he smiles faintly', line: 0, seconds: 5 },
  { shot: 3, scene: 1, framing: 'close-up', camera: 'locked-off', characters: ['mia'], image_prompt: 'a woman behind a wooden counter lined with amber bottles, window light on her face', video_prompt: 'she looks up from the counter', line: 1, seconds: 5 },
]

describe('narrative checks', () => {
  it('accepts a sound bible and refuses minors, numbers in picture words and a wrong episode count', () => {
    expect(checkBible(bible, { episodes: 1 })).toEqual([])
    const bad = { ...bible, look: 'f/1.4 golden hour', characters: [{ ...bible.characters[0]!, age: 16 }], episodes: [] }
    const problems = checkBible(bad, { episodes: 1 }).join(' | ')
    expect(problems).toContain('minors are not cast')
    expect(problems).toContain('look must be words only')
    expect(problems).toContain('plan exactly 1 episode')
  })

  it('names every character "English / 中文" and makes the id from the English name', () => {
    const named = (name: string, id = 'lin-xia') => checkBible({ ...bible, characters: [{ ...bible.characters[0]!, id, name }] }, { episodes: 1 }).join(' ')
    expect(named('Lin Xia / 林夏')).toBe('')
    expect(named('Lin Xia / 林夏', 'xia')).toBe('')
    expect(named('林夏 / 林夏')).toMatch(/"English \/ 中文"/)
    expect(named('Lin Xia / 林夏', 'mia')).toMatch(/made from the English name/)
  })

  it('keeps a name the client wrote exactly: "顾言" is not "顾言筠"', () => {
    const request = '调香师林夏和地产继承人顾言签下协议'
    const cast = (name: string) => ({ ...bible, clientNames: ['林夏', '顾言'], characters: [{ ...bible.characters[0]!, id: 'lin-xia', name: 'Lin Xia / 林夏' }, { ...bible.characters[1]!, id: 'gu-yan', name }] })
    expect(checkBible(cast('Gu Yan / 顾言'), { episodes: 1, request })).toEqual([])
    const renamed = checkBible({ ...cast('Gu Yansu / 顾言筠'), characters: cast('Gu Yansu / 顾言筠').characters.map((c) => (c.id === 'gu-yan' ? { ...c, id: 'gu-yansu' } : c)) }, { episodes: 1, request }).join(' ')
    expect(renamed).toMatch(/keeps the name exactly/)
    expect(renamed).toMatch(/"顾言筠" renames "顾言"/)
  })

  it('writes a look as cast: the face, never a passing state', () => {
    const tired = { ...bible, characters: [{ ...bible.characters[0]!, look: 'shoulder-length dark hair, tired eyes' }] }
    expect(checkBible(tired, { episodes: 1 }).join(' ')).toMatch(/passing state/)
  })

  it('keeps every line inside one shot and every subtitle inside the line width', () => {
    expect(checkScreenplay(play, bible, { seconds: 15, ratio: '9:16' })).toEqual([])
    const long: Screenplay = { ...play, scenes: [{ ...play.scenes[0]!, lines: [{ speaker: 'mia', en: 'I never thought that after all these years you would actually walk back into this shop.', zh: '我从没想过这么多年以后你真的会再走进这家店。' }] }] }
    const problems = checkScreenplay(long, bible, { seconds: 15, ratio: '9:16' }).join(' | ')
    expect(problems).toContain('split it into two lines')
    expect(problems).toContain('at most 12 on a 9:16 frame')
    expect(problems).toContain('space instead of commas and full stops')
  })

  it('refuses more lines than the running time has shots', () => {
    // One scene with two lines: a shot per line and one without dialogue - 15 seconds, not 10.
    expect(checkScreenplay(play, bible, { seconds: 15, ratio: '16:9' })).toEqual([])
    expect(checkScreenplay(play, bible, { seconds: 10, ratio: '16:9' }).join(' ')).toContain('need 3 shots')
    const crowded: Screenplay = { ...play, scenes: [{ ...play.scenes[0]!, lines: [...play.scenes[0]!.lines, ...play.scenes[0]!.lines] }] }
    expect(checkScreenplay(crowded, bible, { seconds: 15, ratio: '16:9' }).join(' ')).toContain('need 5 shots')
  })

  it('shoots dialogue single: the speaker first, framed close enough to read the mouth, every line once', () => {
    expect(checkShots(shots, play, { seconds: 15 })).toEqual([])
    const twoShot = shots.map((s) => (s.shot === 2 ? { ...s, framing: 'wide', characters: ['mia', 'leo'] } : s))
    const problems = checkShots(twoShot, play, { seconds: 15 }).join(' | ')
    expect(problems).toContain('frames its speaker first')
    expect(problems).toContain('so the mouth reads')
    const missing = shots.map((s) => (s.shot === 3 ? { ...s, line: undefined } : s))
    expect(checkShots(missing, play, { seconds: 15 }).join(' ')).toContain('line 1 has no shot')
  })
})

describe('packaging', () => {
  it('needs three titles, a cover from a real shot and the AI disclosure, and refuses clickbait', () => {
    const good = { titles: ['旧城香水店的重逢', 'She Came Back for the Shop', '一瓶香水碎了 故事开始了'], cover: { shot: 2, text: '他回来了' }, description: '一段关于重逢的微短剧。本视频由 AI 生成。', hashtags: ['#微短剧', '#AI短剧', '#都市爱情'] }
    expect(checkPackaging(good, 3)).toEqual([])
    const problems = checkPackaging({ ...good, titles: ['震惊！他回来了', 'b', 'c'], cover: { shot: 9, text: '他回来了' }, description: '重逢' }, 3).join(' | ')
    expect(problems).toContain('clickbait')
    expect(problems).toContain('cover.shot')
    expect(problems).toContain('AI-generated')
  })
})

describe('bilingual subtitles', () => {
  it('sets Chinese large on top and English small under it, inside the 9:16 safe zone', () => {
    const ass = buildAss([{ start: 0, end: 5, subtitle: '有些事真是一点没变', subtitleEn: 'I guess some things never change.', subtitleStart: 0.4, subtitleEnd: 3 }], 1080, 1920)
    const style = (name: string) => ass.split('\n').find((l) => l.startsWith(`Style: ${name},`))!.split(',')
    const [zhSize, enSize] = [Number(style('Sub')[2]), Number(style('SubEn')[2])]
    expect(zhSize).toBe(59)
    expect(enSize).toBe(Math.round(zhSize * 0.6))
    // MarginV is the last-but-one field: the Chinese sits above the English, and both clear the bottom 25 % of the frame.
    const margin = (name: string) => Number(style(name).at(-2))
    expect(margin('Sub')).toBeGreaterThan(margin('SubEn'))
    expect(margin('SubEn')).toBeGreaterThanOrEqual(1920 * 0.25)
    expect(ass).toContain(',SubEn,,0,0,0,,{\\fad(150,150)}I guess some things never change.')
  })
})

describe('narrative mix', () => {
  it('lays dialogue, ambience, effects and a ducked score into one track of the film length', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mix-'))
    const tone = async (name: string, seconds: number, freq: number) => {
      const path = join(dir, name)
      await exec('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`, path])
      return path
    }
    const output = join(dir, 'mix.wav')
    await mixNarrative({
      totalSeconds: 10,
      dialogue: [{ path: await tone('line.wav', 2, 440), start: 0.4 }, { path: await tone('line2.wav', 2, 550), start: 5.4 }],
      ambience: [{ path: await tone('amb.wav', 3, 120), start: 0, seconds: 10 }],
      effects: [{ path: await tone('fx.wav', 1, 900), start: 5 }],
      music: await tone('music.wav', 12, 220),
      output,
    })
    expect(await probeDuration(output)).toBeCloseTo(10, 0)
  })
})

import { checkReviewEvidence } from '../src/crafts/narrative/writing.js'

describe('compliance findings are grounded in the script', () => {
  const source = 'A perfumer and the heir buying up the street sign a three-month contract.\nWe close tomorrow.\n明天就关门了'
  it('accepts a finding that quotes words on the page, and an approval with none', () => {
    expect(checkReviewEvidence({ approve: false, issues: ['scene 1 line 1: "We close tomorrow" - fine, but tighten'] }, source)).toEqual([])
    expect(checkReviewEvidence({ approve: true, issues: [] }, source)).toEqual([])
  })
  it('sends back findings that quote nothing, or quote words that are not there', () => {
    expect(checkReviewEvidence({ approve: false, issues: ['money worship at series level'] }, source).join(' ')).toMatch(/quote the exact words/)
    expect(checkReviewEvidence({ approve: false, issues: ['series: "rebirth revenge on the rich husband"'] }, source).join(' ')).toMatch(/do not appear/)
    expect(checkReviewEvidence({ approve: false, issues: [] }, source).join(' ')).toMatch(/at least one issue/)
  })
})

import { allocateShots } from '../src/crafts/narrative/writing.js'

describe('scene-by-scene shot allocation', () => {
  const play = (lines: number[], actions: string[]) => ({ episode: 1, title: 't', scenes: lines.map((n, i) => ({ scene: i + 1, heading: 'INT. SHOP - DAY', characters: ['mia'], action: actions[i]!, lines: Array.from({ length: n }, () => ({ speaker: 'mia', en: 'Hi there.', zh: '你好' })) })) })
  it('gives every line a shot, every scene one more, and the rest to the scenes with the most action', () => {
    const counts = allocateShots(play([2, 1, 3], ['a short beat', 'a long sweeping sequence across the whole rain-soaked street at night', 'two people talk']), 12)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(12)
    expect(counts[0]).toBeGreaterThanOrEqual(3)
    expect(counts[1]).toBeGreaterThan(2) // the long action scene takes the spare shots
    expect(counts[2]).toBeGreaterThanOrEqual(4)
  })
  it('refuses an episode whose lines need more shots than its running time holds', () => {
    expect(() => allocateShots(play([5, 5], ['x', 'y']), 10)).toThrow(/12 shots are needed/)
  })
})

import { normalizeSubtitle } from '../src/crafts/narrative/writing.js'

describe('subtitle editor', () => {
  it('replaces commas and full stops with a space, as Chinese subtitles are set', () => {
    expect(normalizeSubtitle('你还是这么毛手毛脚，一点没变。')).toBe('你还是这么毛手毛脚 一点没变')
    expect(normalizeSubtitle('等等！别走')).toBe('等等 别走')
  })
})

import { checkScriptNotes } from '../src/crafts/narrative/writing.js'
import { sceneRange } from '../src/crafts/narrative/checks.js'

describe('script editor', () => {
  const page = 'SCENE 1. INT. PERFUME SHOP - MORNING\nlin-xia: Over my dead body.\ngu-yan: Literal. I like that.'
  const scores = { story: 8, hook: 8, structure: 7, dialogue: 9 }
  it('approves only when every score reaches the floor, and every note quotes the page', () => {
    expect(checkScriptNotes({ approve: true, scores, issues: [] }, page)).toEqual([])
    expect(checkScriptNotes({ approve: true, scores: { ...scores, dialogue: 5 }, issues: [] }, page).join(' ')).toMatch(/every score is 7/)
    expect(checkScriptNotes({ approve: false, scores: { ...scores, dialogue: 4 }, issues: ['"Literal. I like that." - a non-sequitur after a threat'] }, page)).toEqual([])
    expect(checkScriptNotes({ approve: false, scores, issues: ['the dialogue is flat'] }, page).join(' ')).toMatch(/quote the exact words/)
    expect(checkScriptNotes({ approve: true, scores: { story: 8 } as never, issues: [] }, page).join(' ')).toMatch(/"scores" needs/)
  })
})

describe('episode shape', () => {
  it('gives a two-minute episode three to five scenes and keeps a quarter of the shots free of dialogue', () => {
    expect(sceneRange(120)).toEqual({ min: 3, max: 5 })
    expect(sceneRange(60)).toEqual({ min: 1, max: 3 })
    const scene = (n: number, lines: number) => ({ scene: n, heading: 'INT. SHOP - DAY', characters: ['mia', 'leo'], action: 'Mia waits.', lines: Array.from({ length: lines }, (_, i) => ({ speaker: i % 2 ? 'leo' : 'mia', en: 'Not today.', zh: '今天不行' })) })
    const two = { episode: 1, title: 't', scenes: [scene(1, 8), scene(2, 7)] }
    expect(checkScreenplay(two, bible, { seconds: 120, ratio: '9:16' }).join(' ')).toMatch(/write 3 to 5/)
    const crowded = { episode: 1, title: 't', scenes: [scene(1, 7), scene(2, 7), scene(3, 6)] }
    expect(checkScreenplay(crowded, bible, { seconds: 120, ratio: '9:16' }).join(' ')).toMatch(/at most 18/)
    const sparse = { episode: 1, title: 't', scenes: [scene(1, 3), scene(2, 3), scene(3, 2)] }
    expect(checkScreenplay(sparse, bible, { seconds: 120, ratio: '9:16' }).join(' ')).toMatch(/at least 12/)
    const split = { episode: 1, title: 't', scenes: [scene(1, 6), scene(2, 6), { ...scene(3, 4), heading: 'EXT. LANE - NIGHT' }] }
    expect(checkScreenplay(split, bible, { seconds: 120, ratio: '9:16' }).join(' ')).toMatch(/scene 2: same place and time as scene 1/)
    const mixed = { episode: 1, title: 't', scenes: [{ ...scene(1, 1), lines: [{ speaker: 'mia', en: 'I do not do favors.', zh: '我不给地产商做 favor' }, { speaker: 'leo', en: 'Ask the AI.', zh: '问问 AI' }] }] }
    const mixedProblems = checkScreenplay(mixed, bible, { seconds: 15, ratio: '9:16' }).join(' ')
    expect(mixedProblems).toMatch(/mixes in English \("favor"\)/)
    expect(mixedProblems).not.toMatch(/"AI"/)
    const stiff = { episode: 1, title: 't', scenes: [{ ...scene(1, 6), lines: ['I am buying the lane.', 'I do not sell.', 'You do not fall for me.', 'Not today.', 'Not today.', 'Not today.'].map((en, i) => ({ speaker: i % 2 ? 'leo' : 'mia', en, zh: '今天不行' })) }, { ...scene(2, 6), heading: 'EXT. LANE - DUSK' }, scene(3, 4)] }
    expect(checkScreenplay(stiff, bible, { seconds: 120, ratio: '9:16' }).join(' ')).toMatch(/3 lines avoid contractions/)
    const good = { episode: 1, title: 't', scenes: [scene(1, 6), { ...scene(2, 6), heading: 'EXT. LANE - DUSK' }, scene(3, 4)] }
    expect(checkScreenplay(good, bible, { seconds: 120, ratio: '9:16' })).toEqual([])
  })
})

import { premiseFindingProblems, unchangedFindings } from '../src/crafts/narrative/writing.js'

describe('premise revision', () => {
  it('is answered only when every passage a finding quotes is gone', () => {
    const issues = ['"顾言在走廊里把林夏拉到一边" - reads as coercion']
    expect(unchangedFindings(issues, '顾言在走廊里把林夏拉到一边，低声说话')).toHaveLength(1)
    expect(unchangedFindings(issues, '顾言在走廊尽头停下，等林夏先开口')).toEqual([])
  })

  it("never removes the client's own premise, and sends back a finding that judges only it", () => {
    const request = '林夏和顾言签下三个月的"假恋爱"协议'
    expect(unchangedFindings(['"三个月假恋爱协议" - distorted view of love'], '林夏签下三个月假恋爱协议', request)).toEqual([])
    expect(premiseFindingProblems({ approve: false, issues: ['"三个月假恋爱协议" - distorted view of love'] }, request).join(' ')).toMatch(/client's own premise/)
    expect(premiseFindingProblems({ approve: false, issues: ['"顾言低声说这条街迟早会是他的" - wealth as a weapon'] }, request)).toEqual([])
  })
})

import { premiseObjections } from '../src/crafts/narrative/writing.js'

describe('episode compliance judges execution, not the cleared premise', () => {
  it('sends back a finding against the contract relationship itself, and keeps one about a threat on screen', () => {
    const premise = 'scene 1 line 6: "三个月 你当我女友" - a contract girlfriend demanded by the wealthier party is a coercive, unequal premise presented as romance'
    const staged = 'scene 2 line 4: "够应付家族就行" - the fake relationship staged for the family treats love as a transaction'
    const threat = 'scene 1 line 5: "Sign, or the shop is gone" - the fake relationship is forced on her with a threat'
    expect(premiseObjections({ approve: false, issues: [premise, staged] })).toHaveLength(2)
    expect(premiseObjections({ approve: false, issues: [threat] })).toEqual([])
  })
})
