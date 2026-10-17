---
name: final-cut-assembly
version: "0.1.0"
description: Finish approved clips into the final advertisement - end card on the product, typeset titles and subtitles, offline voiceover over a locally generated music bed, crossfades and a cinematic grade - and write the delivery report. Use when all clips of a project exist, or when the user asks to re-cut, add or change subtitles or music, or export the final video.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  tags:
    - ffmpeg
    - editing
    - delivery
---

# Final cut assembly

A film is finished in the cut: the same clips read as a draft or as an ad depending on
the ending, the type, the grade and the sound.

## Workflow

1. Confirm every storyboard shot has a clip: `spotfoundry project status --id <id>`.
2. **End card.** Close on the approved product hero still with a slow push-in, the brand name as the title and the brief's single message under it. It guarantees the film ends on the product and that the brand on screen is typeset, never generated.
3. **Typography.** One title per beat (the script's on-screen text) and the voiceover as subtitles, set in Noto Sans CJK SC. Before rendering, check that the font has a glyph for every character; a missing glyph must fail the cut, not render as a box. Titles carry no closing punctuation.
4. **Sound.** Synthesise the voiceover offline, one line per beat, placed 0.45 s after the beat starts on the joined timeline. With 5 s clips and 0.4 s crossfades, clip k (from 0) starts at k x 4.6 s, so a three-beat film places its lines at 0.45, 5.05 and 9.65 s - never at 0, 5 and 10; trim the model's leading and trailing silence, and if a line still overruns its beat, speed it up (at most 1.25x) rather than cutting it. For an ad-grade narrator use `SPOTFOUNDRY_TTS_ENGINE=qwen-tts` with a reference voice designed from a written description (`scripts/voice-design.py`): every line is cloned from that one clip, so the film keeps one voice, and each line goes through a broadcast chain (rumble cut, compression, low-mid body, presence lift, limiter). Never use a real person's recording as the reference without that person's consent. Generate an instrumental bed locally (ACE-Step) from the brief's tone, and let it duck under the voice instead of sitting at one low level. Use a music file only if the user supplied it or has the rights to it.
5. **Picture.** Conform every clip to the delivery size (1080x1920, 1920x1080 or 1080x1080) at 24 fps, crossfade 0.4 s between shots, then grade the joined film as one image: gentle contrast, a teal/warm split, light sharpening, fine grain, a soft vignette, fade in and out. Grading after the join is what makes shots from different generations look like one film.
6. Check the printed duration: the brief plus the 3-second end card, less 0.4 s for each crossfade (a 15-second brief with three clips and the end card ends at 15 + 3 - 3 x 0.4 = 16.8 s). A mismatch means a missing or extra clip, not a rounding problem.
7. Write `projects/<id>/reports/delivery.md`.

`spotfoundry harness` performs steps 2-6. `spotfoundry cut --project <id>` re-runs the picture pass on an existing project.

## delivery.md

- What was made: title, duration, ratio, link to `cut/final.mp4`.
- Per shot: prompt summary, generation seconds for frame and clip, candidates tried, quality-gate score, regenerations.
- Totals: measured wall time per stage, memory at each phase boundary, quality-gate pass rate.
- Where each asset was produced (local or cloud) and which model produced it, including voice and music.
- Open issues: shots kept despite a failed gate, frames accepted unverified, compliance items that need human confirmation.
- Label for publication: the film, its voice and its music are AI-generated and must be marked as such on platforms that require it.
