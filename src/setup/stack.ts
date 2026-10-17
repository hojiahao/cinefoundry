import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exec } from '../lib/exec.js'
import { loadVoiceLibrary, voicesDir } from '../lib/voices.js'
import { REPO_ROOT } from './manifest.js'

/**
 * The local images, the source checkouts they are built from, the voice library and the running services. Every step
 * first asks whether its result already exists, so a re-run only does what is missing.
 */

/** Read deploy/spark/spark.env (KEY=VALUE, `#` comments, inline comments after whitespace). */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    values[match[1]!] = match[2]!.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')
  }
  return values
}

export const sparkEnvPath = () => join(REPO_ROOT, 'deploy', 'spark', 'spark.env')

export function sparkEnv(): Record<string, string> {
  const path = existsSync(sparkEnvPath()) ? sparkEnvPath() : join(REPO_ROOT, 'deploy', 'spark', 'spark.env.example')
  return parseEnvFile(readFileSync(path, 'utf8'))
}

/** spark.env for this machine: the example with SPARK_MODEL_DIR pointing at the real model root (and an optional pip index). */
export function renderSparkEnv(example: string, settings: { modelDir: string; pipIndex?: string }): string {
  return example.split('\n').map((line) => {
    if (/^\s*SPARK_MODEL_DIR\s*=/.test(line)) return `SPARK_MODEL_DIR=${settings.modelDir}`
    if (settings.pipIndex && /^\s*PIP_INDEX_URL\s*=/.test(line)) return `PIP_INDEX_URL=${settings.pipIndex}`
    return line
  }).join('\n')
}

/** Pinned upstream checkouts the images are built from (the commits the reference Spark runs). */
export const CHECKOUTS = {
  comfyui: { url: 'https://github.com/comfyanonymous/ComfyUI', commit: 'b0f4b7b294ce482a2e071d9d762c133d38c7aa07', dir: 'runtime-data/ComfyUI' },
  mossTts: { url: 'https://github.com/OpenMOSS/MOSS-TTS', commit: '934d6826b084c46a0d033402174d5f8ac4ed2519', dir: '.tools/MOSS-TTS' },
} as const

export interface ImagePlan {
  name: string
  /** Alternatives tried in order (registry mirrors); each is a sequence of commands that must all succeed. */
  attempts: string[][][]
  kind: 'pull' | 'build'
}

/**
 * The images and how to get each: vLLM is pulled (Docker Hub first, then each registry mirror, re-tagged to the
 * canonical name); ComfyUI, Qwen3-TTS and MOSS-Audio are built locally on top of it.
 */
export function imagePlans(env: Record<string, string>, mirrors: string[]): ImagePlan[] {
  const tag = env.VLLM_TAG || 'v0.27.1'
  const vllm = `vllm/vllm-openai:${tag}`
  const pip = env.PIP_INDEX_URL || 'https://pypi.org/simple'
  return [
    { name: vllm, kind: 'pull', attempts: [[['docker', 'pull', vllm]], ...mirrors.map((mirror) => [['docker', 'pull', `${mirror}/${vllm}`], ['docker', 'tag', `${mirror}/${vllm}`, vllm]])] },
    { name: 'cinefoundry/comfyui:local', kind: 'build', attempts: [[['docker', 'compose', '-f', 'deploy/spark/compose.yaml', '--env-file', 'deploy/spark/spark.env', 'build', 'comfyui']]] },
    { name: 'cinefoundry/qwen-tts:local', kind: 'build', attempts: [[['docker', 'build', '-t', 'cinefoundry/qwen-tts:local', '--build-arg', `BASE_IMAGE=${vllm}`, '--build-arg', `PIP_INDEX_URL=${pip}`, '-f', 'deploy/spark/qwen-tts/Dockerfile', 'deploy/spark/qwen-tts']]] },
    { name: 'cinefoundry/moss-audio:local', kind: 'build', attempts: [[['docker', 'build', '-t', 'cinefoundry/moss-audio:local', '--build-arg', 'BASE_IMAGE=cinefoundry/qwen-tts:local', '--build-arg', `PIP_INDEX=${pip}`, '-f', 'deploy/spark/moss-audio/Dockerfile', CHECKOUTS.mossTts.dir]]] },
  ]
}

export const registryMirrors = (env: Record<string, string | undefined> = process.env) =>
  (env.CINEFOUNDRY_REGISTRY_MIRRORS ?? 'docker.m.daocloud.io').split(',').map((mirror) => mirror.trim().replace(/\/+$/, '')).filter(Boolean)

/** GitHub URL through an optional prefix mirror (CINEFOUNDRY_GITHUB_MIRROR, e.g. https://ghfast.top/). */
export const githubUrl = (url: string, env: Record<string, string | undefined> = process.env) => (env.CINEFOUNDRY_GITHUB_MIRROR ? `${env.CINEFOUNDRY_GITHUB_MIRROR.replace(/\/*$/, '/')}${url}` : url)

