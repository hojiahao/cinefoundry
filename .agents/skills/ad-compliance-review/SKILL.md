---
name: ad-compliance-review
version: "0.3.0"
description: Review bilingual advertising copy - the English announcer line, its Chinese subtitle and the Chinese on-screen title of every beat - for wording that PRC advertising rules restrict in either language (absolute claims, unverifiable guarantees, medical, health or efficacy claims on non-medical products, data claims without a source), for English a native broadcast copywriter would not write, and for subtitles that do not say what the English says. Use after script authoring and before any media generation, or whenever the user asks whether ad copy is compliant or "能不能这么说".
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: production
  tags:
    - advertising
    - compliance
    - prc-advertising-law
    - bilingual
---

# Ad compliance review

Approved copy reaches voice, image, video and the cut unchanged, so a restricted phrase caught late costs a full regeneration. Review text before media. The ad speaks English and shows Chinese: the 广告法 applies to everything the viewer hears and reads, so "the best" in the voiceover is the same absolute claim as 最好 in the subtitle.

## What you review

Per beat, three strings (`src/pipelines/ad/compliance.ts` gives them to you in this form):

- **VO (English)** - `vo`, spoken by the announcer.
- **Subtitle (Chinese)** - `zh`, set large over the English while it is spoken.
- **Title** - `text`, the Chinese on-screen title.

Plus the brief's category and its proof points: a line that states one of the proof facts is substantiated; anything stronger is not. The end card shows the brief's `message` or the client's quoted `tagline`; check it once by the same rules. Frames carry no generated text, so nothing else reaches the screen.

## Workflow

1. The harness writes `projects/<id>/script/copy.txt` - for each beat its `vo`, `zh` and `text`, one string per line - and runs the deterministic scan on it. To run the scan yourself:

   ```bash
   cinefoundry copy-check projects/<id>/script/copy.txt --category <brief category>
   ```

   The category comes from the brief (`general`, `food`, `health_food`, `cosmetics`, `medical`). Exit code 1 means at least one `block` finding; the harness stops the run on one (*checked*).
2. For each finding, read the matching section of `references/rules.md` before judging. The scan matches wording; whether a claim is substantiated depends on the proof points.
3. Know what each check covers. The scan's patterns are Chinese (plus "NO.1" and "100%"), so on the English line it sees almost nothing; the copywriter's validator rejects the common English absolutes in `vo` (*checked* `EN_ABSOLUTES`: the best, best-ever, number one, No. 1, #1, world's first, world's best, the only, perfect, flawless, guaranteed, 100%, ultimate, unbeatable, revolutionary). Everything else in English is yours.
4. **Judge three things only, briefly** - the reviewer's brief in code:
   1. **Wording a keyword scan would miss, in either language:** implied superlatives ("finest", "unmatched", "like no other", 无可比拟), implied comparison with competitors ("others can't", 别人做不到), effects nobody could prove, body or health effects for food and drink ("wakes you up", "boosts your energy", 提神醒脑, 解暑降火), efficacy on cosmetics ("clinically proven", "repairs your skin"), statistics without a stated source, and register borrowed from another category (skin vocabulary on a coffee).
   2. **English a native broadcast copywriter would not write:** translationese, stock ad-speak, a line that reads as a caption rather than something said, a stress that falls on the wrong word.
   3. **A Chinese subtitle that does not say what the English says, or reads as translationese:** a claim added in translation (the English is clean, the subtitle says 极致), a claim softened away (the English promises, the subtitle hides it), a word-for-word gloss.
   Line lengths are checked elsewhere; do not count characters.
5. **Every line you flag gets a replacement**, carrying all three fields: `{"beat": n, "vo": "English", "zh": "中文字幕", "text": "标题"}`. The harness merges your `revised` lines into the script; a flagged beat with no replacement is asked for once more, and a replacement that breaks the script checks comes back to you with the failures (*checked*: `checkScript` on the merged script - 4-13 English words, no English or Chinese ad-speak, no English absolutes, subtitle at most 16 characters on 16:9 and 12 on 9:16 with spaces instead of commas and full stops, title at most 8 characters, caption characters, the Chinese scan). If your rewrite still fails, the copywriter's lines stand and the scan decides - a rewrite too short for the length check once let the original health claim stand. Keep the selling point, the meaning, the rhythm and the length; drop only the restricted form.
6. Health effects are blocked outright for foods and everyday goods (*checked* `health_effect`, categories `general` and `food`): 补脑, 健脑, 益智, 增强 / 提高 / 提升免疫, 增强抵抗力, 抗疲劳, 缓解疲劳, 助眠, 改善睡眠, 安神, 缓解焦虑, 抗焦虑, 减肥, 瘦身, 燃脂, 刮油, 排毒, 养颜, 抗衰老, 延缓衰老, 护肝, 养胃, 不长胖, 喝不胖, 吃不胖. The English equivalents are not in the scan; judge them yourself. Replace the effect with the experience (the aroma, the feel, the moment) or with a fact from `proof`.
7. Resolve `review` findings (cosmetics efficacy, data claims) with proof from the brief, or rewrite them too.
8. The reviewer must not be the agent that wrote the copy: in the harness it is a separate agent, on the editor model, with this skill and its own system prompt.

## Reply format

Return JSON only, as the harness asks:

```json
{"approve": true, "issues": ["beat 2: ..."], "revised": [{"beat": 2, "vo": "English", "zh": "中文字幕", "text": "标题"}]}
```

`revised` holds only the lines you would change. Name the beat in every issue ("beat 3: ..."): the harness finds flagged beats by their number, and "not approved" with no beat named is recorded as an open item for the delivery report.

## AI-generated content

Every film carries the explicit label "内容由 AI 生成" (opening seconds and end card) and AIGC metadata in the file (人工智能生成合成内容标识办法, in force 2025-09-01). Never approve copy that implies the footage is real photography of a real event, a real customer or a real endorsement.

## Structured judge (optional)

When `TYPESAFE_API_KEY` is set, each beat is also put to Jev, a structured evaluation model that returns calibrated probabilities instead of prose: absolute or superlative claim, bodily or health effect, vocabulary register versus the product category, and how natural the line sounds read aloud. The harness routes on the numbers: p >= 0.7 goes straight back to the copywriter as a rewrite reason, 0.3-0.7 is handed to you to decide (listed in your prompt), below 0.3 passes. Measured on this project's own lines: "全网第一…永不发胖" 0.99, "提神醒脑" as a health effect 0.95, skincare vocabulary on a drink 0.95, clean lines under 0.1; about 1.6 s and 600 tokens per beat. Text leaves the machine, so the record marks it `cloud`; it never sees images or product material, only the copy.

## Severity

- `block`: wording the rules prohibit outright. The copy must not go downstream.
- `review`: allowed only with substantiation. Ask for the proof or rewrite.

## Limits

This is a wording screen, not legal advice. When the user is about to publish, say so, and list what still needs human or legal confirmation instead of implying the copy is cleared.
