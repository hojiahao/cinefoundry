import { readFile } from 'node:fs/promises'

export interface MemoryStatus {
  totalGb: number
  availableGb: number
  swapUsedGb: number
}

const KIB_PER_GIB = 1024 ** 2

/** DGX Spark shares one pool between CPU and GPU, so /proc/meminfo is the ground truth. */
export function parseMeminfo(text: string): MemoryStatus {
  const values = new Map<string, number>()
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line)
    if (match) values.set(match[1]!, Number(match[2]) / KIB_PER_GIB)
  }
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    totalGb: round(values.get('MemTotal') ?? 0),
    availableGb: round(values.get('MemAvailable') ?? 0),
    swapUsedGb: round((values.get('SwapTotal') ?? 0) - (values.get('SwapFree') ?? 0)),
  }
}

export async function memoryStatus(): Promise<MemoryStatus> {
  return parseMeminfo(await readFile('/proc/meminfo', 'utf8'))
}

export interface MemoryPlan {
  budgetGb: number
  requiredGb: number
  headroomGb: number
  fits: boolean
  needs: Record<string, number>
}

export function planMemory(status: MemoryStatus, needs: Record<string, number>, reserveGb: number, against: 'total' | 'available'): MemoryPlan {
  const budgetGb = (against === 'total' ? status.totalGb : status.availableGb) - reserveGb
  const requiredGb = Object.values(needs).reduce((sum, value) => sum + value, 0)
  const round = (value: number) => Math.round(value * 10) / 10
  return { budgetGb: round(budgetGb), requiredGb, headroomGb: round(budgetGb - requiredGb), fits: requiredGb <= budgetGb, needs }
}

/**
 * On DGX Spark, CUDA allocates from memory that is actually free: page cache counts as "available" to the kernel but a
 * model load still failed with out-of-memory at 1 GB free and 53 GB cached (2026-10-17, after a 40 GB download). Model
 * weights are read once at load and stay in the cache; dropping their pages (posix_fadvise DONTNEED, no root needed)
 * gives the next phase that memory back. Files under the roots larger than 1 MiB are released.
 */
export async function releaseFileCache(roots: string[]): Promise<{ freeBeforeGb: number; freeAfterGb: number }> {
  const free = async () => parseMeminfo(await readFile('/proc/meminfo', 'utf8').then((t) => t.replace(/^MemAvailable:/m, 'MemAvailableX:').replace(/^MemFree:/m, 'MemAvailable:')))
  const before = (await free()).availableGb
  if (process.env.CINEFOUNDRY_RELEASE_CACHE === '0') return { freeBeforeGb: before, freeAfterGb: before }
  const script = `import os,sys
for root in sys.argv[1:]:
    for d,_,fs in os.walk(root):
        for f in fs:
            p=os.path.join(d,f)
            try:
                if os.path.getsize(p) < 1<<20: continue
                fd=os.open(p,os.O_RDONLY); os.posix_fadvise(fd,0,0,os.POSIX_FADV_DONTNEED); os.close(fd)
            except OSError: pass`
  const { exec } = await import('./exec.js')
  await exec('python3', ['-c', script, ...roots]).catch(() => undefined)
  return { freeBeforeGb: before, freeAfterGb: (await free()).availableGb }
}

/** Where model weights live: the model root (SPARK_MODEL_DIR, default ~/models). */
export const modelRoots = () => [process.env.SPARK_MODEL_DIR ?? `${process.env.HOME ?? ''}/models`]
