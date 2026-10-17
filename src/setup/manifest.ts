import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../lib/config.js'

/**
 * The model manifest (deploy/models.json): every weight file Cinefoundry can load, pinned to an upstream revision and
 * identified by its content hash. A file counts as installed only when its hash matches; size is never identity.
 */

/** What a file is for. `core` serves every format; the rest are selected by format or opt-in. */
export type Feature = 'core' | 'ad' | 'narrative' | 'kokoro' | 'ltx-int8' | 'wan22-14b' | 'wan22-5b' | 'super-vl'
export const FEATURES: Record<Feature, { default: boolean; description: string }> = {
  core: { default: true, description: 'every format: planner and vision LLMs, LTX-2.5 Fast NVFP4 video and lip-sync, RIFE, ACE-Step music, Qwen3-TTS voices, Whisper' },
  ad: { default: true, description: 'ad film: Qwen-Image Lightning and Qwen-Image-Edit-2509 Lightning' },
  narrative: { default: true, description: 'short video and micro-drama: Qwen-Image-2512, Qwen-Image-Edit-2511 Lightning, MOSS-SoundEffect' },
  kokoro: { default: false, description: 'Kokoro-82M Mandarin narrator (CINEFOUNDRY_TTS_ENGINE=kokoro, the voice used when no library voice is cast)' },
  'ltx-int8': { default: false, description: 'LTX-2.5 Fast int8 transformer (--video-model ltx25-fast)' },
  'wan22-14b': { default: false, description: 'Wan2.2 I2V A14B with the 4-step LoRAs (--video-model wan22-14b)' },
  'wan22-5b': { default: false, description: 'Wan2.2 TI2V 5B (--video-model wan22-5b)' },
  'super-vl': { default: false, description: 'Nemotron 3.5 Super VL 120B (compose --profile super)' },
}
export const DEFAULT_FEATURES = (Object.keys(FEATURES) as Feature[]).filter((name) => FEATURES[name].default)

/**
 * Where a file lands under the model root:
 * - `file`: `<target>/<filename>` (ComfyUI folders, TTS/ASR/audio model directories);
 * - `hf-cache`: a Hugging Face hub cache (`<target>/blobs/<hash>`, `snapshots/<revision>/<path>` linked to the blob,
 *   `refs/main`), which vLLM reads with HF_HUB_OFFLINE=1.
 */
export type Layout = 'file' | 'hf-cache'

export interface HfSource { type: 'hf'; repo: string; revision: string; path: string }
export interface UrlSource { type: 'url'; url: string }

export interface ModelFile {
  /** Unique within the manifest: `<repo>/<path>` for Hugging Face files. */
  id: string
  /** The features that load it; installed when any of them is selected. */
  features: Feature[]
  source: HfSource | UrlSource
  layout: Layout
  /** Directory relative to the model root (SPARK_MODEL_DIR). */
  target: string
  /** The name the file is saved under (for `hf-cache`, the path inside the snapshot). */
  filename: string
  size: number
  /** SHA-256 of the content: Hugging Face's lfs.oid for LFS files, the release digest for URL files. */
  sha256?: string
  /** Git blob id (SHA-1 of "blob <size>\0" + content): how Hugging Face identifies small non-LFS files. */
  gitOid?: string
  /** `hf-api`: read from the Hub API; `measured`: hashed from a file that ran in production (gated repo, oid hidden without a token). */
  hashSource: 'hf-api' | 'release-digest' | 'measured'
  gated?: { url: string; note: string }
  license: string
}

