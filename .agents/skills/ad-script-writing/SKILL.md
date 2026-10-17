---
name: ad-script-writing
version: "0.2.0"
description: Write the script for a short advertisement - hook, beats, voiceover, on-screen text and call to action, timed to the project duration. Use after the brief is confirmed, or when the user asks to rewrite, shorten, change the tone of, or localise an ad script or 广告脚本/口播/文案.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  tags:
    - advertising
    - copywriting
    - script
---

# Ad script writing

A short ad has room for one idea. The script's job is to land that idea in the first
three seconds and spend the rest proving it.

## The standard: copy from a top agency

The bar is the copy of a top Chinese agency or a Hollywood-grade brand film: few words, each one chosen; a line with an image, a rhythm and a point of view that the viewer remembers after one hearing. It is neither template ad-speak nor casual chat. It is crafted language read by a broadcast announcer or a brand's spokesperson.

### The process a top creative team follows - do it in this order

1. **Insight.** One true observation about the audience and the moment the product lives in (what they feel, notice or want at that moment). Not a product feature. Write it for yourself in one sentence; it is the root of every line.
2. **Single-minded proposition.** The one thing the film says - the brief's `message`, sharpened. Everything else is cut.
3. **Concept.** How the film dramatises the proposition: an image, a contrast, a turn. The storyboard's visual concept and your lines must be the same idea.
4. **Brand voice.** Decide the register the brand speaks in and keep it in every line: restrained and premium, warm and assured, bright and crisp, quietly confident. Never shouting, never pleading, never joking unless the brief asks.
5. **Draft, then cut.** Write each line long, then cut until nothing can be removed without losing the image or the point. The best line is usually the shortest true one.
6. **Read-through.** Read the three lines in sequence at an announcer's pace. They must build: the hook opens a question or an image, the middle line proves it, the last line lands and hands over to the end card. Fix any line that breaks the cadence.

### What crafted ad copy sounds like

- **Imagery over adjectives.** Name what the eye or the senses catch - the bead of cold on aluminium, the first breath of steam, the weight of a key under the finger - and let it carry the feeling. One precise image beats three adjectives.
- **Rhythm and metre.** Chinese ad lines live on cadence: balanced clauses (两两相对), a short line after a long one, a final syllable that lands. Commas mark the breaths the announcer takes; the full stop marks where the thought lands. The voice model follows punctuation for its pauses.
- **Economy.** 8-18 spoken characters per 5-second beat (*checked*). Every particle, every 的 earns its place.
- **A turn.** The strongest lines contain a small surprise - a contrast (静与闹), a reversal, an unexpected verb - that makes them memorable.
- **The brand name** sits once, on a stressed position, or not at all in the voiceover (the end card carries it).
- **The register fits the category:** a drink is tasted and felt cold, a cream is felt on skin, a device is held and heard, a computer changes what someone can do.

### Never

- Stock ad-speak that marks copy as templated or machine-written (*checked*): 开启……新篇章 / 新旅程, 焕新, 赋能, 不止于, 满满的, 让……成为可能, 臻享, 尽享, 非凡体验, 品质生活, 美好生活, 全新升级, 极致体验, 匠心之作, 邂逅, 一站式, 颠覆, 重新定义, 引领潮流, 点亮生活, 治愈, 氛围感, 高级感, 仪式感, 灵感迸发, 无限可能, 梦想起航, 触手可及.
- Strings of four-character set phrases (清爽解渴，畅享夏日，活力满满), mechanical parallel triplets, stacked rhetorical questions.
- Casual chat, slang, filler words, internet memes - the film is a brand speaking, not a vlog.
- Lines that describe the packaging ("黑色衬线，牛皮纸质感"); the picture shows the product, the words carry its meaning.
- Exclamation marks and hype. Top commercials are confident and quiet.

### Titles

A title is a typographic moment, not a second voiceover: two to six characters that name the beat's one idea (冰感, 一口回甘, 安静的光). It never repeats the voiceover word for word; the closing line (`tagline`) belongs to the end card only.

## Workflow

1. Read `projects/<id>/brief.json`. The "single message" is the spine; every beat serves it.
2. Pick one structure and name it in the script header:
   - Problem -> product -> payoff (daily-use goods)
   - Sensory close-ups -> reveal (food, drink, beauty)
   - Before / after (tools, services)
   - One scene, one line (brand moments)
