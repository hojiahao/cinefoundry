import { spawn } from 'node:child_process'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

/** Run a program to completion. Rejects on a non-zero exit unless `allowFailure` is set. */
/** No child runs forever: a hung ffmpeg or a stuck container used to hang the harness for good. */
const DEFAULT_TIMEOUT_MS = Number(process.env.CINEFOUNDRY_EXEC_TIMEOUT_MS) || 45 * 60 * 1000

export function exec(command: string, args: string[], options: { allowFailure?: boolean; timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} did not finish within ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s and was stopped`))
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.on('close', () => clearTimeout(timer))
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      const result = { stdout, stderr, code: code ?? -1 }
      if (result.code !== 0 && !options.allowFailure) {
        reject(new Error(`${command} exited with ${result.code}: ${stderr.slice(-1500)}`))
      } else {
        resolve(result)
      }
    })
  })
}
