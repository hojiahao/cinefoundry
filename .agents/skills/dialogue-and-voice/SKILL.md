---
name: dialogue-and-voice
version: "0.2.0"
description: The voice casting director's, the dialogue director's and the ADR supervisor's craft - the 52-voice designed casting library (English and Mandarin, female and male, five adult age bands; announcer, narrator, presenter and character uses) and its design and QC scripts, casting characters from the library first and designing a voice only when none fits, casting the English ad announcer, directing delivery, Whisper pronunciation QC with retake thresholds, the rules a lip-synced shot must meet (one speaker in frame, medium or close framing, a line of at most five seconds with a breath before it) and off-screen voice-over. Use when characters are cast, before any dialogue or voice-over is synthesised, before lip-synced clips are generated, and when a line fails QC or needs a different read.
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
    - casting
---

# Dialogue and voice

Every voice in a Cinefoundry film is designed from words, never recorded from or cloned of a real person. A designed reference clip is made once per voice - for each of the casting library's voices, and for a character no library voice fits - and every line is cloned from that one clip, so the voice never changes within a film or a season. In narrative films the line is synthesised first and the picture is generated to it: LTX-2.5 lip-sync takes the dialogue audio, encodes it and freezes it, and only the picture is sampled, so the mouth follows the words (`workflows/ltx25_fast_lipsync.json`). The audio is the performance; a flat read makes a flat face.

## The casting library

`deploy/voices/library.json` holds 52 designed voices: English (General American) and Mandarin (标准普通话), female and male, 13 of each per language, across five adult age bands - 18-25, 26-35, 36-50, 51-65, 66+. Each entry has an `id` (`en-f2635-warm-velvet`, `zh-m3650-…`), its `ageBand`, `age`, `timbre`, the VoiceDesign `design` it is made from, a casting `description`, and its `uses`: `announcer` (ads), `narrator` (documentary and story narration), `presenter` (creator shorts), `character` (drama roles). The library also fixes one neutral reference text per language and the pitch range per gender (female 150-300 Hz, male 80-180 Hz).

A voice is castable only once its reference clip has passed QC on this machine: `castableVoices` in `src/lib/voices.ts` lists a voice only when `voices/<id>.wav` exists in the audio work folder, and only QC writes that file.

## What the tools do today

| Tool | What it does | Note |
|---|---|---|
| `scripts/voice-design.py` | Qwen3-TTS VoiceDesign over the library: each voice's `design` speaks its language's reference text, 4 takes per voice (`--takes`), filtered by `--only <ids>` or `--language English\|Chinese` | Builds the library's candidate takes |
| `scripts/voice-qc.py` | Picks each library voice's reference from its takes. A take must pass all three: **pronunciation** - Whisper large-v3-turbo error against the reference text at most 0.05 (`--max-error`; English by word, Chinese by toned pinyin syllable); **pitch** - median F0 of voiced frames inside the library's range for the voice's gender, so a deep male narrator cannot come out a tenor; **level** - peak below -0.3 dBFS and RMS above -40 dBFS. Lowest error wins, ties go to the take nearest the voice's median length | Writes `voices/<id>.wav` and every measurement to `voices/qc.json`; a voice with no passing take stays uncastable |
| `scripts/voice-cast.py` (`designVoices`) | VoiceDesign for one film's characters that no library voice fits: a written `design`, one reference line, a `language`, 4 takes in the drama and short pipelines | Takes scored by Whisper, the lowest-error one kept |
| `scripts/qwen-clone.py` (`cloneLines`) | Qwen3-TTS Base: encodes one reference clip once and voices every line from it; per-line `seed` and `language` | No style or emotion parameter |
| `scripts/asr-score.py` (`scoreSpeech`) | Whisper large-v3-turbo; language picked from the expected text; English scored as word error rate, Chinese as toned-syllable (pinyin) error rate, so homophones are not errors | Punctuation and case ignored |
| `speakChecked` in `src/lib/speech.ts` | Speaks, scores and retakes: a line above 0.08 error gets up to 2 more seeds, the lowest-error take is kept | Keeps the best take even if it still fails: read the returned rates |
| `src/lib/audio.ts` | Trims leading and trailing silence at -45 dB, speeds an overrunning line up to 1.25x (never cuts), runs the broadcast voice chain (70 Hz high-pass, 3:1 compression, low-mid body, 3.2 kHz presence, limiter) | Places ad voice-over 0.45 s after its shot starts, 4.1 s per line |
| `ltx25_fast_lipsync.json` | Trims the dialogue audio to the shot length and generates the picture against it | Audio longer than the shot is cut off |

## Casting a character voice

1. Start from `Character.voice` (English, required, *checked*): age, timbre, pace, accent, the attitude underneath ("dry and guarded, warms only with people she trusts"). No names of actors or real people.
2. **The library first** (`castFromLibrary` in `src/crafts/narrative/production.ts`). The code takes the QC-passed English voices tagged `character` of the same gender and within twelve years of the character's age, scores each by the words of `Character.voice` that appear in its timbre and design (three points a word, minus a quarter point per year of age difference), and casts the best. Write `Character.voice` in the library's vocabulary - timbre and register words like warm, husky, gravelly, breathy, bright, resonant - so the match lands on the voice you mean.
3. **Design only when nothing fits.** A character no library voice matches gets a voice of their own: the code builds the design from `Character.voice` plus age, gender and "natural American English, speaking like a real actor in a television drama, not an announcer", speaks one neutral English line in 4 takes, scores them with Whisper and keeps the cleanest. Then listen: timbre right for the face, no hiss, no clipped consonants, no metallic tail. A designed voice has passed pronunciation only - pitch and level are yours to check by ear. Keep the clip and its text under `runtime-data/step-audio/` (the only folder the audio containers can reach).
4. A reference text, when you write one: 8-12 seconds, phonetically varied, emotionally neutral, in the character's register, no proper names. A neutral reference clones well in every mood; an angry one makes every line angry.
5. Cast for contrast across the ensemble the way the look sheet does for faces: two characters of the same gender differ in pitch range and pace, audible with the screen off.
6. Lock the voice with the look sheet for the season.

## Casting the ad announcer

The ad's announcer speaks English. The creative director casts one per film as `sound.voice` from `castableVoices({language: 'English', use: 'announcer'})` - the QC-passed English library voices tagged `announcer` - and the treatment check rejects any id not on that list (*checked*). The cut clones every line from that voice's reference with Qwen3-TTS and checks each one with Whisper (`speakChecked`). When no English announcer has passed QC on the machine, the only option is `default`, the configured narrator; run `voice-design.py --language English` and `voice-qc.py` before a client film rather than ship that.

Cast from the descriptions as a casting director would: age band, timbre and the categories the description names - a low, breathy 30-something for fragrance and night-time luxury, a deep resonant bass for cars and flagship launches, a warm baritone for coffee and premium tech, a bright young voice for snacks and youthful brands. Cutdowns of the same campaign keep the master's announcer.

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
| English ad announcer line (4-13 words) | word error rate | ≤ 0.08 (code), and 0 on the brand name, product name and numbers | anything above, or a stress on the wrong word of the line |
| Library reference clip | error rate, pitch, level | ≤ 0.05 (*checked* by `voice-qc.py`), median pitch inside the gender's range, peak below -0.3 dBFS, RMS above -40 dBFS | no passing take: redesign the voice's `design`, never lower the bar |

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
- A character voice designed from scratch because `Character.voice` used words no library entry contains, when a QC-passed library voice of the right gender and age would have fitted.
- A library voice made castable by copying a take into `voices/` by hand instead of passing `voice-qc.py`.
