import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every environment variable Cinefoundry reads, in one place: its name, its default and what it changes. Code reads a
 * setting through `env()` at the moment it needs it (never a copy taken at start-up unless the module documents
 * otherwise), so the keys file loaded by the CLI and a test that sets a variable both take effect.
 * docs/configuration.md is generated from this table (`npm run docs:config`) and a test keeps the two in step.
 */

export type SettingGroup = 'Local services' | 'Cloud routes' | 'Paths' | 'Generation models' | 'Voice and audio' | 'Scheduling and memory' | 'Quality' | 'Install' | 'Studio'

export interface Setting {
  readonly name: string
  readonly group: SettingGroup
  /** The default as documented; `fallback` computes it when it depends on the machine. Absent: unset means off. */
  readonly default?: string
  readonly fallback?: () => string
  readonly meaning: string
}

/** The model root every model folder defaults under. */
const modelRootFallback = () => process.env.SPARK_MODEL_DIR ?? join(homedir(), 'models')

export const SETTINGS = [
  // Local services
  { name: 'COMFYUI_URL', group: 'Local services', default: 'http://127.0.0.1:8188', meaning: 'ComfyUI HTTP API that runs every image, video, interpolation and music graph.' },
  { name: 'CINEFOUNDRY_PLANNER_URL', group: 'Local services', default: 'http://127.0.0.1:8001/v1', meaning: 'OpenAI-compatible base URL of the planner model that writes briefs, scripts, screenplays and shot lists.' },
  { name: 'CINEFOUNDRY_PLANNER_MODEL', group: 'Local services', default: 'nemotron-3.5-lightning', meaning: 'Model name sent to the planner endpoint.' },
  { name: 'CINEFOUNDRY_PLANNER_KEY', group: 'Local services', default: 'local', meaning: 'Bearer token sent to the planner endpoint.' },
  { name: 'CINEFOUNDRY_WRITER_URL', group: 'Local services', meaning: 'OpenAI-compatible base URL of the writers\' room model (Nemotron 3.5 Super VL, compose profile `super`). When set, the story of a narrative film - development, screenplay, script notes, compliance, shot list and casting briefs - is written and reviewed on it; unset, on the planner.' },
  { name: 'CINEFOUNDRY_WRITER_MODEL', group: 'Local services', default: 'nemotron-3.5-super-vl', meaning: 'Model name sent to the writers\' room endpoint.' },
  { name: 'CINEFOUNDRY_WRITER_CONTAINER', group: 'Local services', default: 'cinefoundry-nemotron-super-1', meaning: 'Docker container of the writers\' room model: started when the room opens, stopped when it closes (its weights do not survive a level-2 sleep and reload).' },
  { name: 'CINEFOUNDRY_PLANNER_CONTAINER', group: 'Local services', default: 'cinefoundry-nemotron-1', meaning: 'Docker container of the planner: stopped while the writers\' room works if it has no sleep mode, started again when the room closes.' },
  { name: 'CINEFOUNDRY_VISION_CONTAINER', group: 'Local services', default: 'cinefoundry-stepvl-1', meaning: 'Docker container of the vision model: stopped while the writers\' room works if it has no sleep mode, started again when the room closes.' },
  { name: 'CINEFOUNDRY_VISION_URL', group: 'Local services', default: 'http://127.0.0.1:8002/v1', meaning: 'OpenAI-compatible base URL of the vision model behind every quality gate.' },
  { name: 'CINEFOUNDRY_VISION_MODEL', group: 'Local services', default: 'step3-vl-10b', meaning: 'Model name sent to the vision endpoint.' },
  { name: 'CINEFOUNDRY_VISION_KEY', group: 'Local services', default: 'local', meaning: 'Bearer token sent to the vision endpoint.' },
  // Cloud routes (all off unless their key is set)
  { name: 'STEPFUN_API_KEY', group: 'Cloud routes', meaning: 'When set, text reviews (compliance, copy) go to StepFun\'s hosted model and are recorded as cloud; unset, a separate local planner agent reviews.' },
  { name: 'CINEFOUNDRY_EDITOR_MODEL', group: 'Cloud routes', default: 'step-3.7-flash', meaning: 'StepFun model used for text reviews when STEPFUN_API_KEY is set.' },
  { name: 'TYPESAFE_API_KEY', group: 'Cloud routes', meaning: 'When set, the TypeSafe Jev judge (cloud, text only) also answers typed questions about an ad\'s script and storyboard.' },
  { name: 'TYPESAFE_ENDPOINT', group: 'Cloud routes', default: 'https://api.typesafe.ai/v1/systemone', meaning: 'TypeSafe Jev endpoint.' },
  { name: 'TYPESAFE_MODEL', group: 'Cloud routes', default: 'jev-latest', meaning: 'TypeSafe Jev model.' },
  { name: 'ARK_API_KEY', group: 'Cloud routes', meaning: 'Enables the opt-in Seedance cloud video route (`--model seedance`); the first frame leaves the machine.' },
  { name: 'ARK_VIDEO_ENDPOINT', group: 'Cloud routes', default: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', meaning: 'Volcengine Ark task endpoint of the Seedance route.' },
  { name: 'ARK_VIDEO_MODEL', group: 'Cloud routes', default: 'doubao-seedance-2-0-fast-260128', meaning: 'Seedance model id.' },
  // Paths
  { name: 'CINEFOUNDRY_PROJECTS', group: 'Paths', default: 'projects', meaning: 'Folder that holds every project (state.json, assets, reports) and the run lock.' },
  { name: 'CINEFOUNDRY_SKILLS', group: 'Paths', default: '.agents/skills', meaning: 'Folder of the agent skills loaded into each stage agent. Read once at start-up.' },
  { name: 'CINEFOUNDRY_AGENTS_MD', group: 'Paths', default: 'AGENTS.md', meaning: 'File whose `## Rules` section is injected into every agent.' },
  { name: 'CINEFOUNDRY_WORKFLOWS', group: 'Paths', default: '<package>/workflows', fallback: () => join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'workflows'), meaning: 'Folder of the ComfyUI workflow templates. Read once at start-up.' },
  { name: 'CINEFOUNDRY_KEYS_FILE', group: 'Paths', default: 'runtime-data/keys.env', meaning: 'KEY=value file the CLI loads at start-up for variables not already set (API keys stay out of the repository).' },
  { name: 'CINEFOUNDRY_BRANDS', group: 'Paths', default: 'brands', meaning: 'Root of the brand kits (brands/<brand-id>/brand.json); kept out of the repository.' },
  { name: 'CINEFOUNDRY_VOICE_LIBRARY', group: 'Paths', default: 'deploy/voices/library.json', meaning: 'The casting library of designed voices.' },
  { name: 'CINEFOUNDRY_STEP_AUDIO_DIR', group: 'Paths', default: 'runtime-data/step-audio', meaning: 'Work folder shared with the audio containers: voice references, lines, effects and job files live under it.' },
  { name: 'SPARK_MODEL_DIR', group: 'Paths', default: '~/models', fallback: () => join(homedir(), 'models'), meaning: 'Model root; the audio model folders default under it and memory release walks it.' },
  { name: 'CINEFOUNDRY_TTS_MODEL_DIR', group: 'Paths', default: '$SPARK_MODEL_DIR/tts', fallback: () => join(modelRootFallback(), 'tts'), meaning: 'Qwen3-TTS weights (voice design and cloning), mounted read-only into the TTS container.' },
  { name: 'CINEFOUNDRY_ASR_MODEL_DIR', group: 'Paths', default: '$SPARK_MODEL_DIR/asr', fallback: () => join(modelRootFallback(), 'asr'), meaning: 'Whisper weights for the pronunciation check, mounted read-only into the audio container.' },
  { name: 'CINEFOUNDRY_SFX_MODEL_DIR', group: 'Paths', default: '$SPARK_MODEL_DIR/audio/MOSS-SoundEffect-v2.0', fallback: () => join(modelRootFallback(), 'audio', 'MOSS-SoundEffect-v2.0'), meaning: 'MOSS-SoundEffect weights for ambience and effects.' },
  // Generation models
  { name: 'CINEFOUNDRY_IMAGE_MODEL', group: 'Generation models', default: 'qwen-image', meaning: 'Text-to-image model when a request names none: `qwen-image` (Lightning) or `qwen-image-2512`.' },
  { name: 'CINEFOUNDRY_EDIT_MODEL', group: 'Generation models', default: 'qwen-image-edit-2509', meaning: 'Edit model for requests with references when none is named: `qwen-image-edit-2509` or `qwen-image-edit-2511`.' },
  { name: 'CINEFOUNDRY_VIDEO_MODEL', group: 'Generation models', meaning: 'Video model when a request names none; unset, `ltx25-fast` with a first frame and `wan22-5b` without.' },
  { name: 'CINEFOUNDRY_RIFE_MODEL', group: 'Generation models', default: 'rife426.pth', meaning: 'RIFE checkpoint for frame interpolation. Read once at start-up.' },
  { name: 'CINEFOUNDRY_IMAGE_NATIVE_MAX_PIXELS', group: 'Generation models', default: String(1328 * 1328), meaning: 'Pixel budget an image is generated at before it is upscaled to the delivery size. Read once at start-up.' },
  // Voice and audio
  { name: 'CINEFOUNDRY_TTS_ENGINE', group: 'Voice and audio', default: 'kokoro', meaning: 'Voiceover engine of an ad without a cast voice: `kokoro`, `step-audio` or `qwen-tts`.' },
  { name: 'CINEFOUNDRY_TTS_PYTHON', group: 'Voice and audio', default: 'runtime-data/tts-venv/bin/python', meaning: 'Python interpreter that runs the Kokoro script.' },
  { name: 'CINEFOUNDRY_TTS_SCRIPT', group: 'Voice and audio', default: 'scripts/tts.py', meaning: 'Kokoro synthesis script.' },
  { name: 'CINEFOUNDRY_TTS_VOICE', group: 'Voice and audio', default: 'zf_001', meaning: 'Kokoro voice id.' },
  { name: 'CINEFOUNDRY_TTS_REF_WAV', group: 'Voice and audio', meaning: 'Reference clip (under the step-audio folder) the cloning engines speak with when no voice was cast.' },
  { name: 'CINEFOUNDRY_TTS_REF_TEXT', group: 'Voice and audio', meaning: 'Transcript of CINEFOUNDRY_TTS_REF_WAV.' },
  { name: 'CINEFOUNDRY_TTS_STYLE', group: 'Voice and audio', meaning: 'Step-Audio-EditX style each line is re-voiced in; empty or unset: none.' },
  { name: 'CINEFOUNDRY_STEP_AUDIO_SCRIPT', group: 'Voice and audio', default: 'scripts/step-audio.sh', meaning: 'Batch script of the Step-Audio-EditX engine.' },
  { name: 'CINEFOUNDRY_VOICE_CHAIN', group: 'Voice and audio', default: '1', meaning: '`0` skips the broadcast voice chain (compression, EQ, limiter) on cloned voiceover.' },
  { name: 'CINEFOUNDRY_QWEN_TTS_IMAGE', group: 'Voice and audio', default: 'cinefoundry/qwen-tts:local', meaning: 'Docker image of Qwen3-TTS (voice design and cloning).' },
  { name: 'CINEFOUNDRY_AUDIO_IMAGE', group: 'Voice and audio', default: 'cinefoundry/moss-audio:local', meaning: 'Docker image of Whisper and MOSS-SoundEffect.' },
  // Scheduling and memory
  { name: 'CINEFOUNDRY_SLEEP_LLMS', group: 'Scheduling and memory', default: '1', meaning: '`0` keeps the language models awake while diffusion models work.' },
  { name: 'CINEFOUNDRY_SLEEP_LEVEL', group: 'Scheduling and memory', default: '2', meaning: 'vLLM sleep level: `2` releases weights and KV cache (reloaded on wake), `1` keeps weights in host memory.' },
  { name: 'CINEFOUNDRY_RELEASE_CACHE', group: 'Scheduling and memory', default: '1', meaning: '`0` skips releasing model files from the page cache (posix_fadvise) at phase boundaries.' },
  { name: 'CINEFOUNDRY_PHASE_SETTLE_MS', group: 'Scheduling and memory', default: '3000', meaning: 'Pause at a phase boundary after ComfyUI is freed and the page cache released, before memory is measured and the next model loads.' },
  { name: 'CINEFOUNDRY_EXEC_TIMEOUT_MS', group: 'Scheduling and memory', default: String(45 * 60 * 1000), meaning: 'Longest any child process (ffmpeg, a container) may run before it is killed. Read once at start-up.' },
  // Quality
  { name: 'CINEFOUNDRY_CRAFT_FLOOR', group: 'Quality', default: '6', meaning: 'Lowest craft rating (light, composition, realism; 0-10) a gated frame may have. A value that is not a number keeps 6. Read once at start-up.' },
  // Install (scripts/install.sh, cinefoundry setup, cinefoundry doctor)
  { name: 'CINEFOUNDRY_MODEL_MANIFEST', group: 'Install', default: '<package>/deploy/models.json', fallback: () => join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'deploy', 'models.json'), meaning: 'Model manifest the installer downloads and verifies (every file pinned to a revision and identified by sha256 or git blob id).' },
  { name: 'HF_ENDPOINT', group: 'Install', default: 'https://huggingface.co', meaning: 'Hugging Face endpoint or mirror the weights are downloaded from, e.g. `https://hf-mirror.com`.' },
  { name: 'HF_TOKEN', group: 'Install', meaning: 'Hugging Face token for the gated LTX-2.5 repository; unset, the token file under HF_HOME, $SPARK_MODEL_DIR/hf or ~/.cache/huggingface is used if present. Sent for gated files only.' },
  { name: 'HF_HOME', group: 'Install', meaning: 'Hugging Face home whose `token` file is read when HF_TOKEN is unset.' },
  { name: 'CINEFOUNDRY_PROXY', group: 'Install', meaning: 'Proxy URL for every installer download, or `none` to ignore a proxy set in the environment; unset, curl and aria2c use http(s)_proxy.' },
  { name: 'CINEFOUNDRY_REGISTRY_MIRRORS', group: 'Install', default: 'docker.m.daocloud.io', meaning: 'Comma-separated registry mirrors tried, in order, when the vLLM image cannot be pulled from Docker Hub; the pulled image is re-tagged to its canonical name.' },
  { name: 'CINEFOUNDRY_GITHUB_MIRROR', group: 'Install', meaning: 'Prefix put in front of GitHub URLs (source checkouts, aria2c), e.g. `https://ghfast.top/`.' },
  { name: 'PIP_INDEX_URL', group: 'Install', meaning: 'Python package index written to a new deploy/spark/spark.env for the image builds; unset, the example\'s value.' },
  { name: 'SPARK_REQUIRED_FREE_GB', group: 'Install', default: '95', meaning: 'Unified memory (GB) that must be available to start the stack; also read by scripts/spark-up.sh.' },
  // Studio
  { name: 'CINEFOUNDRY_STUDIO_TOKEN', group: 'Studio', meaning: 'When set, starting a job from the studio requires this value in the `x-cinefoundry-token` header.' },
] as const satisfies readonly Setting[]

