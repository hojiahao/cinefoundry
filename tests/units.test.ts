import { describe, expect, it } from 'vitest'
import { renderWorkflow } from '../src/comfy/workflow.js'
import { parseArgs } from '../src/lib/args.js'
import { scanCopy } from '../src/lib/compliance.js'
import { nativeSize, videoSize } from '../src/lib/media.js'
import { parseMeminfo, planMemory } from '../src/lib/memory.js'
import { buildShots } from '../src/lib/shots.js'
import { extractJson } from '../src/lib/vision.js'
import { checkRepairedPrompt, checkStoryboard, composeImagePrompt, composeVideoNegative, styleConflicts } from '../src/agent/checks.js'

describe('compliance scan', () => {
  it('blocks absolute terms and guarantees, and does not double count "100%"', () => {
    const findings = scanCopy('全网第一的咖啡，100%天然，喝了永不发胖。', 'food')
    expect(findings.map((finding) => finding.text)).toEqual(['全网第一', '100%', '永不'])
    expect(findings.every((finding) => finding.severity === 'block')).toBe(true)
  })
  it('applies medical wording rules to cosmetics but not to medical ads', () => {
    expect(scanCopy('医学级修复', 'cosmetics').map((finding) => finding.rule)).toContain('medical_claim')
    expect(scanCopy('医学级修复', 'medical')).toEqual([])
  })
  it('flags efficacy and data claims for review, with line numbers', () => {
    const findings = scanCopy('清爽上市\n美白祛斑，好评率98%', 'cosmetics')
    expect(findings.every((finding) => finding.severity === 'review' && finding.line === 2)).toBe(true)
    expect(findings.map((finding) => finding.text)).toEqual(['美白', '祛斑', '好评率', '98%'])
  })
  it('passes clean copy', () => expect(scanCopy('冷萃醇香，0糖0脂，清晨慢饮。', 'food')).toEqual([]))
})

describe('shots', () => {
  it('merges cuts closer than the minimum shot length', () => {
    expect(buildShots([2, 2.1, 5], 6.5, 0.4)).toEqual([[0, 2], [2, 5], [5, 6.5]])
    expect(buildShots([], 3, 0.4)).toEqual([[0, 3]])
    expect(buildShots([2.9], 3, 0.4)).toEqual([[0, 3]])
  })
})

describe('media sizing', () => {
  it('keeps aspect, stays in the native budget and aligns to 16', () => {
    const [width, height] = nativeSize(2160, 3840)
    expect(width * height).toBeLessThanOrEqual(1328 * 1328)
    expect(width % 16).toBe(0)
    expect(height % 16).toBe(0)
    expect(Math.abs(width / height - 9 / 16)).toBeLessThan(0.02)
    expect(nativeSize(1024, 1024)).toEqual([1024, 1024])
  })
  it('maps resolution and ratio to Wan sizes', () => {
    expect(videoSize('720p', '9:16')).toEqual([704, 1280])
    expect(() => videoSize('4k', '16:9')).toThrow(/Unsupported/)
  })
})

describe('workflow rendering', () => {
  it('keeps numeric types for whole placeholders and drops comments', () => {
    const graph = renderWorkflow({ _comment: 'x', '1': { class_type: 'A', inputs: { width: '{{width}}', text: 'say {{prompt}}!' } } }, { width: 512, prompt: '你好' })
    expect(graph).toEqual({ '1': { class_type: 'A', inputs: { width: 512, text: 'say 你好!' } } })
  })
  it('fails loudly on a missing value', () => expect(() => renderWorkflow({ a: '{{nope}}' }, {})).toThrow(/nope/))
})

describe('memory', () => {
  const status = parseMeminfo('MemTotal:       127600000 kB\nMemAvailable:   114300000 kB\nSwapTotal:  8000000 kB\nSwapFree:  8000000 kB\n')
  it('parses /proc/meminfo into GiB', () => expect(status).toEqual({ totalGb: 121.7, availableGb: 109, swapUsedGb: 0 }))
  it('checks a plan against the budget', () => {
    expect(planMemory(status, { nemotron: 30, stepvl: 20, comfyui: 45 }, 10, 'total')).toMatchObject({ fits: true, headroomGb: 16.7 })
    expect(planMemory(status, { step37: 116 }, 10, 'total').fits).toBe(false)
  })
})

describe('helpers', () => {
  it('parses flags, repeats and switches', () => {
    const args = parseArgs(['init', '--id', 'a', '--ref=x.png', '--ref', 'y.png', '--keep-loaded'])
    expect(args.positionals).toEqual(['init'])
    expect(args.flags.get('ref')).toEqual(['x.png', 'y.png'])
    expect(args.flags.get('keep-loaded')).toEqual(['true'])
  })
  it('extracts JSON from a fenced model reply', () => {
    expect(extractJson('好的：\n```json\n{"pass": false, "score": 40, "issues": ["logo warped"]}\n```')).toEqual({ pass: false, score: 40, issues: ['logo warped'] })
  })
})

import { checkScript, checkStoryboard, spokenLength, type Brief, type Script } from '../src/agent/checks.js'

