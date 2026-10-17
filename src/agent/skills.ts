import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { env } from '../lib/config.js'

const SKILL_ROOT = resolve(env('CINEFOUNDRY_SKILLS')!)

/** The body of a skill (frontmatter stripped): the instructions an agent works under. */
export async function loadSkill(name: string): Promise<string> {
  const raw = await readFile(join(SKILL_ROOT, name, 'SKILL.md'), 'utf8')
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
}

/** The standing rules every agent shares, taken from AGENTS.md so there is one source of truth. */
export async function loadRules(): Promise<string> {
  const raw = await readFile(resolve(env('CINEFOUNDRY_AGENTS_MD')!), 'utf8')
  const start = raw.indexOf('## Rules')
  return start >= 0 ? raw.slice(start).trim() : ''
}
