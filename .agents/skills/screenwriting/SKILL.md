---
name: screenwriting
version: "0.1.0"
description: Write one episode's screenplay inside an approved series bible - scene headings, present-tense picture action, subtext, English dialogue that plays like a real American TV series (each line short enough for one five-second lip-synced shot), natural Chinese subtitles, and delivery notes. Use after series-development (or short-video-scripting's cast) is approved, when an episode is written or rewritten, or when the user asks to change dialogue, subtitles, a scene or 台词/字幕/剧本.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: writing
  tags:
    - micro-drama
    - screenplay
    - dialogue
    - subtitles
---

# Screenwriting

The screenwriter turns one line of the episode plan into scenes a crew can shoot and actors can play. Here the actors are a reference face, a designed voice and a lip-sync model, so the screenplay is also the shot budget: every dialogue line becomes one five-second shot with one face speaking. Write so that the scene works within that, and so that a viewer in Shanghai reading the subtitle and a viewer in Ohio hearing the line both feel the same thing.

## The standard

Dialogue at the level of a well-made American cable drama: people talk past each other, answer a question with a question, say the small thing because the big thing is unsayable. No one explains the plot to someone who already knows it. Subtitles at the level of a good Netflix Simplified Chinese track: what a Mandarin speaker would actually say, short, unpunctuated where pauses suffice.

## Inputs

- The series bible: characters (ids, voice, arc), world, look, and this episode's `title`, `synopsis`, `hook`, `cliffhanger`.
- The episode length in seconds (`want.seconds`). The line budget is `floor(seconds / 5)` lines for the whole episode (*checked*): a 90-second episode has room for at most 18 lines, and fewer is better.

## Workflow

1. **Beat the episode.** From the synopsis, write for yourself the beats: hook (first three seconds), first reversal (inside 30 s), a turn every 20-30 s, the cliffhanger. Each beat is one moment between two people.
2. **Budget the shots.** Spend about two thirds of the budget on lines; the rest is establishing, reaction and insert shots with no dialogue. 90 s → about 12 lines; 60 s → about 8; 30 s → about 4. Never reach the ceiling: a scene of wall-to-wall lines has no room for the look that lands it. Between half and three quarters of the shots carry a line (*checked*).
3. **Scenes.** Three to five in a two-minute episode, one to three in a minute (*checked*: at least three from 90 seconds, at most one per 24 seconds), in the bible's sets - a perfume-shop story is shot in the perfume shop and its lane, not in a café the bible never names. A new scene is a new place or time: two scenes in a row under the same heading are one scene cut into pieces and are refused (*checked*). Number them 1..n in order (*checked*). For each:
   - `heading`: `INT.` or `EXT.` (or `INT./EXT.` for a car) + PLACE + ` - ` + TIME, in capitals (*checked* prefix): "INT. NIGHT PHARMACY - 3 AM" is wrong (digits paint into frames downstream); "INT. NIGHT PHARMACY - LATE NIGHT" is right.
   - `characters`: ids from the bible only (*checked*), at most three, everyone who appears even silently.
   - `action` (English, *checked* no Chinese): present tense, what the camera sees, in the order it sees it. Where people are, where the light comes from, the one physical detail that carries the scene (a coat still on, a second cup untouched). Two to four sentences. No camera directions, no inner thoughts ("she feels betrayed" cannot be shot - "she sets the cup down without drinking" can).
