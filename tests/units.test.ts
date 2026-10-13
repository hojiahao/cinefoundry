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
    const findings = scanCopy('全网第一的气泡水，100%天然，喝了永不发胖。', 'food')
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
  it('passes clean copy', () => expect(scanCopy('清爽气泡，0糖0脂，夏日畅饮。', 'food')).toEqual([]))
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
  const brief = { id: 'soda', title: '气泡水', product: 'sparkling water', category: 'food', audience: 'students', message: '0糖也有爽感', ratio: '9:16', durationSeconds: 15, tone: 'fresh', brandText: '冷' } as Brief
  const beat = (n: number, vo: string, text = '') => ({ beat: n, job: 'hook', see: 'a can on ice', vo, text })
  const good: Script = { structure: 'sensory close-ups -> reveal', beats: [beat(1, '冰块碰撞，夏天就此开罐'), beat(2, '零糖零脂，气泡却更足'), beat(3, '先冷一下，我们再出发', '冷一下')] }

  it('accepts a script that follows the skill', () => expect(checkScript(good, brief)).toEqual([]))
  it('counts spoken characters without punctuation', () => expect(spokenLength('冰块碰撞，夏天开罐！')).toBe(8))
  it('rejects the wrong beat count, long voiceover and restricted wording', () => {
    const problems = checkScript({ structure: 'x', beats: [beat(1, '这是一句明显超过十八个字的口播文案它真的太长了读不完'), beat(2, '全网第一的气泡水')] }, brief)
    expect(problems.some((problem) => problem.includes('exactly 3 beats'))).toBe(true)
    expect(problems.some((problem) => problem.includes('at most 18'))).toBe(true)
    expect(problems.some((problem) => problem.includes('全网第一'))).toBe(true)
  })
  it('requires the style line verbatim, English prompts and one camera move', () => {
    const style = 'soft morning light, 50mm'
    const shot = { shot: 1, seconds: 5, framing: 'close-up', camera: 'slow push-in', image_prompt: `A can labelled "冷" on ice, ${style}`, video_prompt: 'Slow push-in.', on_screen_text: '', must_show: 'the can' }
    const script3 = { ...good, beats: [good.beats[0]!] }
    expect(checkStoryboard({ style, product: 'a slim aluminium can with a teal band that reads "冷"', shots: [shot] }, script3, brief)).toEqual([])
    expect(checkStoryboard({ style, product: 'a slim aluminium can with a teal band that reads "冷"', shots: [shot] }, script3, { brandText: '润', product: 'face cream' })).toHaveLength(2)
    const bad = { ...shot, camera: 'push-in then pan', image_prompt: '一罐气泡水' }
    const problems = checkStoryboard({ style, product: "a can", shots: [bad] }, script3)
    expect(problems).toHaveLength(2)
  })
})

import { composeImagePrompt, composeProductPrompt, sanitizeStyle } from '../src/agent/checks.js'
import { clipStart, filmLength } from '../src/lib/ffmpeg.js'
import { buildAss } from '../src/lib/titles.js'

describe('prompt composition and finishing', () => {
  const storyboard = { style: 'soft morning light, 50mm, f/2.8, shallow depth of field, 4k', product: 'a slim silver can whose label reads "冷".', shots: [] }
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
    const ass = buildAss([{ start: 4.6, end: 9.6, title: '0糖', subtitle: '气泡更足{\\b1}' }], 1080, 1920)
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toMatch(/Dialogue: 1,0:00:05\.10,0:00:09\.20,Title/)
    expect(ass).toContain('气泡更足b1') // override tags from model text are neutralised
  })
})

import { captionProblems } from '../src/agent/checks.js'

describe('captions', () => {
  it('accepts ordinary Chinese ad copy', () => {
    expect(captionProblems('vo', '第一口下去，冰凉满口', false)).toEqual([])
    expect(captionProblems('title', '0糖', true)).toEqual([])
  })
  it('rejects emoji, replacement characters, doubled or half-width punctuation and a title ending in a full stop', () => {
    expect(captionProblems('vo', '清爽一夏🥤', false)[0]).toMatch(/must not appear on screen/)
    expect(captionProblems('vo', '清爽�一夏', false)).toHaveLength(1)
    expect(captionProblems('vo', '太爽了！！', false)[0]).toMatch(/repeated or half-width/)
    expect(captionProblems('vo', '清爽,一夏', false)[0]).toMatch(/must not appear|half-width/)
    expect(captionProblems('title', '清爽。', true)[0]).toMatch(/no closing punctuation/)
  })
})

