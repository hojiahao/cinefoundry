---
name: bilingual-subtitles
version: "0.1.0"
description: The timed-text lead's craft for bilingual subtitles - Chinese large on top, English small below - with per-language line and reading-speed limits, timing taken from the spoken audio, safe areas for 16:9 and 9:16, styling, speaker changes, sidecar files, and the rule that subtitles never cover the AI label. Use when a film, short or episode is subtitled or re-timed, when dialogue or voice-over changes after a retake, when a vertical version is made, or when the user asks to fix, restyle or export subtitles.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: post
  tags:
    - subtitles
    - timed-text
    - bilingual
    - typography
    - safe-area
---

# Bilingual subtitles

Characters speak English on screen; the Chinese audience reads Chinese first. Every spoken line carries a Chinese subtitle, set large, with the English line small beneath it - the layout Chinese fansub groups and Bilibili audiences know. Netflix has no bilingual same-screen standard, so each language follows its own column of the Netflix timed-text guides (research, 1.4): a subtitle that breaks either language's rules fails, even if the other is fine.

## Limits

| | Chinese (top, large) | English (bottom, small) |
|---|---|---|
| Characters per line, 16:9 | 16 (*checked* on the screenplay) | 42 |
| Characters per line, 9:16 | 12 (research, 5.4: the vertical line is narrower) | 32 |
| Reading speed | ≤ 9 characters / s | ≤ 20 characters / s |
| Lines per event | 1 (the renderer joins newlines, see below) | 1 |
| On screen | at least 5/6 s (20 frames at 24 fps), at most 7 s | same event as the Chinese |
| Punctuation | no commas or full stops: a space instead; no trailing full stop (*checked*); question marks kept; full-width quotes “ ”; ellipsis … (U+2026) | normal sentence punctuation; ellipsis … (U+2026) |
| Breaks | never inside a word or a name | never between article and noun, or inside a name |

Reading speed is measured over the event's display time, spaces excluded for Chinese. A 16-character Chinese line needs at least 1.8 s; a 60-character English line needs 3 s. The screenplay's 12-word limit (*checked*) keeps a line near 4.4 s, so a single event normally fits both.

The renderer (`buildAss` in `src/lib/titles.ts`) strips line breaks and braces from subtitle text and uses no-wrap style, so one event is exactly one Chinese row and one English row, and inline style overrides are not possible. A line too long for the width is split into two consecutive events at a natural phrase boundary, each timed to the words it carries - never squeezed and never left to run off the frame.

## Translation

- The Chinese is a translation an audience reads, not a gloss (`DialogueLine.zh`): idiomatic, in the character's register, the meaning of the line rather than its word order. A sarcastic "Great. Just great." is “太好了 真是太好了” only if the scene plays it straight; otherwise “这下好了”.
- Names: the bible's Chinese name (“陈米娅”) in Chinese, the English name in English, the same every time.
- Cut to fit, do not shrink: if the Chinese needs more than the limit, condense it; the English line is what is spoken and is subtitled verbatim except for false starts and fillers ("uh", "you know") which are dropped.
- Numbers in Chinese as the audience reads them: Arabic numerals for prices and times, Chinese characters for small counts in speech.

## Timing from the spoken audio

Subtitles are timed to the voice that was actually generated and placed, never to the script or the shot boundaries.

1. Take each line's placement on the timeline and its measured duration after silence trim (the voice stage records both; ad voice-over starts 0.45 s into its shot).
2. **In-time** on the first audible word (`subtitleStart`), at most 2 frames early. A subtitle that appears before the mouth opens gives the line away.
3. **Out-time** (`subtitleEnd`) 0.3-0.5 s after the last word, extended to reach the 5/6 s minimum or the reading-speed floor.
4. **Shot changes** (house convention): if an out-time falls within 0.5 s of a cut, snap it to 2 frames before the cut; never carry a subtitle across a cut into a shot where a different character speaks. Hold across a cut only when the same speaker's line continues over it (an L-cut onto the listener).
5. **Gaps:** at least 2 frames between consecutive events so the eye registers the change; under 0.5 s apart, close the gap to exactly 2 frames instead of flashing off and on.
6. After any retake or re-cut, re-time from the new audio. A retake that is 0.3 s longer silently breaks every later cue that was hand-adjusted.