describe('skill checks (shared by the director and the evals)', () => {
  const brief = { id: 'coffee', title: '冷萃咖啡', product: 'canned cold brew coffee', category: 'food', audience: 'students', message: '0糖也有醇香', ratio: '9:16', durationSeconds: 15, tone: 'fresh', brandText: '拾豆' } as Brief
  const beat = (n: number, vo: string, zh: string, text = '') => ({ beat: n, job: 'hook', see: 'a can on ice', vo, zh, text })
  const good: Script = { structure: 'sensory close-ups -> reveal', beats: [beat(1, 'Ice cracks, and the morning opens with a hiss.', '冰块轻响 清晨开罐'), beat(2, 'Zero sugar. Every note still there.', '零糖 风味一点不少'), beat(3, 'Take a cold sip, then go.', '先冰一口 再出发', '冰一口')] }

  it('accepts a script that follows the skill', () => expect(checkScript(good, brief)).toEqual([]))
  it('counts spoken characters without punctuation', () => expect(spokenLength('咖啡飘香，清晨开始！')).toBe(8))
  it('rejects the wrong beat count, long voiceover and restricted wording', () => {
    const problems = checkScript({ structure: 'x', beats: [beat(1, 'This line runs far too long for five seconds because it keeps going and going without a breath', '太长了'), beat(2, 'The best coffee in the world.', '全网第一的咖啡')] }, brief)
    expect(problems.some((problem) => problem.includes('exactly 3 beats'))).toBe(true)
    expect(problems.some((problem) => problem.includes('at most 13'))).toBe(true)
    expect(problems.some((problem) => problem.includes('全网第一'))).toBe(true)
    // Absolute claims are restricted in English too.
    expect(problems.some((problem) => /"the best"/i.test(problem))).toBe(true)
  })
  it('requires the style line verbatim, English prompts and one camera move', () => {
    const style = 'soft morning light, 50mm'
    const shot = { shot: 1, seconds: 5, framing: 'close-up', camera: 'slow push-in', image_prompt: `A can labelled "拾豆" on ice, ${style}`, video_prompt: 'Slow push-in.', on_screen_text: '', must_show: 'the can' }
    const script3 = { ...good, beats: [good.beats[0]!] }
    expect(checkStoryboard({ style, product: 'a slim aluminium can with a dark brown band that reads "拾豆"', shots: [shot] }, script3, brief)).toEqual([])
    expect(checkStoryboard({ style, product: 'a slim aluminium can with a dark brown band that reads "拾豆"', shots: [shot] }, script3, { brandText: '雾岸', product: 'woody perfume' })).toHaveLength(2)
    const bad = { ...shot, camera: 'push-in then pan', image_prompt: '一罐冷萃咖啡' }
    const problems = checkStoryboard({ style, product: "a can", shots: [bad] }, script3)
    expect(problems).toHaveLength(2)
  })
})

import { composeImagePrompt, composeProductPrompt, sanitizeStyle } from '../src/agent/checks.js'
import { clipStart, filmLength } from '../src/lib/ffmpeg.js'
import { buildAss } from '../src/lib/titles.js'

describe('prompt composition and finishing', () => {
  const storyboard = { style: 'soft morning light, 50mm, f/2.8, shallow depth of field, 4k', product: 'a slim silver can whose label reads "拾豆".', shots: [] }
  const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'slow push-in', image_prompt: 'Macro of the product on crushed ice.', video_prompt: 'x', on_screen_text: '', must_show: 'the can' }

  it('strips lens specs that the image model would paint as text', () => {
    expect(sanitizeStyle(storyboard.style)).toBe('soft morning light, shallow depth of field')
  })
  it('anchors reference shots to image 1 and always forbids stray text', () => {
    const anchored = composeImagePrompt(shot, storyboard, true)
    expect(anchored).toContain('exactly as in image 1')
    expect(anchored).not.toContain('50mm')
    expect(anchored).toMatch(/no lettering anywhere except the label/)
    expect(composeImagePrompt(shot, storyboard)).toContain('The product: a slim silver can')
    expect(composeProductPrompt(storyboard)).toMatch(/^Studio product photograph of a slim silver can/)
  })
  it('places clips and titles on the crossfaded timeline', () => {
    expect(clipStart(2, [5, 5, 5, 3], 0.4)).toBeCloseTo(9.2)
    expect(filmLength([5, 5, 5, 3], 0.4)).toBeCloseTo(16.8)
    const ass = buildAss([{ start: 4.6, end: 9.6, title: '0糖', subtitle: '醇香更足{\\b1}' }], 1080, 1920)
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toMatch(/Dialogue: 1,0:00:05\.10,0:00:09\.20,Title/)
    expect(ass).toContain('醇香更足b1') // override tags from model text are neutralised
  })
})

import { captionProblems } from '../src/agent/checks.js'

describe('captions', () => {
  it('accepts ordinary Chinese ad copy', () => {
    expect(captionProblems('vo', '第一口下去，冰凉满口', false)).toEqual([])
    expect(captionProblems('title', '0糖', true)).toEqual([])
  })
  it('rejects emoji, replacement characters, doubled or half-width punctuation and a title ending in a full stop', () => {
    expect(captionProblems('vo', '醇香一杯☕', false)[0]).toMatch(/must not appear on screen/)
    expect(captionProblems('vo', '醇香�一杯', false)).toHaveLength(1)
    expect(captionProblems('vo', '太爽了！！', false)[0]).toMatch(/repeated or half-width/)
    expect(captionProblems('vo', '醇香,一杯', false)[0]).toMatch(/must not appear|half-width/)
    expect(captionProblems('title', '清爽。', true)[0]).toMatch(/no closing punctuation/)
  })
})

import { statedFormat } from '../src/agent/harness.js'

