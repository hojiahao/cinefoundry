import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { env } from '../lib/config.js'
import { exec } from '../lib/exec.js'
import { hfEndpoint, modelRoot } from './manifest.js'

/**
 * Network settings for every download the installer makes. Requests go through curl and aria2c, which honour the
 * standard proxy variables; CINEFOUNDRY_PROXY overrides them (`none` disables any proxy), HF_ENDPOINT selects a Hugging
 * Face mirror such as https://hf-mirror.com.
 */
export interface NetConfig {
  endpoint: string
  /** Undefined: inherit http(s)_proxy from the environment. `none`: no proxy. Otherwise a proxy URL. */
  proxy?: string
  token?: string
}

const PROXY_VARS = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']

/** The Hugging Face token: HF_TOKEN, else the token file of HF_HOME, the model root's hf/ cache, or ~/.cache/huggingface. */
export function findToken(source: Record<string, string | undefined> = process.env): string | undefined {
  const token = env('HF_TOKEN', source)?.trim()
  if (token) return token
  const home = env('HF_HOME', source)
  const candidates = [home && join(home, 'token'), join(modelRoot(source), 'hf', 'token'), join(homedir(), '.cache', 'huggingface', 'token')]
  for (const path of candidates) if (path && existsSync(path)) {
    const token = readFileSync(path, 'utf8').trim()
    if (token) return token
  }
  return undefined
}

export function netConfig(source: Record<string, string | undefined> = process.env, override: { proxy?: string } = {}): NetConfig {
  return { endpoint: hfEndpoint(source), proxy: override.proxy ?? (env('CINEFOUNDRY_PROXY', source) || undefined), token: findToken(source) }
}

/** Environment for a download child: proxy variables removed when the proxy is disabled or given explicitly. */
export function childEnv(net: NetConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!net.proxy) return base
  const env = { ...base }
  for (const name of PROXY_VARS) delete env[name]
  return env
}

/** curl flags for the configured proxy. */
export function curlProxyArgs(net: NetConfig): string[] {
  if (!net.proxy) return []
  return net.proxy === 'none' ? ['--noproxy', '*'] : ['--proxy', net.proxy]
}

/** GET a JSON document with curl (retries, proxy, optional bearer token passed through a header file, never argv). */
export async function getJson<T>(net: NetConfig, url: string, options: { auth?: boolean; headerFile?: string } = {}): Promise<T> {
  const args = ['-fsSL', '--retry', '4', '--retry-delay', '3', '--connect-timeout', '20', '-A', 'cinefoundry-setup', ...curlProxyArgs(net)]
  if (options.auth && options.headerFile) args.push('-H', `@${options.headerFile}`)
  args.push(url)
  const { stdout, code, stderr } = await exec('curl', args, { allowFailure: true, timeoutMs: 120_000, env: childEnv(net) })
  if (code !== 0) throw new Error(`GET ${url} failed (curl exit ${code}${stderr.trim() ? `: ${stderr.trim().slice(-300)}` : ''})`)
  return JSON.parse(stdout) as T
}
