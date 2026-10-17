import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { arch } from 'node:os'
import { dirname } from 'node:path'
import { exec } from '../lib/exec.js'
import { parseMeminfo, type MemoryStatus } from '../lib/memory.js'

/**
 * Platform detection. Every probe runs a command and every answer comes from a pure parser, so the parsers are tested
 * against real output and the report never depends on what happens to be installed on the developer's machine.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail'
export interface Check {
  name: string
  status: CheckStatus
  detail: string
  /** The exact command that fixes it, when it needs root. */
  fix?: string
  /** A failure that makes the rest of the install pointless (wrong hardware). */
  fatal?: boolean
}

/** `nvidia-smi --query-gpu=name,driver_version --format=csv,noheader` → GPUs. */
export function parseNvidiaSmi(text: string): Array<{ name: string; driver: string }> {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, driver] = line.split(',').map((part) => part.trim())
    return { name: name ?? '', driver: driver ?? '' }
  })
}

/** `node --version` / `docker compose version --short` style: the leading major.minor.patch. */
export function parseVersion(text: string): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : undefined
}

/** CDI devices from `docker info` ("Discovered Devices: cdi: nvidia.com/gpu=all") or from `nvidia-ctk cdi list`. */
export function parseCdiDevices(text: string): string[] {
  const devices = new Set<string>()
  for (const match of text.matchAll(/(?:^|\s|cdi:\s*)(nvidia\.com\/gpu=[\w-]+)/gm)) devices.add(match[1]!)
  return [...devices]
}

/** ffmpeg's `-buildconf` lists `--enable-libass` when subtitles can be burned in. */
export const ffmpegHasLibass = (buildconf: string) => /--enable-libass\b/.test(buildconf)

/** `fc-list : family` → whether the title font the cut uses (Noto Sans CJK SC) is installed. */
export const hasNotoCjk = (fcList: string) => fcList.split('\n').some((line) => line.split(',').some((family) => family.trim() === 'Noto Sans CJK SC'))

/** `df -B1 --output=avail <path>` → bytes available. */
export function parseDfAvail(text: string): number | undefined {
  const lines = text.trim().split('\n')
  const value = Number(lines.at(-1)?.trim())
  return lines.length >= 2 && Number.isFinite(value) ? value : undefined
}

export interface PlatformFacts {
  arch: string
  gpus: Array<{ name: string; driver: string }> | null
  docker: { server?: string; error?: string }
  compose?: string
  cdiDevices: string[]
  node: string
  ffmpeg: { present: boolean; libass: boolean }
  fonts: boolean
  git: boolean
  curl: boolean
  aria2: boolean
  python3: boolean
  memory: MemoryStatus
  modelDiskFree?: number
  dockerDiskFree?: number
}

const tryExec = async (command: string, args: string[]) => {
  try {
    return await exec(command, args, { allowFailure: true, timeoutMs: 30_000 })
  } catch {
    return { stdout: '', stderr: 'not found', code: 127 }
  }
}

/** Nearest existing directory, for df on a model root that does not exist yet. */
function existingAncestor(path: string): string {
  let current = path
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current)
  return current
}

export async function diskFree(path: string): Promise<number | undefined> {
  const result = await tryExec('df', ['-B1', '--output=avail', existingAncestor(path)])
  return result.code === 0 ? parseDfAvail(result.stdout) : undefined
}

