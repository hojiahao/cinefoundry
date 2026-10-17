---
name: delivery-qc
version: "0.2.0"
description: Technical QC and delivery for every Cinefoundry deliverable - automated checks of duration, frame rate, resolution, codec and profile, bitrate, loudness and true peak per destination (web default -16 LUFS / -1.5 dBTP and the broadcast, platform and Netflix-class targets from the research), black frames, silence gaps, clipped audio, frozen picture, subtitle overflow and safe areas, the explicit AI label at the start and on the end card, and the implicit AIGC metadata of GB 45438-2025 - then the delivery package layout and the QC report. Use on every master, cutdown, vertical version and episode before it leaves the studio, after any re-cut or re-encode, or when the user asks whether a file is ready to deliver or upload.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: post
  tags:
    - qc
    - delivery
    - loudness
    - ffmpeg
    - aigc-label
---

# Delivery QC

Nothing leaves the studio on the strength of "it rendered". Every deliverable - the 30 s master, each cutdown, each vertical version, every episode - is measured against its spec by tools, not by eye, and the measurements are written into the package. A fail blocks delivery; a warn ships only with a human's sign-off recorded in the report.

## Specs per deliverable

| Deliverable | Frame | fps | Duration rule |
|---|---|---|---|
| Ad master and cutdowns | 1920×1080 (16:9); optional 1080×1920 | 60 (25 for a China TV version) | the edit's computed length ±1 frame; broadcast spots exactly 30.0 / 15.0 / 6.0 s |
| Creator short, vertical | 1080×1920 | 30 or 60 as briefed | Shorts ≤ 180 s (research, 4.3) |
| Bilibili / YouTube long-form | 1920×1080 or 3840×2160 | 24 / 30 / 60 as briefed | as edited |
| Micro-drama episode | 1080×1920 | 24 | as edited; under 20 min (regulation, research 3.5); 1-3 min domestic, 60-90 s overseas |

Codec for all: H.264 High profile, yuv420p, BT.709 primaries, transfer and matrix tagged, constant frame rate, `moov` atom at the front (faststart); AAC-LC stereo 48 kHz (320 kb/s from the cut); MP4. YouTube recommends 2 consecutive B-frames and CABAC (research, 4.3); the x264 preset used may differ on B-frames - warn, do not fail.

Bitrate: the cut encodes crf 16 under a ceiling of 0.2 bits per pixel per frame, never under 8 Mb/s - about 25 Mb/s at 1080p60, 12 at 1080×1920×30, 10 at 1080p24 (`bitrateCeilingMbps`, shared by the encoder and QC). Fail above the ceiling by more than 10% (*checked*). Warn below YouTube's 1080p SDR reference (8 Mb/s at standard frame rates, 12 at high frame rates; research 4.3) - a static drama scene can legitimately fall under it, but a whole file that does is under-encoded for upload.

## Loudness per destination

| Profile | Integrated | True peak | Measured | Source |
|---|---|---|---|---|
| `web` (default) | -16 LUFS ±1 LU | ≤ -1.5 dBTP | whole programme | what the cut writes (`loudnorm I=-16 TP=-1.5 LRA=11`); sits under the ~-14 LUFS most platforms normalise to, so nothing is turned down |
| `web-platform` | -14 LUFS ±1 LU | ≤ -1.0 dBTP | whole programme | research 4.3 / 5.4: YouTube normalises to about -14 (measured, not official); Douyin and Bilibili publish no standard |
| `cn-broadcast` | -24 LKFS ±1 LU | ≤ -2.0 dBTP | whole programme | GY/T 282-2014 as commonly cited (research 1.4: **unverified**, original not obtained) |
| `us-broadcast` | -24 LKFS | ≤ -2.0 dBTP | whole programme | CALM Act (research 1.4) |
| `netflix-class` | -27 LKFS ±2 LU | ≤ -2.0 dBTP (aim -2.3) | dialogue-gated | Netflix Sound Mix Specifications v1.5 (research 1.4) |

ffmpeg's `ebur128` has no dialogue gating: for `netflix-class`, measure the dialogue stem alone and report the method. Loudness range: warn above 11 LU for web (phones in noisy places), above 15 LU for any profile.