import { statedFormat } from '../src/agent/harness.js'

describe('stated format wins over the intake agent', () => {
  it('reads 横版 / 竖版 and a duration from the request', () => {
    expect(statedFormat('给“醒”做一条 15 秒横版广告')).toEqual({ ratio: '16:9', durationSeconds: 15 })
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
  const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'push-in', image_prompt: 'the product on a table', video_prompt: 'Static.', on_screen_text: '', must_show: 'the jar' }
  const script = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: '指尖轻触，一夜润泽', text: '润' }] }
  it('rejects the skill example copied in place of a face cream', () => {
    const copied = checkStoryboard({ style, product: 'a slim matte-silver aluminium can with a teal band whose label reads "冷"', shots: [shot] }, script, { brandText: '润', product: 'moisturising face cream' })
    expect(copied.some((p) => p.includes('does not mention "润"'))).toBe(true)
    expect(copied.some((p) => p.includes('example from the skill'))).toBe(true)
    expect(checkStoryboard({ style, product: 'a frosted white glass jar with a gold lid whose label reads "润"', shots: [shot] }, script, { brandText: '润', product: 'moisturising face cream' })).toEqual([])
  })
})

describe('product-consistency heuristic', () => {
  it('flags a can for a face cream but not an aluminium keyboard', () => {
    const script1 = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: '晨光里，咖啡香已醒来', text: '醒' }] }
    const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'push-in', image_prompt: 'Macro of the product', video_prompt: 'Push-in.', on_screen_text: '', must_show: 'the product' }
    expect(checkStoryboard({ style: 's', product: 'a deep grey aluminium mechanical keyboard with a "青" plate', shots: [shot] }, script1, { brandText: '青', product: 'mechanical keyboard' })).toEqual([])
    expect(checkStoryboard({ style: 's', product: 'a slim aluminium can with a teal band that reads "润"', shots: [shot] }, script1, { brandText: '润', product: 'face cream' })).toHaveLength(1)
  })
})

describe('voiceover language', () => {
  it('rejects an English word inside a Chinese voiceover line', () => {
    const script = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: '仪式感，唤醒 mornings 的早晨', text: '唤醒' }, { beat: 2, job: 'payoff', see: 'y', vo: '清晨的第一口，温热流转', text: '第一口' }, { beat: 3, job: 'cta', see: 'z', vo: '醒，清晨一口的仪式感', text: '醒' }] }
    const brief = { id: 'c', title: 't', product: 'coffee', category: 'food', audience: 'a', message: 'm', ratio: '16:9', durationSeconds: 15, tone: 'warm', brandText: '醒' } as Brief
    const problems = checkScript(script, brief)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/mixes an English word/)
  })
})

describe('title matches the product form', () => {
  const beats = (text: string) => [{ beat: 1, job: 'hook', see: 'x', vo: '清晨光落，咖啡香起', text }, { beat: 2, job: 'proof', see: 'y', vo: '一袋挂耳，随手冲泡', text: '随泡' }, { beat: 3, job: 'payoff', see: 'z', vo: '温热入喉，清晨唤醒', text: '唤醒' }]
  const brief = (product: string) => ({ id: 'c', title: 't', product, category: 'food', audience: 'a', message: 'm', ratio: '16:9', durationSeconds: 15, tone: 'warm', brandText: '醒' } as Brief)
  it('rejects a can title on a drip-bag coffee, the example copied from the skill', () => {
    const problems = checkScript({ structure: 's', beats: beats('开罐') }, brief('挂耳咖啡'))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/container/)
  })
  it('accepts a can title on a drink, whose can the brief need not mention', () => {
    expect(checkScript({ structure: 's', beats: beats('开罐') }, brief('sugar-free sparkling water'))).toEqual([])
    expect(checkScript({ structure: 's', beats: beats('开罐') }, brief('罐装咖啡'))).toEqual([])
    expect(checkScript({ structure: 's', beats: beats('晨光') }, brief('挂耳咖啡'))).toEqual([])
  })
})

