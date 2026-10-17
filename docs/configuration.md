# Configuration

Cinefoundry is configured by environment variables only. This table is generated from `src/lib/config.ts` (`npm run docs:config`); relative paths resolve against the working directory.

## Local services

| Variable | Default | Meaning |
|---|---|---|
| `COMFYUI_URL` | `http://127.0.0.1:8188` | ComfyUI HTTP API that runs every image, video, interpolation and music graph. |
| `CINEFOUNDRY_PLANNER_URL` | `http://127.0.0.1:8001/v1` | OpenAI-compatible base URL of the planner model that writes briefs, scripts, screenplays and shot lists. |
| `CINEFOUNDRY_PLANNER_MODEL` | `nemotron-3.5-lightning` | Model name sent to the planner endpoint. |
| `CINEFOUNDRY_PLANNER_KEY` | `local` | Bearer token sent to the planner endpoint. |
| `CINEFOUNDRY_VISION_URL` | `http://127.0.0.1:8002/v1` | OpenAI-compatible base URL of the vision model behind every quality gate. |
| `CINEFOUNDRY_VISION_MODEL` | `step3-vl-10b` | Model name sent to the vision endpoint. |
| `CINEFOUNDRY_VISION_KEY` | `local` | Bearer token sent to the vision endpoint. |

## Cloud routes

| Variable | Default | Meaning |
|---|---|---|
| `STEPFUN_API_KEY` | unset | When set, text reviews (compliance, copy) go to StepFun's hosted model and are recorded as cloud; unset, a separate local planner agent reviews. |
| `CINEFOUNDRY_EDITOR_MODEL` | `step-3.7-flash` | StepFun model used for text reviews when STEPFUN_API_KEY is set. |
| `TYPESAFE_API_KEY` | unset | When set, the TypeSafe Jev judge (cloud, text only) also answers typed questions about an ad's script and storyboard. |
| `TYPESAFE_ENDPOINT` | `https://api.typesafe.ai/v1/systemone` | TypeSafe Jev endpoint. |
| `TYPESAFE_MODEL` | `jev-latest` | TypeSafe Jev model. |
| `ARK_API_KEY` | unset | Enables the opt-in Seedance cloud video route (`--model seedance`); the first frame leaves the machine. |
| `ARK_VIDEO_ENDPOINT` | `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks` | Volcengine Ark task endpoint of the Seedance route. |
| `ARK_VIDEO_MODEL` | `doubao-seedance-2-0-fast-260128` | Seedance model id. |

## Paths

| Variable | Default | Meaning |
|---|---|---|
| `CINEFOUNDRY_PROJECTS` | `projects` | Folder that holds every project (state.json, assets, reports) and the run lock. |
| `CINEFOUNDRY_SKILLS` | `.agents/skills` | Folder of the agent skills loaded into each stage agent. Read once at start-up. |
| `CINEFOUNDRY_AGENTS_MD` | `AGENTS.md` | File whose `## Rules` section is injected into every agent. |
| `CINEFOUNDRY_WORKFLOWS` | `<package>/workflows` | Folder of the ComfyUI workflow templates. Read once at start-up. |
| `CINEFOUNDRY_KEYS_FILE` | `runtime-data/keys.env` | KEY=value file the CLI loads at start-up for variables not already set (API keys stay out of the repository). |
| `CINEFOUNDRY_BRANDS` | `brands` | Root of the brand kits (brands/<brand-id>/brand.json); kept out of the repository. |
| `CINEFOUNDRY_VOICE_LIBRARY` | `deploy/voices/library.json` | The casting library of designed voices. |
| `CINEFOUNDRY_STEP_AUDIO_DIR` | `runtime-data/step-audio` | Work folder shared with the audio containers: voice references, lines, effects and job files live under it. |
| `SPARK_MODEL_DIR` | `~/models` | Model root; the audio model folders default under it and memory release walks it. |
| `CINEFOUNDRY_TTS_MODEL_DIR` | `$SPARK_MODEL_DIR/tts` | Qwen3-TTS weights (voice design and cloning), mounted read-only into the TTS container. |
| `CINEFOUNDRY_ASR_MODEL_DIR` | `$SPARK_MODEL_DIR/asr` | Whisper weights for the pronunciation check, mounted read-only into the audio container. |
| `CINEFOUNDRY_SFX_MODEL_DIR` | `$SPARK_MODEL_DIR/audio/MOSS-SoundEffect-v2.0` | MOSS-SoundEffect weights for ambience and effects. |

## Generation models

| Variable | Default | Meaning |
|---|---|---|
| `CINEFOUNDRY_IMAGE_MODEL` | `qwen-image` | Text-to-image model when a request names none: `qwen-image` (Lightning) or `qwen-image-2512`. |
| `CINEFOUNDRY_EDIT_MODEL` | `qwen-image-edit-2509` | Edit model for requests with references when none is named: `qwen-image-edit-2509` or `qwen-image-edit-2511`. |
| `CINEFOUNDRY_VIDEO_MODEL` | unset | Video model when a request names none; unset, `ltx25-fast` with a first frame and `wan22-5b` without. |
| `CINEFOUNDRY_RIFE_MODEL` | `rife426.pth` | RIFE checkpoint for frame interpolation. Read once at start-up. |
| `CINEFOUNDRY_IMAGE_NATIVE_MAX_PIXELS` | `1763584` | Pixel budget an image is generated at before it is upscaled to the delivery size. Read once at start-up. |

