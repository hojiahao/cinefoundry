import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropUnusedImages, loadWorkflow } from '../src/comfy/workflow.js'
import {
  ageWords, applyRecord, castingPrompt, checkCastingBrief, checkCastingBriefs, loadCastMember, palettesClash, pickCandidate,
  referencePrompt, selectReferences, viewForShot, viewPrompt, type CastingBrief, type CharacterRecord,
} from '../src/crafts/narrative/casting.js'
import type { Character } from '../src/crafts/narrative/types.js'
import { IMAGE_NEGATIVE, imageGraph, imageWorkflow } from '../src/lib/media.js'

const mia: Character = { id: 'mia', name: 'Mia Chen / 陈米娅', role: 'lead', age: 28, gender: 'female', look: 'oval face, shoulder length black hair', wardrobe: 'charcoal wool overcoat over a cream roll-neck', arc: '她想要…', voice: 'warm alto' }
const leo: Character = { ...mia, id: 'leo', name: 'Leo Park / 朴里奥', gender: 'male', age: 33, wardrobe: 'navy field jacket over a white tee' }
const brief = (palette: string, over: Partial<CastingBrief> = {}): CastingBrief => ({
  face: 'long oval face, soft jaw, high flat cheekbones', features: 'narrow dark brown eyes set wide, straight nose, full lower lip',
  ethnicity: 'Han Chinese', skin: 'warm light olive skin with faint freckles across the nose', hair: 'shoulder length straight black hair, side parting on her left',
  build: 'slight, upright posture', distinctive: 'a small mole below the right eye', wardrobe: 'wool overcoat open over a roll-neck', palette, ...over,
})

describe('reference selection per shot', () => {
  const pack = (id: string, views: string[]) => [id, { views: Object.fromEntries([['master', `${id}/master.png`], ...views.map((v) => [v, `${id}/${v}.png`])]) as never }] as const
  const cast = new Map([pack('mia', ['profile', 'full-body']), pack('leo', ['profile', 'full-body']), pack('ava', []), pack('kai', ['full-body'])])

  it('takes the master for closer framings, the full-length for wides and the profile for profile shots', () => {
    expect(viewForShot({ framing: 'close-up', image_prompt: 'Mia looks down at the letter' })).toBe('master')
    expect(viewForShot({ framing: 'medium', image_prompt: 'Mia at the counter' })).toBe('master')
    expect(viewForShot({ framing: 'over-the-shoulder', image_prompt: 'over Leo toward Mia' })).toBe('master')
    expect(viewForShot({ framing: 'wide', image_prompt: 'the café at dawn' })).toBe('full-body')
    expect(viewForShot({ framing: 'medium', image_prompt: 'Mia walking along the platform' })).toBe('full-body')
    expect(viewForShot({ framing: 'close-up', image_prompt: 'Mia in profile against the window' })).toBe('profile')
  })

  it('gives a close-up the master portrait alone', () => {
    expect(selectReferences({ characters: ['mia'], framing: 'close-up', image_prompt: 'Mia' }, cast)).toEqual([{ id: 'mia', view: 'master', path: 'mia/master.png' }])
  })

  it('gives a wide the full-length views and fills spare slots with masters, never more than three', () => {
    expect(selectReferences({ characters: ['mia'], framing: 'wide', image_prompt: 'Mia on the street' }, cast).map((r) => `${r.id}:${r.view}`)).toEqual(['mia:full-body', 'mia:master'])
    expect(selectReferences({ characters: ['mia', 'leo'], framing: 'wide', image_prompt: 'the two of them' }, cast).map((r) => `${r.id}:${r.view}`)).toEqual(['mia:full-body', 'leo:full-body', 'mia:master'])
    const four = selectReferences({ characters: ['mia', 'leo', 'kai', 'ava'], framing: 'wide', image_prompt: 'the family at dinner' }, cast)
    expect(four.map((r) => `${r.id}:${r.view}`)).toEqual(['mia:full-body', 'leo:full-body', 'kai:full-body'])
  })

  it('falls back to the master when the view was not made, and skips characters that are not cast', () => {
    expect(selectReferences({ characters: ['ava', 'nobody'], framing: 'close-up', image_prompt: 'Ava in profile' }, cast)).toEqual([{ id: 'ava', view: 'master', path: 'ava/master.png' }])
    expect(selectReferences({ characters: [], framing: 'wide', image_prompt: 'an empty street' }, cast)).toEqual([])
  })

  it('says what each reference is, with the wardrobe once per character', () => {
    const text = referencePrompt([{ id: 'mia', view: 'full-body', path: 'a' }, { id: 'leo', view: 'master', path: 'b' }, { id: 'mia', view: 'master', path: 'c' }], [mia, leo])
    expect(text).toContain('Image 1 is Mia Chen full length')
    expect(text).toContain("Image 2 is Leo Park's face")
    expect(text).toContain("Image 3 is Mia Chen's face")
    expect(text.match(/wearing charcoal/g)).toHaveLength(1)
    expect(text).not.toMatch(/[㐀-鿿]/)
  })
})