import { checkBrief, industryOf, photoLettering } from '../src/agent/checks.js'

describe('category playbooks in the storyboard check', () => {
  const script3 = { structure: 's', beats: [1, 2, 3].map((beat) => ({ beat, job: 'hook', see: 'x', vo: '键帽回弹，指尖有数', text: '青轴' })) }
  const shot = (n: number, extra: Partial<Record<string, string>> = {}) => ({ shot: n, seconds: 5, framing: ['macro', 'medium', 'wide'][n - 1]!, camera: ['slow push-in', 'slow orbit', 'slow pull-back'][n - 1]!, image_prompt: 'the product on a dark reflective table, cool rim light', video_prompt: 'light sweeps across the keys. No people and no hands enter the frame', on_screen_text: '', must_show: 'the product on the table', ...extra })
  const keyboard = { brandText: '青', product: 'mechanical keyboard' }
  const board = (shots: any[]) => ({ style: 'dark studio, cool tones', product: 'a deep grey aluminium mechanical keyboard with a small "青" badge', shots })
  it('reads the industry from the product', () => {
    expect(industryOf('mechanical keyboard')).toBe('electronics')
    expect(industryOf('palm-sized gold mini PC')).toBe('computing')
    expect(industryOf('挂耳咖啡')).toBe('drink')
    expect(industryOf('保湿面霜')).toBe('skincare')
    // 面 (noodles) used to match 桌面 (desktop): a desktop supercomputer was shot as food.
    expect(industryOf('NVIDIA DGX Spark 桌面AI超级计算机')).toBe('computing')
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
    const brief = { id: 'x-1', title: 't', product: 'p', category: 'general', audience: 'a', message: '桌上超算', ratio: '16:9', durationSeconds: 15, tone: 't', brandText: 'NVIDIA', industry: 'computing' } as const
    expect(checkBrief({ ...brief })).toEqual([])
    // The intake agent wrote the message in English and it went onto a Chinese end card.
    expect(checkBrief({ ...brief, message: 'AI supercomputing on your desk' })).toEqual([expect.stringMatching(/must be in Chinese/)])
    expect(checkBrief({ ...brief, industry: undefined })).toEqual([expect.stringMatching(/^industry must be one of/)])
    expect(checkBrief({ ...brief, brandText: '冷泉气泡水' })).toEqual([expect.stringMatching(/too long/)])
    expect(checkBrief({ ...brief, brandText: 'ABCDEFGHIJKLM' })).toEqual([expect.stringMatching(/too long/)])
  })
  it('reads the quoted lettering off a photo description', () => {
    expect(photoLettering('a bronze box; the "NVIDIA" text and the NVIDIA eye logo sit on the side')).toEqual(['NVIDIA'])
    expect(photoLettering('a silver can with a teal band printed with “冷” and "冷"')).toEqual(['冷'])
    expect(photoLettering('no lettering is visible')).toEqual([])
  })
  it('accepts a varied electronics storyboard', () => {
    expect(checkStoryboard(board([shot(1), shot(2), shot(3)]), script3, keyboard)).toEqual([])
  })
  it('rejects rainbow lighting the brief did not ask for, hands typing from above, and screen content', () => {
    const problems = checkStoryboard(board([shot(1, { image_prompt: 'the product with rainbow RGB underglow' }), shot(2, { image_prompt: 'top-down view of hands typing on the product' }), shot(3, { must_show: 'a cursor moving on the screen' })]), script3, keyboard)
    expect(problems.some((p) => /rainbow/.test(p))).toBe(true)
    expect(problems.some((p) => /from above/.test(p))).toBe(true)
    expect(problems.some((p) => /screen or interface/.test(p))).toBe(true)
  })
  it('rejects two shots with the same framing and camera move, wherever they sit', () => {
    const problems = checkStoryboard(board([shot(1), shot(2), shot(3, { framing: 'macro', camera: 'slow push-in' })]), script3, keyboard)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/same framing and camera move/)
  })
  it('rejects hands in more than one shot, motion in must_show, and a Chinese style line', () => {
    const problems = checkStoryboard({ ...board([shot(1, { image_prompt: 'a finger presses a key, no people' }), shot(2, { image_prompt: 'hands typing from a low side angle' }), shot(3, { must_show: 'keys glowing row by row' })]), style: '暗调，冷色' }, script3, keyboard)
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
  const script1 = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: '一口下去，气泡在舌尖炸开', text: '气泡感' }] }
  const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'slow push-in', image_prompt: 'the product on crushed ice', video_prompt: 'mist drifts. No people and no hands enter the frame', on_screen_text: '', must_show: 'the product upright' }
  it('rejects Chinese outside the quoted label text', () => {
    const problems = checkStoryboard({ style: 's', product: '无糖气泡水, tall slim can, matte white, label "冷" in blue', shots: [shot] }, script1, { brandText: '冷', product: 'sugar-free sparkling water' })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/English except the label text/)
    expect(checkStoryboard({ style: 's', product: 'a tall slim matte white can whose label reads "冷" in blue', shots: [shot] }, script1, { brandText: '冷', product: 'sugar-free sparkling water' })).toEqual([])
  })
})

