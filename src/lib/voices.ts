import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { VoiceProfile } from '../crafts/treatment.js'

export type VoiceLanguage = 'English' | 'Chinese'
export type VoiceUse = 'announcer' | 'narrator' | 'presenter' | 'character'

/** One designed voice in the casting library (deploy/voices/library.json). */
export interface LibraryVoice {
  id: string
  language: VoiceLanguage
  accent: string
  gender: 'female' | 'male'
  ageBand: '18-25' | '26-35' | '36-50' | '51-65' | '66+'
  age: number
  timbre: string
  uses: VoiceUse[]
  /** The written description Qwen3-TTS VoiceDesign makes the voice from. */
  design: string
  /** What the voice sounds like and what it suits; shown to the agent that casts it. */
  description: string
}

interface Library { referenceText: Record<VoiceLanguage, string>; pitchHz: Record<'female' | 'male', [number, number]>; voices: LibraryVoice[] }

const libraryPath = () => resolve(process.env.CINEFOUNDRY_VOICE_LIBRARY ?? 'deploy/voices/library.json')
/** Reference clips live in the audio work folder (the containers can read it): voices/<id>.wav. */
export const voicesDir = () => join(resolve(process.env.CINEFOUNDRY_STEP_AUDIO_DIR ?? 'runtime-data/step-audio'), 'voices')

export function loadVoiceLibrary(): Library {
  return JSON.parse(readFileSync(libraryPath(), 'utf8')) as Library
}

/**
 * Voices that can be cast: in the library, matching the filter, and with a reference clip that passed voice QC on this
 * machine. The creative director casts ads from the announcers, the casting director casts characters.
 */
export function castableVoices(filter: { language?: VoiceLanguage; use?: VoiceUse; gender?: 'female' | 'male' } = {}): VoiceProfile[] {
  if (!existsSync(libraryPath())) return []
  return loadVoiceLibrary().voices
    .filter((v) => (!filter.language || v.language === filter.language) && (!filter.use || v.uses.includes(filter.use)) && (!filter.gender || v.gender === filter.gender))
    .filter((v) => existsSync(join(voicesDir(), `${v.id}.wav`)))
    .map(({ id, description, ageBand }) => ({ id, description: `${description} [${ageBand}]` }))
}

/** Reference clip and its transcript for a cast voice, as the clone engine needs them. */
export function voiceReference(id: string): { wav: string; text: string; language: VoiceLanguage } {
  const library = loadVoiceLibrary()
  const voice = library.voices.find((v) => v.id === id)
  if (!voice) throw new Error(`voice ${id} is not in the casting library`)
  return { wav: join(voicesDir(), `${id}.wav`), text: library.referenceText[voice.language], language: voice.language }
}
