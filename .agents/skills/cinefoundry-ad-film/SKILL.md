---
name: cinefoundry-ad-film
version: "0.3.0"
description: Produce a finished advertising film - a 30-second master by default, with an English announcer cast from the voice library, Chinese subtitles over the English line, typeset Chinese titles, a generated score and compliance-checked copy - from one sentence of creative brief, locally on a DGX Spark, by running the Cinefoundry ad pipeline (`cinefoundry ad`). Use when the user asks for an ad, a commercial, a product video, a 30-second spot or a shorter one, "给某个产品做条广告", or wants to re-cut or re-voice an existing Cinefoundry ad project.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: production
  tags:
    - advertising
    - video-generation
    - dgx-spark
    - harness
---

# Cinefoundry ad film

This is the entry point for any agent - Claude Code, Codex, Gemini CLI, or Cinefoundry's own director - that wants a finished ad. It does not do the stages itself: it runs the ad pipeline, which goes brief -> creative -> script -> compliance -> storyboard -> frames + quality gate -> clips -> cut -> versions (15 s and 6 s) -> delivery QC, each stage an agent with its own skill, and checks every result before the next stage starts.

What comes out: a 16:9, native-1080p, 60 fps film of `duration + 3 - 0.5` seconds (32.5 s for the 30-second master): six 5-second shots, hard cuts, a dissolve into a 3-second end card on the product; an English voiceover read by the announcer the creative director cast; the Chinese subtitle large over the English line; a Chinese title per beat; a generated score mixed to -16 LUFS; the explicit AI label and the AIGC metadata. The 15- and 6-second cutdowns are cut from the master afterwards (`editing-and-versioning`).

## Before you start

Run this one check first, before anything else:

```bash
pgrep -af "cli.js (ad|short|drama|harness)"; curl -sf 127.0.0.1:8001/v1/models >/dev/null && curl -sf 127.0.0.1:8002/v1/models >/dev/null && curl -sf 127.0.0.1:8188/system_stats >/dev/null && echo "stack up"; cinefoundry mem status
```

- Any `cli.js` line means another film is generating: stop and tell the user. One film at a time; two runs on one GPU make both slow and can fail a model load. The pipeline also refuses to start while another run holds `projects/.harness.lock`.
- No `stack up`: run `scripts/spark-up.sh`.
- Memory: see `spark-model-scheduler`, including the page-cache eviction before the GPU phases.

## Workflow

1. Take the user's brief as written, in the user's language. Never translate, summarise or rephrase it: a Chinese brief passed on in English once lost its quoted closing line and turned 千亿 into "billion". Keep its quotation marks too (put the brief in single quotes on the command line so “…” survive). Keep their words about the product's look (container, colours, label), the aspect ratio and the duration: the pipeline enforces them against what its agents write.
2. Ask only if the product, the audience or the one message is missing. Decide everything else and state your choice.
3. Run, from the repository root:

   ```bash
   node dist/cli.js ad '<the brief, verbatim>' [--id <project-id>] [--duration 30] [--ratio 16:9|9:16|1:1] [--resolution 1080p|2k|4k|6k] [--fps 60|24|30|120] [--product-image <photo>] [--proof "<facts>"] [--brand <brand-id> [--product <product-id>]]
   ```

   `node dist/cli.js harness` is the same command and still works.

   - `--duration` defaults to 30 (the master); any multiple of 5 from 5 to 30 is accepted, one 5-second clip per beat. A duration stated in the brief ("15 秒") wins over the default.
   - When the user gives facts the brand can back (specs, figures, a source), pass them with `--proof`. They are the only claims the copy may make; without them the copy carries no figures, specs or comparisons.
   - When the film is for a brand with a kit in `brands/` (skill `brand-kit`), pass `--brand <brand-id>` instead of `--proof`: the kit's product, lettering, photos, claims, palette, fonts, grade, announcer, legal lines and logo apply, and the run is refused if the kit fails `cinefoundry brand check` (*checked*).
   - If the user gives a photo of the real product, pass it as `--product-image`. It replaces the generated hero still, so every shot shows the real shape and logo instead of the image model's guess. Only use a photo the user took or has rights to.
   - The default film is 16:9, native 1080p, 60 fps. Leave `--ratio` out unless the user asked for vertical or square (a brief saying 竖版 or naming a vertical platform is read as 9:16 anyway), and leave `--resolution` / `--fps` out unless they asked.

   Generation time is dominated by the clips: measured on this machine, 247 s per native-1080p LTX-2.5 clip and 49 s per RIFE interpolation, six of each for the master. The delivery report records the measured total; do not quote one before it exists. Run it in the background and report progress from the `▸` lines it prints, or point the user at the Studio (`node dist/cli.js studio`, port 3090) where the same run is visible.
4. Use `--plan-only` when the user wants the treatment, script and storyboard to approve before any GPU time is spent.
5. When it finishes, read `projects/<id>/reports/delivery.md` and tell the user: where the film is (`projects/<id>/cut/final.mp4`, and the cutdowns `cut/final_15s.mp4` and `cut/final_06s.mp4` when the master is long enough), what each shot's gate said, the measured total, and every open item the report lists (a shot kept after failing the gate, a compliance item for human confirmation). Do not describe the film as flawless if the report says otherwise.

## Voice

Nothing to set for a normal run. The creative director casts the announcer from the English announcers in the casting library (`deploy/voices/library.json`) that passed voice QC on this machine, and the cut clones every line from that voice with Qwen3-TTS and checks it with Whisper (`dialogue-and-voice`).

A fresh machine has no QC-passed voices; then the only option is the configured default narrator, which is not an English announcer. Design and QC the library first (`scripts/voice-design.py --language English`, then `scripts/voice-qc.py`, both inside their containers; see `dialogue-and-voice`). Every voice is designed from a written description; never use a recording of a real person.

To re-cut a finished project without regenerating pictures: `node dist/cli.js cut --project <id>` (titles, subtitles, end card, sound and grade), or with a supplied score `--audio projects/<id>/audio/music.mp3`.

## Common failures

- `product hero still never passed the gate`: the storyboard's product description contradicts the brief or carries text the image model paints onto the product. Read the gate's issues in `reports/run.jsonl`, fix the brief wording, run again.
- `script still fails its checks after 6 attempts`: usually a subtitle over the ratio's limit (16 characters on 16:9, 12 on 9:16) or an English line outside 4-13 words; the message lists the failures. Rerun; if it repeats, simplify the brief's message.
- `Compliance blocked the script`: a `block` finding survived the reviewer. Nothing was generated; rewrite the brief's claim or supply `--proof`.
- A run that sits for many minutes on one frame: the reviewer is reasoning; each call is bounded, and an inconclusive verdict counts as a rejection.
- Out-of-memory at a model load: another GPU job is running, ComfyUI is holding cached weights, or the page cache holds the memory CUDA needs; `cinefoundry mem free`, evict the page cache (`spark-model-scheduler`), then retry.
