import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readlink, rm, symlink, unlink, writeFile, readFile, chmod } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { downloadUrl, installedPath, storagePath, type ModelFile } from './manifest.js'
import { childEnv, curlProxyArgs, type NetConfig } from './net.js'
import { verifyFile, type FileState, type VerifyCache } from './verify.js'

export interface FileStatus {
  file: ModelFile
  state: FileState
  /** Where the bytes live (blob for hf-cache files). */
  path: string
}

/** Hash every selected file (cache-assisted) and report its state. */
export async function inspectFiles(root: string, files: ModelFile[], cache: VerifyCache, options: { cachedOnly?: boolean; log?: (line: string) => void } = {}): Promise<FileStatus[]> {
  const statuses: FileStatus[] = []
  for (const file of files) {
    const path = storagePath(root, file)
    statuses.push({ file, path, state: await verifyFile(path, file, cache, options) })
  }
  return statuses
}

/** One aria2c input entry: the URL, the directory and the real filename (`out=`), so nothing lands under a hash or a temp name. */
export function aria2Entry(url: string, dir: string, out: string, headers: string[] = []): string {
  return [url, `  dir=${dir}`, `  out=${out}`, ...headers.map((header) => `  header=${header}`)].join('\n') + '\n'
}

export function aria2Args(input: string, net: NetConfig, options: { connections?: number; parallel?: number } = {}): string[] {
  const connections = options.connections ?? 16
  const args = ['-i', input, `-x${connections}`, `-s${connections}`, `-j${options.parallel ?? 4}`, '-c', '--file-allocation=none', '--auto-file-renaming=false', '--allow-overwrite=false',
    '--retry-wait=5', '--max-tries=0', '--timeout=60', '--summary-interval=60', '--console-log-level=warn', '--user-agent=cinefoundry-setup']
  if (net.proxy === 'none') args.push('--all-proxy=', '--no-proxy=*')
  else if (net.proxy) args.push(`--all-proxy=${net.proxy}`)
  return args
}

/** Destination directory and filename of the download for one file. */
export function downloadTarget(root: string, file: ModelFile): { dir: string; out: string } {
  const path = storagePath(root, file)
  return { dir: dirname(path), out: path.slice(dirname(path).length + 1) }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env })
    const forward = (chunk: Buffer) => chunk.toString().split(/\r?\n|\r/).map((line) => line.trimEnd()).filter(Boolean).forEach(log)
    child.stdout.on('data', forward)
    child.stderr.on('data', forward)
    child.on('error', (error) => {
      log(`${command}: ${error.message}`)
      resolve(127)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

export interface DownloadOptions {
  net: NetConfig
  aria2?: string
  /** Header file holding `Authorization: Bearer <token>` (mode 0600), sent for gated files only. */
  authHeaderFile?: string
  workDir: string
  log: (line: string) => void
}

/** Fetch the files with aria2c (many connections, resumable) or, without it, curl -C - one at a time. */
export async function fetchFiles(root: string, files: ModelFile[], options: DownloadOptions): Promise<void> {
  if (!files.length) return
  const { net, log } = options
  const env = childEnv(net)
  const token = options.authHeaderFile ? (await readFile(options.authHeaderFile, 'utf8')).trim() : undefined
  for (const file of files) await mkdir(downloadTarget(root, file).dir, { recursive: true })
  if (options.aria2) {
    await mkdir(options.workDir, { recursive: true })
    const input = join(options.workDir, 'aria2-input.txt')
    const body = files.map((file) => {
      const { dir, out } = downloadTarget(root, file)
      return aria2Entry(downloadUrl(file, net.endpoint), dir, out, file.gated && token ? [token] : [])
    }).join('')
    await writeFile(input, body, { mode: 0o600 })
    await chmod(input, 0o600)
    const code = await run(options.aria2, aria2Args(input, net), env, log)
    await rm(input, { force: true })
    if (code !== 0) log(`aria2c exited with ${code}; files not finished are retried on the next run`)
    return
  }
  for (const file of files) {
    const { dir, out } = downloadTarget(root, file)
    const args = ['-fL', '--retry', '8', '--retry-delay', '5', '--retry-all-errors', '-C', '-', '-A', 'cinefoundry-setup', '-sS', ...curlProxyArgs(net), '-o', join(dir, out)]
    if (file.gated && options.authHeaderFile) args.push('-H', `@${options.authHeaderFile}`)
    args.push(downloadUrl(file, net.endpoint))
    log(`curl ${file.id}`)
    const code = await run('curl', args, env, log)
    if (code !== 0) log(`curl exited with ${code} for ${file.id}`)
  }
}

/**
 * Make an hf-cache file loadable: `snapshots/<revision>/<path>` links to `../../blobs/<hash>` and `refs/main` names the
 * revision, exactly as huggingface_hub lays out its cache.
 */
export async function linkSnapshot(root: string, file: ModelFile): Promise<boolean> {
  if (file.layout !== 'hf-cache' || file.source.type !== 'hf') return false
  const link = installedPath(root, file)
  const target = relative(dirname(link), storagePath(root, file))
  await mkdir(dirname(link), { recursive: true })
  const existing = await lstat(link).catch(() => undefined)
  if (existing?.isSymbolicLink() && (await readlink(link)) === target) return false
  if (existing) await unlink(link)
  await symlink(target, link)
  return true
}

export async function writeRef(root: string, file: ModelFile): Promise<void> {
  if (file.layout !== 'hf-cache' || file.source.type !== 'hf') return
  const ref = join(root, file.target, 'refs', 'main')
  if (existsSync(ref) && (await readFile(ref, 'utf8')).trim() === file.source.revision) return
  await mkdir(dirname(ref), { recursive: true })
  await writeFile(ref, file.source.revision)
}
