---
name: ad-reference-breakdown
version: "0.1.0"
description: Break a reference advertisement video into shots and describe each one (framing, camera move, subject, on-screen text, pacing) so it can be rebuilt with a different product, character, or scene. Use when the user uploads or links a reference ad and asks to 拉片, replicate, remix, or "make one like this", or when a storyboard must follow an existing video's rhythm.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  tags:
    - ffmpeg
    - stepfun
    - vision
    - shot-analysis
---

# Ad reference breakdown (拉片)

Turn a reference video into an editable shot list. Cutting is done with ffmpeg and
viewing with the local vision model, so an unreleased or licensed reference never leaves the machine.

## Workflow

1. Cut the video into shots and export one keyframe per shot:

   ```bash
   cinefoundry shots reference.mp4 --out projects/<id>/breakdown --threshold 0.30
   ```

   This writes `shots.json` (index, start, end, duration, keyframe path) and `shot_XXX.jpg`.
   Lower `--threshold` when soft dissolves are missed; raise it when flashes or fast
   motion cause false cuts. Shots shorter than `--min-shot` seconds merge into the previous one.
2. Describe each keyframe with the local StepFun vision model (`cinefoundry qa` uses the same endpoint). Send
   keyframes in batches of at most 12, in order, and ask for the fields in the output
   format. Ask for what is visible; do not let the model guess brand names it cannot read.
3. Derive pacing from `shots.json`, not from the model: average shot length, the longest
   and shortest shot, and where the product first appears.
4. Map every shot to a storyboard slot. Keep duration, framing, and camera move; replace
   subject, product, and scene with the user's approved assets.
5. Hand the result to storyboard design. Reference describes structure only - never
   carry over the reference brand's logo, slogan, or talent likeness.

## Output format

```json
{
  "source": {"duration": 15.0, "shot_count": 7, "avg_shot_seconds": 2.1},
  "shots": [
    {"index": 1, "start": 0.0, "end": 1.8, "framing": "close-up", "camera": "slow push-in",
     "subject": "...", "action": "...", "on_screen_text": "...", "lighting": "...",
     "role": "hook | product_reveal | benefit | social_proof | cta"}
  ]
}
```

## Failure handling

- `shots.json` has one shot for a clearly edited video: the threshold is too high; rerun lower.
- The vision model returns prose instead of JSON: resend that batch with the format only.
- Vertical and horizontal versions differ: break down the ratio the user will deliver.
