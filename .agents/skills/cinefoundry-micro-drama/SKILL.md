---
name: cinefoundry-micro-drama
version: "0.3.0"
description: Produce a vertical micro-drama (微短剧) - series bible, a cast with locked faces and designed voices, and finished episodes with lip-synced English dialogue, bilingual subtitles, sound design and score - locally on a DGX Spark, by running the Cinefoundry drama pipeline. Use when the user asks for a short drama, a web series, 短剧 / 微短剧, a pilot episode, or wants more episodes of an existing Cinefoundry series, changes to a delivered episode (redo a shot, change a line, regrade, rescore) or an episode exported as EDL, FCPXML or OTIO.
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
3. Agree the scope before GPU time: a series plan (`--episodes`, default 1) and how many to make now (`--produce`, default all planned). One 60-second episode is twelve 5-second shots, each a native-1080p video generation - the longest part of the run - so a pilot of one to three episodes is the sensible first run. Quote durations from the run log, never in advance.
4. Run from the repository root:

   ```bash
   node dist/cli.js drama '<the idea, verbatim>' [--episodes 10] [--produce 2] [--seconds 120] [--ratio 9:16] [--fps 24] [--id <series-id>] [--cast projects/<earlier-id>/cast] [--brand <brand-id> [--product <product-id>]]
   ```

   A brand-funded series passes `--brand` with the brand's kit (skill `brand-kit`): its recurring presenter is cast from the kit's record, and its wording, fonts, grade, logo and legal lines apply; a kit that fails its check stops the run before it starts (*checked*).

   Defaults: 9:16, native 1080p, 24 fps (a higher rate reads as soap opera), 120-second episodes (two minutes, the length of a domestic premium micro-drama episode). Use `--plan-only` to stop after the bible, screenplays and shot lists so the user approves the story before any GPU time.
5. Run it in the background and report progress from the `▸` lines.
6. When it finishes, report: each episode file (`projects/<id>/cut/epNN.mp4`), the bible (`story/bible.json`), the cast (`cast/<id>/character.json` with `master.png`, `profile.png`, `full-body.png`), and every open item the log and `reports/` list - a frame kept after failing the identity gate, a line Whisper still mis-heard after retakes, a compliance issue the reviewer raised. Never call an episode flawless when the record says otherwise.

## Standards this pipeline holds

- Characters are adults, invented, with designed faces and designed voices: no real person's likeness or voice.
- Dialogue is shot single (the speaker alone facing camera, or over the listener's shoulder): two faces in one frame and the model gives the line to the wrong mouth.
- Every line fits one 5-second shot (at most 12 English words) and carries its Chinese subtitle (at most 12 characters on 9:16, no commas or full stops).
- Every episode opens on its hook, ends on its cliffhanger, and carries the explicit AI label at the start and the implicit AIGC metadata (标识办法, GB 45438-2025). Labels are never removed.
- Stories stay out of the genres regulators are cleaning up (violent revenge, flaunting wealth, distorted romance, 霸总-style titles); `content-compliance` has the current list.

## Changes to a delivered episode

Revise the episode instead of re-running the series; only what depends on the change is re-made (`editing-and-versioning`, `docs/revisions.md`):

```bash
node dist/cli.js revise <id> --episode 2 --shot 7 [--note "she stands closer to the window"]   # frame, identity gate, lip-synced clip, episode 2
node dist/cli.js revise <id> --episode 2 --line 3.1 --text "New English line." [--zh "新字幕"]   # compliance, same cast voice + Whisper, lip-sync shot, episode 2
node dist/cli.js revise <id> --grade warmer [--episode 2]                                      # finishing only
node dist/cli.js revise <id> --music "solo cello, ends unresolved" [--episode 2]
node dist/cli.js export <id> --format fcpxml|edl|otio --episode 2                              # interchange, stems, SRT, ASS in exports/ep02/
```

Lines are numbered scene.line from 1, as the compliance reviewer numbers them. A new line passes the same content checks and independent review as the screenplay or the revision is refused and nothing changes. The character keeps the voice in their cast record. A revision takes the GPU lock like a run; report from `reports/revisions.json` and the 修订记录 in `reports/delivery.md`.

## Continuing a series

Re-run with the same `--id` and a larger `--produce`: the new run writes the bible and episodes again in the same project folder. Keep the same idea text so the bible stays the same story. The cast is not redone: every character with a `cast/<id>/character.json` is loaded from it - the same master, reference pack, look, wardrobe and voice (*checked*). A new series with the same people passes `--cast projects/<earlier-id>/cast`; the records are copied into the new project. Delete a character's folder only to recast them.
