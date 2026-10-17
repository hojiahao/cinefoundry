import { hfCacheDir, type Manifest, type ModelFile } from './manifest.js'
import { getJson, type NetConfig } from './net.js'
import { GATED, MEASURED_SHA256, SOURCES, type Source } from './sources.js'

/** One file of a repo revision as the Hub reports it (`GET /api/models/<repo>/revision/<rev>?blobs=true`). */
export interface HubSibling {
  rfilename: string
  size?: number
  blobId?: string
  lfs?: { sha256?: string; oid?: string; size?: number }
}
export interface HubRevision {
  id: string
  sha: string
  gated?: boolean | string
  cardData?: { license?: string; license_name?: string }
  siblings?: HubSibling[]
}

const HEX64 = /^[0-9a-f]{64}$/

export async function fetchRevision(net: NetConfig, repo: string, revision = 'main', auth?: { headerFile: string }): Promise<HubRevision> {
  return getJson<HubRevision>(net, `${net.endpoint}/api/models/${repo}/revision/${revision}?blobs=true`, auth ? { auth: true, headerFile: auth.headerFile } : {})
}

/** The content hash the Hub publishes for a file: lfs sha256 for LFS files (null when hidden), git blob id otherwise. */
export function siblingHash(sibling: HubSibling): { sha256?: string; gitOid?: string } | null {
  if (sibling.lfs) {
    const sha = sibling.lfs.sha256 ?? sibling.lfs.oid
    return sha && HEX64.test(sha) ? { sha256: sha } : null
  }
  return sibling.blobId && /^[0-9a-f]{40}$/.test(sibling.blobId) ? { gitOid: sibling.blobId } : null
}

const excluded = (path: string, patterns: string[] = []) => patterns.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p))

/** Manifest entries for one source, given the Hub's view of its repo (pure; the refresh and the tests share it). */
export function entriesFor(source: Source, revision: HubRevision | undefined): ModelFile[] {
  if (source.kind === 'url') {
    return [{ id: source.url, features: source.features, source: { type: 'url', url: source.url }, layout: 'file', target: source.target, filename: source.filename, size: source.size, sha256: source.sha256, hashSource: 'release-digest', license: source.license }]
  }
  if (!revision) throw new Error(`no Hub data for ${source.repo}`)
  const gated = GATED[source.repo]
  const license = revision.cardData?.license && revision.cardData.license !== 'other' ? `${revision.cardData.license}: ${source.license}` : source.license
  const siblings = (revision.siblings ?? []).filter((s) => {
    if (source.kind === 'hf-file') return s.rfilename === source.path
    if (source.only) return source.only.includes(s.rfilename)
    return s.rfilename !== '.gitattributes' && !excluded(s.rfilename, source.exclude)
  })
  const expected = source.kind === 'hf-file' ? [source.path] : source.only ?? []
  for (const path of expected) if (!siblings.some((s) => s.rfilename === path)) throw new Error(`${source.repo}@${revision.sha} has no file ${path}`)
  if (siblings.length === 0) throw new Error(`${source.repo}@${revision.sha}: no files selected`)
  return siblings.map((sibling) => {
    const id = `${source.repo}/${sibling.rfilename}`
    const published = siblingHash(sibling)
    const measured = MEASURED_SHA256[id]
    if (published?.sha256 && measured && published.sha256 !== measured) throw new Error(`${id}: the Hub's lfs.oid ${published.sha256} differs from the measured ${measured}`)
    const hash = published ?? (measured ? { sha256: measured } : null)
    if (!hash) throw new Error(`${id}: the Hub hides this file's hash${gated ? ' (gated repo: set HF_TOKEN for an account that accepted the terms)' : ''} and no measured hash is recorded`)
    const size = sibling.lfs?.size ?? sibling.size
    if (size === undefined) throw new Error(`${id}: no size reported`)
    const layout = source.kind === 'hf-repo' ? source.layout : 'file'
    const target = layout === 'hf-cache' ? hfCacheDir(source.repo) : source.target!
    const filename = layout === 'hf-cache' ? sibling.rfilename : source.kind === 'hf-file' ? sibling.rfilename.split('/').pop()! : sibling.rfilename
    const entry: ModelFile = {
      id, features: source.features, source: { type: 'hf', repo: source.repo, revision: revision.sha, path: sibling.rfilename }, layout, target, filename, size,
      ...hash, hashSource: published ? 'hf-api' : 'measured', license,
    }
    if (gated) entry.gated = gated
    return entry
  })
}

/** Resolve every source against the Hub and build a fresh manifest. Repos are fetched once each. */
export async function buildManifest(net: NetConfig, auth?: { headerFile: string }, log: (line: string) => void = () => {}): Promise<Manifest> {
  const revisions = new Map<string, HubRevision>()
  for (const source of SOURCES) {
    if (source.kind === 'url') continue
    const key = `${source.repo}@${source.revision ?? 'main'}`
    if (revisions.has(key)) continue
    log(`resolving ${key}`)
    revisions.set(key, await fetchRevision(net, source.repo, source.revision ?? 'main', GATED[source.repo] ? auth : undefined))
  }
  const files = SOURCES.flatMap((source) => entriesFor(source, source.kind === 'url' ? undefined : revisions.get(`${source.repo}@${source.revision ?? 'main'}`)))
  return {
    _comment: 'Generated by `cinefoundry setup manifest --refresh` from src/setup/sources.ts. Every file is pinned to a revision and identified by sha256 (lfs.oid) or, for small non-LFS files, by git blob id. Do not edit by hand.',
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    files,
  }
}

/** Compare a manifest with the Hub: changed hashes at the pinned revision mean a broken or tampered pin. */
export async function checkUpstream(net: NetConfig, files: ModelFile[], auth?: { headerFile: string }): Promise<string[]> {
  const problems: string[] = []
  const byRepoRev = new Map<string, ModelFile[]>()
  for (const file of files) if (file.source.type === 'hf') {
    const key = `${file.source.repo}@${file.source.revision}`
    byRepoRev.set(key, [...(byRepoRev.get(key) ?? []), file])
  }
  for (const [key, group] of byRepoRev) {
    const [repo, revision] = key.split('@') as [string, string]
    const gated = Boolean(group[0]!.gated)
    const hub = await fetchRevision(net, repo, revision, gated ? auth : undefined)
    for (const file of group) {
      const sibling = hub.siblings?.find((s) => s.rfilename === (file.source as { path: string }).path)
      const hash = sibling && siblingHash(sibling)
      // Some endpoints hide a gated repo's hashes from anonymous requests; that is not a mismatch.
      if (!hash && sibling && gated && !auth) continue
      if (!hash) problems.push(`${file.id}: not published at ${revision.slice(0, 12)}`)
      else if ((hash.sha256 ?? hash.gitOid) !== (file.sha256 ?? file.gitOid)) problems.push(`${file.id}: Hub hash ${hash.sha256 ?? hash.gitOid} differs from the manifest`)
    }
  }
  return problems
}
