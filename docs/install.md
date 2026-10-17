# Installing Cinefoundry

Cinefoundry runs on one NVIDIA DGX Spark (aarch64, GB10, DGX OS). One command takes a fresh clone to a running studio:

```bash
git clone <repository> cinefoundry && cd cinefoundry
scripts/install.sh
```

The installer checks the machine, installs what it can without root, downloads and verifies every model weight,
builds the local images, designs the casting library's voices, starts the stack and runs `cinefoundry doctor`. It ends
by printing the command for a first film of each format and the studio URL. Every step checks its result first, so
running it again after any failure (a dropped connection, a missing package, a reboot) continues where it stopped.
Everything it prints is appended to `runtime-data/install.log`.

## Modes

| Command | What it does |
|---|---|
| `scripts/install.sh` | The full install, then starts the stack and runs `cinefoundry doctor` |
| `scripts/install.sh --check` | Reports what is installed and what is missing; changes nothing |
| `scripts/install.sh --dry-run` | Prints every download (URL and destination), build and command it would run; changes nothing |
| `scripts/install.sh --models-only` | Downloads and verifies the model weights only |
| `scripts/install.sh --no-start` | Installs everything but leaves the stack stopped |
| `--formats ad,short,drama` | Installs weights for these formats only (default: all three) |
| `--with <extra>[,<extra>]` | Adds optional models (below) |
| `--proxy <url>` / `--proxy none` | Proxy for every download; `none` ignores a proxy set in the environment |

`--check` and `--dry-run` hash files that are already present, so they report verified content, not file names.

## What it checks