describe('the request decides what the product looks like', () => {
  const script1 = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: '一口下去，气泡在舌尖炸开', text: '气泡感' }] }
  const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'slow push-in', image_prompt: 'the product on crushed ice', video_prompt: 'mist drifts. No people and no hands enter the frame', on_screen_text: '', must_show: 'the product upright' }
  const brief = { brandText: '冷', product: 'sugar-free sparkling water', appearance: '银色铝罐，青绿色标签上有白色书法字“冷”' }
  it('rejects a bottle when the request said a can', () => {
    const problems = checkStoryboard({ style: 's', product: 'a clear glass bottle whose label reads "冷"', shots: [shot] }, script1, brief)
    expect(problems.some((p) => /must be a can/.test(p))).toBe(true)
    expect(problems.some((p) => /aluminium in the request/.test(p))).toBe(true)
    expect(checkStoryboard({ style: 's', product: 'a slim silver aluminium can with a teal label that reads "冷" in white brush script', shots: [shot] }, script1, brief)).toEqual([])
  })
  it('rejects the template words "in quotes"', () => {
    expect(checkStoryboard({ style: 's', product: 'a silver aluminium can, label text "冷" in quotes', shots: [shot] }, script1, brief)).toHaveLength(1)
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
  const photo = { description: 'A low flat box with a gold metal-foam front and a small "NVIDIA" badge.' }

  it('flags a style line that repaints the product', () => {
    const style = styleConflicts('professional cool rim light on cool-toned metal, pale palette, smooth texture', photo)
    expect(style.some((problem) => problem.includes('"smooth"'))).toBe(true)
    expect(style.some((problem) => problem.includes('cool-toned metal'))).toBe(true)
  })

  it('leaves light, background, placement and finishes the photo shows to the storyboard', () => {
    expect(styleConflicts('cool rim light, dark studio, foam texture catching the light', photo)).toEqual([])
    expect(styleConflicts('smooth gradients', undefined)).toEqual([])
    const script = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'the box standing upright on a desk', vo: '桌上千亿参数', text: '桌上' }] }
    const storyboard = {
      style: 'cool rim light, dark studio', product: 'a flat gold box with a foam front and an "NVIDIA" badge',
      shots: [{ shot: 1, seconds: 5, framing: 'wide', camera: 'slow push-in', image_prompt: 'the unit standing upright on a desk', video_prompt: 'Slow push-in.', on_screen_text: '', must_show: 'the unit on a desk' }],
    }
    expect(checkStoryboard(storyboard, script, { brandText: 'NVIDIA', product: 'DGX Spark', photo }).filter((problem) => problem.includes('photo'))).toEqual([])
    expect(checkStoryboard({ ...storyboard, style: 'cool rim light, smooth texture' }, script, { brandText: 'NVIDIA', product: 'DGX Spark', photo }).filter((problem) => problem.includes('photo'))).toHaveLength(1)
  })
})

