/**
 * The shared language of narrative films - micro-dramas, creator skits, talking-head shorts. A series has a bible
 * (logline, world, characters, episode plan); an episode has a screenplay (scenes of action and dialogue); a scene is
 * broken into shots. Characters speak English on screen (lip-synced) and every line carries its Chinese subtitle.
 * Picture fields are English (they prompt the image and video models); story fields for the Chinese audience are Chinese.
 */

export interface Character {
  /** Stable id used everywhere: lowercase, dashed ("mia", "old-chen"). */
  id: string
  /** Name as spoken and subtitled: English name, then Chinese ("Mia Chen / 陈米娅"). */
  name: string
  /** Role in the story: lead, love interest, antagonist, mentor, supporting. */
  role: string
  /** Age as a number, for casting the face and the voice. */
  age: number
  gender: 'female' | 'male'
  /** The locked look (English, words only): face, hair, build, skin; the reference sheet is generated from it. */
  look: string
  /** Default wardrobe (English); a scene may change it, the continuity record keeps it. */
  wardrobe: string
  /** What they want, what stops them, how they change (Chinese, two sentences). */
  arc: string
  /** How they sound (English): age, timbre, pace, accent. Drives the designed voice. */
  voice: string
}

export interface EpisodePlan {
  episode: number
  /** Chinese title shown on the episode card. */
  title: string
  /** What happens (Chinese, two or three sentences). */
  synopsis: string
  /** The first three seconds: the image or line that stops the scroll (Chinese). */
  hook: string
  /** The last beat that makes the next episode unmissable (Chinese). */
  cliffhanger: string
}

export interface SeriesBible {
  /** One sentence: who wants what, against what (Chinese). */
  logline: string
  /** Genre and tone, e.g. "urban romance, warm and witty" (English). */
  genre: string
  /** Where and when; the look of the world (English, words only - it prompts the image model). */
  world: string
  /** The series' visual treatment: light, palette, texture (English, words only). */
  look: string
  characters: Character[]
  episodes: EpisodePlan[]
}

export interface DialogueLine {
  /** Character id; "vo" for an off-screen narrator. */
  speaker: string
  /** What is said, in English - spoken by the voice engine and lip-synced. */
  en: string
  /** The Chinese subtitle, a translation an audience reads, not a gloss (≤16 characters per line, no full stops). */
  zh: string
  /** How it is said (English): "quietly, holding back tears". */
  delivery?: string
}

export interface Scene {
  scene: number
  /** INT./EXT. place - time ("INT. CAFÉ - MORNING"). */
  heading: string
  /** Character ids present. */
  characters: string[]
  /** What we see, in present tense (English, picture words). */
  action: string
  lines: DialogueLine[]
}

export interface Screenplay {
  episode: number
  title: string
  scenes: Scene[]
}

export interface NarrativeShot {
  shot: number
  scene: number
  /** wide | medium | close-up | over-the-shoulder | insert */
  framing: string
  /** One camera move in operator's words ("slow push-in", "locked-off"). */
  camera: string
  /** Who is in frame (character ids); the first one is the speaker on a dialogue shot. */
  characters: string[]
  /** The first frame (English, picture words, no numbers, no on-screen text). */
  image_prompt: string
  /** What moves during the shot (English). */
  video_prompt: string
  /** Index of the scene line spoken in this shot, if any: the shot is lip-synced to it. */
  line?: number
  seconds: number
}