/** Commands that put `dir` at exactly `commit` (a shallow fetch of that one commit; a re-run is a no-op). */
export function checkoutCommands(dir: string, url: string, commit: string): string[][] {
  return [
    ['git', 'init', '-q', dir],
    ['git', '-C', dir, 'fetch', '-q', '--depth', '1', url, commit],
    ['git', '-C', dir, 'checkout', '-q', '--detach', commit],
  ]
}

export async function headCommit(dir: string): Promise<string | undefined> {
  if (!existsSync(join(dir, '.git'))) return undefined
  const result = await exec('git', ['-C', dir, 'rev-parse', 'HEAD'], { allowFailure: true }).catch(() => undefined)
  return result?.code === 0 ? result.stdout.trim() : undefined
}

export async function imageExists(name: string): Promise<boolean> {
  const result = await exec('docker', ['image', 'inspect', '--format', '{{.Id}}', name], { allowFailure: true, timeoutMs: 30_000 }).catch(() => undefined)
  return result?.code === 0
}

/** Run a command with its output streamed into the log. */
export function stream(command: string[], log: (line: string) => void, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command[0]!, command.slice(1), { cwd: options.cwd ?? REPO_ROOT, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const forward = (chunk: Buffer) => chunk.toString().split(/\r?\n|\r/).map((line) => line.trimEnd()).filter(Boolean).forEach(log)
    child.stdout.on('data', forward)
    child.stderr.on('data', forward)
    child.on('error', (error) => {
      log(`${command[0]}: ${error.message}`)
      resolve(127)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

/** Voice library state: library voices with a QC-passed reference clip on this machine, and the ones still missing. */
export function voiceLibraryStatus(): { total: number; ready: string[]; missing: string[] } {
  const library = loadVoiceLibrary()
  const qcPath = join(voicesDir(), 'qc.json')
  const qc = existsSync(qcPath) ? (JSON.parse(readFileSync(qcPath, 'utf8')) as { chosen?: Record<string, string | null> }) : {}
  const ready: string[] = []
  const missing: string[] = []
  for (const voice of library.voices) {
    if (existsSync(join(voicesDir(), `${voice.id}.wav`)) && qc.chosen?.[voice.id]) ready.push(voice.id)
    else missing.push(voice.id)
  }
  return { total: library.voices.length, ready, missing }
}

/** The two container runs that build the missing voices: design takes with Qwen3-TTS VoiceDesign, then QC with Whisper. */
export function voiceBuildCommands(missing: string[], paths: { repo: string; work: string; models: string }): string[][] {
  const gpu = ['docker', 'run', '--rm', '--device', 'nvidia.com/gpu=all', '--ipc=host', '-v', `${paths.repo}:/repo:ro`, '-v', `${paths.work}:/work`]
  return [
    [...gpu, '-v', `${join(paths.models, 'tts')}:/models:ro`, 'cinefoundry/qwen-tts:local', '/repo/scripts/voice-design.py', '--model', '/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign', '--out', '/work/voices/candidates', '--only', ...missing],
    [...gpu, '-v', `${join(paths.models, 'asr')}:/asr:ro`, 'cinefoundry/moss-audio:local', '/repo/scripts/voice-qc.py', '--asr', '/asr/whisper-large-v3-turbo', '--candidates', '/work/voices/candidates', '--voices', '/work/voices'],
  ]
}

/** The stack's health endpoints (scripts/spark-up.sh waits on the same). */
export const SERVICES = [
  { name: 'nemotron', url: 'http://127.0.0.1:8001/health' },
  { name: 'stepvl', url: 'http://127.0.0.1:8002/health' },
  { name: 'comfyui', url: 'http://127.0.0.1:8188/system_stats' },
] as const

export async function serviceHealth(timeoutMs = 3000): Promise<Record<string, boolean>> {
  const entries = await Promise.all(SERVICES.map(async (service) => {
    try {
      const response = await fetch(service.url, { signal: AbortSignal.timeout(timeoutMs) })
      return [service.name, response.ok] as const
    } catch {
      return [service.name, false] as const
    }
  }))
  return Object.fromEntries(entries)
}

/** Commands for a first film of each format and the studio. */
export function firstFilmCommands(): string[] {
  return [
    'node dist/cli.js ad    "A 30-second film for Misthaven, a woody fragrance in a heavy faceted glass bottle, for women around thirty"',
    'node dist/cli.js short "A 60-second skit in a specialty coffee bar: a barista talks a regular into trying a natural-process Ethiopian"',
    'node dist/cli.js drama "A fake-dating romance: to save her late grandmother\'s perfume shop, a young perfumer signs a three-month contract with the heir buying up the street" --episodes 3 --produce 1',
  ]
}
export const STUDIO = { command: 'node dist/cli.js studio', url: 'http://127.0.0.1:3090' }