export async function probePlatform(modelRoot: string, aria2Path?: string): Promise<PlatformFacts> {
  const [smi, dockerVersion, compose, dockerInfo, ctk, ffmpeg, fonts, git, curl, aria2, python] = await Promise.all([
    tryExec('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader']),
    tryExec('docker', ['version', '--format', '{{.Server.Version}}']),
    tryExec('docker', ['compose', 'version', '--short']),
    tryExec('docker', ['info']),
    tryExec('nvidia-ctk', ['cdi', 'list']),
    tryExec('ffmpeg', ['-hide_banner', '-buildconf']),
    tryExec('fc-list', [':', 'family']),
    tryExec('git', ['--version']),
    tryExec('curl', ['--version']),
    tryExec(aria2Path ?? 'aria2c', ['--version']),
    tryExec('python3', ['--version']),
  ])
  const dockerRoot = /Docker Root Dir:\s*(\S+)/.exec(dockerInfo.stdout)?.[1]
  return {
    arch: arch() === 'arm64' ? 'aarch64' : arch(),
    gpus: smi.code === 0 ? parseNvidiaSmi(smi.stdout) : null,
    docker: dockerVersion.code === 0 && dockerVersion.stdout.trim() ? { server: dockerVersion.stdout.trim() } : { error: (dockerVersion.stderr || 'docker not found').trim().split('\n').pop() },
    compose: compose.code === 0 ? compose.stdout.trim() : undefined,
    cdiDevices: [...new Set([...parseCdiDevices(dockerInfo.stdout), ...(dockerInfo.stdout.includes('Discovered Devices') ? [] : parseCdiDevices(ctk.stdout))])],
    node: process.versions.node,
    ffmpeg: { present: ffmpeg.code === 0, libass: ffmpegHasLibass(ffmpeg.stdout + ffmpeg.stderr) },
    fonts: fonts.code === 0 && hasNotoCjk(fonts.stdout),
    git: git.code === 0,
    curl: curl.code === 0,
    aria2: aria2.code === 0,
    python3: python.code === 0,
    memory: parseMeminfo(await readFile('/proc/meminfo', 'utf8').catch(() => '')),
    modelDiskFree: await diskFree(modelRoot),
    dockerDiskFree: dockerRoot ? await diskFree(dockerRoot) : undefined,
  }
}

/**
 * Measured on the reference Spark (docker system df, 2026-10-17): vllm/vllm-openai:v0.27.1 22.5 GB, plus the unique
 * layers of cinefoundry/comfyui 0.81 GB, qwen-tts 0.63 GB and moss-audio 0.55 GB.
 */
export const IMAGE_BYTES = 24.5e9

export interface Needs {
  /** Bytes of model files still to download. */
  downloadBytes: number
  /** Whether images still have to be pulled or built. */
  imagesMissing: boolean
  /** Unified memory the stack needs free to start (scripts/spark-up.sh, SPARK_REQUIRED_FREE_GB). */
  startGb: number
  /** The stack is already running, so its memory is in use by design. */
  stackRunning: boolean
}