| Check | Requirement | If missing |
|---|---|---|
| CPU and GPU | aarch64 and an NVIDIA GB10 (`nvidia-smi`) | Stops before anything is downloaded, listing what does not match |
| Docker | Docker Engine reachable by this user, Compose v2 | Prints the `apt-get` / `usermod` command |
| NVIDIA Container Toolkit | CDI device `nvidia.com/gpu=all` (`docker info`, `nvidia-ctk cdi list`) | Prints the `nvidia-ctk cdi generate` command |
| Node.js | 22 or later | Installed into `.tools/node` (verified against the release's SHASUMS256.txt) |
| ffmpeg | Built with libass (typeset titles and subtitles) | Prints the `apt-get` command |
| Fonts | Noto Sans CJK SC | Prints the `apt-get install fonts-noto-cjk` command |
| aria2c | Optional, for parallel resumable downloads | A static build is fetched into `.tools/aria2` (release digest checked); curl is the fallback |
| Model disk | Free space under `SPARK_MODEL_DIR` ≥ the summed size of the files still to download | Stops before downloading |
| Docker disk | 24.5 GB free under the Docker root while images are missing (vLLM image plus the unique layers of the three local images, measured with `docker system df`) | Reported as a failure |
| Unified memory | 95 GB available to start the stack (`SPARK_REQUIRED_FREE_GB`) | Reported; the stack is not started on a full machine |

Commands that need root are printed together, exactly as they must be run. The model download does not need root, so
it proceeds while they are pending; run the printed commands, then `scripts/install.sh` again.

## Model weights

`deploy/models.json` lists every file, generated from `src/setup/sources.ts` by `cinefoundry setup manifest --refresh`.
Each entry records the repository, the commit it is pinned to, the path in the repository, the folder and filename it
is saved under, its size, its license and the feature that needs it. Each file is identified by its content: the
SHA-256 the Hugging Face API publishes as `lfs.oid`, or for small non-LFS files (configs, tokenizers) the git blob id
the API publishes. A file counts as installed only when its hash matches. Size never identifies a file.

| Feature | Installed | Size | Contents |
|---|---|---|---|
| `core` | always | 103.0 GB | Nemotron 3.5 Lightning 30B-A3B NVFP4 and its DSpark drafter, Step3-VL-10B-FP8, LTX-2.5 Fast NVFP4 with its Gemma text encoder, video and audio VAEs and latent upscaler, RIFE 4.26, ACE-Step, Qwen3-TTS VoiceDesign and Base, Whisper large-v3-turbo, the Qwen-Image text encoder and VAE |
| `ad` | default | 43.4 GB | Qwen-Image and Qwen-Image-Edit-2509, each with its 8-step Lightning LoRA |
| `narrative` | default | 53.0 GB | Qwen-Image-2512, Qwen-Image-Edit-2511 with its Lightning LoRA, MOSS-SoundEffect v2 |
| `kokoro` | `--with kokoro` | 0.3 GB | Kokoro-82M v1.1 Mandarin narrator, plus its Python environment in `runtime-data/tts-venv` |
| `ltx-int8` | `--with ltx-int8` | 21.5 GB | LTX-2.5 Fast int8 transformer (`--video-model ltx25-fast`) |
| `wan22-14b` | `--with wan22-14b` | 38.0 GB | Wan2.2 I2V A14B, both experts, 4-step LoRAs, UMT5 encoder, VAE |
| `wan22-5b` | `--with wan22-5b` | 18.1 GB | Wan2.2 TI2V 5B, UMT5 encoder, VAE |
| `super-vl` | `--with super-vl` | 76.4 GB | Nemotron 3.5 Super VL 120B NVFP4 and its LiLiCorr drafter (compose profile `super`) |

The default install (all three formats) is 199.4 GB in 163 files. Files land under `SPARK_MODEL_DIR` (default
`~/models`): ComfyUI weights in `comfyui/<folder>/`, the vLLM models as a Hugging Face cache in `hf/hub/` (blobs named
by their hash, a snapshot per pinned revision, `refs/main`), voice, speech-recognition and sound-effect models in
`tts/`, `asr/` and `audio/`.

**Downloading.** Files resolve at their pinned commit through `HF_ENDPOINT` (default `https://huggingface.co`; in
mainland China `HF_ENDPOINT=https://hf-mirror.com`). aria2c fetches many files at once with 16 connections each, saves
each under its real filename (`out=`) and resumes partial files; without aria2c, curl resumes with `-C -`. After the
download every file is hashed; a file that does not match is deleted and fetched once more, and anything still wrong is
reported. Hashes already computed are kept in `runtime-data/setup/verified.json`, keyed by path, size, modification
time and inode, so a re-run does not re-read hundreds of gigabytes; any change to a file invalidates its entry.

**Gated weights.** LTX-2.5 (`Lightricks/LTX-2.5`) is gated under the LTX-2 Community License. Sign in at
<https://huggingface.co/Lightricks/LTX-2.5>, accept the terms, create a read token at
<https://huggingface.co/settings/tokens>, then `export HF_TOKEN=<token>` (or `hf auth login`) and run the installer
again. Without a token the installer downloads everything else and prints these steps. With a token, it first checks
that the repository's published `lfs.oid` values match the manifest; the token is sent to `HF_ENDPOINT` for the gated
repository only.

## Images, sources and the voice library

| Image | How |
|---|---|
| `vllm/vllm-openai:<VLLM_TAG>` | `docker pull`; on failure each registry in `CINEFOUNDRY_REGISTRY_MIRRORS` (default `docker.m.daocloud.io`), re-tagged to the canonical name |
| `cinefoundry/comfyui:local` | Built by compose from ComfyUI checked out at the tested commit in `runtime-data/ComfyUI` |
| `cinefoundry/qwen-tts:local` | Built from `deploy/spark/qwen-tts` on the vLLM image |
| `cinefoundry/moss-audio:local` | Built from `deploy/spark/moss-audio` on the Qwen3-TTS image, from MOSS-TTS checked out at the tested commit in `.tools/MOSS-TTS` |

`PIP_INDEX_URL` in `deploy/spark/spark.env` selects the Python package index for the builds;
`CINEFOUNDRY_GITHUB_MIRROR` (a URL prefix) routes the GitHub checkouts and downloads. The installer writes
`deploy/spark/spark.env` from the example with `SPARK_MODEL_DIR` set to the real model root if it does not exist yet.

The casting library (`deploy/voices/library.json`, 52 designed voices) is built on the GPU: Qwen3-TTS VoiceDesign
speaks each voice's reference text in four takes (`scripts/voice-design.py`), and `scripts/voice-qc.py` keeps the take
that passes pronunciation (Whisper), pitch and level checks. Only voices without a QC-passed reference are designed. The
step takes the run lock (`projects/.harness.lock`), so it never runs next to a film.

## Starting and checking

With every step complete, the installer runs `scripts/spark-up.sh`, which refuses to start on a machine without enough
free unified memory, starts Nemotron (:8001), Step3-VL (:8002) and ComfyUI (:8188), and runs `cinefoundry doctor`. If
the stack is already running, it runs the doctor only.

`cinefoundry doctor` reports, as JSON, the platform checks, the model files of the installed features (hash-verified by
the installer; `--verify` hashes them now), the images, the voice library, the services, and every workflow template
node by node against the running ComfyUI. A missing file of an optional feature that was not installed is a warning.

## Network settings

| Variable | Purpose |
|---|---|
| `HF_ENDPOINT` | Hugging Face endpoint or mirror, e.g. `https://hf-mirror.com` |
| `HF_TOKEN` | Token for the gated LTX-2.5 repository |
| `CINEFOUNDRY_PROXY` | Proxy URL for every download, or `none` (same as `--proxy`) |
| `CINEFOUNDRY_REGISTRY_MIRRORS` | Comma-separated registry mirrors for the vLLM image |
| `CINEFOUNDRY_GITHUB_MIRROR` | Prefix for GitHub URLs, e.g. `https://ghfast.top/` |
| `PIP_INDEX_URL` | Python package index for the image builds (written to `spark.env`) |
| `NODE_MIRROR` | Node.js download mirror, e.g. `https://npmmirror.com/mirrors/node` |
| `npm_config_registry` | npm registry, e.g. `https://registry.npmmirror.com` |
| `SPARK_MODEL_DIR` | Model root (default `~/models`) |

## Maintaining the manifest

`cinefoundry setup manifest` compares every pinned file with the Hub and exits non-zero on any difference.
`cinefoundry setup manifest --refresh` re-resolves `src/setup/sources.ts` against the Hub and rewrites
`deploy/models.json`; a source may pin a `revision`, and otherwise follows the repository's current main. Tests
(`tests/install.test.ts`) fail when a workflow loads a file the manifest does not hold, or the manifest holds a ComfyUI
file no workflow loads.
