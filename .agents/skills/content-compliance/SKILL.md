---
name: content-compliance
version: "0.1.0"
description: Review a non-advertising project - a micro-drama series bible, an episode screenplay or a creator short - against the NRTA micro-drama rules (《微短剧发展管理办法》 in force 2026-09-01, the AI micro-drama classification standard, the 2026 cleanup campaign), the mandatory AI-content labels (《人工智能生成合成内容标识办法》 and GB 45438-2025), platform AIGC disclosure (YouTube, Douyin) and likeness and voice rights, and return approve / issues / revised lines. Use after series-development, screenwriting or short-video-scripting and before any picture is generated, or when the user asks whether a story, title or line is allowed, 能不能播, 会不会被下架, or how to label AI content.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: production
  tags:
    - compliance
    - micro-drama
    - aigc-labeling
    - likeness-rights
---

# Content compliance

Ad copy answers to the Advertising Law (`ad-compliance-review`). Dramas and creator shorts answer to the broadcast regulator, the platforms and the AI-labeling rules, and a failure there costs more than a rewrite: a series taken down after twenty episodes, an account demonetised, a channel struck. This reviewer reads the story before a single frame is made, when a fix is one line.

## The rules, as of October 2026

**《微短剧发展管理办法》** (NRTA Order No. 16, adopted 2026-07-27, in force 2026-09-01) - the first departmental regulation for micro-dramas:
- A micro-drama is a series with episodes under 20 minutes, a clear main line, continuous plot and prominent characters. Everything this studio makes as a series is one.
- Three classes by investment and subject. Class one (large investment, or politics, military, diplomacy, national security, ethnicity, religion, the judiciary, public security as subject) needs a 《微短剧发行许可证》 from provincial or higher NRTA; class two needs provincial approval; class three is reviewed before broadcast by a qualified platform, which assigns a programme number. The money thresholds are to be set separately (not yet published in our research).
- **An AI-generated or AI-made micro-drama must carry a notice label in a prominent position in every episode** - producer and broadcaster both.
- Eleven categories of prohibited content. Our research records four of them - endangering national security, distorting history, defaming traditional culture, harming minors' rights - and not the full list; when a story comes near any broadcast red line, the rule is to change the story, and the full text (news.cn, 2026-07-31) is the authority.
- Algorithms that induce addiction are banned. A paywall placed on a peak is craft; an episode built only to stall is not.

**《AI 微短剧分类分层标准》** (published 2026-06-25, in force 2026-07-01): an AI micro-drama with investment of ¥800,000 or more, or whose main plot concerns politics, military, diplomacy, national security or similar special subjects, is managed as a "重点微短剧". A local Spark production costs far less, so the subject decides: keep special subjects out of the main plot, and a general-subject AI drama usually falls to platform self-review. Confirm the class before release.

**The 2026 cleanup campaign** (from 2026-06-01), eight categories - review every bible and every scene against each:

| Category | What it looks like in a script | Fix |
|---|---|---|
| 涉儿童有害 harm involving children | a child in danger, a child as a plot device, "萌宝" | no minors in the story at all (cast ages are *checked* 18-90) |
| 软色情擦边 soft porn / edge content | undressing, bed scenes, action dwelling on body parts, innuendo lines | cut to after; describe faces and places, not bodies |
| 拜金炫富 money worship, flaunting wealth | black-card reveals, luxury brands as status, humiliation by wealth, overnight riches | worth shown by skill and choices |
| 畸形婚恋观 distorted romance values | "you're mine", forced kisses, contract wives, stalking as devotion, cheating rewarded, cruel-then-sweet | equals, consent, an obstacle outside the couple |
| 封建糟粕 feudal superstition | fortune-tellers as truth, curses, 冲喜, son preference | a reason a person can act on |
| 暴力复仇 violent revenge | "you'll pay for this", beatings as payoff, humiliation cycles | vindication through truth, law, consequence |
| 低俗片名 vulgar titles | 霸总, 震惊, sexual words, "跪求", "悔不当初" | an object or a situation from the story |
| 侵权盗版 piracy | quoted song lyrics, famous film lines, known characters, real brands as props | original everything |

The November 2024 notice on 霸总 dramas still applies: no "霸总" or similar words in titles to pull clicks; strict control of money worship, flaunting and overnight riches; entrepreneur stories must be realistic.

## AI labels - mandatory, never removable

