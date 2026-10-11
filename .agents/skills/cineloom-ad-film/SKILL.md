---
name: cineloom-ad-film
version: "0.1.0"
description: Produce a finished short advertising film (visuals, voiceover, music, typeset titles, compliance-checked copy) from one sentence of creative brief, locally on a DGX Spark, by running the CineLoom Harness. Use when the user asks for an ad, a product video, a 10/15/20-second commercial, "给某个产品做条广告", or wants to re-cut or re-voice an existing CineLoom project.
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - advertising
    - video-generation
    - dgx-spark
    - harness
---

# CineLoom ad film

This is the entry point for any agent - Claude Code, Codex, Gemini CLI, or CineLoom's own director -
that wants a finished ad. It does not do the stages itself: it calls the CineLoom Harness, which runs
brief, script, compliance, storyboard, frames, quality gate, clips and cut, each with its own stage
skill, and checks every result before the next stage starts.

## Before you start

1. Check the stack is up: `curl -s 127.0.0.1:8001/v1/models`, `127.0.0.1:8002/v1/models` and `127.0.0.1:8188/system_stats` must all answer. If not, run `scripts/spark-up.sh`.
2. Check nothing else is generating: `pgrep -af "cli.js harness"` must be empty. One film at a time; two runs on one GPU make both slow and can fail a model load.
3. Check memory with `cineloom mem status` (see `spark-model-scheduler`). About 45 GB available with the three services idle is normal.

## Workflow

1. Take the user's brief as written. Keep their words about the product's look (container, colours, label), the aspect ratio and the duration: the harness enforces them against what its agents write.
2. Ask only if the product, the audience or the one message is missing. Decide everything else.
3. Run, from the repository root:

   ```bash
   node dist/cli.js harness "<the brief, verbatim>" [--id <project-id>] [--ratio 9:16|16:9|1:1] [--duration 10|15|20] [--product-image <photo>]
   ```

   If the user gives a photo of the real product, pass it as `--product-image`. It replaces the
   generated hero still, so every shot shows the real shape and logo instead of the image model's
   guess. Only use a photo the user took or has rights to.

   A 15-second film takes about 30 to 40 minutes on one DGX Spark (three 5-second clips at ~340 s each dominate). Run it in the background and report progress from the `▸` lines it prints, or point the user at the Studio (`node dist/cli.js studio`, port 3090) where the same run is visible.
4. Use `--plan-only` when the user wants the script and storyboard to approve before any GPU time is spent.
5. When it finishes, read `projects/<id>/reports/delivery.md` and tell the user: where the film is (`projects/<id>/cut/final.mp4`), what each shot's gate said, total seconds, and every open item the report lists (a shot kept after failing the gate, for example). Do not describe the film as flawless if the report says otherwise.

## Voice

The default voice engine is Kokoro. For a broadcast narrator, set before running:

```bash
export CINELOOM_TTS_ENGINE=qwen-tts \
       CINELOOM_TTS_REF_WAV=runtime-data/step-audio/voices/male-2.wav \
       CINELOOM_TTS_REF_TEXT="$(python3 -c "import json;print(json.load(open('runtime-data/step-audio/voices/voices.json'))['male-2']['text'])")"
```

The reference voices were designed from a written description (`scripts/voice-design.py`). Only use a
reference recording of a real person with that person's consent.

To re-voice or re-cut a finished project without regenerating pictures:
`node dist/cli.js cut --project <id> --audio projects/<id>/audio/music.mp3`.

## Common failures

- `product hero still never passed the gate`: the storyboard's product description contradicts the brief or carries text the image model paints onto the product. Read the gate's issues in `reports/run.jsonl`, fix the brief wording, run again.
- A run that sits for many minutes on one frame: the reviewer is reasoning; each call is bounded, and an inconclusive verdict counts as a rejection.
- Out-of-memory at a model load: another GPU job is running, or ComfyUI is holding cached weights; `cineloom mem free`, then retry.
