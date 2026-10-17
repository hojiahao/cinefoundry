import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { takeRunLock } from '../engine/lock.js'
import { exec } from '../lib/exec.js'
import { memoryStatus } from '../lib/memory.js'
import { audioWork } from '../lib/speech.js'
import { fetchFiles, inspectFiles, linkSnapshot, writeRef, type FileStatus } from './download.js'
import { buildManifest, checkUpstream } from './hf.js'
import { DEFAULT_FEATURES, downloadUrl, featuresFor, gb, loadManifest, manifestPath, modelRoot, REPO_ROOT, selectFiles, totalBytes, type Feature, type Manifest, type ModelFile } from './manifest.js'
import { netConfig, type NetConfig } from './net.js'
import { assessPlatform, probePlatform, rootFixes, type Check } from './platform.js'
import { CHECKOUTS, checkoutCommands, firstFilmCommands, githubUrl, headCommit, imageExists, imagePlans, registryMirrors, renderSparkEnv, serviceHealth, sparkEnv, sparkEnvPath, STUDIO, stream, voiceBuildCommands, voiceLibraryStatus } from './stack.js'
import { VerifyCache } from './verify.js'

export type SetupMode = 'install' | 'check' | 'dry-run'
export interface SetupOptions {
  mode: SetupMode
  modelsOnly: boolean
  noStart: boolean
  features: Feature[]
  proxy?: string
  log: (line: string) => void
}

const SETUP_DIR = () => join(REPO_ROOT, 'runtime-data', 'setup')
const statePath = () => join(SETUP_DIR(), 'state.json')
const cachePath = () => join(SETUP_DIR(), 'verified.json')

/** Aria2 static build used when aria2c is not installed (abcfy2/aria2-static-build, release digest). */
const ARIA2 = {
  url: 'https://github.com/abcfy2/aria2-static-build/releases/download/1.37.0/aria2-aarch64-linux-musl_static.zip',
  sha256: '0c681a89a40e0f82d1f5137608e86257eb0af201459c002941ea098f2b8c26b6',
  bin: join(REPO_ROOT, '.tools', 'aria2', 'aria2c'),
}

/** The model root: SPARK_MODEL_DIR from the environment, else from deploy/spark/spark.env (unless still the placeholder), else ~/models. */
export function resolveModelRoot(env: Record<string, string | undefined> = process.env): string {
  if (env.SPARK_MODEL_DIR) return modelRoot(env)
  const fromFile = sparkEnv().SPARK_MODEL_DIR
  return modelRoot({ SPARK_MODEL_DIR: fromFile && !fromFile.startsWith('/path/to') ? fromFile : undefined })
}

/** Features recorded by the last install, so doctor checks what was asked for. */
export function installedFeatures(): Feature[] {
  try {
    return (JSON.parse(readFileSync(statePath(), 'utf8')) as { features: Feature[] }).features
  } catch {
    return DEFAULT_FEATURES
  }
}

function printChecks(checks: Check[], log: (line: string) => void): void {
  for (const check of checks) log(`  ${check.status === 'ok' ? 'ok  ' : check.status === 'warn' ? 'warn' : 'FAIL'}  ${check.name.padEnd(26)} ${check.detail}`)
}

