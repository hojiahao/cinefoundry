---
name: editing-and-versioning
version: "0.2.0"
description: The editor's and the versioning editor's craft - story and rhythm, cutting on action and on dialogue (J and L cuts within what the assembler can do), reaction shots, retention editing for creator shorts, ad cutdowns from the 30 s master to 15 s and 6 s (choose shots, rewrite copy, re-run compliance, re-voice), micro-drama episodes that end on the cliffhanger, and the frame rate per format. Use when clips exist and the edit is decided, when a cutdown or vertical version is made, when an episode runs long or loses tension, or when the user asks to re-cut, tighten, shorten or reorder a film.
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

A cutdown is a new film made from the master's shots, not a trimmed master.

1. **Choose shots.** 15 s keeps the hook, the single proof and the product hero; 6 s keeps one image that carries the proposition and the end card. Choose the strongest frames, not the first ones.
2. **Durations to the frame.** Spots are exact: Σ durations − Σ overlaps = 30.0, 15.0 or 6.0 s. Example 6 s: hero shot 3.5 s + end card 3.0 s − 0.5 s dissolve. Example 15 s: 4.0 + 4.0 + 4.5 + 3.0 − 0.5. Trim tails to fit; never speed up picture.
3. **Rewrite the copy separately** with `ad-script-writing`: a 15 s line is a new English line - with its own Chinese subtitle and title - that fits 15 s, not the master's first half; 6 s has at most one short line or none, with the brand on screen throughout.
4. **Re-run compliance** (`ad-compliance-review`) on the new copy. Shorter copy drops qualifiers; a claim safe in 30 s can become absolute in 6 s.
5. **Re-voice** with the master's cast announcer, run pronunciation QC (`dialogue-and-voice`), re-mix with the same score, edited to resolve on the new end card - not faded.
6. Re-time subtitles from the new voice (`bilingual-subtitles`) and run `delivery-qc` on every version.

## Frame rates per format

| Format | Delivery fps | How |
|---|---|---|
| Micro-drama, creator skits | 24 | Native 24 fps clips; no interpolation. Higher rates read as soap opera and fight the film look (research, 5.4) |
| Ads and product films | 60 | RIFE 120 fps master per clip, conformed by dropping frames evenly |
| Creator shorts | 30 for talking heads and drama, 60 for product and motion | 30 from the 120 master; 60 likewise |
| China TV ad version | 25 | When the brief names broadcast (research, 5.4) |

Never mix frame rates inside one film, and never interpolate a lip-synced drama shot: RIFE smears mouths.

## Output format

```json
{
  "version": "15s",
  "target_seconds": 15.0,
  "fps": 60,
  "shots": [{"clip": "clips/shot_002.hfr.mp4", "seconds": 4.0, "join": {"type": "cut", "overlap": 0}, "why": "hook"}],
  "lines": [{"id": "vo_1", "at": 0.45}],
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