describe('stated format wins over the intake agent', () => {
  it('reads 横版 / 竖版 and a duration from the request', () => {
    expect(statedFormat('给“雾岸”香水做一条 15 秒横版广告')).toEqual({ ratio: '16:9', durationSeconds: 15 })
    expect(statedFormat('20 秒竖版种草视频')).toEqual({ ratio: '9:16', durationSeconds: 20 })
    expect(statedFormat('一条广告')).toEqual({ ratio: undefined, durationSeconds: undefined })
  })
})

describe('lenient JSON extraction', () => {
  it('repairs trailing commas and typographic quotes', () => {
    expect(extractJson('{"a": [1, 2,], "b": {"c": 1,},}')).toEqual({ a: [1, 2], b: { c: 1 } })
    expect(extractJson('{“k”: “v”}')).toEqual({ k: 'v' })
  })
})

describe('storyboard must describe this brief\'s product', () => {
  const style = 'soft light'
  const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'push-in', image_prompt: 'the product on a table', video_prompt: 'Static.', on_screen_text: '', must_show: 'the bottle' }
  const script = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: 'One drop, and cedar fills the room.', text: '雾岸' }] }
  it('rejects the skill example copied in place of a perfume', () => {
    const copied = checkStoryboard({ style, product: 'a slim matte-silver aluminium can with a dark brown band whose label reads "拾豆"', shots: [shot] }, script, { brandText: '雾岸', product: 'woody perfume' })
    expect(copied.some((p) => p.includes('does not mention "雾岸"'))).toBe(true)
    expect(copied.some((p) => p.includes('example from the skill'))).toBe(true)
    expect(checkStoryboard({ style, product: 'a heavy faceted glass bottle with a dark wood cap whose label reads "雾岸"', shots: [shot] }, script, { brandText: '雾岸', product: 'woody perfume' })).toEqual([])
  })
})

describe('product-consistency heuristic', () => {
  it('flags a can for a perfume but not an aluminium camera', () => {
    const script1 = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: '快门落下，银色机身微凉', text: '快门' }] }
    const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'push-in', image_prompt: 'Macro of the product', video_prompt: 'Push-in.', on_screen_text: '', must_show: 'the product' }
    expect(checkStoryboard({ style: 's', product: 'a silver and black aluminium retro digital camera with a "银隼" plate', shots: [shot] }, script1, { brandText: '银隼', product: 'retro digital camera' })).toEqual([])
    expect(checkStoryboard({ style: 's', product: 'a slim aluminium can with a dark band that reads "雾岸"', shots: [shot] }, script1, { brandText: '雾岸', product: 'woody perfume' })).toHaveLength(1)
  })
})

describe('bilingual voiceover', () => {
  const brief = { id: 'c', title: 't', product: 'coffee', category: 'food', audience: 'a', message: 'm', ratio: '16:9', durationSeconds: 15, tone: 'warm', brandText: '拾豆' } as Brief
  const beats = [{ beat: 1, job: 'hook', see: 'x', vo: 'The alarm stops. The kettle starts.', zh: '闹钟停了 水壶响了', text: '拾豆' }, { beat: 2, job: 'payoff', see: 'y', vo: 'The first sip, still warm.', zh: '第一口 还温热', text: '第一口' }, { beat: 3, job: 'cta', see: 'z', vo: 'Mornings, made just right.', zh: '清晨 刚刚好', text: '拾豆' }]
  it('speaks English and subtitles in Chinese', () => expect(checkScript({ structure: 's', beats }, brief)).toEqual([]))
  it('rejects Chinese in the English line, a missing subtitle, stock ad-speak and a subtitle with full stops', () => {
    const problems = checkScript({ structure: 's', beats: [{ ...beats[0]!, vo: '闹钟停了，水壶响了。' }, { ...beats[1]!, zh: '' }, { ...beats[2]!, vo: 'Elevate your mornings like never before.', zh: '清晨，刚刚好。' }] }, brief).join(' | ')
    expect(problems).toMatch(/the Chinese goes in "zh"/)
    expect(problems).toMatch(/"zh" must be the Chinese subtitle/)
    expect(problems).toMatch(/stock ad-speak/)
    expect(problems).toMatch(/space instead of commas/)
  })
  it('narrows the subtitle on a vertical frame', () => {
    const long = { ...beats[0]!, zh: '闹钟停了以后厨房里的水壶慢慢响了' }
    expect(checkScript({ structure: 's', beats: [long, beats[1]!, beats[2]!] }, { ...brief, ratio: '16:9' }).join(' ')).not.toMatch(/at most 12/)
    expect(checkScript({ structure: 's', beats: [long, beats[1]!, beats[2]!] }, { ...brief, ratio: '9:16' }).join(' ')).toMatch(/at most 12 on a 9:16 frame/)
  })
})

