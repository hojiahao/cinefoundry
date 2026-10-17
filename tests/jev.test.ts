import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { judgeCopy, judgeStoryboard, type JevConfig } from '../src/agent/jev.js'

/** Jev's wire format against a fake server: one request per beat/shot, answers mapped to findings and validator problems. */
async function fakeJev(answer: (state: any, questions: any) => Record<string, unknown>) {
  const calls: any[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString())
      calls.push({ auth: request.headers.authorization, ...body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ model: 'jev-1.13.0', answers: answer(body.state, body.questions), usage: { input_tokens: 600, output_tokens: 20 } }))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const config: JevConfig = { apiKey: 'k', endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/systemone`, model: 'jev-latest' }
  return { config, calls, close: () => server.close() }
}

const brief = { id: 'coffee', title: 't', product: 'specialty coffee', category: 'food', audience: 'a', message: 'm', ratio: '9:16', durationSeconds: 10, tone: 'warm', brandText: '拾豆' } as const

describe('Jev structured judge', () => {
  it('turns calibrated answers into block / review copy findings', async () => {
    const jev = await fakeJev((state) => {
      const bad = String(state.voiceover_line_chinese).includes('全网第一')
      return {
        absolute_claim: { type: 'noul', noul: bad ? 0.99 : 0.04 },
        health_effect: { type: 'noul', noul: bad ? 0.5 : 0.05 },
        register: { type: 'choice', choice: bad ? 'skincare' : 'drink', probabilities: {}, confidence: 0.95 },
        naturalness: { type: 'score', score: bad ? 0.8 : 1.9, probabilities: {}, confidence: 0.9 },
      }
    })
    const script = { structure: 's', beats: [{ beat: 1, job: 'hook', see: 'x', vo: 'The number one specialty coffee.', zh: '全网第一的精品咖啡', text: '第一' }, { beat: 2, job: 'payoff', see: 'y', vo: 'One sip, and the crema settles.', zh: '一口下去 醇香在舌尖化开', text: '醇香' }] }
    const result = await judgeCopy(jev.config, brief as never, script)
    jev.close()
    expect(jev.calls).toHaveLength(2)
    expect(jev.calls[0].auth).toBe('Bearer k')
    expect(jev.calls[0].model).toBe('jev-latest')
    expect(Object.keys(jev.calls[0].questions)).toEqual(['absolute_claim', 'health_effect', 'register', 'packaging_talk', 'naturalness'])
    const beat1 = result.findings.filter((f) => f.beat === 1)
    expect(beat1.map((f) => [f.issue, f.severity])).toEqual([
      ['absolute or superlative claim', 'block'],
      ['claims a bodily or health effect', 'review'],
      ['vocabulary reads as skincare, not food or drink', 'block'],
      ['sounds unnatural when read aloud', 'review'],
    ])
    expect(result.findings.filter((f) => f.beat === 2)).toEqual([])
    expect(result.inputTokens).toBe(1200)
  })

  it('reports storyboard problems in the validator format, allowing hands only when must_show asks', async () => {
    const jev = await fakeJev((state) => ({
      asks_for_text: { type: 'noul', noul: /slogan/.test(state.shot.image_prompt) ? 0.98 : 0.03 },
      multiple_actions: { type: 'noul', noul: /then/.test(state.shot.video_prompt) ? 0.99 : 0.05 },
      redescribes_product: { type: 'noul', noul: 0.1 },
      people_or_hands: { type: 'noul', noul: /hand/.test(state.shot.image_prompt) ? 0.97 : 0.02 },
    }))
    const shot = (n: number, image_prompt: string, video_prompt: string, must_show: string) => ({ shot: n, seconds: 5, framing: 'macro', camera: 'push-in', image_prompt, video_prompt, on_screen_text: '', must_show })
    const storyboard = { style: 's', product: 'p', shots: [
      shot(1, 'the product on ice', 'Slow push-in.', 'the cup'),
      shot(2, 'the product with the slogan painted above', 'Push-in then pan.', 'the cup'),
      shot(3, 'a hand lifting the product', 'Static.', 'a hand holding the cup'),
      shot(4, 'a hand lifting the product', 'Static.', 'the cup upright'),
    ] }
    const result = await judgeStoryboard(jev.config, storyboard)
    jev.close()
    expect(result.problems).toEqual([
      'shot 2: image_prompt asks the model to draw text; on-screen text is typeset in post',
      'shot 2: more than one action or camera move; keep exactly one',
    ])
    expect(result.notes).toEqual(['shot 4: asks for a person or hand although must_show does not call for one; make it a product-only composition or say so in must_show'])
  })
})