## The checks

Run on the file as delivered, never on an intermediate. The `qc` craft (`src/crafts/qc.ts`) runs every check marked *checked* with ffprobe and ffmpeg only - one probe, one decoding pass with every detector chained - at the end of the ad pipeline (master and cutdowns, stage `qc`) and of every narrative cut. Fails and warns become open items in the log, `run.jsonl` and `delivery.md`; nothing is re-encoded to pass.

| Check | How | Fail when |
|---|---|---|
| Container and streams | `ffprobe -v error -show_streams -show_format -of json`; MP4 box order | codec, profile, pix_fmt, colour tags, size, `r_frame_rate` or `avg_frame_rate` off spec (variable frame rate); audio not AAC 48 kHz stereo; `moov` after `mdat` (*checked*) |
| Duration | video stream duration and frame count | outside the edit's length ±1 frame; frame count ≠ duration × fps ±1 (*checked*) |
| Loudness, true peak | `ffmpeg -i f -af ebur128=peak=true -f null -` | outside the profile window: ads `web`, shorts and dramas `web-platform`; LRA above the limit warns (*checked*) |
| Clipping | `astats` peak level and flat factor | sample peak ≥ -0.1 dBFS or flat factor > 0 (flat-topped waveform) (*checked*) |
| Black frames | `blackdetect=d=0.1:pix_th=0.10` | black ≥ 0.1 s anywhere except the head fade (0.35 s), the tail fade (0.5 s) and a cut to black marked in the edit (*checked*; no edit marks cuts to black yet) |
| Silence | `silencedetect=noise=-60dB:d=0.5` | digital silence ≥ 0.5 s overlapping a voiceover or dialogue line's window: a dropped voice (*checked*). Elsewhere outside the head (0.3 s) and tail (0.8 s) fades it warns: the bed is meant to be always on, so silence means a dropped layer, but a supplied track may breathe (*checked*) |
| Frozen picture | `freezedetect=n=0.003:d=1.5` | warn only: locked-off shots can be still, but a frozen clip from a failed generation reads as a glitch; the end card's push-in is exempt (*checked*) |
| Subtitles | parse the `.ass`; render width per event (*checked* so far: a subtitle event over every voiced line) | any event breaking `bilingual-subtitles` limits: chars per line (zh 16 / en 42 on 16:9, zh 12 / en 32 on 9:16), reading speed (zh 9 / en 20 per s), duration 5/6-7 s, gap < 2 frames, zh commas or full stops, rendered width outside the safe area (9:16: x ∈ [60, 900], baseline ≤ y 1440) |
| Overlap | event rectangles | a subtitle, title or closing line overlapping the AI label |
| Explicit AI label | `.ass` Label events (*checked*: a Label event over 0-3 s and one of at least 2 s reaching the end), then the vision model on frames at 0.5 s, 2.5 s and mid end card (not automated yet) | “内容由 AI 生成” missing from 0-3 s, missing on the end card (ads) or episode opening (drama), illegible, or on 9:16 placed in the platform UI band (y < 380 or x > 900) |
| Label size | rendered glyph height / shortest frame side | **warn** below 5%, or on screen under 2 s: the research's reading of GB 45438-2025 (secondhand, **unverified**, research 3.5). The Label style sets the font size to 5% of the short side (54 px at 1080p); measure the rendered glyph height, which runs below the font size, and report it |
| Implicit metadata | `ffprobe -show_format` tag `AIGC` (JSON) and `comment` | not valid JSON; `Label` ≠ "1"; `ContentProducer` or `ProduceID` empty or not this deliverable's (`<project>`, `<project>-15s`, `<project>-ep01`); `ContentPropagator` / `PropagateID` keys absent; comment missing 内容由 AI 生成 (*checked*) |
| Fonts | glyph coverage of every on-screen character | any missing glyph (the cut already fails on this; re-check after copy edits) |

