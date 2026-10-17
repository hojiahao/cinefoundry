import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const SKILL_ROOT = resolve(process.env.SPOTFOUNDRY_SKILLS ?? '.agents/skills')

/** The body of a skill (frontmatter stripped): the instructions an agent works under. */
export async function loadSkill(name: string): Promise<string> {
  const raw = await readFile(join(SKILL_ROOT, name, 'SKILL.md'), 'utf8')
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
}

/** The standing rules every agent shares, taken from AGENTS.md so there is one source of truth. */
export async function loadRules(): Promise<string> {
  const raw = await readFile(resolve(process.env.SPOTFOUNDRY_AGENTS_MD ?? 'AGENTS.md'), 'utf8')
  const start = raw.indexOf('## Rules')
  return start >= 0 ? raw.slice(start).trim() : ''
}
