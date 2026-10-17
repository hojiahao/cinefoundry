---
name: short-video-scripting
version: "0.1.0"
description: Write a creator short video for Douyin, Bilibili or YouTube Shorts - the hook in the first three seconds, the retention structure, pattern interrupts, the format (talking-head 口播, review 测评, explainer 科普, skit 剧情, product short), the call to action and the platform differences - as a one-episode Screenplay with a one-presenter cast, so the narrative pipeline can shoot it. Use when the user asks for a short video, a 短视频/口播/测评/科普/Shorts/抖音视频, or wants an existing one re-hooked, shortened or moved to another platform.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: writing
  tags:
    - short-video
    - creator
    - retention
    - douyin
    - bilibili
    - youtube-shorts
---

# Short-video scripting

A creator short lives or dies in its first seconds and is judged second by second after that. Top creator teams (影视飓风 runs about a hundred people, one job each) do not trust inspiration; they run a process with fixed checks. This skill is the writer's part of that process. It writes the same Screenplay JSON as `screenwriting` - one episode - so the narrative pipeline casts, shoots, lip-syncs and subtitles it. The presenter speaks English on camera; every line carries its Chinese subtitle.

## The standard

A short that a regular viewer of the platform's best channels cannot tell from a human creator's: one clear promise in the first line, a payoff every few seconds, a presenter with a point of view, and an ending that earns the follow. Nothing generic, nothing that reads as a content farm.

## Pick a format the engine can make

| Format | Length here | Structure | Feasibility on this engine |
|---|---|---|---|
| Talking head 口播 | Douyin 30-90 s | conclusion or conflict in line one; framing changes every 5-10 s; full-length captions | good: one face, front or three-quarter, is LTX's strongest case; avoid long held close-ups |
| Review / 测评 | 30-90 s vertical; B站 3-15 min is beyond one run | verdict first → look → detail inserts → test → comparison → verdict | medium: product inserts are a strength; hands operating the product are not - show the product alone, the presenter judges to camera |
| Explainer / 科普 | 45-120 s | question hook → the counter-intuitive fact → picture explanation → one-line takeaway | best: narration (`vo`) over pictures needs no lips |
| Skit / 剧情 | 1-3 min | conflict open, a reversal every 30-60 s | medium: write it like a micro-drama episode, two people at most |
| Product short / 带货 | 15-30 s | pain → product → result → price or action | best: reuses the ad pipeline's product craft |
| Vlog | - | - | decline: the audience buys realness, which a synthetic presenter cannot honestly give |

## Platform differences

- **Douyin**: 9:16, 1080×1920, 30 fps for talk and skits (60 for product and motion), 15-90 s, product shorts 15-30 s. The trade treats five-second completion as the gate to the next traffic pool (the often-quoted ">40% at 5 s, >30% overall" is a training-school figure with no official source), and since 2025 engagement counts too. Captions run the whole video, keywords enlarged.
- **YouTube Shorts**: 9:16, up to 3 minutes, best at 20-60 s. Since 31 March 2025 every start or replay counts as a view; monetisation still uses "engaged views". A loop - the last line flows into the first - earns replays.
- **Bilibili**: horizontal 16:9 is still the home format; viewers expect substance and tolerate length. In a short, deliver one real piece of knowledge, not a teaser for a video that does not exist.
- **Safe zone (9:16)**: faces, captions and the product live inside x 60-900, y 380-1440 of a 1080×1920 frame; the bottom quarter belongs to the platform's title and buttons. Do not write beats that need the edges.

## Retention structure

