import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configurationMarkdown, env, SETTINGS } from '../src/lib/config.js'

const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
})

describe('configuration', () => {
  const declared = new Set<string>(SETTINGS.map((s) => s.name))

  it('is read in one place: no module but src/lib/config.ts reads process.env', () => {
    const offenders = sources('src')
      .filter((file) => file !== join('src', 'lib', 'config.ts'))
      .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => `${file}: ${m[1]}`))
    expect(offenders).toEqual([])
  })

  it('declares every variable the code names', () => {
    const named = sources('src').flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/\b(?:env\(['"]|env\.)((?:CINEFOUNDRY|COMFYUI|SPARK|STEPFUN|TYPESAFE|ARK)_[A-Z0-9_]*)/g)].map((m) => m[1]!))
    expect(named.filter((name) => !declared.has(name))).toEqual([])
    // And every declared variable is read somewhere: a setting nothing reads would document a switch that does nothing.
    const all = sources('src').filter((file) => !file.endsWith('config.ts')).map((file) => readFileSync(file, 'utf8')).join('\n')
    expect([...declared].filter((name) => !all.includes(name))).toEqual([])
  })

  it('gives every variable a meaning and keeps names unique', () => {
    expect(declared.size).toBe(SETTINGS.length)
    for (const setting of SETTINGS) expect(setting.meaning.length).toBeGreaterThan(10)
  })

  it('returns the environment\'s value when set, even empty, else the default', () => {
    expect(env('CINEFOUNDRY_PROJECTS', {})).toBe('projects')
    expect(env('CINEFOUNDRY_PROJECTS', { CINEFOUNDRY_PROJECTS: '/srv/films' })).toBe('/srv/films')
    expect(env('CINEFOUNDRY_TTS_STYLE', { CINEFOUNDRY_TTS_STYLE: '' })).toBe('')
    expect(env('STEPFUN_API_KEY', {})).toBeUndefined()
    expect(env('CINEFOUNDRY_WORKFLOWS', {})).toMatch(/workflows$/)
  })

  it('is documented in docs/configuration.md, generated from the table (npm run docs:config)', () => {
    expect(readFileSync('docs/configuration.md', 'utf8')).toBe(configurationMarkdown())
  })
})