**《人工智能生成合成内容标识办法》** (CAC and three other departments, in force 2025-09-01) **+ the mandatory national standard GB 45438-2025**:
- **Explicit label** (perceivable): for video, a prominent notice on the opening frames, optionally repeated around the frame, mid-video or at the end; for audio, a spoken or rhythmic notice at the start, middle or end. Secondary readings put the video text label at a character height of at least 5% of the frame's shortest side and at least 2 seconds on screen - **unverified**: we have not read the standard's text; delivery must check it before release.
- **Implicit label** (metadata): generation attribute, provider name or code, content ID. The TC260 video metadata guide (MP4, MOV, MKV, WebM) requires `Label`, `ContentProducer`, `ProduceID`, `ContentPropagator`, `PropagateID`.
- Platforms read the metadata and show a notice; with no metadata they label declared content "may be AI-generated" and detected content "suspected AI-generated".
- **No one may maliciously delete, alter, forge or conceal a label.** Every Cinefoundry output carries both labels, on every episode, and there is no option to remove, shrink, shorten or hide them. A request to do so is refused, whoever asks.
- A script must not contradict the label: no "true story", "real footage", "filmed live", no presenter claiming to be a real person.

**Platforms**:
- **YouTube**: realistic content that viewers could take as real and that was made or altered with AI must be disclosed at upload ("altered or synthetic content"; renamed "AI content labeling" with a more visible label in May 2026 - secondary sources). Sensitive subjects (news, health, finance, elections) show the label on the player. Undisclosed content may be labelled by YouTube; repeated failure can mean removal or suspension from the Partner Programme. Cinefoundry's photoreal people are always in the must-disclose category.
- **Douyin**: declare AI generation in the 创作声明 at publishing; the platform also detects it. Unlabelled AI content has been punishable up to account bans since 2023; violating AI virtual humans can be taken down, demonetised, stripped of followers and banned.
- **Bilibili, Kuaishou, Tencent** have published rules under the national measures; Bilibili's operating page was not obtained (**unverified** details).

## Likeness and voice

- No real person's face or voice, living or dead, famous or not. Characters are designed from words; voices are designed voices from the casting library only. The industry's habit of using real likenesses without consent is exactly what the US NO FAKES Act targets (passed unanimously by the Senate Judiciary Committee in June 2026 - a committee vote, not yet law), and Netflix's August 2025 GenAI guidance requires written approval for any actor likeness (secondary sources).
- Reject: a `look` or `voice` that names or evokes a real person ("looks like", "sounds like", a celebrity's name), a character named after a real public figure, a plot about a real person or company.

## Workflow

1. **Series level** (bible): logline, genre, titles against the eight categories and the 霸总 notice; main subject against the special-subject list (classification); every character adult, invented, voice designed.
2. **Scene level**: each `action` against soft porn, violence, flaunting, minors and readable real brands.
3. **Line level**: each `en` and `zh` against all of the above, and against claims that contradict the AI label. A creator short with product claims also goes to `ad-compliance-review`.
4. **Revise** every line you flag that a line change can fix. A revised line still obeys the screenplay checks: ≤12 English words, Chinese ≤16 characters with no full stop (*checked* when the screenplay is re-validated), same speaker, same story function.
5. **Approve** only when nothing remains. A premise-level problem (the whole engine is revenge, the title is 霸总) cannot be fixed by lines: report it, do not approve, and send it back to `series-development`.

## Output format

```json
{"approve": false,
 "issues": ["scene N line M: <the rule> - <why this line breaks it>", "scene N action: ...", "series: ..."],
 "revised": [{"scene": 0, "line": 0, "en": "<replacement English line>", "zh": "<替换的中文字幕>"}]}
```

Scenes and lines are numbered from 1 as in the screenplay (line M is the M-th line of scene N). `revised` holds only lines you would change, never unchanged ones. This is a shape, not content: never reuse an example from this file.

## Quality bar

- Every issue names a rule and a location; "tone is too dark" is not an issue.
- A revision keeps the scene's drama: the conflict stays, only the forbidden payoff goes.
- Nothing is approved that would need the AI label weakened, a real face or voice, or a special-subject licence.
- Uncertain rules (label size and duration, Bilibili's page, the eleven categories in full) are reported as open items, not guessed.

## Common failures

- Approving because each line is clean while the premise is "rebirth revenge on the rich husband": violent revenge, money worship and distorted romance at series level.
- Flagging a line and leaving it unrevised when a one-line fix exists.
- A revision that runs to 18 words or ends in 。, failing the screenplay check it was meant to pass.
- Treating the AI label as a design choice that a client can turn off.
- Letting "inspired by a true story" into a title card of a fully generated drama.
