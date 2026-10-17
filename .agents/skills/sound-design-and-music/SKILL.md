---
name: sound-design-and-music
version: "0.1.0"
description: The sound designer's and the composer / music supervisor's craft - per-shot sound-effect and per-scene ambience prompts for MOSS-SoundEffect v2 (English, concrete, 48 kHz, at most 30 s, never music), foley sync points, ambience beds per location, score direction for ACE-Step (genre, instrumentation, tempo, structure, ending; no named artists), how the layers sit under dialogue, and the licensing rule that nothing is licensed or uploaded. Use after the shot list is locked and before the mix, when a scene or shot is re-cut, or when the user asks to change the sound, the effects or the music of a film, short or episode.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: sound
  tags:
    - sound-design
    - foley
    - ambience
    - music
    - moss-soundeffect
    - ace-step
---

# Sound design and music

Half of what makes a frame feel real is what you hear. A generated picture with dead air reads as a render; the same picture with a room tone, a cup set down on the frame it touches the table and a score that breathes with the cut reads as a film. Sound is designed per shot from the locked shot list, generated locally, and mixed under the dialogue.

## Tools

| Layer | Engine | What it does |
|---|---|---|
| Effects and ambience | MOSS-SoundEffect v2 (Apache-2.0) via `scripts/sfx.py` / `generateSfx` | One English prompt and a length per job, clamped to 30 s, 48 kHz, 100 steps, cfg 4.0; the model loads once per batch; a `seed` per job picks the take |
| Score | ACE-Step v1 3.5B via ComfyUI `ace_step_instrumental` / `generateMusic` | Instrumental only (lyrics fixed to `[instrumental]`); conditioned on `tags`; renders 2 s longer than asked; saves MP3 |
| Mix | `mixSoundtrack` in `src/lib/audio.ts`, loudness in `assembleFilm` | Voice lines placed at cue times, music bed at 0.55 under them with sidechain ducking (ratio 8, 20 ms attack, 400 ms release), limiter, then the whole soundtrack normalised to -16 LUFS / -1.5 dBTP |

The ACE-Step output is MP3: decode once to 48 kHz WAV and never re-encode it lossy again before the final AAC.

## Workflow

1. Read the treatment's `sound.ambience` and `sound.music` (English, *checked*; no named artists or films, *checked*) and the shot list. For narrative films read each scene heading: location and time of day decide the ambience.
2. **Spot the film.** For each shot, list what must be heard and when, in seconds from the shot's start: footfalls, a door, a cup, a phone buzz, cloth on a turn, a breath. Mark which ones are sync points (the sound has a visible cause on a known frame).
3. Write one ambience prompt per location (per scene) and one effects prompt per shot that needs one. A shot without a visible sound event gets no effect: ambience carries it.
4. Write the score direction once per film or episode, with the cue map (where music enters, peaks, drops out).
5. Generate: ambience for the scene's full length plus 2 s handles (split above 30 s into overlapping beds crossfaded over 1-2 s), effects at the shot's length, score at the film's length.
6. Audition every take with picture. Reject and reseed anything with musical content in an effects take, a mismatched space (a cathedral reverb on a kitchen), audible artefacts (metallic shimmer, warble, a dropout), or a sound that lands on the wrong action.
7. Hand the layers to the mix with their placement times.

## Writing MOSS-SoundEffect prompts

English, concrete, physical: the source, the action, the material, the space, the distance, the intensity. One event or one bed per prompt.

| Weak | Strong |
|---|---|
| "café sounds" | "quiet café interior in the morning, low murmur of a few distant conversations, occasional cup set on a saucer, espresso machine hiss far in the background, small room" |
| "footsteps" | "a woman's leather ankle boots walking slowly on a wooden floor, close, indoors, five steps then stop" |
| "dramatic hit" | "a heavy wooden door slammed shut in a stone hallway, close, with a short hard echo" |
| "phone" | "a smartphone vibrating twice on a hard wooden table, close, dry room" |

- No music, melody, chords, beats or "cinematic" in an effects or ambience prompt: the model obliges with a tune, and it fights the score. "Riser", "whoosh" and "impact" are design sounds for ads and trailers, not for drama.
- No speech in ambience beyond indistinct murmur ("unintelligible distant voices"): words in the bed compete with the dialogue and the subtitles.
- Say the space every time (small room, open street, car interior, stairwell). Ambience that matches the picture's space is what makes the room real.
- Say the distance (close, mid, far) so the take sits at the right perspective without heavy processing.
- Write lengths as the job's `seconds`, not in the prompt.

