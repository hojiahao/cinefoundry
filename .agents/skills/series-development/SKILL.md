---
name: series-development
version: "0.2.0"
description: The showrunner's and head writer's job for a micro-drama (微短剧) or a narrative short series - logline, genre and tone, world, series look, the character roster (ids, locked look, wardrobe, arc, designed voice, adults only), and the episode plan with a three-second hook and a cliffhanger per episode and the paywall (卡点) placed for longer series. Use at the start of any drama, series, 短剧 or story-driven project, when the user changes the premise, cast or episode count, or when content-compliance rejects a premise rather than a line.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: writing
  tags:
    - micro-drama
    - series-bible
    - showrunner
---

# Series development

In a writers' room the showrunner owns the series bible and every episode writer works inside it; that is how a voice, a face and a rule of the world stay the same from episode one to the finale. This skill writes that bible. The screenwriter (`screenwriting`), the casting and continuity stages and the reviewer (`content-compliance`) all read it, so a weak decision here is paid for in every later stage.

## The standard

The bar is a premium vertical series that a viewer finishes without once thinking "AI": a premise you can say in one breath, three to five people who want incompatible things, one or two rooms lit with intent, and an ending on every episode that makes the next tap automatic. The market is flooded with cheap AI dramas - about 128,000 titles went up in Q1 2026, over 95% AI-made by one count, and Hongguo took down 3,522 low-quality AI dramas in a single week in April 2026. Viewers name the faults: "weird motion", "stiff faces", "formulaic plot". Motion and faces are the picture team's problem; a formulaic plot is yours. The model to follow is the boutique short season - Huace's AIGC drama is 6 episodes of 15 minutes - not the 80-episode assembly line.

## Formats

| Format | Episode length | Episodes | Paywall |
|---|---|---|---|
| Domestic vertical micro-drama (9:16, 24 fps) | 1-3 min (legal ceiling: under 20 min) | boutique season 10-20 | free platforms (Hongguo) are ad-funded: no paywall, but every episode still ends on a peak |
| Overseas English vertical (ReelShort / DramaBox style) | 60-90 s | season of 10-20 here; the market runs 60-90 | first 5-10 episodes free; the 卡点 lands on the emotional peak of episode 8-12 |
| Creator skit (one episode) | 1-5 min | 1 | none; hand to `short-video-scripting` instead if there is no continuing cast |

Episode count comes from the brief; plan exactly that many, numbered 1..n in order (*checked*).

## What the camera can shoot - write inside it

The engine is LTX-2.5 lip-sync on a single DGX Spark. These are hard limits, not style preferences; a scene that ignores them comes back stiff or broken and reads as AI.

- **Few people.** At most five characters in the bible (*checked*, default five), and no more than three in any scene. Every one needs a locked reference face and a designed voice, and across 10-20 episodes faces drift - the fewer, the steadier.
- **Few places.** Two to four standing sets for the whole season: an apartment, an office, a car interior, a stairwell, a rooftop at night. Return to them; each return costs nothing and builds the world.
- **Dialogue is single shots.** One person speaks per shot, framed alone or over the listener's shoulder. Two people speaking in one frame gets the line put in the wrong mouth. Write scenes as exchanges - shot, reverse shot, reaction - not as group arguments.
- **No crowds, no fights, no touch in close-up.** Background faces collapse; punches, hugs, kisses, handshakes, handing over objects, eating and pouring all break hands. Violence happens off screen and is heard or seen after; affection is in a look, a distance closed, a door held.
- **No readable text in frame.** Phone screens, letters, contracts, signs come out as noise. A message that matters is read aloud or arrives as a voice note.
- **No long takes.** Shots are about five seconds; a scene is built from cuts, which suits the genre's rhythm.
- **Emotion through the cut, not the micro-expression.** Long held close-ups expose empty eyes. Design moments where a reaction shot, a sound or a silence carries the feeling.

## Genres in 2026 - what works, what regulators are clearing out

Since 1 June 2026 a cleanup campaign targets eight categories: harm involving children, soft porn and edge content (软色情擦边), money worship and flaunting wealth (拜金炫富), distorted romance and marriage values (畸形婚恋观), feudal superstition (封建糟粕), violent revenge (暴力复仇), vulgar titles (低俗片名), and piracy. The November 2024 notice on "霸总" dramas still stands: fewer of them, no "霸总" or similar words in titles to pull clicks, strict control of money worship, flaunting and overnight riches, and entrepreneur stories must be realistic. The classic hits - 逆袭, 重生复仇, 战神/赘婿, billionaire romance, 萌宝 - sit squarely in these zones, and 萌宝 needs a child, which this studio never casts (*checked*: every character is 18-90).

Keep the engine of the genre, change what it runs on:

| Market engine | Steer to |
|---|---|
| Revenge on those who wronged her | Vindication: the truth comes out, she earns the job back, they face consequences through law, exposure or their own choices - never her violence, never humiliation as payoff |
| Hidden billionaire / CEO who owns everyone | Competence and status inside work: the night-shift nurse who is the best diagnostician on the floor; worth shown by skill, not by cards, cars or brands |
| Possessive love ("you're mine"), contract marriage, cruel-then-sweet | Equal partners with a real obstacle: a secret, a rival job offer, a promise to someone else; consent and respect on screen, tension from timing and pride |
| Rebirth / fated destiny | A second chance framed as memory, regret or a found letter - no fortune-tellers, curses or fate as truth |
| Overseas werewolf / vampire fantasy | Only if the whole look is stylised and it plays in two rooms by night; no transformations, no bites |