async function ensureAria2(net: NetConfig, log: (line: string) => void, dryRun: boolean): Promise<string | undefined> {
  const which = await exec('sh', ['-c', 'command -v aria2c'], { allowFailure: true })
  if (which.code === 0 && which.stdout.trim()) return which.stdout.trim()
  if (existsSync(ARIA2.bin)) return ARIA2.bin
  if (dryRun) {
    log(`  would fetch aria2c ${ARIA2.url} -> ${ARIA2.bin}`)
    return undefined
  }
  const dir = join(REPO_ROOT, '.tools', 'aria2')
  await mkdir(dir, { recursive: true })
  const zip = join(dir, 'aria2-static.zip')
  const proxyArgs = net.proxy ? (net.proxy === 'none' ? ['--noproxy', '*'] : ['--proxy', net.proxy]) : []
  const got = await exec('curl', ['-fsSL', '--retry', '4', ...proxyArgs, '-o', zip, githubUrl(ARIA2.url)], { allowFailure: true, timeoutMs: 600_000 }).catch(() => ({ code: 1 }))
  const { sha256File } = await import('./verify.js')
  if (got.code !== 0 || !existsSync(zip) || (await sha256File(zip)) !== ARIA2.sha256) {
    log('  could not fetch a verified aria2c; downloads fall back to curl (one connection per file)')
    await rm(zip, { force: true })
    return undefined
  }
  const unpacked = await exec('python3', ['-m', 'zipfile', '-e', zip, dir], { allowFailure: true }).catch(() => ({ code: 1 }))
  await rm(zip, { force: true })
  if (unpacked.code !== 0 || !existsSync(ARIA2.bin)) {
    log('  could not unpack aria2c; downloads fall back to curl')
    return undefined
  }
  await chmod(ARIA2.bin, 0o755)
  log(`  aria2c installed at ${ARIA2.bin}`)
  return ARIA2.bin
}

async function withAuthHeader<T>(net: NetConfig, body: (headerFile: string | undefined) => Promise<T>): Promise<T> {
  if (!net.token) return body(undefined)
  await mkdir(SETUP_DIR(), { recursive: true })
  const file = join(SETUP_DIR(), `.auth-${process.pid}`)
  await writeFile(file, `Authorization: Bearer ${net.token}\n`, { mode: 0o600 })
  try {
    return await body(file)
  } finally {
    await rm(file, { force: true })
  }
}

interface ModelsResult { ready: boolean; statuses: FileStatus[]; blocked: ModelFile[] }

