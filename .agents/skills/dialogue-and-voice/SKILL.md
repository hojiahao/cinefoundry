---
name: dialogue-and-voice
version: "0.1.0"
description: The voice casting director's, the dialogue director's and the ADR supervisor's craft - designing one English voice per character from a written description with Qwen3-TTS VoiceDesign, casting the ad announcer from the library, directing delivery, Whisper pronunciation QC with retake thresholds, the rules a lip-synced shot must meet (one speaker in frame, medium or close framing, a line of at most five seconds with a breath before it) and off-screen voice-over. Use when characters are cast, before any dialogue or voice-over is synthesised, before lip-synced clips are generated, and when a line fails QC or needs a different read.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: sound
  tags:
    - voice
    - dialogue
    - adr
    - lip-sync
    - qwen3-tts
    - whisper
---

# Dialogue and voice

Every voice in a Cinefoundry film is designed from words, never recorded from or cloned of a real person. A designed reference clip is made once per character (or per announcer), and every line is cloned from that one clip, so the voice never changes within a film or a season. In narrative films the line is synthesised first and the picture is generated to it: LTX-2.5 lip-sync takes the dialogue audio, encodes it and freezes it, and only the picture is sampled, so the mouth follows the words (`workflows/ltx25_fast_lipsync.json`). The audio is the performance; a flat read makes a flat face.

## What the tools do today

| Tool | What it does | Note |
|---|---|---|
| `scripts/voice-cast.py` (`designVoices`) | Qwen3-TTS VoiceDesign per character: a written `design`, a reference line, a `language` (English by default), 3 takes | The character voices |
| `scripts/voice-design.py` | The same model over `deploy/voices.json`: 4 takes per announcer, Mandarin reference text | The ad announcer library |
| `scripts/qwen-clone.py` (`cloneLines`) | Qwen3-TTS Base: encodes one reference clip once and voices every line from it; per-line `seed` and `language` | No style or emotion parameter |
| `scripts/asr-score.py` (`scoreSpeech`) | Whisper large-v3-turbo; language picked from the expected text; English scored as word error rate, Chinese as toned-syllable (pinyin) error rate, so homophones are not errors | Punctuation and case ignored |
| `speakChecked` in `src/lib/speech.ts` | Speaks, scores and retakes: a line above 0.08 error gets up to 2 more seeds, the lowest-error take is kept | Keeps the best take even if it still fails: read the returned rates |
| `src/lib/audio.ts` | Trims leading and trailing silence at -45 dB, speeds an overrunning line up to 1.25x (never cuts), runs the broadcast voice chain (70 Hz high-pass, 3:1 compression, low-mid body, 3.2 kHz presence, limiter) | Places ad voice-over 0.45 s after its shot starts |
| `ltx25_fast_lipsync.json` | Trims the dialogue audio to the shot length and generates the picture against it | Audio longer than the shot is cut off |

## Casting a character voice

1. Start from `Character.voice` (English, required, *checked*): age, timbre, pace, accent. Expand it into a VoiceDesign `design` of three to five sentences: age and gender, register and timbre (breathy, chesty, nasal, gravelly), pace and rhythm, accent (General American, Southern British, light Mandarin-accented English - say which), the attitude underneath ("dry and guarded, warms only with people she trusts"). No names of actors or real people.
2. Write an English reference text of 8-12 seconds: phonetically varied, emotionally neutral, in the character's register, no proper names. A neutral reference clones well in every mood; an angry one makes every line angry.
3. Design three takes (`voice-cast.py`, `language: English`), score each with Whisper, keep the cleanest, then listen: timbre right for the face, no hiss, no clipped consonants, no metallic tail. Keep the clip and its text under `runtime-data/step-audio/` (the only folder the audio containers can reach); it is the character's entry in the film's voice map, which also holds `vo` for a narrator.
4. Cast for contrast across the ensemble the way the look sheet does for faces: two characters of the same gender differ in pitch range and pace, audible with the screen off.
5. Lock the voice with the look sheet for the season.

## Casting the ad announcer

