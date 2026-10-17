import type { Brief } from '../agent/checks.js'

/**
 * The creative director's treatment: the one idea every later stage serves. Before it existed the copywriter and the
 * storyboard artist each guessed the film on their own, and the words and the pictures could tell two stories.
 * Visual and sound fields are in English because they feed image, video, music and sound-effect models verbatim.
 */
export interface Treatment {
  /** One true observation about the audience at the moment the product lives in (Chinese). */
  insight: string
  /** The single thing the film says, sharpened from the brief's message (Chinese). */
  proposition: string
  /** How the film dramatises the proposition: an image, a contrast, a turn (Chinese). */
  concept: string
  /** The register the brand speaks in, e.g. "restrained and premium" (English). */
  brandVoice: string
  visual: {
    /** One sentence a crew could light from (English, words only). */
    concept: string
    /** Time of day, where the key light comes from and its colour temperature; the same in every shot (English). */
    light: string
    /** Dominant, supporting and accent colour, taken from the product (English words). */
    palette: string[]
    /** Surfaces, grain, haze, materials (English). */
    texture: string
  }
  /** How the beats build across the film, one line (English). */
  rhythm: string
  sound: {
    /** Voice id from the casting library. */
    voice: string
    /** How the announcer reads: pace, warmth, where the weight falls (English). */
    voiceDirection: string
    /** Score direction for the music model: genre, instrumentation, tempo, mood, how it ends (English, no artist names). */
    music: string
    /** The ambience the film lives in, e.g. "quiet kitchen at dawn, faint birdsong outside" (English). */
    ambience: string
  }
}

export interface VoiceProfile {
  id: string
  /** What the voice sounds like and what it suits; shown to the creative director for casting. */
  description: string
}

const NUMBERS = /\d/
const BANNED_REFERENCES = /\b(in the style of|like (the|a) (film|movie|ad|commercial) by|by (wes anderson|christopher nolan|ridley scott))\b/i

export function checkTreatment(t: Treatment, voices: VoiceProfile[]): string[] {
  const problems: string[] = []
  for (const key of ['insight', 'proposition', 'concept', 'brandVoice', 'rhythm'] as const) if (!t[key]?.toString().trim()) problems.push(`${key} is empty`)
  if (!t.visual) problems.push('visual is missing')
  else {
    for (const key of ['concept', 'light', 'texture'] as const) if (!t.visual[key]?.trim()) problems.push(`visual.${key} is empty`)
    if (!Array.isArray(t.visual.palette) || t.visual.palette.length !== 3 || t.visual.palette.some((c) => !c?.trim())) problems.push('visual.palette must be exactly three colours: dominant, supporting, accent')
    // Visual words are pasted into image prompts, where the model paints any digit into the frame.
    const words = `${t.visual.concept} ${t.visual.light} ${t.visual.texture} ${(t.visual.palette ?? []).join(' ')}`
    if (NUMBERS.test(words)) problems.push('visual fields must be words only: no numbers, lens specs or colour temperatures in kelvin (the image model paints digits into the frame)')
    if (/[㐀-鿿]/.test(words)) problems.push('visual fields must be in English: they are pasted into image prompts')
  }
  if (!t.sound) problems.push('sound is missing')
  else {
    if (!voices.some((v) => v.id === t.sound.voice)) problems.push(`sound.voice must be one of the casting library ids: ${voices.map((v) => v.id).join(', ')}`)
    for (const key of ['voiceDirection', 'music', 'ambience'] as const) if (!t.sound[key]?.trim()) problems.push(`sound.${key} is empty`)
    if (/[㐀-鿿]/.test(`${t.sound.music} ${t.sound.ambience}`)) problems.push('sound.music and sound.ambience must be in English: they prompt the music and sound models')
    if (BANNED_REFERENCES.test(`${t.sound.music} ${t.visual?.concept ?? ''}`)) problems.push('no named artists, directors or films as references: describe the qualities instead')
  }
  return problems
}

export const treatmentUser = (brief: Brief, request: string, voices: VoiceProfile[]) => `The client's request, in their own words:
${request}

Brief (the studio's reading of it):
${JSON.stringify(brief, null, 2)}

Casting library for the announcer (choose one id):
${voices.map((v) => `- ${v.id}: ${v.description}`).join('\n')}

Write the treatment for a ${brief.durationSeconds}-second ${brief.ratio} film: ${brief.durationSeconds / 5} shots of 5 seconds and a 3-second end card.
Return JSON only:
{"insight": "中文", "proposition": "中文", "concept": "中文", "brandVoice": "English",
 "visual": {"concept": "English, one sentence", "light": "English: time of day, key light direction and quality, warm or cool", "palette": ["dominant", "supporting", "accent"], "texture": "English"},
 "rhythm": "English, how the ${brief.durationSeconds / 5} beats build",
 "sound": {"voice": "<library id>", "voiceDirection": "English", "music": "English: genre, instrumentation, tempo, mood, ending", "ambience": "English"}}`

/** The part of the treatment the copywriter works from. */
export const treatmentForCopy = (t: Treatment) => `Creative direction (the copy serves this; do not contradict it):
- Insight: ${t.insight}
- Proposition: ${t.proposition}
- Concept: ${t.concept}
- Brand voice: ${t.brandVoice}
- Rhythm: ${t.rhythm}
- The announcer reads it like this: ${t.sound.voiceDirection}`

/** The part of the treatment the storyboard artist and the director of photography work from. */
export const treatmentForPicture = (t: Treatment) => `Director's treatment (every shot serves it; \`style\` must carry its light and palette):
- Concept: ${t.concept} / ${t.visual.concept}
- Light, the same in every shot: ${t.visual.light}
- Palette: dominant ${t.visual.palette[0]}, supporting ${t.visual.palette[1]}, accent ${t.visual.palette[2]}
- Texture: ${t.visual.texture}
- Rhythm: ${t.rhythm}`