/** Step 3: every weight the selected features need, verified by hash, fetched if missing. */
async function models(root: string, manifest: Manifest, options: SetupOptions, net: NetConfig, cache: VerifyCache): Promise<ModelsResult> {
  const { log } = options
  const files = selectFiles(manifest, options.features)
  log(`\n[models] ${files.length} files, ${gb(totalBytes(files))} GB, under ${root}`)
  log(`  source ${net.endpoint}${net.proxy ? `, proxy ${net.proxy}` : ''}`)
  let statuses = await inspectFiles(root, files, cache, { log: (line) => log(`  ${line}`) })
  await cache.save()
  const pending = () => statuses.filter((status) => status.state !== 'verified')
  const gatedWithoutToken: ModelFile[] = pending().filter((status) => status.file.gated && !net.token).map((status) => status.file)
  for (const gate of new Set(gatedWithoutToken.map((file) => file.gated!.url))) {
    const sample = gatedWithoutToken.find((file) => file.gated!.url === gate)!
    log(`  GATED  ${gate} - ${sample.gated!.note}`)
  }
  const todo = pending().filter((status) => !gatedWithoutToken.includes(status.file))
  // One line per repository and state: a fresh machine has hundreds of missing files.
  const groups = new Map<string, ModelFile[]>()
  for (const status of pending()) {
    const key = `${status.state}\t${status.file.source.type === 'hf' ? status.file.source.repo : status.file.id}`
    groups.set(key, [...(groups.get(key) ?? []), status.file])
  }
  for (const [key, group] of groups) {
    const [state, repo] = key.split('\t') as [string, string]
    log(`  ${state.padEnd(9)} ${repo}: ${group.length === 1 ? group[0]!.filename : `${group.length} files`} (${gb(totalBytes(group))} GB)`)
  }
  if (options.mode !== 'install') {
    if (options.mode === 'dry-run') for (const status of todo) log(`  would fetch ${downloadUrl(status.file, net.endpoint)}\n            -> ${status.path}`)
    log(`  ${files.length - pending().length} of ${files.length} verified; ${gb(totalBytes(pending().map((status) => status.file)))} GB to download`)
    return { ready: pending().length === 0, statuses, blocked: gatedWithoutToken }
  }
  if (todo.length) {
    await withAuthHeader(net, async (headerFile) => {
      const gated = todo.filter((status) => status.file.gated).map((status) => status.file)
      if (gated.length && headerFile) {
        // The token is used for the gated repo only; its published lfs.oid must match the manifest before any byte is fetched.
        const drift = await checkUpstream(net, gated, { headerFile }).catch((error: Error) => [`could not read the gated repo's file list: ${error.message}`])
        for (const problem of drift) log(`  upstream: ${problem}`)
        if (drift.length) {
          log(`  not downloading ${gated.length} gated files: the repo does not match the manifest, or the token has no access (accept the terms at ${gated[0]!.gated!.url})`)
          gatedWithoutToken.push(...gated)
        }
      }
      for (const status of todo.filter((s) => s.state === 'mismatch')) {
        log(`  removing ${status.path}: content does not match the manifest`)
        await rm(status.path, { force: true })
        cache.forget(status.path)
      }
      const fetchable = todo.filter((status) => !gatedWithoutToken.includes(status.file))
      if (!fetchable.length) return
      const aria2 = await ensureAria2(net, log, false)
      log(`  fetching ${fetchable.length} files, ${gb(totalBytes(fetchable.map((status) => status.file)))} GB, with ${aria2 ? 'aria2c' : 'curl'}`)
      for (let round = 1; round <= 2; round++) {
        const wanted = statuses.filter((status) => status.state !== 'verified' && !gatedWithoutToken.includes(status.file)).map((status) => status.file)
        if (!wanted.length) break
        await fetchFiles(root, wanted, { net, aria2, authHeaderFile: headerFile, workDir: SETUP_DIR(), log: (line) => log(`  ${line}`) })
        statuses = await inspectFiles(root, statuses.map((status) => status.file), cache, { log: (line) => log(`  ${line}`) })
        await cache.save()
        for (const status of statuses.filter((s) => s.state === 'mismatch')) {
          log(`  ${status.file.id}: downloaded content does not match sha256; removing it${round === 1 ? ' and fetching again' : ''}`)
          await rm(status.path, { force: true })
          cache.forget(status.path)
        }
      }
    })
  }
  for (const status of statuses.filter((s) => s.state === 'verified')) {
    await linkSnapshot(root, status.file)
    await writeRef(root, status.file)
  }
  const left = pending()
  for (const status of left) log(`  NOT READY ${status.file.id}: ${status.state}`)
  log(`  ${files.length - left.length} of ${files.length} verified`)
  return { ready: left.length === 0, statuses, blocked: gatedWithoutToken }
}

async function checkouts(options: SetupOptions, needMoss: boolean): Promise<boolean> {
  const { log } = options
  let ok = true
  for (const [key, checkout] of Object.entries(CHECKOUTS)) {
    if (key === 'mossTts' && !needMoss) continue
    const dir = join(REPO_ROOT, checkout.dir)
    const head = await headCommit(dir)
    if (head === checkout.commit) {
      log(`  ok    ${checkout.dir} at ${checkout.commit.slice(0, 12)}`)
      continue
    }
    if (head) {
      log(`  warn  ${checkout.dir} is at ${head.slice(0, 12)}, the tested commit is ${checkout.commit.slice(0, 12)}; left as it is`)
      continue
    }
    if (existsSync(dir) && !existsSync(join(dir, '.git'))) {
      log(`  FAIL  ${checkout.dir} exists but is not a git checkout; move it away and re-run`)
      ok = false
      continue
    }
    const commands = checkoutCommands(dir, githubUrl(checkout.url), checkout.commit)
    if (options.mode !== 'install') {
      log(`  ${options.mode === 'dry-run' ? 'would run' : 'missing'}  ${commands.map((command) => command.join(' ')).join(' && ')}`)
      ok = false
      continue
    }
    for (const command of commands) {
      if ((await stream(command, (line) => log(`    ${line}`))) !== 0) {
        log(`  FAIL  ${command.join(' ')}`)
        ok = false
        break
      }
    }
  }
  return ok
}