The implicit fields follow the TC260 video metadata guide (`Label`, `ContentProducer`, `ProduceID`, `ContentPropagator`, `PropagateID`; research 3.5, secondary sources). The cut writes the propagator pair empty: the studio produces, the platform propagates. That reading is ours and unverified; flag it in the report, never fill the fields with invented values. Any remux or re-encode after the cut must carry the tags through (`-movflags use_metadata_tags`, `-map_metadata 0`); a step that drops them fails QC. Nobody removes, alters or hides either label (标识办法, research 3.5).

## Workflow

1. Identify the deliverable's spec row and loudness profile from the brief and the destination; record both.
2. Run every check; collect measurements, not just verdicts.
3. On a fail, route it back: loudness or clipping to the mix, duration to the edit, subtitles to `bilingual-subtitles`, label or metadata to the cut. Never patch a master in place with a second lossy encode.
4. Re-run the full checklist on the replacement file.
5. Assemble the package, write checksums, write the reports.

## Package layout

```
deliver/<project-id>/
  masters/<slug>_<version>_<W>x<H>_<fps>p.mp4      # e.g. spark_30s_1920x1080_60p.mp4, ep03_1080x1920_24p.mp4
  subtitles/<slug>_<version>.zh-en.ass
  subtitles/<slug>_<version>.zh.srt
  subtitles/<slug>_<version>.en.srt
  stems/<slug>_<version>_{dialogue,effects,music}.wav  # 48 kHz 24-bit, when the mix kept them; M&E = effects + music
  packaging/packaging.json                          # from platform-packaging, plus cover files
  reports/qc.json
  reports/delivery.md
  SHA256SUMS
```

## qc.json

One entry per deliverable, written by the `qc` craft to `reports/qc.json` (paths relative to the project; values illustrative):

```json
[{
  "label": "15s",
  "file": "cut/final_15s.mp4",
  "spec": {"width": 1920, "height": 1080, "fps": 60, "seconds": 15.0, "loudness": {"profile": "web", "integrated": -16, "tolerance": 1, "truePeak": -1.5},
           "speech": [{"start": 0.45, "end": 2.9}], "ass": "cut/titles_15s.ass", "produceId": "spark-15s", "stillWindows": [{"start": 12.0, "end": 15.0}]},
  "measured": {"probe": {"video": {"codec": "h264", "profile": "High", "pixFmt": "yuv420p", "rFrameRate": 60, "avgFrameRate": 60, "seconds": 15.0, "frames": 900, "bitrateMbps": 18.4},
                         "audio": {"codec": "aac", "sampleRate": 48000, "channels": 2}, "tags": {"AIGC": "{...}", "comment": "内容由 AI 生成 · Cinefoundry · spark-15s"}},
               "faststart": true, "loudness": {"integrated": -16.1, "lra": 6.2, "truePeak": -1.6}, "astats": {"peakDb": -2.3, "flatFactor": 0},
               "black": [{"start": 0, "end": 0.2}], "silence": [], "freeze": [], "ass": [{"start": 0, "end": 3, "style": "Label", "text": "内容由 AI 生成"}]},
  "results": [{"check": "loudness", "status": "pass", "detail": "-16.1 LUFS, target -16 ±1 (web)"}, {"check": "frozen_picture", "status": "warn", "detail": "frozen 5.00-7.00 s: a failed generation reads as a glitch"}],
  "verdict": "pass-with-warnings"
}]
```

`verdict` is `pass`, `pass-with-warnings` (each warn needs a named sign-off in `delivery.md`) or `fail`.

## delivery.md

Per file: spec, measured values, verdict, warns and who signed them off; the loudness profile and why; which labels it carries and where; the platform disclosure to tick at upload (from `platform-packaging`); open issues carried from earlier stages (frames kept after a failed gate, lines kept above the ASR threshold, compliance items for human confirmation); models and engines for picture, voice, effects and music; that nothing was licensed or uploaded during production.

## Common failures

- QC run on the pre-mux file: the delivered one lost its metadata.
- Loudness normalised per version by ear: cutdowns land 3 LU apart.
- The vertical version passing with the label under the platform's top bar.
- A re-encode to "fix" a small issue that drops the AIGC tags and softens the picture.
- Warns shipped without a named sign-off.