1. **0-3 s - the hook.** The first line is the promise or the conflict, and the first image already shows the subject. Three hooks that work: the result first ("This costs eight dollars and beats the forty-dollar one"), the wrong belief ("You've been charging your phone wrong"), the stakes ("I have one minute to fix this"). The first line matches the title; the first shot matches the cover.
2. **3-10 s - the reason to stay.** Say what the viewer gets by the end, or open a question you will close late.
3. **Body - a payoff every 5-10 s.** One fact, one turn, one proof per line. Every line becomes a five-second shot, so every shot must deliver.
4. **Pattern interrupts every 2-4 s on screen**, written into the action: a punch-in, a cut to an insert, a caption pop, a sound hit. On anything over a minute, a bigger reset about every 30 s - a new location in the set, a graphic, a change of energy.
5. **The payoff, then the CTA - fast.** Pay off the hook's promise completely, then one short ask. Stop. No recap.

## Calls to action

One per video, in the presenter's voice, a reason rather than a plea. Douyin: a question that invites a real comment or a follow for the next part. Bilibili: the native ask is 一键三连 (like, coin, favourite), worded naturally in the subtitle. YouTube Shorts: subscribe for the series, or the loop back to the opening. Never "smash that like button".

## Writing it as a Screenplay

- **The cast** is a one-entry bible (two for a skit): the presenter as a character with `id`, `name`, adult `age`, `look`, `wardrobe`, `voice` (a designed voice) and an `arc` that states the channel persona. Same rules as `series-development`.
- **One episode**: `"episode": 1`, `title` = the Chinese video title (the first line agrees with it).
- **Scenes are segments**: hook, body sections, payoff and CTA. Usually one set ("INT. HOME STUDIO - DAY", "INT. TEST KITCHEN - MORNING"); a second set is a pattern interrupt.
- **`action`** names what is seen during the segment, including the inserts the cut will use ("the cable, coiled on white; the charger alone, turning slowly").
- **Lines** follow `screenwriting` exactly: ≤12 English words (*checked*), Chinese subtitle ≤16 characters - aim for 12 in vertical - with no full stop (*checked*), speaker present in the scene or `vo` (*checked*), at most `floor(seconds / 5)` lines (*checked*), at least one line (*checked*). Talking-head shorts may use nearly the full budget, since the presenter is the picture; explainers put most lines on `vo` over inserts.
- **Delivery**: the presenter's energy, not a label - "conspiratorial, leaning in", "dead-pan, then the grin".

## Workflow

1. Read the brief: platform, length, format, audience, product (if any), what the viewer should do afterwards.
2. Pick the format from the table; decline or redirect a vlog.
3. Write the hook line and the title together; then the payoff line; then the body between them.
4. Budget lines against seconds; mark the interrupts in the action.
5. Read aloud at the presenter's pace with a stopwatch - English first, then the Chinese alone.
6. Hand to `content-compliance`; a product short also goes through `ad-compliance-review`, since claims about a product are advertising claims.

## Output format

```json
{"episode": 1, "title": "中文视频标题",
 "scenes": [
  {"scene": 1, "heading": "INT. PLACE - TIME", "characters": ["<presenter id>"],
   "action": "English: what is seen, inserts and interrupts",
   "lines": [{"speaker": "<id or vo>", "en": "Twelve words or fewer", "zh": "不超过十六字 不加句号", "delivery": "English"}]}
 ]}
```

This is a shape, not content: every value comes from this brief. Never reuse an example from this file.

## Quality bar

- With the sound off, the first frame and the first caption say what the video is about.
- Every line delivers something new; cutting any one line would lose information.
- The presenter has a point of view and a voice that is theirs across the channel.
- The hook's promise is kept in full before the CTA.

## Common failures

- "Hi guys, welcome back to my channel" as line one: the scroll has already happened.
- A synthetic presenter claiming personal experience ("I've used this every day for three months"): a fabricated testimonial. Demonstrate and judge; do not invent a life.
- A review whose key beat is hands unboxing and operating the product: hands break. Show the product alone, cut back to the verdict.
- Numbers and model codes spoken as digit strings: they break lip-sync. Round them and say them as words.
- Twenty seconds of setup before any payoff, or a recap after the payoff.
- Writing the same script for Douyin and Bilibili: one wants speed, the other substance.
