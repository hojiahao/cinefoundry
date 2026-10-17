---
name: cinefoundry-short-video
version: "0.2.0"
description: Produce a finished vertical short video for Douyin, Bilibili or YouTube Shorts - a presenter piece, review, explainer, skit or product short with a three-second hook, lip-synced English, bilingual subtitles, sound and score - plus its packaging (three titles to test, cover frame, description with the AI disclosure, hashtags), locally on a DGX Spark, by running the Cinefoundry short pipeline. Use when the user asks for a 短视频, a Douyin / 抖音 / B站 / Shorts / Reels video, a talking-head or explainer clip, or packaging for one, or to revise a delivered Cinefoundry short (redo a shot, change a line, regrade, rescore) or export it as EDL, FCPXML or OTIO.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: production
  tags:
    - short-video
    - creator
    - video-generation
    - dgx-spark
---

# Cinefoundry short video

The entry point for any agent that wants a finished creator short. It runs the short pipeline on the Cinefoundry
Engine; each stage is an agent under its own skill and every result is checked before the next stage:

topic (`short-video-scripting`) → screenplay → compliance (`content-compliance`) → shots (`storyboard-design`,
`cinematography-and-art-direction`, `character-and-continuity`) → casting → frames + gate → dialogue
(`dialogue-and-voice`) → clips → sound (`sound-design-and-music`) → cut (`bilingual-subtitles`, `editing-and-versioning`,
`delivery-qc`) → packaging (`platform-packaging`).

## Before you start

```bash
pgrep -af "cli.js (ad|short|drama|harness)"; curl -sf 127.0.0.1:8001/v1/models >/dev/null && curl -sf 127.0.0.1:8002/v1/models >/dev/null && curl -sf 127.0.0.1:8188/system_stats >/dev/null && echo "stack up"; cinefoundry mem status
```

A running `cli.js` line means another film is generating: stop and tell the user.

## Workflow

1. Take the topic verbatim, in the user's language, with the platform they named and any fact they gave.
2. Ask only if there is no topic. Choose the format (presenter, review, explainer, skit, product short) and length yourself, and say what you chose. A product advertisement with a brand's claims is an ad: use `cinefoundry-ad-film` instead.
3. Run from the repository root:

   ```bash
   node dist/cli.js short '<the topic, verbatim>' [--seconds 60] [--ratio 9:16] [--fps 30] [--id <project-id>] [--cast projects/<earlier-id>/cast] [--brand <brand-id> [--product <product-id>]]
   ```

   For branded content pass `--brand` with the brand's kit (skill `brand-kit`): its presenter, product, wording, fonts, grade, logo, legal lines and hashtags apply, and the run is refused if the kit fails its check (*checked*).

   Defaults: 9:16, native 1080p, 30 fps, 60 seconds (creator shorts run one to three minutes; pass --seconds up to 180). Use `--ratio 16:9` for a Bilibili or YouTube landscape video and `--fps 60` for product or motion-heavy shorts. `--plan-only` stops after the script and shot list for approval.
4. When it finishes, report: the video (`projects/<id>/cut/ep01.mp4`), the cover (`cut/cover.jpg`), the three titles, the description and hashtags from `reports/packaging.json`, and every open item the log lists. Remind the user that the platform's own AI-content declaration must be ticked when publishing (YouTube altered or synthetic content; Douyin AI 标识) - the description already discloses it.

## Changes after delivery

Revise the finished short instead of running it again; only what depends on the change is re-made (`editing-and-versioning`, `docs/revisions.md`):

```bash
node dist/cli.js revise <id> --shot 4 [--note "tighter framing on the product"]       # frame, identity gate, clip (lip-synced on a dialogue shot), the video
node dist/cli.js revise <id> --line 2.1 --text "New English line." [--zh "新字幕"]     # scene.line from 1: compliance, same voice + Whisper, lip-sync shot, the video
node dist/cli.js revise <id> --grade cooler | --music "lighter, plucked strings"
node dist/cli.js export <id> --format fcpxml|edl|otio                                 # interchange, stems, SRT, ASS in exports/ep01/
```

A revision takes the GPU lock like a run. A refused one (the new line fails compliance) changes nothing: tell the user why. When the revised shot is the cover shot, the cover follows it. Report from `reports/revisions.json` and the 修订记录 in `reports/delivery.md`.

## Standards this pipeline holds

- The first three seconds earn the next three: the hook is an image or a line, never a greeting or a logo.
- A synthetic presenter never claims a personal experience it cannot have ("I used this for a month"); facts are stated as facts with their source.
- Faces and voices are designed, never a real person's.
- Subtitles stay inside the vertical safe zone (clear of the platform's caption, buttons and progress bar), Chinese large over English small; the explicit AI label opens the video and is never covered or removed.