describe('casting brief', () => {
  it('accepts a plain, specific brief', () => {
    expect(checkCastingBrief(brief('charcoal and cream'), mia)).toEqual([])
  })

  it('refuses empty fields, digits, Chinese, words of worth, likenesses and anything that reads as a minor', () => {
    const problems = (over: Partial<CastingBrief>) => checkCastingBrief(brief('charcoal and cream', over), mia).join(' | ')
    expect(problems({ hair: '' })).toMatch(/hair is empty/)
    expect(problems({ build: 'about 170 cm' })).toMatch(/no digits/)
    expect(problems({ skin: '白皙' })).toMatch(/English/)
    expect(problems({ face: 'a beautiful heart-shaped face' })).toMatch(/word of worth/)
    expect(problems({ features: 'eyes that resemble a famous actress' })).toMatch(/real or famous person/)
    expect(problems({ face: 'looks like a young film star' })).toMatch(/real or famous person/)
    expect(problems({ build: 'slight, girl-next-door frame' })).toMatch(/minor/)
    expect(problems({ face: 'teenage roundness in the cheeks' })).toMatch(/minor/)
  })

  it('keeps wardrobe palettes apart across the cast', () => {
    expect(palettesClash('navy and white', 'navy, white and red')).toBe(true)
    expect(palettesClash('charcoal and cream', 'charcoal and rust')).toBe(false)
    expect(checkCastingBrief(brief('navy'), mia).join()).toMatch(/at least two colours/)
    expect(checkCastingBrief(brief('navy and white'), mia, [{ id: 'leo', brief: { palette: 'white and navy blue' } }]).join()).toMatch(/repeats leo/)
  })

  it('checks the designer reply as a whole: one brief per character, distinct palettes, no strangers', () => {
    const reply = { characters: [{ id: 'mia', brief: brief('charcoal and cream') }, { id: 'leo', brief: brief('cream and charcoal') }] }
    expect(checkCastingBriefs(reply, [mia, leo]).join()).toMatch(/repeats/)
    expect(checkCastingBriefs({ characters: [{ id: 'mia', brief: brief('charcoal and cream') }] }, [mia, leo]).join()).toMatch(/exactly one brief for "leo", got 0/)
    expect(checkCastingBriefs({ characters: [{ id: 'mia', brief: brief('charcoal and cream') }, { id: 'zed', brief: brief('olive and rust') }] }, [mia]).join()).toMatch(/"zed" is not a character/)
    expect(checkCastingBriefs({ characters: [{ id: 'leo', brief: brief('navy and rust') }] }, [leo], [{ id: 'mia', brief: brief('charcoal and cream') }])).toEqual([])
  })

  it('writes ages in words and never younger than the twenties', () => {
    expect(ageWords(28, 'female')).toBe('in her late twenties')
    expect(ageWords(41, 'male')).toBe('in his early forties')
    expect(ageWords(18, 'female')).toBe('in her early twenties')
    expect(castingPrompt(mia, brief('charcoal and cream'))).not.toMatch(/\d/)
    expect(viewPrompt('full-body', mia)).toContain('head to the feet')
    expect(viewPrompt('profile', mia)).toContain('Image 1 is Mia Chen')
  })

  it('keeps a passing candidate over a higher-scoring reject, then the score, then the casting ratings', () => {
    const v = (pass: boolean, score: number, sum = 0) => ({ verdict: { pass, score, issues: [], casting: { realism: sum, brief: 0, distinct: 0 } } })
    expect(pickCandidate([v(false, 95), v(true, 81), v(true, 80)])).toEqual(v(true, 81))
    expect(pickCandidate([v(true, 85, 6), v(true, 85, 9)])).toEqual(v(true, 85, 9))
    expect(pickCandidate([])).toBeUndefined()
  })
})

