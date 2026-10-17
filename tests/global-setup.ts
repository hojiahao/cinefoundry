import { execFileSync } from 'node:child_process'

/**
 * tests/pipeline.test.ts runs the built CLI (dist/cli.js) as an agent would, in its own process. Build it from the
 * current sources first, so a fresh checkout's `npx vitest run` passes and no test ever runs a stale build.
 */
export default function setup(): void {
  try {
    execFileSync('npm', ['run', '--silent', 'build'], { stdio: 'pipe' })
  } catch (error) {
    const failure = error as { stdout?: Buffer; stderr?: Buffer }
    throw new Error(`npm run build failed before the tests:\n${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`)
  }
}