async function images(options: SetupOptions): Promise<boolean> {
  const { log } = options
  let ok = true
  for (const plan of imagePlans(sparkEnv(), registryMirrors())) {
    if (await imageExists(plan.name)) {
      log(`  ok    ${plan.name}`)
      continue
    }
    if (options.mode !== 'install') {
      log(`  ${options.mode === 'dry-run' ? 'would run' : 'missing'}  ${plan.attempts.map((attempt) => attempt.map((command) => command.join(' ')).join(' && ')).join('   || ')}`)
      ok = false
      continue
    }
    let done = false
    for (const attempt of plan.attempts) {
      log(`  ${plan.kind === 'pull' ? 'pulling' : 'building'} ${plan.name}: ${attempt.map((command) => command.join(' ')).join(' && ')}`)
      let failed = false
      for (const command of attempt) if ((await stream(command, (line) => log(`    ${line}`))) !== 0) {
        failed = true
        break
      }
      if (!failed && (await imageExists(plan.name))) {
        done = true
        break
      }
    }
    if (!done) {
      log(`  FAIL  ${plan.name} could not be ${plan.kind === 'pull' ? 'pulled (set CINEFOUNDRY_REGISTRY_MIRRORS to a reachable registry mirror)' : 'built (see the log above; PIP_INDEX_URL in deploy/spark/spark.env selects the Python package index)'}`)
      ok = false
      break
    }
  }
  return ok
}

async function voices(root: string, options: SetupOptions): Promise<boolean> {
  const { log } = options
  const status = voiceLibraryStatus()
  if (!status.missing.length) {
    log(`  ok    ${status.ready.length} of ${status.total} voices passed QC`)
    return true
  }
  const commands = voiceBuildCommands(status.missing, { repo: REPO_ROOT, work: audioWork(), models: root })
  if (options.mode !== 'install') {
    log(`  ${status.ready.length} of ${status.total} voices ready; missing: ${status.missing.join(', ')}`)
    if (options.mode === 'dry-run') for (const command of commands) log(`  would run ${command.join(' ')}`)
    return false
  }
  let release: (() => Promise<void>) | undefined
  try {
    release = await takeRunLock('setup: voice library')
  } catch (error) {
    log(`  skip  ${(error as Error).message}`)
    return false
  }
  try {
    await mkdir(join(audioWork(), 'voices', 'candidates'), { recursive: true })
    log(`  designing ${status.missing.length} voices with Qwen3-TTS VoiceDesign, then QC with Whisper`)
    for (const command of commands) if ((await stream(command, (line) => log(`    ${line}`))) !== 0) {
      log(`  FAIL  ${command.slice(0, 12).join(' ')} ...`)
      return false
    }
  } finally {
    await release()
  }
  const after = voiceLibraryStatus()
  log(`  ${after.ready.length} of ${after.total} voices passed QC${after.missing.length ? `; still failing: ${after.missing.join(', ')} (re-run to design new takes)` : ''}`)
  return after.missing.length === 0
}

async function ensureSparkEnv(root: string, options: SetupOptions): Promise<void> {
  if (existsSync(sparkEnvPath())) {
    const configured = sparkEnv().SPARK_MODEL_DIR
    if (configured && configured !== root) options.log(`  warn  deploy/spark/spark.env has SPARK_MODEL_DIR=${configured}, models are under ${root}`)
    else options.log('  ok    deploy/spark/spark.env')
    return
  }
  const example = await readFile(join(REPO_ROOT, 'deploy', 'spark', 'spark.env.example'), 'utf8')
  const text = renderSparkEnv(example, { modelDir: root, pipIndex: process.env.PIP_INDEX_URL })
  if (options.mode === 'install') {
    await writeFile(sparkEnvPath(), text)
    options.log(`  wrote deploy/spark/spark.env (SPARK_MODEL_DIR=${root})`)
  } else options.log(`  ${options.mode === 'dry-run' ? 'would write' : 'missing'} deploy/spark/spark.env (SPARK_MODEL_DIR=${root})`)
}