describe('cast reuse', () => {
  const record = (over: Partial<CharacterRecord> = {}): CharacterRecord => ({
    version: 1, id: 'mia', name: mia.name, gender: 'female', age: 28, look: 'the look as cast', wardrobe: 'the wardrobe as cast', brief: brief('charcoal and cream'),
    voice: { description: 'warm alto', library: 'en-f-alto' },
    images: { master: { path: 'master.png', score: 91, pass: true, model: 'qwen-image-2512' }, profile: { path: 'profile.png', score: 88, pass: true, model: 'qwen-image-edit-2511' }, 'full-body': { path: 'full-body.png', score: 86, pass: true, model: 'qwen-image-edit-2511' } },
    candidates: [], castAt: '2026-10-17T00:00:00.000Z', ...over,
  })
  const folder = (rec: unknown, files: string[]) => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cast-')), 'mia')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'character.json'), typeof rec === 'string' ? rec : JSON.stringify(rec))
    for (const f of files) writeFileSync(join(dir, f), 'png')
    return dir
  }

  it('loads a recorded character with the views whose files exist', async () => {
    const dir = folder(record(), ['master.png', 'profile.png'])
    const member = await loadCastMember(dir, mia)
    expect('record' in member && member.views).toEqual({ master: join(dir, 'master.png'), profile: join(dir, 'profile.png') })
    expect('record' in member && member.record.voice.library).toBe('en-f-alto')
  })

  it('refuses a folder that is not this character or has no master', async () => {
    expect(await loadCastMember(join(tmpdir(), 'no-such-cast', 'mia'), mia)).toEqual({ reason: 'not cast yet' })
    expect(await loadCastMember(folder(record(), ['profile.png']), mia)).toEqual({ reason: 'master portrait is missing' })
    expect(await loadCastMember(folder(record({ gender: 'male' }), ['master.png']), mia)).toMatchObject({ reason: expect.stringMatching(/bible says female/) })
    expect(await loadCastMember(folder(record({ id: 'leo' }), ['master.png']), mia)).toMatchObject({ reason: expect.stringMatching(/not "mia"/) })
    expect(await loadCastMember(folder('{ broken', ['master.png']), mia)).toMatchObject({ reason: expect.stringMatching(/not valid JSON/) })
  })

  it('puts the recorded look and wardrobe back on the character', () => {
    expect(applyRecord(mia, record())).toMatchObject({ id: 'mia', look: 'the look as cast', wardrobe: 'the wardrobe as cast', voice: 'warm alto' })
  })
})