describe('title matches the product form', () => {
  const beats = (text: string) => [{ beat: 1, job: 'hook', see: 'x', vo: 'Evening light, and the scent of cedar.', zh: '暮光落下 雪松香起', text }, { beat: 2, job: 'proof', see: 'y', vo: 'One spray, and the room changes.', zh: '轻轻一喷 满室木香', text: '一喷' }, { beat: 3, job: 'payoff', see: 'z', vo: 'Warm on the wrist, calm inside.', zh: '腕间温热 心里安静', text: '安静' }]
  const brief = (product: string) => ({ id: 'c', title: 't', product, category: 'general', audience: 'a', message: 'm', ratio: '16:9', durationSeconds: 15, tone: 'warm', brandText: '雾岸' } as Brief)
  it('rejects a can title on a perfume, the example copied from the skill', () => {
    const problems = checkScript({ structure: 's', beats: beats('开罐') }, brief('woody perfume'))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/container/)
  })
  it('accepts a can title on a drink, whose can the brief need not mention', () => {
    expect(checkScript({ structure: 's', beats: beats('开罐') }, brief('iced coffee drink'))).toEqual([])
    expect(checkScript({ structure: 's', beats: beats('开罐') }, brief('罐装咖啡'))).toEqual([])
    expect(checkScript({ structure: 's', beats: beats('暮光') }, brief('woody perfume'))).toEqual([])
  })
})

import { checkBrief, industryOf, photoLettering } from '../src/agent/checks.js'

describe('category playbooks in the storyboard check', () => {
  const script3 = { structure: 's', beats: [1, 2, 3].map((beat) => ({ beat, job: 'hook', see: 'x', vo: '降噪开启，世界安静', text: '安静' })) }
  const shot = (n: number, extra: Partial<Record<string, string>> = {}) => ({ shot: n, seconds: 5, framing: ['macro', 'medium', 'wide'][n - 1]!, camera: ['slow push-in', 'slow orbit', 'slow pull-back'][n - 1]!, image_prompt: 'the product on a dark reflective table, cool rim light', video_prompt: 'light sweeps across the case. No people and no hands enter the frame', on_screen_text: '', must_show: 'the product on the table', ...extra })
  const earbuds = { brandText: 'LUMO', product: 'wireless earbuds' }
  const board = (shots: any[]) => ({ style: 'dark studio, cool tones', product: 'a matte white wireless earbuds case with a small "LUMO" badge', shots })
  it('reads the industry from the product', () => {
    expect(industryOf('retro digital camera')).toBe('electronics')
    expect(industryOf('palm-sized gold mini PC')).toBe('computing')
    expect(industryOf('精品咖啡')).toBe('drink')
    expect(industryOf('护肤精华')).toBe('skincare')
    // 面 (noodles) used to match 桌面 (desktop): a desktop computer was shot as food.
    expect(industryOf('ATLAS 桌面AI工作站')).toBe('computing')
    expect(industryOf('桌面音箱')).toBe('electronics')
    expect(industryOf('a desktop workstation with one GPU')).toBe('computing')
    expect(industryOf('wireless earbuds')).toBe('electronics')
    expect(industryOf('方便面')).toBe('food')
    expect(industryOf('乌龙茶')).toBe('drink')
    expect(industryOf('米色保温杯')).toBe('general')
    expect(industryOf('实木茶几')).toBe('general')
    expect(industryOf('steam iron')).toBe('general')
  })
  it('checks the brief\'s industry and brand lettering', () => {
    const brief = { id: 'x-1', title: 't', product: 'p', category: 'general', audience: 'a', message: '桌上工作站', ratio: '16:9', durationSeconds: 15, tone: 't', brandText: 'ATLAS', industry: 'computing' } as const
    expect(checkBrief({ ...brief })).toEqual([])
    // The intake agent wrote the message in English and it went onto a Chinese end card.
    expect(checkBrief({ ...brief, message: 'AI compute on your desk' })).toEqual([expect.stringMatching(/must be in Chinese/)])
    expect(checkBrief({ ...brief, industry: undefined })).toEqual([expect.stringMatching(/^industry must be one of/)])
    expect(checkBrief({ ...brief, brandText: '拾豆精品咖啡' })).toEqual([expect.stringMatching(/too long/)])
    expect(checkBrief({ ...brief, brandText: 'ABCDEFGHIJKLM' })).toEqual([expect.stringMatching(/too long/)])
  })
  it('reads the quoted lettering off a photo description', () => {
    expect(photoLettering('a dark grey grand tourer; the "VORSA" badge and the VORSA crest sit on the grille')).toEqual(['VORSA'])
    expect(photoLettering('a heavy faceted glass bottle with a label printed with “雾岸” and "雾岸"')).toEqual(['雾岸'])
    expect(photoLettering('no lettering is visible')).toEqual([])
  })
  it('accepts a varied electronics storyboard', () => {
    expect(checkStoryboard(board([shot(1), shot(2), shot(3)]), script3, earbuds)).toEqual([])
  })
  it('rejects rainbow lighting the brief did not ask for, hands seen from above, and screen content', () => {
    const problems = checkStoryboard(board([shot(1, { image_prompt: 'the product with rainbow RGB underglow' }), shot(2, { image_prompt: 'top-down view of hands opening the product' }), shot(3, { must_show: 'a cursor moving on the screen' })]), script3, earbuds)
    expect(problems.some((p) => /rainbow/.test(p))).toBe(true)
    expect(problems.some((p) => /from above/.test(p))).toBe(true)
    expect(problems.some((p) => /screen or interface/.test(p))).toBe(true)
  })
  it('rejects two shots with the same framing and camera move, wherever they sit', () => {
    const problems = checkStoryboard(board([shot(1), shot(2), shot(3, { framing: 'macro', camera: 'slow push-in' })]), script3, earbuds)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/same framing and camera move/)
  })
  it('rejects hands in more than one shot, motion in must_show, and a Chinese style line', () => {
    const problems = checkStoryboard({ ...board([shot(1, { image_prompt: 'a finger taps the product, no people' }), shot(2, { image_prompt: 'hands lifting the product from a low side angle' }), shot(3, { must_show: 'earbuds glowing row by row' })]), style: '暗调，冷色' }, script3, earbuds)
    expect(problems.some((p) => /hands or fingers appear in 2 shots/.test(p))).toBe(true)
    expect(problems.some((p) => /decide one/.test(p))).toBe(true)
    expect(problems.some((p) => /describes motion/.test(p))).toBe(true)
    expect(problems.some((p) => /style must be in English/.test(p))).toBe(true)
  })
})