4. **Lines.** For each: `speaker` (an id in this scene's `characters` - *checked* - or `vo` for an unseen narrator or a voice on a phone), `en`, `zh`, `delivery`.
5. **Place the hook and the cliffhanger.** The episode's first shot or first line is the plan's hook, with no throat-clearing before it. The last line or the last action is the cliffhanger; nothing after it.
6. **Read it aloud** in English, at speaking pace, alternating voices. Cut every line that only restates the action, every name used as punctuation, every "Well," and "I mean,". Then read the Chinese alone, as if there were no English.
7. Count (words, characters, lines) and hand the draft to the script editor.
8. **Script notes.** An independent script editor on the reviewer model, who did not write the draft, scores it 0-10 on story (the bible's world and sets, the plan's events in order), hook, structure (setup, a reversal, escalation, the plan's cliffhanger last) and dialogue (every line answers or turns the one before, no non-sequiturs, stock lines or ping-pong insults). It approves only at 7 or more on every score, and every note quotes the draft (*checked*). Headings, numbering and counts are checked by code and are never notes. The best draft so far goes back to the screenwriter with its notes, at most three times, and the rewrite changes only what the notes name; drafts are ranked approved first, then by total score, and a draft still not approved is kept as the best one and reported as an open item (*checked*). Then the screenplay goes to `content-compliance`.

## English dialogue

- **At most 12 words per line** (*checked*): about 4.4 seconds of speech inside a five-second shot. Most good lines are 3-8 words. If a thought needs more, split it into two lines - and usually give the second to the other person.
- **Contractions and fragments**: "You're not coming." "Since when?" "Since now." Spoken American English, not written English.
- **Subtext over statement.** "Did you eat?" can mean "I forgive you". Let the action and the delivery carry what the words withhold.
- **One speaker per shot, so no overlaps.** Interruptions are written as a line that ends on a dash and the next speaker's line; no two people speak at once, no group chorus.
- **Lip-sync friendliness**: avoid strings of initials and numbers spoken as digits ("Room 1408" → "the room at the end"), long proper nouns, and tongue-twisters; each costs a broken mouth.
- **Never the translationese of the genre**: "You are too much!", "I will make you pay the price", "Do you know who I am?", "Today you look down on me..." - and never the stock lines that mark dialogue as machine-written: "We need to talk", "It's not what it looks like", "I can explain", "You don't understand", "This changes everything", "Whatever it takes", "I've been waiting for this moment", "Let's do this". Write the line only this character would say here.
- **No exposition between people who both know it** ("As you know, your father left the company to me").

## Chinese subtitles

- **A translation an audience reads, not a gloss.** "Since when?" → "什么时候的事"; not "从什么时候".
- **At most 16 characters** (*checked*); in a 9:16 frame aim for 12 or fewer, since the vertical line is narrow. Spaces do not count.
- **Chinese only** (*checked*): no English word in a subtitle ("做 favor" is refused); only a name set in capitals, such as a brand or "AI", stays in Latin letters.
- **No full stop** at the end (*checked*), and no commas inside: use a space where the voice pauses ("我知道 你别说了"). Keep question marks; use exclamation marks rarely; quotes are full-width “ ”.
- **Names** as the bible's Chinese name, and only when the English says the name.
- **Register matches the character**: an older doctor does not speak internet slang; a twenty-something does not speak 书面语.
- Reading speed is at most 9 characters a second; a 16-character line needs about two seconds on screen, which a five-second shot gives.

## Delivery notes

English, under eight words, an actable intention rather than a label: "too casual, hiding the hurt", "barely above a whisper, testing him", "fast, before she loses her nerve". The voice engine reads it, and the picture stage uses it for the face. Not "angry", "sad", "emotional".

## Writing for what can be shot

- The speaker of each line will be framed alone or over the listener's shoulder; write so the listener's reaction is worth a cut.
- No physical business that needs hands: no eating, pouring, handing over, hugging, grabbing an arm, fighting. Replace with stillness and distance: she does not take the envelope; he stops at the door.
- No readable screens, letters or signs. A message is read aloud (as a line, by the reader, or as `vo`).
- No crowds: a "busy office" is two desks and a dark floor beyond them.
- Anything violent or intimate happens between scenes and is felt after.

## Output format

```json
{"episode": 1, "title": "中文集名",
 "scenes": [
  {"scene": 1, "heading": "INT. PLACE - TIME", "characters": ["<id>", "<id>"],
   "action": "English, present tense, picture words",
   "lines": [
    {"speaker": "<id or vo>", "en": "Twelve words or fewer", "zh": "不超过十六字 不加句号", "delivery": "English intention"}
   ]}
 ]}
```

This is a shape, not content: every value comes from this episode. Never reuse an example from this file.

## Quality bar

- The episode works on the subtitles alone and on the English alone; each line earns its shot.
- The first three seconds are the hook; the last beat is the cliffhanger; a reversal lands inside the first 30 seconds.
- Every scene has a want and a resistance; no scene is two people agreeing.
- A stranger can tell who is speaking from the line, without the name.
- Line count is well under the budget, leaving shots for silence.

## Common failures

- A 20-word line from a confrontation: rejected by the code and unplayable in one shot. Split it, and let the other person cut in.
- A subtitle ending in 。 or packed with ，: rejected, and reads like a document.
- A speaker who is not listed in the scene's `characters`, or a `vo` used to hide that someone should be on screen.
- "She reads the text message" as the scene's key beat: the screen will be noise; have it read aloud.
- Action written as camera direction ("CLOSE ON her hands"): shots are the storyboard's job, and hands are the weakest thing the model draws.
- Dialogue that sounds dubbed - formal, complete sentences with names in every line.