## Foley and sync points

- Sync what the audience sees cause: a hand placing an object, a door, a footfall on a visible step, a phone landing. Place the transient on the frame of contact, within one frame at 24 fps. A sound 2-3 frames late reads as dubbing.
- Generated video timing drifts: find the contact frame by stepping through the clip, not from the prompt's intended timing. Trim the effect's leading silence so the transient sits exactly on that frame.
- Cloth and body: a soft clothing rustle on a turn, a sit, a stand. Barely audible, but its absence makes people look pasted in.
- Do not foley what is off screen unless it is story (a car pulling up outside is story; random traffic is ambience).
- Hands and props are where generated video is weakest; a precise, quiet sound on the contact sells a contact the picture only half shows.

## Ambience beds per location

- One continuous bed per scene, running under every shot of the scene and across cuts. Ambience that changes on every cut announces the edit and breaks the space.
- Interiors have a room tone even when "silent": an air handler, a fridge hum, a distant city. True digital silence is never used except as a deliberate story beat, and then for under a second.
- Day and night differ: birds and traffic by day; a distant siren, insects or wind by night. Rain, wind and weather match what the picture shows.
- Dialogue scenes keep beds low and steady, without events that land on top of words.
- Ads: the treatment's single ambience under the whole film, faint, so the product world has air.

## Score direction for ACE-Step

`tags` are genre, instrumentation, tempo, mood and how it ends, comma-separated, English, no artist, composer, film or brand names (*checked* for the treatment):

```
restrained modern cinematic score, felt piano, warm low strings, soft pulsing synth bass, 72 bpm, intimate and hopeful, builds gently, resolves on a sustained major chord
```

- **Instrumentation** is three or four named instruments. "Orchestral" alone gives a stock trailer.
- **Tempo** in bpm, chosen from the edit: shots every 5 s at 72 bpm put a cut every six beats; ads at 90-110 bpm cut on the bar.
- **Structure and ending** in plain words: "starts sparse, builds from the middle, ends on a held chord". A score that fades out mid-phrase sounds cut, so the end card lands on the resolution; trim the render's extra 2 s from the tail, never from a phrase.
- **Micro-drama:** one theme per series, with motifs per character or relationship; stings at the cliffhanger. Music drops out for the most important line of a scene: silence under dialogue is louder than a swell.
- **Ads:** the score carries the rhythm the editor cuts to; the drop or resolution lands on the product reveal or the end card.
- **Creator shorts:** a light bed under talking heads, at a level that never competes with speech.

## Levels under dialogue

Dialogue is the reference; everything else is mixed relative to it. House targets on short-term loudness while a line plays: ambience 18-24 LU below dialogue, effects at the level their distance implies (a close cup can touch dialogue level between lines, never on a word), music 12-18 LU below dialogue under speech and up to near dialogue level between lines. The bed ducks under the voice by sidechain (code), so set the music level for the gaps, not for under speech. The final loudness target is a delivery matter: see `delivery-qc`.

## Licensing

Nothing in the soundtrack is licensed, sampled or uploaded. Effects, ambience and score are generated on this machine; voices are designed, not recorded or cloned from a person. Never use a library track, a commercial song, a sample pack or a "sound-alike" prompt for a known piece. Record the engine and seed of every layer in the delivery report; the soundtrack is declared AI-generated with the picture.

## Output format

```json
{
  "score": {"tags": "English tags", "seconds": 30, "cues": [{"at": 0.0, "event": "enter sparse"}, {"at": 22.5, "event": "resolve on end card"}]},
  "ambience": [{"scene": 1, "prompt": "English", "seconds": 32}],
  "effects": [{"shot": 3, "prompt": "English", "seconds": 5, "sync": [{"at": 1.62, "what": "cup touches table"}]}]
}
```

## Common failures

- "Cinematic" or "epic" in an effects prompt: a melody in the foley.
- A new ambience on every shot: the cut becomes audible and the room disappears.
- Effects timed from the prompt instead of the frame: everything lands late.
- A score with no ending, faded out under the end card.
- Music under every line of a drama: no line lands.
- Named artists or "in the style of" in score tags.