export interface Manifest {
  _comment: string
  version: 1
  generated: string
  files: ModelFile[]
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const manifestPath = () => env('CINEFOUNDRY_MODEL_MANIFEST')!
export const modelRoot = (source: Record<string, string | undefined> = process.env) => resolve(env('SPARK_MODEL_DIR', source) || join(homedir(), 'models'))

export function loadManifest(path = manifestPath()): Manifest {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest
  const problems = validateManifest(manifest)
  if (problems.length) throw new Error(`${path} is invalid:\n  ${problems.join('\n  ')}`)
  return manifest
}

const HEX64 = /^[0-9a-f]{64}$/
const HEX40 = /^[0-9a-f]{40}$/

/** Structural checks: every file has a source, a target, a positive size and exactly the hash its kind needs. */
export function validateManifest(manifest: Manifest): string[] {
  const problems: string[] = []
  if (manifest.version !== 1) problems.push(`version must be 1, got ${String(manifest.version)}`)
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) return [...problems, 'files must be a non-empty list']
  const ids = new Set<string>()
  const destinations = new Set<string>()
  for (const file of manifest.files) {
    const where = file.id ?? '(no id)'
    if (!file.id) problems.push('a file has no id')
    if (ids.has(file.id)) problems.push(`${where}: duplicate id`)
    ids.add(file.id)
    if (!Array.isArray(file.features) || !file.features.length || file.features.some((feature) => !(feature in FEATURES))) problems.push(`${where}: features must list known features`)
    if (file.layout !== 'file' && file.layout !== 'hf-cache') problems.push(`${where}: unknown layout ${String(file.layout)}`)
    if (!file.target || file.target.startsWith('/') || file.target.split('/').includes('..')) problems.push(`${where}: target must be a relative directory`)
    if (!file.filename || file.filename.startsWith('/') || file.filename.split('/').includes('..')) problems.push(`${where}: filename must be relative`)
    if (!Number.isInteger(file.size) || file.size < 0 || (file.size === 0 && !file.gitOid)) problems.push(`${where}: size must be a non-negative integer (zero only for an empty non-LFS file)`)
    if (!file.license) problems.push(`${where}: license note missing`)
    if (file.source?.type === 'hf') {
      if (!/^[\w.-]+\/[\w.-]+$/.test(file.source.repo)) problems.push(`${where}: bad repo ${file.source.repo}`)
      if (!HEX40.test(file.source.revision)) problems.push(`${where}: revision must be a 40-hex commit`)
      if (!file.source.path) problems.push(`${where}: source path missing`)
      if (file.layout === 'hf-cache' && file.filename !== file.source.path) problems.push(`${where}: an hf-cache file keeps its repo path as filename`)
    } else if (file.source?.type === 'url') {
      if (!/^https:\/\//.test(file.source.url)) problems.push(`${where}: url must be https`)
      if (file.layout !== 'file') problems.push(`${where}: url files use the file layout`)
    } else problems.push(`${where}: unknown source`)
    const hashes = Number(Boolean(file.sha256)) + Number(Boolean(file.gitOid))
    if (hashes !== 1) problems.push(`${where}: needs exactly one of sha256 or gitOid`)
    if (file.sha256 && !HEX64.test(file.sha256)) problems.push(`${where}: sha256 must be 64 lowercase hex`)
    if (file.gitOid && !HEX40.test(file.gitOid)) problems.push(`${where}: gitOid must be 40 lowercase hex`)
    if (file.gitOid && file.source?.type !== 'hf') problems.push(`${where}: gitOid only identifies Hugging Face files`)
    const destination = file.layout === 'hf-cache' ? `${file.target}#${file.filename}` : `${file.target}/${file.filename}`
    if (destinations.has(destination)) problems.push(`${where}: another file has the same destination`)
    destinations.add(destination)
  }
  return problems
}

/** Files for the requested features. */
export function selectFiles(manifest: Manifest, features: Feature[] = DEFAULT_FEATURES): ModelFile[] {
  const wanted = new Set(features)
  return manifest.files.filter((file) => file.features.some((feature) => wanted.has(feature)))
}

/** Parse `--formats ad,short` and `--with wan22-14b` into features. Short video and micro-drama share the narrative set. */
export function featuresFor(formats: string[] | undefined, extras: string[] = []): Feature[] {
  const chosen = new Set<Feature>(['core'])
  const list = formats && formats.length ? formats : ['ad', 'short', 'drama']
  for (const format of list) {
    if (format === 'ad') chosen.add('ad')
    else if (format === 'short' || format === 'drama' || format === 'narrative') chosen.add('narrative')
    else if (format === 'all') (Object.keys(FEATURES) as Feature[]).forEach((name) => chosen.add(name))
    else throw new Error(`unknown format ${JSON.stringify(format)}; use ad, short, drama or all`)
  }
  for (const extra of extras) {
    if (!(extra in FEATURES)) throw new Error(`unknown feature ${JSON.stringify(extra)}; use ${Object.keys(FEATURES).join(', ')}`)
    chosen.add(extra as Feature)
  }
  return [...chosen]
}

export const hfCacheDir = (repo: string) => join('hf', 'hub', `models--${repo.replace('/', '--')}`)

/** The path a loader opens: the plain file, or the snapshot entry of an hf-cache file. */
export function installedPath(root: string, file: ModelFile): string {
  if (file.layout === 'hf-cache' && file.source.type === 'hf') return join(root, file.target, 'snapshots', file.source.revision, file.filename)
  return join(root, file.target, file.filename)
}

/** Where the bytes are stored: the plain file, or the content-addressed blob of an hf-cache file. */
export function storagePath(root: string, file: ModelFile): string {
  if (file.layout === 'hf-cache') return join(root, file.target, 'blobs', (file.sha256 ?? file.gitOid)!)
  return join(root, file.target, file.filename)
}

/** Download URL. Hugging Face files resolve at their pinned revision through HF_ENDPOINT (e.g. https://hf-mirror.com). */
export function downloadUrl(file: ModelFile, endpoint = hfEndpoint()): string {
  if (file.source.type === 'url') return file.source.url
  const path = file.source.path.split('/').map(encodeURIComponent).join('/')
  return `${endpoint}/${file.source.repo}/resolve/${file.source.revision}/${path}`
}

export const hfEndpoint = (source: Record<string, string | undefined> = process.env) => (env('HF_ENDPOINT', source) || 'https://huggingface.co').replace(/\/+$/, '')

export const totalBytes = (files: ModelFile[]) => files.reduce((sum, file) => sum + file.size, 0)
export const gb = (bytes: number) => Math.round((bytes / 1e9) * 10) / 10