describe('frame prompt repairs and second objects (summer-cool-soda-ltx, shot 3)', () => {
  const storyboard = { style: 'cinematic macro, cool tones', product: 'a silver aluminum can with a teal-green label that reads "冷"', shots: [] }
  const shot = {
    shot: 3, seconds: 5, framing: 'wide', camera: 'slow pull-back', video_prompt: 'Slow pull-back.', on_screen_text: '',
    image_prompt: 'wide shot of the silver aluminum can with teal-green label bearing white Chinese calligraphy "冷" standing on a condensation-beaded surface, icy bubbles rising faintly inside a poured glass',
    must_show: 'the silver aluminum can with teal-green label on a condensation-beaded surface, icy bubbles in a poured glass',
  }
  const previous = composeImagePrompt(shot, storyboard, true, 'drink')
  const tail = previous.slice(previous.indexOf('Image 1 is the product'))

  it('uses the original reference sentence', () => {
    expect(previous).toContain('Image 1 is the product: keep its shape, proportions, colours, material and label exactly as in image 1.')
  })

  it('rejects the repairs that broke the frame: a changed framing, the can inside the glass, an escaped label', () => {
    const closeUp = `close-up shot of the silver aluminum can with teal-green label bearing white Chinese calligraphy "冷", positioned in a poured glass. ${tail}`
    expect(checkRepairedPrompt(previous, closeUp)).toEqual([expect.stringContaining('framing is "wide", not "close-up"')])
    const escaped = `Wide shot of a silver aluminum can with teal-green label and white Chinese calligraphy "\\u97f0" beside a poured glass. ${tail}`
    const problems = checkRepairedPrompt(previous, escaped)
    expect(problems.some((p) => p.includes('escape sequence'))).toBe(true)
    expect(problems.some((p) => p.includes('"冷"'))).toBe(true)
    expect(checkRepairedPrompt(previous, 'Wide shot of the can "冷" beside a glass.')).toEqual([expect.stringContaining('word for word')])
    expect(checkRepairedPrompt(previous, `Wide shot of the can with the label "冷" on wet slate, a poured glass of soda to its right. ${tail}`)).toEqual([])
  })

  it('asks must_show to place a second object, and lends that placement to an image prompt without one', () => {
    const script1 = { title: 't', beats: [{ beat: 1, vo: 'x', text: '', see: 'x' }] } as never
    const second = (shots: typeof shot[]) => checkStoryboard({ ...storyboard, shots }, script1).filter((p) => p.includes('second object'))
    expect(second([shot])).toHaveLength(1)
    const placed = { ...shot, must_show: 'the can, and a glass of soda to the right of the can' }
    expect(second([placed])).toEqual([])
    expect(composeImagePrompt(placed, storyboard, true, 'drink')).toContain('. In the picture: the can, and a glass of soda to the right of the can. Image 1 is the product')
    const both = { ...placed, image_prompt: 'wide shot of the can "冷" on a wet surface, a poured glass to the right of the can' }
    expect(composeImagePrompt(both, storyboard, true, 'drink')).not.toContain('In the picture')
    expect(second([{ ...shot, image_prompt: 'wide shot of the can "冷" on a glass table', must_show: 'the can on a glass table' }])).toEqual([])
  })
})

import { statedTagline } from '../src/agent/harness.js'

