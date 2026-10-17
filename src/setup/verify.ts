import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ModelFile } from './manifest.js'

/** SHA-256 of a file's content, streamed. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { highWaterMark: 8 << 20 })) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Git blob id: SHA-1 of "blob <size>\0" followed by the content (Hugging Face's id for non-LFS files). */
export async function gitBlobOid(path: string): Promise<string> {
  const { size } = await stat(path)
  const hash = createHash('sha1')
  hash.update(`blob ${size}\0`)
  for await (const chunk of createReadStream(path, { highWaterMark: 8 << 20 })) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Hashes already computed, keyed by path and invalidated by any change of size, mtime or inode. It only saves
 * re-reading hundreds of gigabytes on a re-run; the hash itself always decides.
 */
export class VerifyCache {
  private entries: Record<string, { size: number; mtimeMs: number; ino: number; hash: string }>
  constructor(private readonly path?: string) {
    this.entries = path && existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as typeof this.entries) : {}
  }
  async lookup(file: string): Promise<string | undefined> {
    const entry = this.entries[file]
    if (!entry) return undefined
    const info = await stat(file).catch(() => undefined)
    return info && info.size === entry.size && info.mtimeMs === entry.mtimeMs && info.ino === entry.ino ? entry.hash : undefined
  }
  async remember(file: string, hash: string): Promise<void> {
    const info = await stat(file)
    this.entries[file] = { size: info.size, mtimeMs: info.mtimeMs, ino: info.ino, hash }
  }
  forget(file: string): void {
    delete this.entries[file]
  }
  async save(): Promise<void> {
    if (!this.path) return
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(this.entries, null, 1))
  }
}

/** `unverified`: present but not hashed yet (only with `cachedOnly`). */
export type FileState = 'verified' | 'missing' | 'partial' | 'mismatch' | 'unverified'

/**
 * Whether the bytes at `path` are exactly the manifest's file. A file still being downloaded (aria2 control file next to
 * it) is `partial` without hashing; any other file is hashed. `cachedOnly` answers from the cache alone (doctor) and
 * reports a file it has not hashed as `unverified` rather than guessing.
 */
export async function verifyFile(path: string, file: Pick<ModelFile, 'sha256' | 'gitOid'>, cache?: VerifyCache, options: { cachedOnly?: boolean; log?: (line: string) => void } = {}): Promise<FileState> {
  if (!existsSync(path)) return 'missing'
  if (existsSync(`${path}.aria2`)) return 'partial'
  const expected = file.sha256 ?? file.gitOid
  const kind = file.sha256 ? 'sha256' : 'git'
  const cached = await cache?.lookup(path)
  const key = (hash: string) => `${kind}:${hash}`
  if (cached !== undefined) return cached === key(expected!) ? 'verified' : 'mismatch'
  if (options.cachedOnly) return 'unverified'
  options.log?.(`hashing ${path}`)
  const actual = file.sha256 ? await sha256File(path) : await gitBlobOid(path)
  await cache?.remember(path, key(actual))
  return actual === expected ? 'verified' : 'mismatch'
}
