import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { projectsRoot } from '../lib/project.js'

/**
 * One GPU, one film at a time, enforced here rather than left to whoever starts the run: a second run
 * makes both slow and can fail a model load, and agents asked to check first with pgrep skipped it
 * (eval/skill-bench, cinefoundry-ad-film: 32 of 32 plans). A lock whose process is gone is stale and is taken over.
 */
export async function takeRunLock(request: string): Promise<() => Promise<void>> {
  const lock = join(projectsRoot(), '.harness.lock')
  await mkdir(projectsRoot(), { recursive: true })
  // Created atomically (O_EXCL): two runs started together can no longer both read "no lock" and both write one.
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lock, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), brief: request }))
      await handle.close()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error
      const held = await readFile(lock, 'utf8').then((text) => JSON.parse(text) as { pid: number; startedAt: string; brief: string }).catch(() => undefined)
      if (held && held.pid !== process.pid && alive(held.pid)) {
        throw new Error(`Another film is generating (pid ${held.pid}, started ${held.startedAt}: "${held.brief.slice(0, 60)}"). One film at a time on this GPU: wait for it to finish, or stop it first.`)
      }
      await rm(lock, { force: true }) // stale: its process is gone
    }
  }
  return async () => {
    const now = await readFile(lock, 'utf8').then((text) => JSON.parse(text) as { pid: number }).catch(() => undefined)
    if (now?.pid === process.pid) await rm(lock, { force: true })
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Who holds the run lock right now, if anyone: a lock whose process is gone does not count. */
export async function runLockHolder(): Promise<{ pid: number; startedAt: string; brief: string } | undefined> {
  const held = await readFile(join(projectsRoot(), '.harness.lock'), 'utf8').then((text) => JSON.parse(text) as { pid: number; startedAt: string; brief: string }).catch(() => undefined)
  return held && alive(held.pid) ? held : undefined
}
