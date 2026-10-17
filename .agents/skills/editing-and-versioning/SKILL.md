---
name: editing-and-versioning
version: "0.3.0"
description: The editor's and the versioning editor's craft - story and rhythm, cutting on action and on dialogue (J and L cuts within what the assembler can do), reaction shots, retention editing for creator shorts, ad cutdowns from the 30 s master to 15 s and 6 s (choose shots, rewrite copy, re-run compliance, re-voice), micro-drama episodes that end on the cliffhanger, and the frame rate per format. Also client revisions after delivery (redo a shot, change a line, regrade, rescore) and interchange to an online editor (EDL, FCPXML, OpenTimelineIO, stems, SRT). Use when clips exist and the edit is decided, when a cutdown or vertical version is made, when an episode runs long or loses tension, when the user asks to re-cut, tighten, shorten or reorder a film, when a client asks for a change to a delivered film, or when a cut must go to Resolve, Premiere or Final Cut.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: post
  tags:
    - editing
    - versioning
    - cutdowns
    - retention
    - micro-drama
    - revisions
    - interchange
---

# Editing and versioning

The edit is where generated shots become a performance. A model gives five seconds of a face; the editor decides which two and a half of them are true, what the audience hears over the cut, and what they see when they need to feel something. The editor decides; the code (`assembleFilm`) executes the decision list.

## What the assembler does

- Each clip occupies `durations[i]` seconds, **taken from the start of the clip**: tails can be trimmed, heads cannot. Plan every cut with that in mind.
- A join is a hard cut (overlap 0) or a dissolve of the overlap's length; overlaps are per join. Film length = Σ durations − Σ overlaps.
- One grade over the joined film, fade in 0.35 s, out 0.5 s; audio is a finished soundtrack laid under the picture.
- Generated clips are 5 s at 24 fps (121 frames). Narrative episodes are built on that grid: exactly one shot per 5 s of running time (*checked*), each dialogue line in its own shot (*checked*).

## Story and rhythm

- Cut when the shot has delivered its information or emotion, not when it runs out. Most generated shots have their best second in the middle; video models settle into a hold or drift in the last second. Trim tails freely.
- Vary shot length with intent: tension tightens the cuts, grief lets a shot sit. Five 5-second shots in a row is a metronome, not a scene.
- Each scene has a turn. Find the shot where it turns and give it the most screen time.
- Cut out anything the audience already knows. If a reaction says it, cut the line that explains it.

## Cutting on action

- Cut in the middle of a movement - a turn of the head, a stand, a door opening - so the motion carries the eye across the cut. Match the direction and speed of the movement on both sides.
- Screen direction holds across the cut (see `character-and-continuity`): a character exiting frame right enters the next shot frame left.
- Commercials cut hard on action; the only dissolve is 0.5 s into the end card. Drama dissolves only for time passing, and rarely.

## Dialogue: J and L cuts, reaction shots

- **L-cut** (the line continues over the listener): trim the speaker's clip tail and place the listener's shot next; the line's audio keeps playing from the speaker's clip timing. This is fully supported and is the main tool for making dialogue feel performed rather than generated: the audience watches the listener take the line.
- **J-cut** (the next speaker is heard before we cut to them) needs the next clip's head trimmed so its picture catches up with its audio. The assembler cannot trim heads today, so a J-cut is limited to a line whose audio starts late in its own clip: a line placed with 0.4 s of breath can lead the cut by at most that breath. Do not offset audio further than the clip allows; lip-sync falls apart by the frame.
- Keep audio and picture locked for every lip-synced shot: the line's position on the timeline = the clip's start on the timeline + the line's offset inside the clip. Any J or L cut moves the cut, never the line.
- **Reaction shots** are planned, not found: the screenplay budget leaves non-dialogue shots for them (one line per 5 s shot, *checked*). A reaction is a listener's single or a close-up without a line, played small - a held breath, eyes dropping. Generated faces are weakest in long emotional close-ups; a 1.5-2 s reaction cut against the line does more than 5 s of the speaker.
- Never cut away from a speaker on a plosive or mid-word; cut on a breath or between phrases.

## Retention editing for creator shorts