import { serviceRoot, isSleeping } from '../src/lib/rest.js'

describe('resting the language models', () => {
  it('derives the vLLM control root from the OpenAI base url', () => {
    expect(serviceRoot('http://127.0.0.1:8001/v1')).toBe('http://127.0.0.1:8001')
    expect(serviceRoot('http://127.0.0.1:8001/v1/')).toBe('http://127.0.0.1:8001')
  })
  it('treats a server without sleep mode as one to leave alone', async () => {
    expect(await isSleeping('http://127.0.0.1:1/v1')).toBeUndefined()
  })
})

describe('the product line is painted into the hero still', () => {
  const script1 = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: '一口下去，醇香在舌尖化开', text: '醇香' }] }
  const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'slow push-in', image_prompt: 'the product on crushed ice', video_prompt: 'mist drifts. No people and no hands enter the frame', on_screen_text: '', must_show: 'the product upright' }
  it('rejects Chinese outside the quoted label text', () => {
    const problems = checkStoryboard({ style: 's', product: '冷萃咖啡, tall slim can, matte white, label "拾豆" in brown', shots: [shot] }, script1, { brandText: '拾豆', product: 'canned cold brew coffee' })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/English except the label text/)
    expect(checkStoryboard({ style: 's', product: 'a tall slim matte white can whose label reads "拾豆" in brown', shots: [shot] }, script1, { brandText: '拾豆', product: 'canned cold brew coffee' })).toEqual([])
  })
})

describe('the request decides what the product looks like', () => {
  const script1 = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: '一口下去，醇香在舌尖化开', text: '醇香' }] }
  const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'slow push-in', image_prompt: 'the product on crushed ice', video_prompt: 'mist drifts. No people and no hands enter the frame', on_screen_text: '', must_show: 'the product upright' }
  const brief = { brandText: '拾豆', product: 'canned cold brew coffee', appearance: '银色铝罐，深棕色标签上有白色书法字“拾豆”' }
  it('rejects a bottle when the request said a can', () => {
    const problems = checkStoryboard({ style: 's', product: 'a clear glass bottle whose label reads "拾豆"', shots: [shot] }, script1, brief)
    expect(problems.some((p) => /must be a can/.test(p))).toBe(true)
    expect(problems.some((p) => /aluminium in the request/.test(p))).toBe(true)
    expect(checkStoryboard({ style: 's', product: 'a slim silver aluminium can with a dark brown label that reads "拾豆" in white brush script', shots: [shot] }, script1, brief)).toEqual([])
  })
  it('rejects the template words "in quotes"', () => {
    expect(checkStoryboard({ style: 's', product: 'a silver aluminium can, label text "拾豆" in quotes', shots: [shot] }, script1, brief)).toHaveLength(1)
  })
})

describe('gateFailure', () => {
  it('tells a spent token budget from an answer without JSON and from a transport error', async () => {
    const { gateFailure } = await import('../src/agent/gate.js')
    const { JsonReplyError } = await import('../src/agent/llm.js')
    expect(gateFailure(new JsonReplyError('no JSON', 170, 3000, 'length'))).toMatchObject({ cause: 'budget', completionTokens: 3000, seconds: 170 })
    expect(gateFailure(new JsonReplyError('no JSON', 40, 800, 'stop'))).toMatchObject({ cause: 'unparsable', finishReason: 'stop' })
    expect(gateFailure(new Error('step3-vl returned 500: oops'))).toMatchObject({ cause: 'transport' })
  })
})

describe('product photo conflicts', () => {
  const photo = { description: 'A low flat box with a gold metal-foam front and a small "ATLAS" badge.' }

  it('flags a style line that repaints the product', () => {
    const style = styleConflicts('professional cool rim light on cool-toned metal, pale palette, smooth texture', photo)
    expect(style.some((problem) => problem.includes('"smooth"'))).toBe(true)
    expect(style.some((problem) => problem.includes('cool-toned metal'))).toBe(true)
  })

  it('leaves light, background, placement and finishes the photo shows to the storyboard', () => {
    expect(styleConflicts('cool rim light, dark studio, foam texture catching the light', photo)).toEqual([])
    expect(styleConflicts('smooth gradients', undefined)).toEqual([])
    const script = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'the box standing upright on a desk', vo: '桌上本地推理', text: '桌上' }] }
    const storyboard = {
      style: 'cool rim light, dark studio', product: 'a flat gold box with a foam front and an "ATLAS" badge',
      shots: [{ shot: 1, seconds: 5, framing: 'wide', camera: 'slow push-in', image_prompt: 'the unit standing upright on a desk', video_prompt: 'Slow push-in.', on_screen_text: '', must_show: 'the unit on a desk' }],
    }
    expect(checkStoryboard(storyboard, script, { brandText: 'ATLAS', product: 'ATLAS One', photo }).filter((problem) => problem.includes('photo'))).toEqual([])
    expect(checkStoryboard({ ...storyboard, style: 'cool rim light, smooth texture' }, script, { brandText: 'ATLAS', product: 'ATLAS One', photo }).filter((problem) => problem.includes('photo'))).toHaveLength(1)
  })
})