## Voice and audio

| Variable | Default | Meaning |
|---|---|---|
| `CINEFOUNDRY_TTS_ENGINE` | `kokoro` | Voiceover engine of an ad without a cast voice: `kokoro`, `step-audio` or `qwen-tts`. |
| `CINEFOUNDRY_TTS_PYTHON` | `runtime-data/tts-venv/bin/python` | Python interpreter that runs the Kokoro script. |
| `CINEFOUNDRY_TTS_SCRIPT` | `scripts/tts.py` | Kokoro synthesis script. |
| `CINEFOUNDRY_TTS_VOICE` | `zf_001` | Kokoro voice id. |
| `CINEFOUNDRY_TTS_REF_WAV` | unset | Reference clip (under the step-audio folder) the cloning engines speak with when no voice was cast. |
| `CINEFOUNDRY_TTS_REF_TEXT` | unset | Transcript of CINEFOUNDRY_TTS_REF_WAV. |
| `CINEFOUNDRY_TTS_STYLE` | unset | Step-Audio-EditX style each line is re-voiced in; empty or unset: none. |
| `CINEFOUNDRY_STEP_AUDIO_SCRIPT` | `scripts/step-audio.sh` | Batch script of the Step-Audio-EditX engine. |
| `CINEFOUNDRY_VOICE_CHAIN` | `1` | `0` skips the broadcast voice chain (compression, EQ, limiter) on cloned voiceover. |
| `CINEFOUNDRY_QWEN_TTS_IMAGE` | `cinefoundry/qwen-tts:local` | Docker image of Qwen3-TTS (voice design and cloning). |
| `CINEFOUNDRY_AUDIO_IMAGE` | `cinefoundry/moss-audio:local` | Docker image of Whisper and MOSS-SoundEffect. |

## Scheduling and memory

| Variable | Default | Meaning |
|---|---|---|
| `CINEFOUNDRY_SLEEP_LLMS` | `1` | `0` keeps the language models awake while diffusion models work. |
| `CINEFOUNDRY_SLEEP_LEVEL` | `2` | vLLM sleep level: `2` releases weights and KV cache (reloaded on wake), `1` keeps weights in host memory. |
| `CINEFOUNDRY_RELEASE_CACHE` | `1` | `0` skips releasing model files from the page cache (posix_fadvise) at phase boundaries. |
| `CINEFOUNDRY_PHASE_SETTLE_MS` | `3000` | Pause at a phase boundary after ComfyUI is freed and the page cache released, before memory is measured and the next model loads. |
| `CINEFOUNDRY_EXEC_TIMEOUT_MS` | `2700000` | Longest any child process (ffmpeg, a container) may run before it is killed. Read once at start-up. |

## Quality

| Variable | Default | Meaning |
|---|---|---|
| `CINEFOUNDRY_CRAFT_FLOOR` | `6` | Lowest craft rating (light, composition, realism; 0-10) a gated frame may have. A value that is not a number keeps 6. Read once at start-up. |

## Install

| Variable | Default | Meaning |
|---|---|---|
| `CINEFOUNDRY_MODEL_MANIFEST` | `<package>/deploy/models.json` | Model manifest the installer downloads and verifies (every file pinned to a revision and identified by sha256 or git blob id). |
| `HF_ENDPOINT` | `https://huggingface.co` | Hugging Face endpoint or mirror the weights are downloaded from, e.g. `https://hf-mirror.com`. |
| `HF_TOKEN` | unset | Hugging Face token for the gated LTX-2.5 repository; unset, the token file under HF_HOME, $SPARK_MODEL_DIR/hf or ~/.cache/huggingface is used if present. Sent for gated files only. |
| `HF_HOME` | unset | Hugging Face home whose `token` file is read when HF_TOKEN is unset. |
| `CINEFOUNDRY_PROXY` | unset | Proxy URL for every installer download, or `none` to ignore a proxy set in the environment; unset, curl and aria2c use http(s)_proxy. |
| `CINEFOUNDRY_REGISTRY_MIRRORS` | `docker.m.daocloud.io` | Comma-separated registry mirrors tried, in order, when the vLLM image cannot be pulled from Docker Hub; the pulled image is re-tagged to its canonical name. |
| `CINEFOUNDRY_GITHUB_MIRROR` | unset | Prefix put in front of GitHub URLs (source checkouts, aria2c), e.g. `https://ghfast.top/`. |
| `PIP_INDEX_URL` | unset | Python package index written to a new deploy/spark/spark.env for the image builds; unset, the example's value. |
| `SPARK_REQUIRED_FREE_GB` | `95` | Unified memory (GB) that must be available to start the stack; also read by scripts/spark-up.sh. |

## Studio

| Variable | Default | Meaning |
|---|---|---|
| `CINEFOUNDRY_STUDIO_TOKEN` | unset | When set, starting a job from the studio requires this value in the `x-cinefoundry-token` header. |