- The first 3 seconds decide the session: open on the conclusion, the conflict or the strongest image, never on a greeting or a logo. The first line matches the title and the first shot matches the cover (research, 4.2).
- A visual change every 2-4 seconds (cut, push-in, insert, title or sound hit) for vertical shorts; about every 30 seconds a pattern interrupt (new location, graphic, sound turn) for long-form (research, 4.2; practitioner values). Talking heads change framing every 5-10 seconds (research, 4.1).
- Douyin practitioners watch the 5-second completion rate (often cited >40%, with >30% overall completion; training-school figures, no official source). Edit as if every second must earn the next.
- YouTube long-form: the best material compressed into the first 60 seconds, a re-engagement beat about every 3 minutes (research, 4.2).
- Mark the retention risks in the edit notes: every stretch longer than 4 s without a change, every line that repeats the title.

## Micro-drama episodes

- The hook is in the first 3 seconds: direct conflict, a strong question or a fall from a height (research, 3.2). Episode 1 establishes the identity gap within 10 s.
- An emotional beat every 20-30 seconds, the first release or reversal inside the first half minute, the cycle of anticipation, pressure, release.
- **End on the cliffhanger, at its highest point.** Cut on the reveal or the reaction to it, before any answer: a face registering the line, a door opening on someone we did not expect. Hard cut to black or to the episode card on the beat; a sting may hit on the cut. Never resolve, never linger, never fade out slowly.
- Paywall episodes are structured backward from the peak, not from a natural story break (research, 3.2); for overseas releases the first 5-10 episodes are free and the paywall falls at the emotional peak of episodes 8-12 (research, 5.4).
- Episodes run 1-3 minutes domestically, 60-90 s overseas; the regulatory ceiling is under 20 minutes (research, 3.5).

## Ad cutdowns: 30 s master to 15 s and 6 s

A cutdown is a new film made from the master's shots, not a trimmed master. The ad pipeline's `versions` stage runs this section after the cut: the versioning editor (this skill with `ad-script-writing`) returns one plan per version, code checks it (`src/crafts/versions.ts`), and the cut reuses the master's finishing pass.

