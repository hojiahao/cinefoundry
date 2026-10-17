import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../lib/config.js'
import { inspectFiles } from './download.js'
import { installedFeatures, resolveModelRoot } from './index.js'
import { loadManifest, REPO_ROOT, selectFiles, totalBytes, gb } from './manifest.js'
import { assessPlatform, probePlatform } from './platform.js'
import { imageExists, imagePlans, serviceHealth, sparkEnv, voiceLibraryStatus } from './stack.js'
import { VerifyCache } from './verify.js'

export interface DoctorSection {
  ok: boolean
  problems: string[]
  warnings: string[]
  detail?: Record<string, unknown>
}

/**
 * The installation half of `cinefoundry doctor`: platform, model files (hash-verified by the installer; `verify`
 * hashes now), images, voice library and services. Model files never count as installed by their size.
 */
export async function installationReport(options: { verify?: boolean } = {}): Promise<Record<string, DoctorSection>> {
  const root = resolveModelRoot()
  const health = await serviceHealth()
  const plans = imagePlans(sparkEnv(), [])
  const present = await Promise.all(plans.map((plan) => imageExists(plan.name)))
  const files = selectFiles(loadManifest(), installedFeatures())
  const cache = new VerifyCache(join(REPO_ROOT, 'runtime-data', 'setup', 'verified.json'))
  const statuses = await inspectFiles(root, files, cache, { cachedOnly: !options.verify })
  if (options.verify) await cache.save()
  const facts = await probePlatform(root, existsSync(join(REPO_ROOT, '.tools', 'aria2', 'aria2c')) ? join(REPO_ROOT, '.tools', 'aria2', 'aria2c') : undefined)
  const missing = statuses.filter((status) => status.state === 'missing' || status.state === 'partial')
  const checks = assessPlatform(facts, {
    downloadBytes: totalBytes(missing.map((status) => status.file)),
    imagesMissing: present.some((value) => !value), startGb: Number(env('SPARK_REQUIRED_FREE_GB')), stackRunning: Object.values(health).every(Boolean),
  })
  const voices = existsSync(join(REPO_ROOT, 'deploy', 'voices', 'library.json')) ? voiceLibraryStatus() : { total: 0, ready: [], missing: [] }
  const unverified = statuses.filter((status) => status.state === 'unverified')
  return {
    platform: {
      ok: !checks.some((check) => check.status === 'fail'),
      problems: checks.filter((check) => check.status === 'fail').map((check) => `${check.name}: ${check.detail}${check.fix ? ` (fix: ${check.fix})` : ''}`),
      warnings: checks.filter((check) => check.status === 'warn').map((check) => `${check.name}: ${check.detail}`),
    },
    models: {
      ok: statuses.every((status) => status.state === 'verified' || status.state === 'unverified'),
      problems: statuses.filter((status) => status.state === 'missing' || status.state === 'partial' || status.state === 'mismatch').map((status) => `${status.state}: ${status.file.id} (${status.path})`),
      warnings: unverified.length ? [`${unverified.length} files (${gb(totalBytes(unverified.map((status) => status.file)))} GB) present but not hash-verified yet: run cinefoundry doctor --verify or scripts/install.sh`] : [],
      detail: { root, files: statuses.length, verified: statuses.filter((status) => status.state === 'verified').length },
    },
    images: {
      ok: present.every(Boolean),
      problems: plans.filter((_, index) => !present[index]).map((plan) => `image missing: ${plan.name} (scripts/install.sh builds it)`),
      warnings: [],
    },
    voices: {
      ok: true,
      problems: [],
      warnings: voices.missing.length ? [`${voices.missing.length} of ${voices.total} library voices have no QC-passed reference on this machine (scripts/install.sh builds them)`] : [],
      detail: { ready: voices.ready.length, total: voices.total },
    },
    services: {
      ok: Object.values(health).every(Boolean),
      problems: Object.entries(health).filter(([, up]) => !up).map(([name]) => `${name} is not answering (scripts/spark-up.sh)`),
      warnings: [],
    },
  }
}
