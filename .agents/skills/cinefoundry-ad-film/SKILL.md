---
name: cinefoundry-ad-film
version: "0.2.0"
description: Produce a finished short advertising film (visuals, voiceover, music, typeset titles, compliance-checked copy) from one sentence of creative brief, locally on a DGX Spark, by running the Cinefoundry Harness. Use when the user asks for an ad, a product video, a 10/15/20-second commercial, "给某个产品做条广告", or wants to re-cut or re-voice an existing Cinefoundry project.
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

This is the entry point for any agent - Claude Code, Codex, Gemini CLI, or Cinefoundry's own director -
that wants a finished ad. It does not do the stages itself: it calls the Cinefoundry Harness, which runs
brief, script, compliance, storyboard, frames, quality gate, clips, cut, cutdowns and delivery QC, each with its own stage
skill, and checks every result before the next stage starts.

## Before you start

Run this one check first, before anything else:

```bash
pgrep -af "cli.js harness"; curl -sf 127.0.0.1:8001/v1/models >/dev/null && curl -sf 127.0.0.1:8002/v1/models >/dev/null && curl -sf 127.0.0.1:8188/system_stats >/dev/null && echo "stack up"; cinefoundry mem status
```

- Any `cli.js harness` line means another film is generating: stop and tell the user. One film at a time; two runs on one GPU make both slow and can fail a model load. The harness also refuses to start while another run holds its lock.
- No `stack up`: run `scripts/spark-up.sh`.
- Memory: see `spark-model-scheduler`. About 45 GB available with the three services idle is normal.

## Workflow

1. Take the user's brief as written, in the user's language. Never translate, summarise or rephrase it: a Chinese brief passed on in English lost its quoted closing line ("DGX Spark，把 AI 超算放上你的桌面") and turned "千亿参数" into "billion-parameter". Keep its quotation marks too (put the brief in single quotes on the command line so “…” survive). Keep their words about the product's look (container, colours, label), the aspect ratio and the duration: the harness enforces them against what its agents write.
2. Ask only if the product, the audience or the one message is missing. Decide everything else.
3. Run, from the repository root:

   ```bash
   node dist/cli.js harness "<the brief, verbatim>" [--id <project-id>] [--ratio 16:9|9:16|1:1] [--duration 10|15|20] [--resolution 1080p|2k|4k|6k] [--fps 60|24|30|120] [--product-image <photo>] [--proof "<facts>"]
   ```

   When the user gives facts the brand can back (specs, figures, a source), pass them with `--proof`.
   They are the only claims the copy may make; without them the compliance reviewer strips every number.

   If the user gives a photo of the real product, pass it as `--product-image`. It replaces the
   generated hero still, so every shot shows the real shape and logo instead of the image model's
   guess. Only use a photo the user took or has rights to.

   The default film is 16:9, native 1080p, 60 fps. Leave `--ratio` out unless the user asked for vertical or square, and leave `--resolution` / `--fps` out unless they asked. Generation time on one DGX Spark is dominated by the three native-1080p clips (about 4 minutes each) and their interpolation (under a minute each); the delivery report records the measured total. Run it in the background and report progress from the `▸` lines it prints, or point the user at the Studio (`node dist/cli.js studio`, port 3090) where the same run is visible.
4. Use `--plan-only` when the user wants the script and storyboard to approve before any GPU time is spent.
5. When it finishes, read `projects/<id>/reports/delivery.md` and tell the user: where the film is (`projects/<id>/cut/final.mp4`, and the cutdowns `cut/final_15s.mp4` and `cut/final_06s.mp4` when the master is long enough), what each shot's gate said, the QC verdict per file (`reports/qc.json`), total seconds, and every open item the report lists (a shot kept after failing the gate, for example). Do not describe the film as flawless if the report says otherwise.

## Voice

The default voice engine is Kokoro. For a broadcast narrator, set before running:

```bash
export CINEFOUNDRY_TTS_ENGINE=qwen-tts \
       CINEFOUNDRY_TTS_REF_WAV=runtime-data/step-audio/voices/male-2.wav \
       CINEFOUNDRY_TTS_REF_TEXT="$(python3 -c "import json;print(json.load(open('runtime-data/step-audio/voices/voices.json'))['male-2']['text'])")"
```

The reference voices were designed from a written description (`scripts/voice-design.py`). Only use a
reference recording of a real person with that person's consent.

To re-voice or re-cut a finished project without regenerating pictures:
`node dist/cli.js cut --project <id> --audio projects/<id>/audio/music.mp3`.

## Common failures

- `product hero still never passed the gate`: the storyboard's product description contradicts the brief or carries text the image model paints onto the product. Read the gate's issues in `reports/run.jsonl`, fix the brief wording, run again.
- A run that sits for many minutes on one frame: the reviewer is reasoning; each call is bounded, and an inconclusive verdict counts as a rejection.
- Out-of-memory at a model load: another GPU job is running, or ComfyUI is holding cached weights; `cinefoundry mem free`, then retry.