## Speaker changes

- One speaker per event. Two speakers in one event would need dash-led dialogue lines, and the one-row-per-language renderer cannot hold them; split at the speaker change.
- Off-screen and voice-over lines are subtitled like on-screen ones. In sidecar SRT the English off-screen line may be italic; the burned-in version cannot be.
- Rapid exchanges under 1 s per line: merge only if both lines fit one row per language and the speakers' alternation is obvious from the picture; otherwise give each line its minimum duration and let the edit breathe.

## Position and safe areas

| | 16:9, 1920×1080 | 9:16, 1080×1920 |
|---|---|---|
| English baseline | 6% of height from the bottom (65 px) | y = 1440 (25% of height from the bottom) |
| Chinese row | directly above the English, about 1.55 English line heights higher | directly above the English, about y = 1386 |
| Horizontal | centred, inside the lower title-safe area | text inside x ∈ [60, 900]: the right column is platform buttons |
| Sizes in code | zh 4.5% of height (49 px), en 60% of zh (29 px) | zh 5.5% of width (59 px), en 60% of zh (35 px) |

The vertical rule is the research's engineering intersection of measured YouTube Shorts and Douyin safe zones: faces, subtitles and product inside x ∈ [60, 900], y ∈ [380, 1440], subtitle baseline around y 1300-1400, above the caption, username and progress bar (research, 4.3; platform pixels are not officially published). Two consequences:

- Centred text on a 1080-wide frame is centred on x = 540, but the safe band is centred on 480: a 12-character Chinese row at 59 px with its letter spacing is about 750 px wide and fits the 840 px band; 16 characters (about 1000 px) do not. Check the rendered width, not the character count.
- The code follows the research's suggested style (research, 5.4): Chinese about 4.5-5% of frame height on 16:9 and 56-64 px on a 1080-wide vertical frame, English about 60% of the Chinese. Judge readability on a phone held at arm's length, not on a monitor.

Placement rules for both ratios: Chinese and English never swap order; the block never jumps position between consecutive events; it never sits over a mouth, burned-in text or the product label. On 9:16 close-ups the storyboard keeps the mouth above the subtitle block; if a frame forces a clash, move the block up for that event, never over the face.

## Styling

Noto Sans CJK SC for both languages (commercial use allowed; every character is checked against the font before rendering and a missing glyph fails the cut). White fill, thin translucent dark outline, no box, no shadow drop. Chinese regular weight, English slightly translucent so the hierarchy reads at a glance; 150 ms fades in and out. No colour coding per speaker, no emoji, no keyword pop-ups in drama. Creator talking-head shorts may enlarge or colour a key word (research, 4.2) - only in the Chinese row, at most once per event.

## The AI label is never covered

The explicit label “内容由 AI 生成” sits top-right on its own layer for the first 3 s and on the end card. Titles, subtitles and the closing line never overlap it. On 9:16 the label's position in code (about 67 px from the top, 32 px from the right edge) falls inside the zone platform UI covers (top 120-380 px, right 96-200 px, research 4.3): for vertical deliverables it must sit inside the safe zone, below y = 380 and left of x = 900, or the platform's own overlay hides it. `delivery-qc` checks this; do not ship a vertical file with the label under the UI.

## Output format

```json
{
  "ratio": "9:16",
  "events": [{"start": 5.85, "end": 9.62, "speaker": "mia", "zh": "你昨晚去哪了", "en": "Where were you last night?", "offscreen": false}]
}
```

Deliver with the burned-in master: `<slug>.zh-en.ass` (the render source), `<slug>.zh.srt` and `<slug>.en.srt` as sidecars (YouTube uses the SRT for auto-translation, research 5.4).

## Common failures

- Timing copied from shot boundaries: subtitles up before the speaker draws breath and hanging after they stop.
- A 16-character Chinese row on a vertical frame running into the button column.
- Commas and full stops in Chinese rows.
- Chinese that is a word-for-word gloss of the English.
- Re-voiced lines with the old timing.
- A subtitle block under the AI label, or a label hidden by platform UI on the vertical version.
