---
name: final-cut-assembly
version: "0.3.0"
description: Finish approved clips into the final advertisement at broadcast standard - hard cuts with a dissolve into the end card, the product end card, designed Chinese titles and voice-timed Chinese-over-English subtitles, the English announcer, sound effects and a locally generated score mixed to -16 LUFS, a category grade, 60 fps RIFE masters, explicit and implicit AI labels - and write the delivery report. Use when all clips of a project exist, or when the user asks to re-cut, change titles, subtitles, voice, sound or music, or export the final video.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: post
  tags:
    - ffmpeg
    - editing
    - delivery
---

# Final cut assembly

A film is finished in the cut: the same clips read as a draft or as an ad depending on
the ending, the type, the grade and the sound.

## The standard

Finish like a top post house: the edit has rhythm, the grade makes three generations look like one camera, the type is designed, the sound is mixed to broadcast standards, and the file meets platform specs. Default delivery is **16:9, 1920x1080, 60 fps**; resolution presets `1080p` (native), `2k`, `4k`, `6k` (generated at native 1080p and upscaled in the cut, recorded as upscaled - never passed off as native); frame rates 24 (film look), 30, 60 (default), 120.

## Workflow

1. Confirm every storyboard shot has a clip: `cinefoundry project status --id <id>`. Above 24 fps each clip also has a RIFE-interpolated 120 fps master (`clips/shot_00N.hfr.mp4`), made at the end of the clips stage while the language models sleep; the cut uses it and conforms to the delivery rate by dropping frames evenly, so 60 fps lands exactly on the 24 fps motion.
2. **Edit.** Shots cut hard - commercials cut on action, not on dissolves. The only dissolve is 0.5 s into the end card. With 5 s shots, shot k (from 0) starts at k x 5 s; the 30 s master is 30 + 3 (end card) - 0.5 = **32.5 s**, a 15 s film 17.5 s.
3. **End card.** The approved hero still with a slow push-in, the brand on its label (generated once, gated), and the closing line typeset under it: the client's `tagline` when the request quoted one, otherwise the single message. The brand on screen is never redrawn by a model.
4. **Typography.**
   - Title per beat (the script's `text`, Chinese): upper third, letter-spaced, soft shadow, fades in 0.5 s after the cut and out before the next. It sits in the calm upper third the storyboard left for it.
   - Subtitles, bilingual: the Chinese subtitle (`zh`) large on top, the English line the announcer speaks (`vo`) beneath it at about 60 % of the size - one row each, bottom safe area (English baseline 6 % of the height from the bottom on 16:9, 25 % on 9:16). Both appear when the voice starts and leave 0.25 s after it ends, never on screen in silence. Line limits, translation and placement: `bilingual-subtitles`; the script's subtitle length is already checked (16 characters on 16:9, 12 on 9:16).
   - Font: Noto Sans CJK SC (commercial use allowed). Every character is checked against the font before rendering; a missing glyph fails the cut instead of drawing a box.
   - No closing punctuation on titles; no emoji or symbols anywhere.
5. **Sound.** Casting, QC and delivery of the voice are in `dialogue-and-voice`, music and effects in `sound-design-and-music`. The announcer is the English voice the creative director cast from the library (`sound.voice`), cloned with Qwen3-TTS from its QC-passed reference and checked line by line with Whisper. The cut places each line 0.45 s after its shot starts (0.45, 5.45, 10.45 … 25.45 s), gives it 4.1 s, trims the model's silence, speeds a line up at most 1.25x rather than cutting it, runs the broadcast voice chain, ducks the music under the voice, and normalises the soundtrack to **-16 LUFS integrated, -1.5 dBTP true peak** (web delivery; broadcast masters use -24 LKFS). AAC 320 kbps, 48 kHz.
6. **Grade.** One grade over the joined film, chosen by the product's industry - restrained, never a filter look:
   - drink: clean, cool highlights, crisp, whites stay white
   - skincare: soft, low contrast, warm-neutral skin, no sharpening
   - food: warm and rich, lifted mids, texture kept
   - electronics: deep neutral blacks, cool edge, crisp metal
   - computing: warm gold key, deep blacks, no blue cast
   - automotive: deep clean blacks, crisp metal, cool shadows against warm highlights
   - fragrance: rich and sculpted, amber highlights, velvety shadows, no sharpening
   - general / home: warm practical light, soft contrast
   Fine grain and a soft vignette in all of them; fade in 0.35 s, out 0.5 s.
7. **AI labels (required by 人工智能生成合成内容标识办法, in force 2025-09-01).** Explicit: "内容由 AI 生成" in the top-right corner for the first 3 seconds and on the end card, set prominently - text 5 % of the frame's short side (54 px at 1080p), right margin 5 % of the width, and on 9:16 a top margin of 20 % of the height so the platform's own top bar never covers it. Titles, subtitles and the closing line never overlap it. Implicit: AIGC metadata in the container (Label, ContentProducer, ProduceID) plus a comment. Never remove either.
8. **Encode.** H.264 High, yuv420p, BT.709 tags, crf 16 with a ceiling of 0.2 bits per pixel per frame (about 25 Mbps at 1080p60), faststart.
9. Check the printed duration against step 2. A mismatch means a missing or extra clip, not rounding.
10. Write `projects/<id>/reports/delivery.md`.

`cinefoundry ad` performs steps 1-10. `cinefoundry cut --project <id>` re-runs the cut on an existing project with the format stored in its brief (`resolution`, `fps`).

## delivery.md

- What was made: title, duration, ratio, link to `cut/final.mp4`.
- Per shot: prompt summary, generation seconds for frame and clip, candidates tried, quality-gate score, regenerations.
- Totals: measured wall time per stage, memory at each phase boundary, quality-gate pass rate.
- Where each asset was produced (local or cloud) and which model produced it, including voice and music.
- Open issues: shots kept despite a failed gate, frames accepted unverified, compliance items that need human confirmation.
- Delivery format: resolution preset, frame size, frame rate, and whether the picture was upscaled from native 1080p.
- Labels: the explicit and implicit AI labels the file carries. The film, its voice and its music are AI-generated and must also be declared as such where a platform asks.
