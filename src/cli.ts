#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { COMMANDS } from './commands/index.js'
import { parseArgs, UsageError } from './lib/args.js'

const HELP = `CineLoom - agentic ad-film studio for a single DGX Spark

  CineLoom Harness: one brief in, one finished film out

  cineloom harness "<brief>" [--id id] [--ratio 9:16] [--duration 15] [--product-image photo] [--plan-only] [--video-model wan22-14b|wan22-5b|ltx25-fast|ltx25-fast-nvfp4|seedance]

  Individual tools, as the skills call them
  cineloom eval [--briefs eval/briefs.json] [--repeats 2]      with/without-skill comparison
  cineloom project init --id <id> --brief <text> [--title] [--ratio 9:16] [--duration 15]
  cineloom project status --id <id>
  cineloom project stage --id <id> --stage <stage> --status <pending|running|done|failed> [--note]
  cineloom copy-check <file|-> [--category general|food|health_food|cosmetics|medical]
  cineloom shots <video> [--out dir] [--threshold 0.30]
  cineloom image --prompt <text> [--size 1328x1328] [--ref img ...] [--project id --shot n | --out file]
  cineloom video --prompt <text> [--first-frame img] [--duration 5] [--ratio 9:16] [--resolution 720p] [--project id --shot n | --out file]
  cineloom qa --frame <img> [--ref img ...] [--expect text] [--project id --shot n]
  cineloom cut --project <id> [--audio file] [--silent]            re-run end card, titles, sound and grade
  cineloom mem <status|plan|free> [--need name=GB ...]
  cineloom doctor
  cineloom studio [--port 3090] [--host 127.0.0.1]
`

// Optional API keys for cloud routes live outside the repo (runtime-data/ is git-ignored).
const keysFile = process.env.CINELOOM_KEYS_FILE ?? 'runtime-data/keys.env'
if (existsSync(keysFile)) {
  for (const line of readFileSync(keysFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && !(match[1]! in process.env)) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '')
  }
}

const [name, ...rest] = process.argv.slice(2)
const command = name ? COMMANDS[name] : undefined
if (!command) {
  console.log(HELP)
  process.exit(name && name !== 'help' && name !== '--help' ? 2 : 0)
}
try {
  process.exitCode = await command(parseArgs(rest))
} catch (error) {
  console.error(error instanceof UsageError ? `usage error: ${error.message}` : `error: ${(error as Error).message}`)
  process.exitCode = error instanceof UsageError ? 2 : 1
}
