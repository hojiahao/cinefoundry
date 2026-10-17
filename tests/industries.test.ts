import { describe, expect, it } from 'vitest'
import { composeProductPrompt, composeVideoNegative, composeVideoPrompt, industryOf } from '../src/agent/checks.js'
import { GRADES } from '../src/lib/ffmpeg.js'

describe('automotive and fragrance are shot as their own categories', () => {
  it('reads a car and a perfume as their industries, not as general or a drink', () => {
    expect(industryOf('VORSA dark grey grand tourer')).toBe('automotive')
    expect(industryOf('一台深灰色燃油跑车')).toBe('automotive')
    // A perfume comes in a glass bottle and 香水 contains 水: neither makes it a drink.
    expect(industryOf('雾岸 woody perfume in a heavy faceted glass bottle')).toBe('fragrance')
    expect(industryOf('木质调香水')).toBe('fragrance')
    expect(industryOf('拾豆 iced coffee')).toBe('drink')
  })
  it('gives each its own light, motion, negative prompt and grade', () => {
    const shot = { shot: 1, seconds: 5, framing: 'wide', camera: 'slow tracking shot', image_prompt: 'the car on a coastal road at dusk', video_prompt: 'the car drives past', on_screen_text: '', must_show: 'the car' }
    expect(composeVideoPrompt(shot, 'automotive')).toMatch(/wheels turn at the speed the car moves/)
    expect(composeVideoNegative('base', 'automotive')).toMatch(/wheels not turning/)
    expect(composeVideoNegative('base', 'fragrance')).toMatch(/warped facets/)
    expect(composeProductPrompt({ style: '', product: 'a dark grey grand tourer', shots: [] }, 'automotive')).toMatch(/three-quarter front view, the whole car in frame/)
    expect(GRADES.automotive).toBeDefined()
    expect(GRADES.fragrance).toBeDefined()
  })
})
