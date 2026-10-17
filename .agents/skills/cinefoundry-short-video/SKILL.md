---
name: cinefoundry-short-video
version: "0.1.0"
description: Produce a finished vertical short video for Douyin, Bilibili or YouTube Shorts - a presenter piece, review, explainer, skit or product short with a three-second hook, lip-synced English, bilingual subtitles, sound and score - plus its packaging (three titles to test, cover frame, description with the AI disclosure, hashtags), locally on a DGX Spark, by running the Cinefoundry short pipeline. Use when the user asks for a 短视频, a Douyin / 抖音 / B站 / Shorts / Reels video, a talking-head or explainer clip, or packaging for one.
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
   node dist/cli.js short '<the topic, verbatim>' [--seconds 45] [--ratio 9:16] [--fps 30] [--id <project-id>]
   ```

   Defaults: 9:16, native 1080p, 30 fps, 45 seconds. Use `--ratio 16:9` for a Bilibili or YouTube landscape video and `--fps 60` for product or motion-heavy shorts. `--plan-only` stops after the script and shot list for approval.
4. When it finishes, report: the video (`projects/<id>/cut/ep01.mp4`), the cover (`cut/cover.jpg`), the three titles, the description and hashtags from `reports/packaging.json`, and every open item the log lists. Remind the user that the platform's own AI-content declaration must be ticked when publishing (YouTube altered or synthetic content; Douyin AI 标识) - the description already discloses it.

## Standards this pipeline holds

- The first three seconds earn the next three: the hook is an image or a line, never a greeting or a logo.
- A synthetic presenter never claims a personal experience it cannot have ("I used this for a month"); facts are stated as facts with their source.
- Faces and voices are designed, never a real person's.
- Subtitles stay inside the vertical safe zone (clear of the platform's caption, buttons and progress bar), Chinese large over English small; the explicit AI label opens the video and is never covered or removed.
