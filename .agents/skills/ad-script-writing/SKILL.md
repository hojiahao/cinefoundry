---
name: ad-script-writing
version: "0.3.0"
description: Write the bilingual script for a short advertisement - one English announcer line per 5-second beat in top American agency broadcast copy, its Chinese subtitle and a Chinese on-screen title, built across a 30-second master of six beats and timed to the project duration. Use after the brief and the creative treatment are confirmed, or when the user asks to rewrite, shorten, change the tone of, or localise an ad script or 广告脚本/口播/文案/字幕.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: writing
  tags:
    - advertising
    - copywriting
    - script
    - bilingual
---

# Ad script writing

A spot has room for one idea. The script lands it in the first beat and spends the rest earning it. Every beat carries three pieces of copy that do three different jobs:

| Field | Language | Who meets it | Job |
|---|---|---|---|
| `vo` | English | heard: the announcer the creative director cast reads it | the line itself - written for the ear |
| `zh` | Chinese | read: set large over the English line while it is spoken | the same meaning, in Chinese a viewer reads at a glance |
| `text` | Chinese | seen: the beat's title, typeset in the upper third | one typographic moment, not a second voiceover |

`see` (English) tells the storyboard what the picture is. The validator that accepts or rejects the script is `checkScript` in `src/agent/checks.ts`; every rule marked *checked* below is enforced there, and a draft that breaks one comes straight back.

## The standard: broadcast copy from a top American agency

The bar is the voiceover of a top American agency's broadcast spot: few words, each one chosen; a line with an image, a rhythm and a point of view that the viewer remembers after one hearing. Not template ad-speak, not a feature list, not chat. The Chinese subtitle is held to the bar of a good theatrical subtitle track: what a Chinese copywriter would have written for the same picture, never a gloss of the English.

### The process - in this order

1. **Insight.** Start from the treatment's insight: one true observation about the audience at the moment the product lives in. It is about people, not the product. Every line grows from it.
2. **Single-minded proposition.** The one thing the film says - the brief's `message`, sharpened by the treatment. Everything that does not serve it is cut, however true.
3. **Concept.** The treatment's image, contrast or turn. The words and the pictures tell one story: if the concept is silence, the copy is quiet.
4. **Brand voice.** The treatment's `brandVoice` in every line: restrained and premium, warm and assured, dry and confident. Never shouting, never pleading, no jokes unless the brief asks.
5. **Draft long, then cut.** Write each line with everything in it, then cut until nothing can go without losing the image or the point. The best line is usually the shortest true one.
6. **Read the run aloud.** Read all the beats in sequence at an announcer's pace, against a five-second clock per beat. They must build as one thought: the hook opens a question or an image, the middle earns it, the last line lands and hands over to the end card. Fix any line that breaks the cadence.

### What crafted English broadcast copy sounds like

- **Write for the ear.** Short declaratives, fragments where they land harder ("Not yet."), contractions, present tense. One idea per line; one breath per line.
- **Don't say what you see.** The picture already shows the product, the road, the steam. The line adds what the picture cannot: the meaning, the feeling, the turn. "A cup of coffee on a table" over a cup of coffee is wasted air.
- **Concrete over abstract.** Nouns and verbs a viewer can feel - the first pull of the engine, the room going quiet, the shutter's click - instead of adjectives. One precise image beats three adjectives.
- **A turn.** The strongest lines carry a small surprise: a reversal, a contrast, an unexpected verb. It is what makes a line repeatable.
- **The stress lands last.** End the line on the word that matters; the announcer's weight falls there and the cut follows it.
- **Restraint.** No exclamation marks, no rhetorical-question hooks ("Ever wondered…?"), no "Introducing", no "Meet the new". Confidence is quiet.
- **The brand name** is said once at most, in a stressed position, or not at all: the end card carries it. A brand printed in Chinese characters stays out of the English line - the code tolerates `brandText` inside `vo`, but an American announcer reading Chinese characters sounds wrong. A Latin brand name (VORSA, LUMO) may be spoken.

The shape of the difference - illustrations, never lines to reuse:

| Template | Crafted |
|---|---|
| "Experience seamless sound like never before." (stock ad-speak, rejected) | "The train keeps talking. You stop hearing it." |
| "The perfect fragrance for the perfect evening." (absolute claim, rejected) | "It arrives before you do, and stays after you leave." |