describe('frame prompt repairs and second objects (canned cold brew, shot 3)', () => {
  const storyboard = { style: 'cinematic macro, cool tones', product: 'a silver aluminum can with a dark brown label that reads "拾豆"', shots: [] }
  const shot = {
    shot: 3, seconds: 5, framing: 'wide', camera: 'slow pull-back', video_prompt: 'Slow pull-back.', on_screen_text: '',
    image_prompt: 'wide shot of the silver aluminum can with dark brown label bearing white Chinese calligraphy "拾豆" standing on a condensation-beaded surface, iced coffee swirling faintly inside a poured glass',
    must_show: 'the silver aluminum can with dark brown label on a condensation-beaded surface, iced coffee in a poured glass',
  }
  const previous = composeImagePrompt(shot, storyboard, true, 'drink')
  const tail = previous.slice(previous.indexOf('Image 1 is the product'))

  it('uses the original reference sentence', () => {
    expect(previous).toContain('Image 1 is the product: keep its shape, proportions, colours, material and label exactly as in image 1.')
  })

  it('rejects the repairs that broke the frame: a changed framing, the can inside the glass, an escaped label', () => {
    const closeUp = `close-up shot of the silver aluminum can with dark brown label bearing white Chinese calligraphy "拾豆", positioned in a poured glass. ${tail}`
    expect(checkRepairedPrompt(previous, closeUp)).toEqual([expect.stringContaining('framing is "wide", not "close-up"')])
    const escaped = `Wide shot of a silver aluminum can with dark brown label and white Chinese calligraphy "\\u62fe\\u8c46" beside a poured glass. ${tail}`
    const problems = checkRepairedPrompt(previous, escaped)
    expect(problems.some((p) => p.includes('escape sequence'))).toBe(true)
    expect(problems.some((p) => p.includes('"拾豆"'))).toBe(true)
    expect(checkRepairedPrompt(previous, 'Wide shot of the can "拾豆" beside a glass.')).toEqual([expect.stringContaining('word for word')])
    expect(checkRepairedPrompt(previous, `Wide shot of the can with the label "拾豆" on wet slate, a poured glass of iced coffee to its right. ${tail}`)).toEqual([])
  })

  it('asks must_show to place a second object, and lends that placement to an image prompt without one', () => {
    const script1 = { title: 't', beats: [{ beat: 1, vo: 'x', text: '', see: 'x' }] } as never
    const second = (shots: typeof shot[]) => checkStoryboard({ ...storyboard, shots }, script1).filter((p) => p.includes('second object'))
    expect(second([shot])).toHaveLength(1)
    const placed = { ...shot, must_show: 'the can, and a glass of iced coffee to the right of the can' }
    expect(second([placed])).toEqual([])
    expect(composeImagePrompt(placed, storyboard, true, 'drink')).toContain('. In the picture: the can, and a glass of iced coffee to the right of the can. Image 1 is the product')
    const both = { ...placed, image_prompt: 'wide shot of the can "拾豆" on a wet surface, a poured glass to the right of the can' }
    expect(composeImagePrompt(both, storyboard, true, 'drink')).not.toContain('In the picture')
    expect(second([{ ...shot, image_prompt: 'wide shot of the can "拾豆" on a glass table', must_show: 'the can on a glass table' }])).toEqual([])
  })
})

import { faithfulLabel, statedTagline } from '../src/agent/harness.js'

describe('a camera is not a keyboard', () => {
  const brief = { id: 'd', title: '银隼相机', product: 'retro digital camera', category: 'general', audience: 'street photographers', message: '把街头装进口袋', ratio: '16:9', durationSeconds: 15, tone: 'night', brandText: '银隼', industry: 'electronics' } as Brief
  const beats = (zh: string, text: string) => [{ beat: 1, job: 'hook', see: 'x', vo: 'Late at night, the street is still awake.', zh: '深夜 街角还亮着一盏灯', text: '口袋里的银隼' }, { beat: 2, job: 'proof', see: 'y', vo: 'One press, and the moment holds still.', zh, text }, { beat: 3, job: 'payoff', see: 'z', vo: 'A whole city in one silver frame.', zh: '一格取景 装下整座城', text: '整座城' }]
  it('rejects switch and keycap copy on a camera, the skill\'s keyboard example copied', () => {
    const problems = checkScript({ structure: 's', beats: beats('指尖落下 红轴一声轻响', '红轴轻响') }, brief)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/belongs to a keyboard/)
  })
  it('accepts copy about what the camera does, and switch copy on a keyboard', () => {
    expect(checkScript({ structure: 's', beats: beats('快门落下 街景就此定格', '街景定格') }, brief)).toEqual([])
    expect(checkScript({ structure: 's', beats: beats('指尖落下 红轴一声轻响', '红轴轻响') }, { ...brief, product: 'mechanical keyboard', industry: 'electronics' })).toEqual([])
  })
  it('reads the closing line the request quotes', () => {
    expect(statedTagline('镜头拉远，深灰色GT驶上海岸公路。字幕：“VORSA，把每一段远路都开成回家的路。” 启动 harness')).toBe('VORSA，把每一段远路都开成回家的路')
    expect(statedTagline('结尾口号「雾散了，香还在」')).toBe('雾散了，香还在')
    expect(statedTagline('精品咖啡，15 秒竖版')).toBeUndefined()
    expect(statedTagline('海岸公路在晨雾里展开。字幕：VORSA，把每一段远路都开成回家的路。')).toBe('VORSA，把每一段远路都开成回家的路')
    expect(statedTagline('海岸公路在晨雾里展开。字幕："VORSA，把每一段远路都开成回家的路。')).toBe('VORSA，把每一段远路都开成回家的路')
  })
  it('shrinks a long closing line to fit a portrait end card', () => {
    const ass = buildAss([{ start: 0, end: 3, title: '', subtitle: '', closing: 'VORSA，把每一段远路都开成回家的路' }], 1080, 1920)
    expect(ass).toMatch(/\\fs\d+\\fsp\d+\}VORSA/)
    expect(buildAss([{ start: 0, end: 3, title: '', subtitle: '', closing: 'VORSA，把每一段远路都开成回家的路' }], 1920, 1080)).not.toMatch(/\\fs\d+/)
  })
})