/** Judge the facts. Pure: the same facts always give the same report. */
export function assessPlatform(facts: PlatformFacts, needs: Needs): Check[] {
  const checks: Check[] = []
  const add = (check: Check) => checks.push(check)
  add(facts.arch === 'aarch64'
    ? { name: 'cpu', status: 'ok', detail: 'aarch64' }
    : { name: 'cpu', status: 'fail', fatal: true, detail: `${facts.arch}: Cinefoundry runs on NVIDIA DGX Spark (aarch64, GB10)` })
  const gb10 = facts.gpus?.find((gpu) => /GB10/i.test(gpu.name))
  add(gb10
    ? { name: 'gpu', status: 'ok', detail: `${gb10.name}, driver ${gb10.driver}` }
    : facts.gpus === null
      ? { name: 'gpu', status: 'fail', fatal: true, detail: 'nvidia-smi not found or failed: no NVIDIA driver. Cinefoundry needs an NVIDIA DGX Spark (GB10) running DGX OS' }
      : { name: 'gpu', status: 'fail', fatal: true, detail: `found ${facts.gpus.map((gpu) => gpu.name).join(', ') || 'no GPU'}; Cinefoundry needs the NVIDIA GB10 of a DGX Spark` })
  if (facts.docker.server) add({ name: 'docker', status: 'ok', detail: `Docker ${facts.docker.server}` })
  else if (/permission denied/i.test(facts.docker.error ?? '')) add({ name: 'docker', status: 'fail', detail: 'Docker is installed but this user cannot reach the daemon', fix: 'sudo usermod -aG docker $USER && newgrp docker' })
  else add({ name: 'docker', status: 'fail', detail: `Docker Engine not available (${facts.docker.error ?? 'not found'})`, fix: 'sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin && sudo usermod -aG docker $USER' })
  const composeVersion = facts.compose ? parseVersion(facts.compose) : undefined
  if (facts.docker.server) {
    add(composeVersion && composeVersion[0] >= 2
      ? { name: 'docker compose', status: 'ok', detail: `v${facts.compose}` }
      : { name: 'docker compose', status: 'fail', detail: 'the Docker Compose v2 plugin is missing', fix: 'sudo apt-get install -y docker-compose-plugin' })
    add(facts.cdiDevices.includes('nvidia.com/gpu=all')
      ? { name: 'nvidia container toolkit', status: 'ok', detail: 'CDI device nvidia.com/gpu=all' }
      : { name: 'nvidia container toolkit', status: 'fail', detail: 'no CDI device nvidia.com/gpu=all: containers cannot reach the GPU', fix: 'sudo apt-get install -y nvidia-container-toolkit && sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml && sudo nvidia-ctk runtime configure --runtime=docker --cdi.enabled && sudo systemctl restart docker' })
  }
  const node = parseVersion(facts.node)
  add(node && node[0] >= 22 ? { name: 'node', status: 'ok', detail: `v${facts.node}` } : { name: 'node', status: 'fail', detail: `Node ${facts.node}; 22 or later is required (scripts/install.sh installs it under .tools/)` })
  add(!facts.ffmpeg.present
    ? { name: 'ffmpeg', status: 'fail', detail: 'ffmpeg not found', fix: 'sudo apt-get install -y ffmpeg' }
    : facts.ffmpeg.libass
      ? { name: 'ffmpeg', status: 'ok', detail: 'with libass (typeset titles and subtitles)' }
      : { name: 'ffmpeg', status: 'fail', detail: 'ffmpeg is built without libass, so titles and subtitles cannot be typeset', fix: 'sudo apt-get install -y ffmpeg libass9' })
  add(facts.fonts ? { name: 'fonts', status: 'ok', detail: 'Noto Sans CJK SC' } : { name: 'fonts', status: 'fail', detail: 'Noto Sans CJK SC not installed (titles and subtitles)', fix: 'sudo apt-get install -y fonts-noto-cjk && fc-cache -f' })
  for (const [tool, present, pkg] of [['git', facts.git, 'git'], ['curl', facts.curl, 'curl']] as const) {
    if (!present) add({ name: tool, status: 'fail', detail: `${tool} not found`, fix: `sudo apt-get install -y ${pkg}` })
  }
  add(facts.aria2 ? { name: 'aria2c', status: 'ok', detail: 'parallel, resumable downloads' } : { name: 'aria2c', status: 'warn', detail: 'not found; the installer fetches a static build into .tools/aria2 (or uses curl)' })
  if (facts.modelDiskFree !== undefined) {
    const need = needs.downloadBytes
    add(facts.modelDiskFree >= need
      ? { name: 'model disk', status: 'ok', detail: `${gbText(facts.modelDiskFree)} free, ${gbText(need)} still to download` }
      : { name: 'model disk', status: 'fail', detail: `${gbText(facts.modelDiskFree)} free, ${gbText(need)} still to download: free space or set SPARK_MODEL_DIR to a larger disk` })
  }
  if (facts.dockerDiskFree !== undefined && needs.imagesMissing) {
    add(facts.dockerDiskFree >= IMAGE_BYTES
      ? { name: 'docker disk', status: 'ok', detail: `${gbText(facts.dockerDiskFree)} free for images (${gbText(IMAGE_BYTES)} needed)` }
      : { name: 'docker disk', status: 'fail', detail: `${gbText(facts.dockerDiskFree)} free under the Docker root, the images need ${gbText(IMAGE_BYTES)}` })
  }
  const mem = facts.memory
  if (needs.stackRunning) add({ name: 'unified memory', status: 'ok', detail: `${mem.availableGb} of ${mem.totalGb} GB available (stack running)` })
  else add(mem.availableGb >= needs.startGb
    ? { name: 'unified memory', status: 'ok', detail: `${mem.availableGb} of ${mem.totalGb} GB available, ${needs.startGb} GB needed to start the stack` }
    : { name: 'unified memory', status: 'warn', detail: `${mem.availableGb} of ${mem.totalGb} GB available, ${needs.startGb} GB needed to start the stack: stop other GPU work before starting` })
  return checks
}

const gbText = (bytes: number) => `${Math.round(bytes / 1e8) / 10} GB`

export const rootFixes = (checks: Check[]) => [...new Set(checks.filter((check) => check.status === 'fail' && check.fix).map((check) => check.fix!))]
