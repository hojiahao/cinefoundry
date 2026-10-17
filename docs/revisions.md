# Revisions and interchange

A delivered film is the start of the client conversation, not the end of it: "redo shot 3", "change this line", "make it
warmer". Cinefoundry makes each of these a revision of the finished project - a partial pipeline run that re-makes the
one thing that changed and everything that depends on it, and nothing else - and hands any finished cut to an online
editor as EDL, Final Cut Pro XML or OpenTimelineIO with its stems and subtitles.

## Revisions

```bash
cinefoundry revise <id> --shot N [--episode E] [--note "what to change"]
cinefoundry revise <id> --line <beat|scene.line> --text "new English" [--zh "新字幕"] [--episode E]
cinefoundry revise <id> --grade <warmer|cooler|brighter|darker|punchier|softer|richer|muted|neutral>
cinefoundry revise <id> --music "direction"
```

One revision per command. The engine API is `runRevision(REVISIONS[format], { id, request })`
(`src/engine/revise.ts`, `src/pipelines/index.ts`); the CLI is a thin wrapper and the Studio can call the same function.

### What each revision re-makes

| Revision | Ad film | Short video, micro-drama |
|---|---|---|
| `--shot N` | First frame (new seed; with `--note`, the storyboard artist rewrites the frame prompt and the storyboard keeps it) → quality gate within its regeneration limit → clip → RIFE master above 24 fps → master → only the cutdowns whose edit uses shot N → delivery QC | First frame (new seed or note) → identity gate → clip, lip-synced to its line on a dialogue shot → RIFE above 24 fps → the episode → delivery QC; the short's cover when it is that shot |
| `--line` | Beat N's English line (and subtitle) → script checks, restricted-wording scan, independent compliance reviewer → re-voiced in the cast announcer's voice, Whisper-checked; the other lines keep their takes → master → delivery QC. Cutdowns carry their own copy and are not touched | `scene.line` (both from 1) → screenplay checks, wording scan, absolute claims, independent reviewer → re-voiced in the character's cast voice, Whisper-checked → the dialogue shot regenerated against the new line → the episode → delivery QC |
| `--grade` | Master and every cutdown, re-finished from the clips on disk | Every cut episode (or `--episode E`) |
| `--music` | A new score in the given direction; master, and cutdowns back-timed to it. Refused on a silent film | A new score per episode; the episodes re-mixed |

Without `--zh`, the bilingual copy editor translates the new line into its subtitle under the same width rules.
A narrative `--shot` or `--line` defaults to episode 1.

### Rules the engine enforces

- **The lock.** A revision takes `projects/.harness.lock` like any run and refuses to start while another film holds it.
- **Refusals change nothing.** Everything that can refuse - a shot or line that does not exist, a line that fails the
  script checks, the wording scan or the reviewer, an unknown grade, a score for a silent film - is checked before any
  file is touched or any stage is marked. A refused revision is still recorded, with its reason. A line is never
  rewritten behind the client's back: when the reviewer would change it, the revision is refused and the suggested
  rewrite is quoted in the reason.
- **Only dependents change.** A shot revision re-cuts the master and the cutdowns that use the shot; a line revision
  re-voices that line only; finishing revisions keep every frame, clip and voice take. End card, voice takes and score
  are reused unless the revision is about them.
- **Previous assets are kept.** A file a revision replaces is first copied to its next versioned name
  (`clips/shot_003.v1.mp4`, `cut/final.v2.mp4`, `script/script.v1.json`); new frames carry the revision number
  (`frames/shot_003.rev1.png`). Nothing is deleted.
- **Every revision is recorded.** Each has its own runId; every `reports/run.jsonl` row it writes carries
  `kind: "revision"`, its number and `baseRunId` (the run that made the project). `reports/revisions.json` holds one
  entry per revision: the request (what and why), status, reason, stages re-run, every file changed with the version it
  replaced, deliverables re-cut and their QC verdict. The board marks the stages it re-runs with `revision N`.