describe('computer shots', () => {
  const script3 = { structure: 's', beats: [1, 2, 3].map((beat) => ({ beat, job: 'hook', see: 'x', vo: '回车落下，大模型本地作答', text: '本地作答' })) }
  const brief = { brandText: 'ATLAS', product: 'palm-sized gold mini PC', industry: 'computing' as const }
  const shot = (n: number, extra: Partial<Record<string, string>> = {}) => ({ shot: n, seconds: 5, framing: ['macro', 'medium', 'wide'][n - 1]!, camera: ['slow push-in', 'slow orbit', 'slow pull-back'][n - 1]!, image_prompt: 'the product on a dark desk at night', video_prompt: 'slow move, the product stays still', on_screen_text: '', must_show: 'the product on the desk', ...extra })
  const board = (shots: any[], style = 'late-night desk, warm rim light') => ({ style, product: 'a gold mini PC with an "ATLAS" badge', shots })
  it('rejects what a screen shows, an unplaced monitor and a hand that is also "no hands"', () => {
    expect(checkStoryboard(board([shot(1), shot(2, { image_prompt: 'the product, screen illuminates showing running 2000B parameter model' }), shot(3)]), script3, brief)).toEqual(expect.arrayContaining([expect.stringMatching(/what a screen shows/)]))
    expect(checkStoryboard(board([shot(1), shot(2, { must_show: 'the product, 2000B parameter model overlay' }), shot(3)]), script3, brief)).toEqual([expect.stringMatching(/overlay/)])
    expect(checkStoryboard(board([shot(1), shot(2, { image_prompt: 'the product beside a glowing monitor' }), shot(3)]), script3, brief)).toEqual([expect.stringMatching(/second object \(monitor\)/)])
    expect(checkStoryboard(board([shot(1), shot(2, { image_prompt: 'a hand presses Enter from a low side angle beside the product', video_prompt: 'slow orbit. No people and no hands enter the frame' }), shot(3)]), script3, brief)).toEqual([expect.stringMatching(/no people\/no hands/)])
  })
  it('accepts screen glow, a placed monitor, and a hand shot under an overhead light', () => {
    expect(checkStoryboard(board([shot(1, { image_prompt: 'the product lit by screen glow on a dark desk' }), shot(2, { image_prompt: 'a monitor behind the product, out of focus', must_show: 'the product with a monitor behind it' }), shot(3)]), script3, brief)).toEqual([])
    expect(checkStoryboard(board([shot(1), shot(2, { image_prompt: 'a hand presses Enter from a low side angle beside the product' }), shot(3)], 'soft overhead light, dark desk'), script3, brief)).toEqual([])
  })
})

describe('computers are lit warm, not blue', () => {
  const script3 = { structure: 's', beats: [1, 2, 3].map((beat) => ({ beat, job: 'hook', see: 'x', vo: '回车落下，大模型本地作答', text: '本地作答' })) }
  const brief = { brandText: 'ATLAS', product: 'palm-sized gold mini PC', industry: 'computing' as const }
  const shot = (n: number, extra: Partial<Record<string, string>> = {}) => ({ shot: n, seconds: 5, framing: ['macro', 'medium', 'wide'][n - 1]!, camera: ['slow push-in', 'slow orbit', 'slow pull-back'][n - 1]!, image_prompt: 'the product on a dark desk, warm gold rim light', video_prompt: 'slow move, the product stays still', on_screen_text: '', must_show: 'the product on the desk', ...extra })
  const board = (shots: any[]) => ({ style: 'late-night desk, soft warm light', product: 'a gold mini PC with an "ATLAS" badge', shots })
  it('rejects the blue light that turned a gold mini PC blue', () => {
    expect(checkStoryboard(board([shot(1), shot(2), shot(3, { image_prompt: 'server racks behind the product, cool blue ambient light' })]), script3, brief)).toEqual([expect.stringMatching(/blue, cyan or "cool" light/)])
    expect(checkStoryboard(board([shot(1), shot(2, { video_prompt: 'a blue LED strip glows along the edges' }), shot(3)]), script3, brief)).toEqual([expect.stringMatching(/blue, cyan or "cool" light/)])
    expect(checkStoryboard(board([shot(1), shot(2), shot(3)]), script3, brief)).toEqual([])
    expect(composeImagePrompt(shot(1), board([]), true, 'computing')).toMatch(/warm golden/)
    expect(composeVideoNegative('blurry', 'computing')).toMatch(/blue light/)
  })
})