### Rhythm across the 30-second master

The default film is a 30-second master: six 5-second beats and a 3-second end card. The 15- and 6-second cutdowns are cut from the same beats (`editing-and-versioning`), so beat 1 must open any version and the last beat must close one.

| Beat | Job | What the line does |
|---|---|---|
| 1 | `hook` | the shortest, sharpest line: an image or a question the film will answer; works with the sound off through the title alone |
| 2 | `proof` | the world and the insight: where and when the product lives, said about the viewer |
| 3 | `proof` | the product enters: what it is for in that world |
| 4 | `proof` | experience or substantiated fact: one sensation, or one fact from `proof` |
| 5 | `payoff` | the turn the hook promised, the strongest line |
| 6 | `payoff` or `cta` | lands and hands over to the end card without repeating it |

- Exactly `durationSeconds / 5` beats (*checked*): one beat becomes one generated clip. Durations are multiples of 5 from 5 to 30 s; a 15 s film has three beats (hook, proof, payoff), not eight.
- Vary the length across the run - a short line after a long one - and save the longest for the middle. Six lines of the same length read as a list.
- One rhetorical device per film. If the run uses a repeated opening, it uses it twice, not six times.
- Name the structure the film follows in `structure` (*checked*: not empty), e.g. "problem -> product -> payoff", "sensory close-ups -> reveal", "one scene, one line", "before / after".

### Category register

The register fits the product, and borrowing another category's vocabulary reads wrong even when every rule passes.

- **Fragrance** (a luxury perfume like 雾岸): intimate, sensorial, restrained - presence, memory, the air a person leaves. Never an effect on other people that nobody could prove.
- **Automotive** (a petrol grand tourer like VORSA): the drive felt - the road, the sound, the long stretch ahead, the hands on the wheel. Performance figures only from `proof`; never a safety or speed promise beyond it.
- **Personal electronics** (wireless earbuds like LUMO): one concrete sensation per beat - the fit, the quiet arriving, a voice suddenly close. Abstractions strung together ("immerse yourself in pure sound") say nothing a viewer can feel.
- **Coffee and drinks** (a specialty coffee like 拾豆): aroma, the pour, the first sip, the ritual and its hour. A drink is sipped, never bitten or chewed (*checked*: `bite`/`chew` in `vo`, 咬/嚼 in `zh`). No body effect ("wakes you up", 提神) - describe the moment, not a physiological claim.
- **Cameras and objects of craft** (a retro camera like 银隼): weight, the mechanical click, the wait, what the photograph keeps.
- **Computers** are sold on what they run and what that changes, never on touch or sound. Switch, keycap and key-travel vocabulary (轴体, 键帽, 键程, 按键手感) on a product without keys is rejected (*checked*).

## The rules

### `vo` - the English line

- English only: any Chinese in `vo` other than `brandText` is rejected (*checked*). The Chinese goes in `zh`.
- **4-13 words** (*checked*, counted by spaces). The announcer starts 0.45 s into the beat and has 4.1 s before the line must end; at a broadcast pace of about 2.5 words a second that is about 10 words unhurried. A longer line is sped up, at most 1.25x - aim for 6-10 words and treat 13 as the ceiling, not the target. Under 4 the beat is mostly silence.
- Stock English ad-speak is rejected (*checked* `EN_CLICHES`): elevate, unleash, game-changer, seamless(ly), next-level, redefine, unlock your / unlock the, experience the, like never before, take it to the next, empower, cutting-edge, state-of-the-art, immerse yourself, embark, journey of.
- **Absolute claims are restricted in English too** (广告法 第九条; *checked* `EN_ABSOLUTES`): the best, best-ever, number one, No. 1, #1, world's first, world's best, the only, perfect, flawless, guaranteed, 100%, ultimate, unbeatable, revolutionary. The list is the floor: "finest", "unmatched", "leading", "like no other" make the same claim and fail the compliance review.

### `zh` - the Chinese subtitle