describe('a computer is not a keyboard', () => {
  const brief = { id: 'd', title: '桌上超算', product: 'palm-sized gold mini PC', category: 'general', audience: 'developers', message: '把AI超算放上桌面', ratio: '16:9', durationSeconds: 15, tone: 'night', brandText: 'NVIDIA', industry: 'computing' } as Brief
  const beats = (vo: string, text: string) => [{ beat: 1, job: 'hook', see: 'x', vo: '深夜，桌上只亮着这一台', text: '巴掌大的超算' }, { beat: 2, job: 'proof', see: 'y', vo, text }, { beat: 3, job: 'payoff', see: 'z', vo: '一张书桌，装下整座机房', text: '桌上机房' }]
  it('rejects switch and keycap copy on a computer, the skill\'s keyboard example copied', () => {
    const problems = checkScript({ structure: 's', beats: beats('指尖落下，青轴一声清响', '青轴响亮') }, brief)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/belongs to a keyboard/)
  })
  it('accepts copy about what the computer runs, and switch copy on a keyboard', () => {
    expect(checkScript({ structure: 's', beats: beats('回车落下，大模型本地作答', '本地作答') }, brief)).toEqual([])
    expect(checkScript({ structure: 's', beats: beats('指尖落下，青轴一声清响', '青轴响亮') }, { ...brief, product: 'mechanical keyboard', industry: 'electronics' })).toEqual([])
  })
  it('reads the closing line the request quotes', () => {
    expect(statedTagline('镜头拉远，桌面化作一座数据中心。字幕：“DGX Spark，把 AI 超算放上你的桌面。” 启动 harness')).toBe('DGX Spark，把 AI 超算放上你的桌面')
    expect(statedTagline('结尾口号「冷一下，再出发」')).toBe('冷一下，再出发')
    expect(statedTagline('夏日气泡水，15 秒竖版')).toBeUndefined()
    expect(statedTagline('桌面化作一座数据中心。字幕：DGX Spark，把 AI 超算放上你的桌面。')).toBe('DGX Spark，把 AI 超算放上你的桌面')
    expect(statedTagline('桌面化作一座数据中心。字幕："DGX Spark，把 AI 超算放上你的桌面。')).toBe('DGX Spark，把 AI 超算放上你的桌面')
  })
  it('shrinks a long closing line to fit a portrait end card', () => {
    const ass = buildAss([{ start: 0, end: 3, title: '', subtitle: '', closing: 'DGX Spark，把 AI 超算放上你的桌面' }], 1080, 1920)
    expect(ass).toMatch(/\\fs\d+\\fsp\d+\}DGX Spark/)
    expect(buildAss([{ start: 0, end: 3, title: '', subtitle: '', closing: 'DGX Spark，把 AI 超算放上你的桌面' }], 1920, 1080)).not.toMatch(/\\fs\d+/)
  })
})

describe('computer shots', () => {
  const script3 = { structure: 's', beats: [1, 2, 3].map((beat) => ({ beat, job: 'hook', see: 'x', vo: '回车落下，大模型本地作答', text: '本地作答' })) }
  const brief = { brandText: 'NVIDIA', product: 'palm-sized gold mini PC', industry: 'computing' as const }
  const shot = (n: number, extra: Partial<Record<string, string>> = {}) => ({ shot: n, seconds: 5, framing: ['macro', 'medium', 'wide'][n - 1]!, camera: ['slow push-in', 'slow orbit', 'slow pull-back'][n - 1]!, image_prompt: 'the product on a dark desk at night', video_prompt: 'slow move, the product stays still', on_screen_text: '', must_show: 'the product on the desk', ...extra })
  const board = (shots: any[], style = 'late-night desk, warm rim light') => ({ style, product: 'a gold mini PC with an "NVIDIA" badge', shots })
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
  const brief = { brandText: 'NVIDIA', product: 'palm-sized gold mini PC', industry: 'computing' as const }
  const shot = (n: number, extra: Partial<Record<string, string>> = {}) => ({ shot: n, seconds: 5, framing: ['macro', 'medium', 'wide'][n - 1]!, camera: ['slow push-in', 'slow orbit', 'slow pull-back'][n - 1]!, image_prompt: 'the product on a dark desk, warm gold rim light', video_prompt: 'slow move, the product stays still', on_screen_text: '', must_show: 'the product on the desk', ...extra })
  const board = (shots: any[]) => ({ style: 'late-night desk, soft warm light', product: 'a gold mini PC with an "NVIDIA" badge', shots })
  it('rejects the blue light that turned the gold DGX Spark blue', () => {
    expect(checkStoryboard(board([shot(1), shot(2), shot(3, { image_prompt: 'server racks behind the product, cool blue ambient light' })]), script3, brief)).toEqual([expect.stringMatching(/blue, cyan or "cool" light/)])
    expect(checkStoryboard(board([shot(1), shot(2, { video_prompt: 'a blue LED strip glows along the edges' }), shot(3)]), script3, brief)).toEqual([expect.stringMatching(/blue, cyan or "cool" light/)])
    expect(checkStoryboard(board([shot(1), shot(2), shot(3)]), script3, brief)).toEqual([])
    expect(composeImagePrompt(shot(1), board([]), true, 'computing')).toMatch(/warm golden/)
    expect(composeVideoNegative('blurry', 'computing')).toMatch(/blue light/)
  })
})