describe('faithfulLabel', () => {
  it('puts back label lettering the intake agent miscopied, and leaves faithful copies alone', () => {
    const request = '木质香水「雾岸」，切面玻璃瓶上有黑色书法字“雾岸”。'
    expect(faithfulLabel('切面玻璃瓶上有黑色书法字“雾崖”', request, '雾岸')).toBe('切面玻璃瓶上有黑色书法字“雾岸”')
    expect(faithfulLabel('深棕色标签上有白色书法字“拾豆”', '深棕色标签上有白色书法字“拾豆”', '拾豆')).toBe('深棕色标签上有白色书法字“拾豆”')
    expect(faithfulLabel('标签上有“雾崖”', '没有写标签文字', '雾岸')).toBe('标签上有“雾崖”')
  })
})

describe('containerWord', () => {
  it('names the container of a Chinese product description in English', async () => {
    const { containerWord } = await import('../src/agent/prompts.js')
    expect(containerWord('厚重切面玻璃瓶，琥珀色香水')).toBe('bottle')
    expect(containerWord('银色铝罐，深棕色标签')).toBe('can')
    expect(containerWord('哑光白色陶瓷杯')).toBe('cup')
    expect(containerWord('牛皮纸咖啡豆自立袋')).toBe('pouch')
    expect(containerWord('哑光白色无线耳机')).toBeUndefined()
  })
})

describe('flaggedBeats', () => {
  it('reads the beat numbers a reviewer names', async () => {
    const { flaggedBeats } = await import('../src/agent/harness.js')
    expect(flaggedBeats(["Beat 3 VO '世界很吵' sounds unnatural", "Beat 2 VO '一键开启全网降噪' implies an absolute claim"], 3)).toEqual([2, 3])
    expect(flaggedBeats(['第2拍 暗示功效', 'beat 9 is out of range', 'no beat named'], 3)).toEqual([2])
  })
})

describe('health effect claims', () => {
  it('blocks health effects for foods and everyday goods, not for fragrance notes', () => {
    expect(scanCopy('补脑增强免疫力，脆爽一夏', 'food').filter((f) => f.severity === 'block').map((f) => f.text)).toEqual(['补脑', '增强免疫'])
    expect(scanCopy('卖点就说助眠、缓解焦虑', 'general').map((f) => f.rule)).toEqual(['health_effect', 'health_effect'])
    expect(scanCopy('主要香调雪松薰衣草', 'general')).toEqual([])
  })
})

describe('delivery formats', () => {
  it('defaults to landscape 1080p at 60 fps and scales presets up to 6K', async () => {
    const f = await import('../src/lib/formats.js')
    expect([f.DEFAULT_RATIO, f.DEFAULT_RESOLUTION, f.DEFAULT_FPS]).toEqual(['16:9', '1080p', 60])
    expect(f.deliverySize('1080p', '16:9')).toEqual([1920, 1080])
    expect(f.deliverySize('4k', '16:9')).toEqual([3840, 2160])
    expect(f.deliverySize('6k', '16:9')).toEqual([6144, 3456])
    expect(f.deliverySize('2k', '9:16')).toEqual([1440, 2560])
    expect(f.deliverySize('1080p', '1:1')).toEqual([1080, 1080])
    expect(f.generationResolution('4k')).toBe('1080p')
    expect(f.isUpscaled('1080p')).toBe(false)
    expect(f.isUpscaled('4k')).toBe(true)
    expect(() => f.deliverySize('8k', '16:9')).toThrow('Unknown resolution')
    expect(() => f.checkFps(50)).toThrow('Unsupported frame rate')
  })
  it('times hard cuts and a closing dissolve', () => {
    // three 5 s shots cut hard, a 0.5 s dissolve into a 3 s end card
    expect(clipStart(3, [5, 5, 5, 3], [0, 0, 0.5])).toBeCloseTo(14.5)
    expect(filmLength([5, 5, 5, 3], [0, 0, 0.5])).toBeCloseTo(17.5)
  })
})

describe('stock ad-speak', () => {
  it('sends back machine-sounding cliches and keeps concrete spoken lines', async () => {
    const { AI_CLICHES } = await import('../src/agent/checks.js')
    for (const line of ['开启美好生活新篇章', '焕新你的每一天', '让早晨成为可能', '满满的高级感']) expect(AI_CLICHES.test(line)).toBe(true)
    for (const line of ['磨开豆子，香气往上冒', '第一口有点凉，后面是回甘']) expect(AI_CLICHES.test(line)).toBe(false)
  })
})

describe('voice-timed subtitles', () => {
  it('shows a subtitle only while its line is spoken, and labels the film as AI-generated', async () => {
    const { buildAss } = await import('../src/lib/titles.js')
    const ass = buildAss([
      { start: 0, end: 5, title: '冰感', subtitle: '冰凉落进掌心', subtitleStart: 0.45, subtitleEnd: 2.9 },
      { start: 0, end: 3, label: '内容由 AI 生成' },
    ], 1920, 1080)
    expect(ass).toContain('Dialogue: 0,0:00:00.45,0:00:02.90,Sub')
    expect(ass).toMatch(/Dialogue: 2,0:00:00\.00,0:00:03\.00,Label,,0,0,0,,内容由 AI 生成/)
  })
})