async function ensureKokoroVenv(options: SetupOptions): Promise<boolean> {
  const python = join(REPO_ROOT, 'runtime-data', 'tts-venv', 'bin', 'python')
  if (existsSync(python)) return true
  const commands = [['python3', '-m', 'venv', 'runtime-data/tts-venv'], ['runtime-data/tts-venv/bin/pip', 'install', '-q', 'kokoro>=0.8', 'misaki[zh]', 'soundfile']]
  if (options.mode !== 'install') {
    options.log(`  ${options.mode === 'dry-run' ? 'would run' : 'missing'}  ${commands.map((command) => command.join(' ')).join(' && ')}`)
    return false
  }
  for (const command of commands) if ((await stream(command, (line) => options.log(`    ${line}`))) !== 0) return false
  return true
}

/** The whole install, or its report (`check`) or plan (`dry-run`). Returns the process exit code. */
export async function runSetup(options: SetupOptions): Promise<number> {
  process.chdir(REPO_ROOT)
  const { log } = options
  const net = netConfig(process.env, { proxy: options.proxy })
  const root = resolveModelRoot()
  const manifest = loadManifest()
  const cache = new VerifyCache(cachePath())
  log(`Cinefoundry setup (${options.mode}${options.modelsOnly ? ', models only' : ''}${options.noStart ? ', no start' : ''}) - features: ${options.features.join(', ')}`)

  // 1. Platform: hardware first, so a wrong machine stops before anything is fetched.
  log('\n[platform]')
  const health = await serviceHealth()
  const stackRunning = Object.values(health).every(Boolean)
  const files = selectFiles(manifest, options.features)
  const quick = await inspectFiles(root, files, cache, { cachedOnly: true })
  const imagesMissing = !(await Promise.all(imagePlans(sparkEnv(), []).map((plan) => imageExists(plan.name)))).every(Boolean)
  const facts = await probePlatform(root, existsSync(ARIA2.bin) ? ARIA2.bin : undefined)
  const checks = assessPlatform(facts, {
    downloadBytes: totalBytes(quick.filter((status) => status.state === 'missing' || status.state === 'partial').map((status) => status.file)),
    imagesMissing, startGb: Number(process.env.SPARK_REQUIRED_FREE_GB ?? 95), stackRunning,
  })
  printChecks(checks, log)
  if (checks.some((check) => check.fatal)) {
    log('\nThis machine is not an NVIDIA DGX Spark (aarch64 + GB10); Cinefoundry supports only that platform. Nothing was changed.')
    return 1
  }
  const fixes = rootFixes(checks)
  if (checks.some((check) => check.name === 'model disk' && check.status === 'fail')) {
    log('\nNot enough disk for the model weights; nothing was downloaded.')
    return 1
  }

  // 2-3. Models (no root needed): run even when root fixes are pending, so the long download is not held up.
  const result = await models(root, manifest, options, net, cache)
  if (options.mode === 'install') await writeFile(statePath(), JSON.stringify({ features: options.features, modelRoot: root, updated: new Date().toISOString() }, null, 2))
  let ready = result.ready
  if (options.features.includes('kokoro')) ready = (await ensureKokoroVenv(options)) && ready

  if (options.modelsOnly) return summary(options, ready, fixes, result)

  if (fixes.length) {
    log('\n[needs root] run these, then run scripts/install.sh again (it resumes where it stopped):')
    for (const fix of fixes) log(`  ${fix}`)
    return summary(options, false, fixes, result)
  }

  log('\n[config]')
  await ensureSparkEnv(root, options)
  log('\n[sources]')
  const needMoss = !(await imageExists('cinefoundry/moss-audio:local'))
  ready = (await checkouts(options, needMoss)) && ready
  log('\n[images]')
  const imagesReady = await images(options)
  ready = imagesReady && ready
  log('\n[voices]')
  ready = (imagesReady && result.ready ? await voices(root, options) : (log('  waiting for images and models'), false)) && ready

  if (!options.noStart) {
    log('\n[stack]')
    const now = await serviceHealth()
    if (Object.values(now).every(Boolean)) {
      log('  ok    nemotron :8001, stepvl :8002, comfyui :8188 already running')
      if (options.mode === 'install') ready = (await stream(['node', 'dist/cli.js', 'doctor'], (line) => log(`  ${line}`))) === 0 && ready
    } else if (options.mode !== 'install') {
      log(`  ${options.mode === 'dry-run' ? 'would run' : 'not running:'} scripts/spark-up.sh  (${Object.entries(now).map(([name, up]) => `${name} ${up ? 'up' : 'down'}`).join(', ')})`)
      ready = false
    } else if (!ready) {
      log('  not starting: the steps above are not complete')
    } else {
      const lock = join(REPO_ROOT, 'projects', '.harness.lock')
      if (existsSync(lock)) log(`  note  ${lock} exists; spark-up only starts services, it does not touch a running film`)
      const available = (await memoryStatus()).availableGb
      log(`  starting the stack (${available} GB unified memory available)`)
      ready = (await stream(['bash', 'scripts/spark-up.sh'], (line) => log(`  ${line}`))) === 0
    }
  }
  return summary(options, ready, fixes, result)
}