- A natural translation an audience reads, not a gloss: the meaning and the register of the English, in the word order Chinese wants. Condense rather than squeeze; never pad. "The train keeps talking. You stop hearing it." is shaped like 列车还在喧哗 你已听不见, not 火车一直在说话 你停止听到它.
- Required and Chinese (*checked*).
- **At most 16 characters on 16:9 and 1:1, 12 on 9:16** (*checked* `subtitleMax`; spaces and punctuation do not count). The narrower vertical line comes from the platforms' safe zone.
- **Spaces instead of commas and full stops** (*checked*): 你未到 它先至, never 你未到，它先至。 Question marks, ellipses (…) and full-width quotes stay.
- Stock Chinese ad-speak is rejected in `zh` and `text` (*checked* `AI_CLICHES`): 开启……新篇章 / 新旅程 / 新时代, 焕新, 赋能, 不止于, 满满的, 让……成为可能, 臻享, 尽享, 非凡体验, 品质生活, 美好生活, 全新升级, 极致体验, 匠心之作, 邂逅, 一站式, 颠覆, 重新定义, 引领潮流, 点亮生活, 治愈, 氛围感, 高级感, 仪式感, 灵感迸发, 无限可能, 梦想起航, 触手可及.
- The Chinese wording scan runs on `zh` and `text` for the brief's category, and any `block` finding is rejected (*checked* `scanCopy`): absolute terms (最, 第一, 顶级, 极致, 首选, 唯一 …), guarantees (100%, 永不, 零风险 …), medical words, and for food and everyday goods health effects (补脑, 抗疲劳, 助眠, 减肥, 养颜 …). A faithful translation of a clean English line is clean; a translation that "improves" the line with 极致 is not.

### `text` - the Chinese title

- **At most 8 characters** (*checked*), and better two to six: it names the beat's one idea. It never repeats `zh` word for word.
- No closing punctuation on a title (*checked*).
- Titles name this product's own moment. A title that mentions a container the product does not have (罐, 瓶) is rejected (*checked*) - copying a title from another product is how that happens.

### Both on-screen lines (`zh` and `text`)

Typeset in the cut in Noto Sans CJK SC, never drawn by the image model, so write exactly what should appear:

- Only Chinese characters, Latin letters, digits, spaces and ordinary full-width marks ，。！？、：；“”‘’·—…%％℃°+- (*checked*). No emoji, no symbols, no other scripts.
- No half-width punctuation (, . ! ? ; :) and no doubled marks (*checked*); never start with punctuation (*checked*).

### Claims and the client's words

- Claims come from the brief's `proof` and nothing stronger. With no proof supplied: no figures, no specs, no comparisons. A figure the brief cannot substantiate is a compliance rewrite later.
- When the request quotes a closing line (`tagline`), the end card shows it character for character. Build towards it; no title, subtitle or line repeats it.
- Read the client's own request as well as the brief: where they differ, the request wins, and scenes or lines the client asked for are not yours to drop.
- The copy talks about the experience, never about the packaging's typography or print; the picture shows the product.
- Never copy a line from this file, from an example or from another film. Write this product's own line.

## Workflow

1. Read `projects/<id>/brief.json`, the client's request and the treatment (`creative/treatment.json`: insight, proposition, concept, brand voice, rhythm, and how the announcer reads).
2. Choose the structure and assign each beat its job from the rhythm table.
3. Write `vo` first, all beats, and read the run aloud against the clock. Count the words.
4. Translate each line into `zh` by meaning, then count characters against the ratio's limit and replace commas and full stops with spaces.
5. Write `text` for each beat: the beat's idea in two to six characters.
6. Write `see` in English: one subject, one action - the picture the line plays over, not a restatement of it.
7. Write `projects/<id>/script/script.json`, then hand the copy to `ad-compliance-review` (a different agent) before anything is generated.

## Output format

Return JSON only, exactly this shape (the harness prompt in `src/agent/prompts.ts` asks for the same):

```json
{"structure": "...", "beats": [{"beat": 1, "job": "hook|proof|payoff|cta", "see": "...", "vo": "English line", "zh": "中文字幕", "text": "标题"}]}
```

One object per beat, `beat` numbered from 1, `job` one of `hook`, `proof`, `payoff`, `cta`. This is a shape, not content: every value comes from this brief.

## Quality bar

- The first beat works with the sound off; the product is seen in at least two beats and in the last.
- Read in sequence, the English lines form one thought with a turn, in one brand voice, and nothing in them is said by the picture already.
- Each subtitle says what its English line says, in Chinese a viewer would not notice as translated.
- Every rule marked *checked* passes on the first draft: a rejected draft costs a retry, and six failed drafts stop the run.