Also strong and cheap to shoot well: one-location suspense (a missing person, a locked flat, a voicemail), workplace drama in one office, family reconciliation around one dinner table, a two-hander romance over one season of night calls. Stay out of politics, the military, diplomacy, national security, ethnicity, religion, the courts and the police as main subjects: those make an AI drama a "重点微短剧" (tier-one licensing) regardless of budget, where a general-subject AI drama under ¥800,000 usually falls to the platform's own pre-broadcast review.

Titles (`title`, and the series name in the brief): concrete and intriguing, never "霸总", never sexual, never 震惊-style clickbait, never a promise of humiliation ("跪求", "悔不当初"). A good title names an object or a situation from the story.

## Workflow

1. **Read the brief and the user's own words.** Fix: format, platform, episode count, episode length, audience. The user's words win where the brief differs.
2. **Logline** (Chinese, one sentence, *checked* non-empty): protagonist + what she wants + what stands in the way + what she loses if she fails. If it needs two sentences the premise is not yet clear.
3. **Genre and tone** (English): genre plus two tone words that will survive a whole season ("workplace suspense, cool and wry"). Run the genre table above against it now, not after episode ten.
4. **World** (English, words only, no digits, no Chinese - *checked*): the city, the season, the two to four sets, the social texture. It prompts the image model, so write what the eye sees: "a narrow rain-slick lane of old brick apartments, a fluorescent all-night pharmacy at its end".
5. **Look** (English, words only - *checked*): one light logic, a three-colour palette, the texture. No numbers, lenses, Kelvin, or named films and directors - describe the qualities.
6. **Cast** (three to five people, *checked* at most five). For each:
   - `id`: lowercase, digits and dashes, 24 characters at most, unique (*checked*) - "lin-yue", "dr-park".
   - `name`: English name / Chinese name, both sayable and distinct in the first letter and the first character (the viewer reads them in subtitles).
   - `role`, `age` (adult number, *checked* 18-90), `gender` (female or male, *checked*; it casts the voice).
   - `look` (English, words only, *checked* no digits): face shape, hair colour and cut, build, skin, one distinguishing feature. Make every pair of characters tell apart at thumbnail size - different hair silhouettes, different builds. Write "in her early thirties", never "32".
   - `wardrobe` (English): a default outfit with one signature colour or item that never changes without a story reason.
   - `arc` (Chinese, two sentences): what they want, what stops them, how they change.
   - `voice` (English): age, timbre, pace, accent, one habit ("a low, dry alto, unhurried, faint Boston vowels, drops her volume when she lies"). A designed voice only - never "sounds like" any real actor or singer. Casting takes a QC-passed voice from the casting library first (same gender, within twelve years, matched on the timbre words in this field) and designs a new one only when none fits (`dialogue-and-voice`), so use plain timbre words - warm, husky, gravelly, breathy, bright, resonant - rather than metaphors.
7. **Season shape.** Write the season in one paragraph for yourself: the setup by episode 2, the midpoint reversal, the paywall peak (if any), the final turn. Then work backwards from the peaks: the 卡点 sits on the highest emotional point, not at a natural chapter break.
8. **Episode plan** (Chinese, all four fields non-empty - *checked*):
   - `title`: the episode card, four to eight characters.
   - `synopsis`: two or three sentences, two to four scenes, the sets named. Each episode has an expectation, a pressure and a release ("期待-压抑-爆发"), with an emotional beat every 20-30 seconds and a first reversal inside the first half-minute.
   - `hook`: the first three seconds, as an image or a line - direct conflict, a hard question, or a fall from a height. In episode 1 the overseas audience must know who is up and who is down within ten seconds.
   - `cliffhanger`: the last beat - a reveal, an arrival, a choice, a line cut off. On the paywall episode, start it with 【付费卡点】.
9. **Self-check against the camera list and the genre table**, then hand the bible to `content-compliance` before any episode is written.

## Output format

```json
{"logline": "中文一句", "genre": "English genre, two tone words", "world": "English, words only", "look": "English, words only",
 "characters": [
  {"id": "<slug>", "name": "English / 中文", "role": "lead", "age": 0, "gender": "female",
   "look": "English, words only", "wardrobe": "English", "arc": "中文两句", "voice": "English"}
 ],
 "episodes": [
  {"episode": 1, "title": "中文", "synopsis": "中文两三句", "hook": "中文", "cliffhanger": "中文"}
 ]}
```

This is a shape, not content: every value comes from this brief. Never reuse an example from this file.

## Quality bar

- The logline has a want, an obstacle and a cost; the cast want incompatible things, so scenes write themselves as conflicts between people in a room.
- Every episode's hook and cliffhanger can be shot with one or two people in a known set; none needs a crowd, a fight, a kiss, a screen or a sign.
- Status and worth come from skill, truth and choices, not from money, brands or physical dominance.
- A stranger can tell every character apart from the look and wardrobe lines alone, and hear them apart from the voice lines alone.
- The paywall, if there is one, lands on the season's sharpest peak.

## Common failures

- A "romance revenge" premise whose payoff is a public slap and a black card: hits violent revenge, flaunting wealth and distorted romance at once. Rewrite the payoff as vindication.
- Seven characters "for scope": the code rejects more than five, and by episode six the faces drift anyway.
- A world line with a brand, a year or an address number ("Shanghai 2026, Tower 3"): digits are painted into frames and fail the check.
- Hooks that are summaries ("她发现了真相") instead of a picture or a line someone can shoot.
- A child at the heart of the story: minors are never cast, and the plot falls apart when the child cannot appear.
- Cliffhangers that resolve in the first line of the next episode without cost: the audience learns the cliffhangers lie.
