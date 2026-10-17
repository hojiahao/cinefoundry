import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { VoiceProfile } from '../crafts/treatment.js'

/** The announcer casting library (deploy/voices.json); each voice's reference clip lives in the step-audio voices folder. */
interface Library { referenceText: string; voices: Array<VoiceProfile & { design: string }> }

const libraryPath = () => resolve(process.env.CINEFOUNDRY_VOICE_LIBRARY ?? 'deploy/voices.json')
export const voicesDir = () => join(resolve(process.env.CINEFOUNDRY_STEP_AUDIO_DIR ?? 'runtime-data/step-audio'), 'voices')

export function loadVoiceLibrary(): Library {
  return JSON.parse(readFileSync(libraryPath(), 'utf8')) as Library
}

/** Voices whose reference clip has been designed on this machine: only these can be cast. */
export function castableVoices(): VoiceProfile[] {
  if (!existsSync(libraryPath())) return []
  return loadVoiceLibrary().voices.filter((voice) => existsSync(join(voicesDir(), `${voice.id}.wav`))).map(({ id, description }) => ({ id, description }))
}

/** Reference clip and its transcript for a cast voice, as the clone engines need them. */
export function voiceReference(id: string): { wav: string; text: string } {
  return { wav: join(voicesDir(), `${id}.wav`), text: loadVoiceLibrary().referenceText }
}