3. Divide the duration into 5-second beats - one beat becomes one generated clip. A 15 s ad has three beats; do not write more.
4. For each beat write: what we see (one subject, one action), voiceover, on-screen text, and the beat's job (hook, proof, payoff, call to action).
5. Budget words: Mandarin voiceover reads at about 4 characters per second. Write 10-18 characters per 5 s beat and count them (punctuation does not count). Over 18 cannot be read in time; under 8 leaves most of the beat silent - a model asked only for a maximum tends to answer with four characters.
6. On-screen text is a title of at most 8 characters per beat. It is typeset in post-production in a real font, never drawn by the image model, so write exactly what should appear: Chinese characters, digits and ordinary full-width punctuation only - no emoji, no symbols, no doubled marks, and no closing punctuation on a title.
7. Write `projects/<id>/script/script.json`, then hand the copy to `ad-compliance-review` before anything is generated.

## Output format

```json
{"structure": "sensory close-ups -> reveal",
 "beats": [
  {"beat": 1, "job": "hook",   "see": "<one subject, one action, in English>", "vo": "<8-18 个汉字>", "text": "<≤8 个汉字的标题>"},
  {"beat": 2, "job": "proof",  "see": "...", "vo": "...", "text": "..."},
  {"beat": 3, "job": "payoff", "see": "...", "vo": "...", "text": "..."}
 ]}
```

`see` is in English (it feeds the storyboard); `vo` and `text` are in Chinese. The validator that accepts or rejects this file is `src/agent/checks.ts` - beat count, 8-18 spoken characters, title length, caption characters and the compliance scan.

## Quality bar

- The first beat works with the sound off.
- The product is visible in at least two beats, and in the last one.
- Claims come from the brief's proof points. No superlatives, no guarantees, no numbers without a source, and no body or health effects for food and drink ("提神醒脑", "解暑降火") - these fail compliance and cost a rewrite. Describe the experience (taste, feel, moment), not an effect.
- Match the register to the category: a drink is tasted, a cream is felt, a device is used. Borrowing another category's vocabulary ("肌肤燥热" for a soda) reads as wrong even when every rule passes.
- Peripherals (industry `electronics`: keyboards, mice, earphones, phones) are sold on feel, sound and craft: one concrete sensation per beat (the travel of a key, the click it makes, the weight in the hand), not abstractions strung together ("流畅如风，指尖连接创意" says nothing a viewer can feel).
- Computers (industry `computing`: desktops, mini PCs, workstations, servers, GPUs) are not touched or heard; nobody buys one for its click. Sell what it runs and what that changes for the user, one per beat: what the person does and what happens next (a press of Enter, and the model answers right here); scale against size (a whole data center's job on a palm-sized box); local and private (the data never leaves the desk); waiting time gone. Every figure comes from the brief's `proof` ("128GB 统一内存", "本地运行 2000 亿参数模型"); with no proof, no numbers. A desktop AI computer was once written as a keyboard ("指尖落下，青轴一声清响" / "青轴响亮"), copied from this file's old example: switches, keycaps and key travel on a product without keys are rejected (*checked*).
- Never copy a line from this file or from an example into a script; write this product's own line.
- The film ends on an end card with the brand and the single message, so the last beat should hand over to it rather than repeat it. When the request quotes a closing line (`brief.tagline`, "字幕：“…”"), that line is the end card, character for character; the beats build towards it and none of them repeats it.
- Read the client's own request as well as `brief.json`: the brief is the studio's summary, and the scenes and lines the client asked for (a developer pressing Enter, a screen lighting up) are not yours to drop.
- Voiceover reads as crafted ad copy at an announcer's pace - an image, a cadence, a point - not a list of slogans and not casual chat. Read the three lines aloud in sequence before handing them on.
- Voiceover is Chinese only; a stray English word ("唤醒 mornings") is a defect and is rejected. Only the brand text may be non-Chinese.
- Titles name this product's own moment. "开罐" was written for a drip-bag coffee once, copied from an example about a can; a title that mentions a container the product does not have (罐/瓶) is rejected.
- The voiceover talks about the experience, never about the packaging: "黑色衬线，牛皮纸质感" describes the label's typography and was accepted once by every check - it reads as a product spec, not an ad. Leave the look of the product to the storyboard.
