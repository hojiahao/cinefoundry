---
name: cinefoundry-micro-drama
version: "0.1.0"
description: Produce a vertical micro-drama (微短剧) - series bible, a cast with locked faces and designed voices, and finished episodes with lip-synced English dialogue, bilingual subtitles, sound design and score - locally on a DGX Spark, by running the Cinefoundry drama pipeline. Use when the user asks for a short drama, a web series, 短剧 / 微短剧, a pilot episode, or wants more episodes of an existing Cinefoundry series.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: production
  tags:
    - micro-drama
    - series
    - video-generation
    - dgx-spark
---

# Cinefoundry micro-drama

The entry point for any agent - Claude Code, Codex, Gemini CLI, DSH - that wants a finished micro-drama. It does not
do the stages itself: it runs the drama pipeline on the Cinefoundry Engine, which hands each stage to an agent under
its own skill and checks every result before the next stage starts:

development (`series-development`) → screenplay (`screenwriting`) → compliance (`content-compliance`) → shots
(`storyboard-design`, `cinematography-and-art-direction`, `character-and-continuity`) → casting → frames + identity gate
→ dialogue (`dialogue-and-voice`) → lip-synced clips → sound (`sound-design-and-music`) → cut (`bilingual-subtitles`,
`editing-and-versioning`, `delivery-qc`).

## Before you start

```bash
pgrep -af "cli.js (ad|short|drama|harness)"; curl -sf 127.0.0.1:8001/v1/models >/dev/null && curl -sf 127.0.0.1:8002/v1/models >/dev/null && curl -sf 127.0.0.1:8188/system_stats >/dev/null && echo "stack up"; cinefoundry mem status
```

- A running `cli.js` line means another film is generating: stop and tell the user. One film at a time on this GPU; the engine also refuses to start while another run holds its lock.
- No `stack up`: run `scripts/spark-up.sh`.

## Workflow

1. Take the user's story idea verbatim, in their language: premise, genre, the characters they named, the ending they want. Never paraphrase it.
2. Ask only if there is no premise at all. Decide genre, length and cast yourself and say what you chose.
3. Agree the scope before GPU time: a series plan (`--episodes`, default 1) and how many to make now (`--produce`, default all planned). One 60-second episode is twelve 5-second shots; on one DGX Spark that is roughly an hour and a half of generation, so a pilot of one to three episodes is the sensible first run.
4. Run from the repository root:

   ```bash
   node dist/cli.js drama '<the idea, verbatim>' [--episodes 10] [--produce 2] [--seconds 60] [--ratio 9:16] [--fps 24] [--id <series-id>]
   ```

   Defaults: 9:16, native 1080p, 24 fps (a higher rate reads as soap opera), 60-second episodes. Use `--plan-only` to stop after the bible, screenplays and shot lists so the user approves the story before any GPU time.
5. Run it in the background and report progress from the `▸` lines.
6. When it finishes, report: each episode file (`projects/<id>/cut/epNN.mp4`), the bible (`story/bible.json`), the cast sheets (`cast/*.sheet.png`), and every open item the log and `reports/` list - a frame kept after failing the identity gate, a line Whisper still mis-heard after retakes, a compliance issue the reviewer raised. Never call an episode flawless when the record says otherwise.

## Standards this pipeline holds

- Characters are adults, invented, with designed faces and designed voices: no real person's likeness or voice.
- Dialogue is shot single (the speaker alone facing camera, or over the listener's shoulder): two faces in one frame and the model gives the line to the wrong mouth.
- Every line fits one 5-second shot (at most 12 English words) and carries its Chinese subtitle (at most 12 characters on 9:16, no commas or full stops).
- Every episode opens on its hook, ends on its cliffhanger, and carries the explicit AI label at the start and the implicit AIGC metadata (标识办法, GB 45438-2025). Labels are never removed.
- Stories stay out of the genres regulators are cleaning up (violent revenge, flaunting wealth, distorted romance, 霸总-style titles); `content-compliance` has the current list.

## Continuing a series

Re-run with the same `--id` and a larger `--produce`: the previous run is archived under `projects/.archive`, and the new run writes the bible and episodes again. Keep the same idea text so the bible stays the same story.