function summary(options: SetupOptions, ready: boolean, fixes: string[], result: ModelsResult): number {
  const { log } = options
  log('')
  if (result.blocked.length) log(`Gated weights not downloaded (${result.blocked.length} files): accept the terms at ${[...new Set(result.blocked.map((file) => file.gated!.url))].join(', ')}, set HF_TOKEN, re-run.`)
  if (fixes.length && options.modelsOnly) log(`Root prerequisites still missing:\n  ${fixes.join('\n  ')}`)
  if (!ready) {
    log(options.mode === 'install' ? 'Setup is not complete. Fix what is reported above and run scripts/install.sh again; finished steps are skipped.' : 'Not ready: see above.')
    return 1
  }
  if (options.modelsOnly) {
    log('All model weights are present and verified.')
    return 0
  }
  log(options.noStart ? 'Installed. Start the stack with scripts/spark-up.sh, then make a first film:' : 'Cinefoundry is ready. A first film of each format:')
  for (const command of firstFilmCommands()) log(`  ${command}`)
  log(`Studio: ${STUDIO.command}  ->  ${STUDIO.url}`)
  return 0
}

/** `setup manifest`: rebuild deploy/models.json from the Hub (`--refresh`) or compare it with the Hub (default). */
export async function manifestCommand(refresh: boolean, proxy: string | undefined, log: (line: string) => void): Promise<number> {
  const net = netConfig(process.env, { proxy })
  return withAuthHeader(net, async (headerFile) => {
    if (refresh) {
      const manifest = await buildManifest(net, headerFile ? { headerFile } : undefined, log)
      await writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`)
      log(`wrote ${manifestPath()}: ${manifest.files.length} files, ${gb(totalBytes(manifest.files))} GB`)
      return 0
    }
    const manifest = loadManifest()
    const problems = await checkUpstream(net, manifest.files, headerFile ? { headerFile } : undefined)
    for (const problem of problems) log(problem)
    log(problems.length ? `${problems.length} differences from the Hub` : `all ${manifest.files.filter((file) => file.source.type === 'hf').length} Hugging Face files match the Hub at their pinned revisions`)
    return problems.length ? 1 : 0
  })
}

export { featuresFor }