describe('image model selection and workflow rendering', () => {
  const values = (refs: number) => ({ prompt: 'p', negative: IMAGE_NEGATIVE, width: 1328, height: 1328, seed: 7, filename_prefix: 'x', ...Object.fromEntries(Array.from({ length: refs }, (_, i) => [`image_${i + 1}`, `ref${i + 1}.png`])) })

  it('keeps the ad defaults, honours the environment flags and refuses unknown models', () => {
    expect(imageWorkflow(0, {}, {}).workflow).toBe('qwen_image_lightning')
    expect(imageWorkflow(2, {}, {}).workflow).toBe('qwen_image_edit_lightning')
    expect(imageWorkflow(0, {}, { CINEFOUNDRY_IMAGE_MODEL: 'qwen-image-2512' }).workflow).toBe('qwen_image_2512')
    expect(imageWorkflow(1, {}, { CINEFOUNDRY_EDIT_MODEL: 'qwen-image-edit-2511' }).workflow).toBe('qwen_image_edit_2511_lightning')
    expect(imageWorkflow(1, { editModel: 'qwen-image-edit-2511' }, { CINEFOUNDRY_EDIT_MODEL: 'qwen-image-edit-2509' }).model).toBe('qwen-image-edit-2511')
    expect(() => imageWorkflow(0, {}, { CINEFOUNDRY_IMAGE_MODEL: 'flux2-dev' })).toThrow(/Unknown image model/)
    expect(() => imageWorkflow(4, { editModel: 'qwen-image-edit-2511' }, {})).toThrow(/at most 3/)
  })

  it('renders Qwen-Image-2512 at the model card settings with its negative prompt and no Lightning LoRA', async () => {
    const plan = imageWorkflow(0, { model: 'qwen-image-2512' }, {})
    const graph = imageGraph(await loadWorkflow(plan.workflow), plan, 0, values(0))
    const nodes = Object.values(graph)
    expect(JSON.stringify(graph)).not.toContain('{{')
    expect(nodes.find((n) => n.class_type === 'UNETLoader')!.inputs.unet_name).toBe('qwen_image_2512_fp8_e4m3fn.safetensors')
    expect(nodes.some((n) => n.class_type === 'LoraLoaderModelOnly')).toBe(false)
    expect(nodes.find((n) => n.class_type === 'KSampler')!.inputs).toMatchObject({ steps: 50, cfg: 4, seed: 7 })
    expect(nodes.filter((n) => n.class_type === 'CLIPTextEncode').map((n) => n.inputs.text)).toEqual(['p', IMAGE_NEGATIVE])
  })

  it('renders Edit-2511 with only the references given, the 2511 Lightning LoRA and index_timestep_zero conditioning', async () => {
    const plan = imageWorkflow(2, { editModel: 'qwen-image-edit-2511' }, {})
    const graph = imageGraph(await loadWorkflow(plan.workflow), plan, 2, values(2))
    const nodes = Object.values(graph)
    expect(JSON.stringify(graph)).not.toContain('{{')
    expect(nodes.find((n) => n.class_type === 'UNETLoader')!.inputs.unet_name).toBe('qwen_image_edit_2511_fp8mixed.safetensors')
    expect(nodes.find((n) => n.class_type === 'LoraLoaderModelOnly')!.inputs.lora_name).toBe('Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors')
    expect(nodes.filter((n) => n.class_type === 'LoadImage').map((n) => n.inputs.image)).toEqual(['ref1.png', 'ref2.png'])
    const encoders = nodes.filter((n) => n.class_type === 'TextEncodeQwenImageEditPlus')
    expect(encoders.every((n) => 'image1' in n.inputs && 'image2' in n.inputs && !('image3' in n.inputs))).toBe(true)
    const sampler = nodes.find((n) => n.class_type === 'KSampler')!.inputs
    for (const side of ['positive', 'negative'] as const) {
      const method = graph[(sampler[side] as [string, number])[0]]!
      expect(method).toMatchObject({ class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { reference_latents_method: 'index_timestep_zero' } })
    }
    expect(sampler).toMatchObject({ steps: 8, cfg: 1 })
  })

  it('leaves the 2509 graph with all three slots, as the ads use it', async () => {
    const plan = imageWorkflow(1, {}, {})
    const graph = imageGraph(await loadWorkflow(plan.workflow), plan, 3, values(3))
    expect(Object.values(graph).filter((n) => n.class_type === 'LoadImage')).toHaveLength(3)
  })

  it('drops unused reference slots and every link to them', () => {
    const template = { _comment: 'x', '20': { class_type: 'LoadImage', inputs: { image: '{{image_1}}' } }, '21': { class_type: 'LoadImage', inputs: { image: '{{image_2}}' } }, '6': { class_type: 'Enc', inputs: { image1: ['20', 0], image2: ['21', 0], prompt: '{{prompt}}' } } }
    expect(dropUnusedImages(template, 1)).toEqual({ _comment: 'x', '20': template['20'], '6': { class_type: 'Enc', inputs: { image1: ['20', 0], prompt: '{{prompt}}' } } })
    expect(dropUnusedImages(template, 2)).toEqual(template)
  })
})
