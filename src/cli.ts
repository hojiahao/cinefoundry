#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { COMMANDS } from './commands/index.js'
import { parseArgs, UsageError } from './lib/args.js'

const HELP = `Cinefoundry - an agentic film studio on a single NVIDIA DGX Spark

  One idea in, a finished film out
  cinefoundry ad "<brief>"      [--duration 30] [--ratio 16:9|9:16|1:1] [--resolution 1080p|2k|4k|6k] [--fps 60|24|30|120] [--product-image photo] [--proof "facts"] [--plan-only]
  cinefoundry short "<topic>"   [--seconds 45] [--ratio 9:16] [--fps 30] [--cast dir] [--plan-only]
  cinefoundry drama "<story>"   [--episodes 10] [--produce 2] [--seconds 60] [--ratio 9:16] [--fps 24] [--cast dir] [--plan-only]
  Common: [--id id] [--video-model ltx25-fast-nvfp4|ltx25-fast|wan22-14b|wan22-5b|seedance] [--candidates 2]
  (cinefoundry harness is the same as cinefoundry ad)

  Individual tools, as the skills call them
  cinefoundry eval [--briefs eval/briefs.json] [--repeats 2]      with/without-skill comparison
  cinefoundry project init --id <id> --brief <text> [--title] [--ratio 9:16] [--duration 15]
  cinefoundry project status --id <id>
  cinefoundry project stage --id <id> --stage <stage> --status <pending|running|done|failed> [--note]
  cinefoundry copy-check <file|-> [--category general|food|health_food|cosmetics|medical]
  cinefoundry shots <video> [--out dir] [--threshold 0.30]
  cinefoundry image --prompt <text> [--size 1328x1328] [--ref img ...] [--model qwen-image|qwen-image-2512] [--edit-model qwen-image-edit-2509|qwen-image-edit-2511] [--project id --shot n | --out file]
  cinefoundry video --prompt <text> [--first-frame img] [--duration 5] [--ratio 16:9] [--resolution 1080p] [--project id --shot n | --out file]
  cinefoundry qa --frame <img> [--ref img ...] [--expect text] [--project id --shot n]
  cinefoundry cut --project <id> [--audio file] [--silent] [--end-still img] re-run end card, titles, sound and grade
  cinefoundry mem <status|plan|free> [--need name=GB ...]
  cinefoundry doctor
  cinefoundry studio [--port 3090] [--host 127.0.0.1]
`

// Optional API keys for cloud routes live outside the repo (runtime-data/ is git-ignored).
const keysFile = process.env.CINEFOUNDRY_KEYS_FILE ?? 'runtime-data/keys.env'
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