Ads cast one announcer per film from `deploy/voices.json` (the creative director's `sound.voice`, *checked* against the library ids). The six designed Mandarin narrators:

| id | Use for |
|---|---|
| `baritone-premium` | premium automotive, watches, computing, finance |
| `warm-premium-female` | skincare, jewellery, fragrance, home |
| `bright-young-female` | drinks, snacks, everyday treats |
| `clear-young-male` | sports drinks, consumer electronics, everyday tech |
| `deep-authority-male` | technology launches, corporate and brand films |
| `intimate-soft-female` | candles, sleep, night-time home |

Cutdowns of the same campaign keep the master's announcer. An English announcer is not in the library; design one with this skill's casting steps if a brief needs it.

## Directing delivery

- `DialogueLine.delivery` says how the line is played in physical, actable terms: "quietly, holding back tears", "fast, cutting him off", "a half laugh on the first word". Never one emotion word.
- The clone engine has no emotion control, so delivery is carried by the text and the reference: punctuation sets the breath ("No. Not tonight." plays differently from "No, not tonight"); a short sentence lands harder; a dash makes an interruption. For a register the neutral clip cannot reach (shouting, whispering), design a second reference for the same character from the same `design` plus the register, and accept it only if it is unmistakably the same voice side by side.
- Subtext over text: the best lines say less than the character means. Cut adverbs from the line; put them in `delivery`.
- Contractions, fragments and interruptions are how people speak. A line that reads like a caption ("I am very upset that you did this") will sound synthetic however clean the voice.

## Pronunciation QC and retakes (ADR)

Every synthesised line is transcribed and compared with its script before it reaches the lip-sync workflow or the mix. The code retakes anything above 0.08 (`speakChecked`); the house bar on top of it:

| Material | Measure | Pass | Retake |
|---|---|---|---|
| English dialogue (≤ 12 words) | word error rate | ≤ 0.08 (code), and 0 errors on names, numbers and the line's key words | any content word wrong, dropped or added, even under 0.08 |
| Mandarin announcer | toned-syllable error rate | ≤ 0.05, and 0 on the brand name, product name and numbers | anything above, or a wrong tone on the brand |
| Reference clip for a voice | error rate | the lowest of the takes, and 0 on a 10-12 s line | redesign if no take reaches it |

On a 12-word line one wrong word is 0.083: the code threshold already means "at most one slip in a short line", and that slip may not be a word that carries meaning.

- A retake changes the seed first (the code steps `7 + 101 × round`), then the wording (a synonym, a name moved off the line ending), then the design. After three failed takes `speakChecked` keeps the least-bad one silently: treat any returned rate above threshold as a failure, rewrite the line with the screenwriter, and do not ship the closest miss.
- Listen to every passing take as well. ASR does not hear a robotic cadence, a wrong stress ("REcord" for "reCORD"), a breath in the middle of a word, or a line that sounds read rather than said.
- Record per line: take count, error rate, chosen take, and any line accepted with a known flaw.

## Lip-synced shot rules

- **One speaker in frame.** A dialogue shot frames its speaker first (*checked*); a second character appears only from behind in an over-the-shoulder (*checked*). Two faces in frame and the model gives the line to the wrong mouth.
- **Framing that shows the mouth:** medium, medium close-up, close-up or over-the-shoulder (*checked*). Front or three-quarter face; never profile, never a wide.
- **Line length.** At most 12 English words (*checked*): about 4.4 s at conversational pace inside a 5 s shot. A longer thought is two lines in two shots, typically split across a reaction.
- **A breath before the line.** The audio given to the lip-sync workflow starts with about 0.4 s of room tone so the mouth starts closed and opens on the first word, and ends at least 0.3 s before the shot ends so the mouth settles. The silence trim in `audio.ts` removes this; pad it back for lip-sync stems.
- **One line per shot,** and every line has a shot (*checked*); a line is never spoken in two shots (*checked*).
- Speed-up: `audio.ts` allows 1.25x for voice-over; for lip-synced dialogue keep it at or under about 1.1x. Above that the read sounds rushed and the mouth flutters. Shorten the line instead.
- After generation, check sync on the clip: plosives (p, b, m) close the lips on the frame they are heard. Lips one or two frames late across a whole line read as dubbing.

## Off-screen voice-over

- Speaker `vo` is exempt from the framing rules (the check skips it): use it for narration, inner monologue, a voice on the phone or through a door.
- Never lay voice-over over a close-up of a character whose mouth is closed but who looks as if they should be speaking; cut to hands, an insert or a back view.
- An off-screen character speaking within the scene (heard from the next room) gets the same voice as on screen, filtered by the room in the mix, not a different voice.
- Narration is mixed dry and close; diegetic off-screen lines carry the room's reverb.

## Common failures

- A line whose kept take is still above threshold shipped because `speakChecked` returned without throwing.
- A reference clip with emotion baked in: every line inherits it.
- Lines written to be read: "As you know, we have been partners for ten years."
- A 15-word line squeezed to 5 s by time-stretching: rushed, and the lip-sync falls apart.
- No breath before the line: the mouth is already moving on the cut.
- Two characters of the same gender with indistinguishable voices.