export type SettingName = (typeof SETTINGS)[number]['name']

const byName = new Map<string, Setting>(SETTINGS.map((setting) => [setting.name, setting]))

/** The value of a setting: the environment's when it is set (even to ""), else its default; undefined when it has none. */
export function env(name: SettingName, source: Record<string, string | undefined> = process.env): string | undefined {
  const value = source[name]
  if (value !== undefined) return value
  const setting = byName.get(name)!
  return setting.fallback ? setting.fallback() : setting.default
}

/** The model root (SPARK_MODEL_DIR, default ~/models). */
export const modelRoot = () => env('SPARK_MODEL_DIR')!

/** docs/configuration.md, rendered from SETTINGS. */
export function configurationMarkdown(): string {
  const cell = (text: string) => text.replace(/\|/g, '\\|')
  const groups = [...new Set(SETTINGS.map((s) => s.group))]
  const sections = groups.map((group) => {
    const rows = (SETTINGS as readonly Setting[]).filter((s) => s.group === group).map((s) => `| \`${s.name}\` | ${s.default === undefined ? 'unset' : `\`${cell(s.default)}\``} | ${cell(s.meaning)} |`)
    return `## ${group}\n\n| Variable | Default | Meaning |\n|---|---|---|\n${rows.join('\n')}\n`
  })
  return `# Configuration\n\nCinefoundry is configured by environment variables only. This table is generated from \`src/lib/config.ts\` (\`npm run docs:config\`); relative paths resolve against the working directory.\n\n${sections.join('\n')}`
}