- **Delivery QC and the report.** Every re-cut deliverable is measured again; `reports/qc.json` is merged, so the files
  not re-cut keep their reports. `reports/delivery.md` is rewritten with a revision history (修订记录); for short videos
  and micro-dramas the pipeline now writes a delivery report too.
- **Finishing choices persist.** `--grade` and `--music` are recorded in `cut/finishing.json`; every later cut of the
  project, by a revision or by `cinefoundry cut`, is finished with them.

### State a revision reads

A revision loads the project's recorded state, not a log of the original run: `brief.json`, `creative/treatment.json`,
`script/script.json`, `storyboard/storyboard.json`, `cut/version_<id>.json` for an ad; `story/`, `storyboard/`,
`cast/<id>/character.json` and the voice library for a narrative film; the assets in `state.json`, the options the
project was made with (`state.json` `options`), and each cut's timeline. Projects made before options and timelines
were recorded still load: a silent ad is recognised by its missing soundtrack, line takes and sound are found where the
dialogue and sound stages write them.

## Timelines

Every cut writes its edit decision record next to the film: `cut/master.timeline.json`, `cut/15s.timeline.json`,
`cut/06s.timeline.json`, `cut/ep01.timeline.json`. It lists each picture clip with its source file, in point, start and
length on the record, the dissolve into the end card, every sound on its bus (dialogue, music, effects, ambience), the
bilingual subtitles, the end card and the shot markers, and the grade. Revisions re-cut from what is on disk; export
reads only the timeline.

## Interchange export

```bash
cinefoundry export <id> --format edl|fcpxml|otio [--version master|15s|06s] [--episode E]
```

Writes `projects/<id>/exports/<label>/`:

| File | Contents |
|---|---|
| `<label>.edl`, `<label>.effects.edl` (`--format edl`) | CMX 3600, non-drop, record from 01:00:00:00. The first list is the picture with the dialogue (A) and music (A2) stems; the second the effects (A) and ambience (A2) stems, because an EDL carries two audio channels. Clip names and source paths in `FROM CLIP NAME` / `SOURCE FILE` comments, shot markers as `LOC` |
| `<label>.fcpxml`, `<label>.xml` (`--format fcpxml`) | FCPXML 1.10 for Final Cut Pro and DaVinci Resolve: frame-rate rationals (`frameDuration="1/60s"`), every offset and duration in whole frames, the four stems as connected clips with audio roles, shot markers. FCP 7 XML (xmeml 5) for Premiere Pro (and Resolve) with the same edit in frame counts |
| `<label>.otio` (`--format otio`) | OpenTimelineIO `Timeline.1`: a `Stack.1` of one video and four audio `Track.1`, `Clip.2` with `ExternalReference.1` and available ranges, the dissolve as a `SMPTE_Dissolve` `Transition.1`, shot markers as `Marker.2` |
| `<label>_mix.wav`, `<label>_dialogue.wav`, `_music.wav`, `_effects.wav`, `_ambience.wav` | The mix and its four stems, 48 kHz 24-bit, each exactly the cut's length, rendered from the timeline's sources in the same ffmpeg pass as the mix: the stems are the buses the mix sums, before the delivery loudness normalisation. A bus the film does not use is a silent stem, so a delivery always has four |
| `<label>.zh.srt`, `<label>.en.srt`, `<label>.ass` | The subtitles per language, to the millisecond, and the ASS burned into the delivered picture (titles, closing line, the explicit AI label) |
| `manifest.json` | What was exported, the picture list, which stems are empty, and the conform notes |

Every time is converted to whole frames at the cut's rate; a time that falls between frames, a clip that does not
start where the previous one ends, or a dissolve whose outgoing clip has no handle is an error, not a rounding. A
dissolve begins on the edit: the outgoing clip plays its tail handle under it, exactly as the cut was rendered.

The picture sources are the generated clips before grade and titles. The grade, the typeset titles and the explicit
AI label are in the delivered file and the ASS; a conform must burn the ASS in and keep the label (标识办法,
GB 45438-2025).