1. **Which versions.** 15 s (three shots) and 6 s (one shot), each only from a master at least twice its length - from a 30 s master both, from 15-25 s only the 6 s (*checked*).
2. **Choose shots.** 15 s keeps the hook, the single proof and the product hero; 6 s keeps one image that carries the proposition and the end card. Choose the strongest frames, not the first ones: the gate score of every shot is in the brief. Every shot is a shot of the master and is used once per version (*checked*).
3. **Durations to the frame.** Spots are exact: Σ durations − Σ overlaps = 15.0 or 6.0 s, end card included: 6 s = hero 3.5 s + end card 3.0 s − 0.5 s dissolve; 15 s = 4.0 + 4.0 + 4.5 + 3.0 − 0.5 (*checked*). Each shot holds 3-5 s from the head of its clip and lands on a frame at the delivery rate (*checked*). Trim tails to fit; never speed up picture.
4. **Rewrite the copy separately** with `ad-script-writing`: a 15 s line is a new line that fits 15 s, not the master's first half; 6 s has one short line, with the brand on screen throughout. The beat shape is the master's - an English line, its Chinese subtitle, a Chinese title, one beat per shot - and every master script check applies (*checked*). A line holds at most the master's 13 words scaled to its shot's voice slot: 5 s 13, 4.5 s 11, 4 s 9, 3.5 s 8, 3 s 6 (*checked*).
5. **Re-run compliance** (`ad-compliance-review`) on the new copy, through the same reviewer path as the master; a reviewer's rewrite is kept only if it still passes the version's checks, and copy with a `block` finding is not cut (*checked*). Shorter copy drops qualifiers; a claim safe in 30 s can become absolute in 6 s.
6. **Re-voice** with the master's cast announcer, run pronunciation QC (`dialogue-and-voice`), re-mix with the same score back-timed so it ends where the master's does - resolving on the new end card, not faded mid-phrase (*checked*: the version takes the last seconds of the master's bed).
7. Re-time subtitles from the new voice (`bilingual-subtitles`) and run `delivery-qc` on every version (*checked*: the `qc` stage measures master and cutdowns). A version whose plan or copy cannot be made to pass is not cut; it is reported as an open item and the master still ships.

## Client revisions

After delivery the client reviews and asks for changes. A change is a revision of the finished project, never a new run: `cinefoundry revise` re-makes the one thing that changed and everything that depends on it, and nothing else (`docs/revisions.md`).

| The client says | Command | What is re-made |
|---|---|---|
| "Redo shot 3" / "the can looks wrong in shot 3" | `revise <id> --shot 3 [--note "what to change"]` | That shot's frame (new seed, or the note applied to its frame prompt), gate, clip; the master and only the cutdowns that use the shot (*checked*) |
| "Change this line" | `revise <id> --line 2 --text "..." [--zh "..."]` (ad beat) or `--line 3.1 --episode 1` (scene.line) | The line through compliance, re-voiced in the same cast voice with the Whisper check, the lip-synced shot of a dialogue line; the master or the episode (*checked*) |
| "Warmer", "less saturated" | `revise <id> --grade warmer` | Finishing only: every deliverable regraded, every clip and voice kept (*checked*) |
| "The music is too busy" | `revise <id> --music "sparse piano, slower"` | A new score; master and cutdowns, back-timed (*checked*) |

How the editor works a note:

1. **Translate the note into one revision.** "Make shot 3 feel like morning" is `--shot 3 --note "soft low morning light from the left"`: a note names what is visible in the frame (light, framing, what is in it), never the product's or a face's look - those come from the hero still and the reference portraits. "Make it warmer" over the whole film is a grade, not six shot notes. One revision per command; several notes are several revisions, each recorded.
2. **A line change is a copy change.** The new line must pass everything the script passed: the word count for its slot, the subtitle width, the wording scan and the independent reviewer (*checked*). If it fails, the revision is refused with the reason and nothing changes; tell the client what the rule is and offer the reviewer's suggested wording. Never soften a client's line without asking.
3. **Expect only dependents to change.** A revised shot that no cutdown uses leaves the 15 s and 6 s files untouched; a line revision leaves the cutdowns' own copy alone. The revision record (`reports/revisions.json`) lists every file changed and the version it replaced (`clips/shot_003.v1.mp4`): use it to show the client before and after.
4. **Report from the record.** After a revision, read the delivery report's 修订记录 and the new QC verdict; a frame kept after a failed gate or a line Whisper still mis-hears is an open item, as in the original run.
5. **One film at a time.** A revision takes the GPU lock like any run; it is refused while another film generates.

## Interchange: handing the cut to an online editor

When the client's post house finishes the film in DaVinci Resolve, Premiere Pro or Final Cut Pro, export the cut instead of sending only the MP4:

```bash
cinefoundry export <id> --format fcpxml            # FCPXML 1.10 (Resolve, Final Cut) + FCP 7 XML (Premiere)
cinefoundry export <id> --format edl --version 15s # CMX 3600 EDL of a cutdown
cinefoundry export <id> --format otio --episode 2  # OpenTimelineIO of an episode
```

Everything lands in `projects/<id>/exports/<label>/`: the interchange file, the mix and its four stems (dialogue, music, effects, ambience) as WAVs of the cut's exact length, Chinese and English SRT, the ASS, and `manifest.json`. Timecode starts at 01:00:00:00; every event is on a whole frame at the cut's rate (*checked*); the dissolve into the end card begins on the edit. The picture sources are the ungraded, untitled clips: tell the receiving editor that the grade and titles are in the delivered file and the ASS, and that the explicit AI label must stay burned in.

## Frame rates per format

| Format | Delivery fps | How |
|---|---|---|
| Micro-drama, creator skits | 24 | Native 24 fps clips; no interpolation. Higher rates read as soap opera and fight the film look (research, 5.4) |
| Ads and product films | 60 | RIFE 120 fps master per clip, conformed by dropping frames evenly |
| Creator shorts | 30 for talking heads and drama, 60 for product and motion | 30 from the 120 master; 60 likewise |
| China TV ad version | 25 | When the brief names broadcast (research, 5.4) |

Never mix frame rates inside one film, and never interpolate a lip-synced drama shot: RIFE smears mouths.

## Output format

One plan per version (`cut/version_<id>.json` keeps it with the compliance result):

```json
{
  "version": "15s",
  "target_seconds": 15,
  "shots": [{"shot": 2, "seconds": 4.0, "why": "hook"}, {"shot": 4, "seconds": 4.0, "why": "proof"}, {"shot": 6, "seconds": 4.5, "why": "product hero"}],
  "script": {"structure": "hook -> proof -> hero", "beats": [{"beat": 1, "job": "hook", "see": "what is on screen", "vo": "English line", "zh": "中文字幕", "text": "标题"}]},
  "notes": ["retention risk: 0:08-0:13 single held shot"]
}
```

## Common failures

- Every shot left at its full 5 s: the drift and the dead last second stay in.
- A J-cut that offsets a lip-synced line from its picture.
- A cutdown made by trimming the master: the line ends mid-sentence and the music fades.
- Cutdown copy not re-checked for compliance.
- A drama episode that ends a beat after the cliffhanger.
- A drama interpolated to 60 fps.
