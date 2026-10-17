---
name: ad-compliance-review
version: "0.2.0"
description: Review Chinese advertising copy (scripts, voiceover, on-screen text, captions) for wording that PRC advertising rules restrict - absolute claims, unverifiable guarantees, medical or efficacy claims on non-medical products, and data claims without a source. Use after script or voiceover authoring and before any media generation, or whenever the user asks whether ad copy is compliant or "能不能这么说".
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  tags:
    - advertising
    - compliance
    - prc-advertising-law
---

# Ad compliance review

Generated copy reaches image, video and voice generation unchanged, so a restricted
phrase caught late costs a full regeneration. Review text before media.

## Workflow

1. Collect every user-visible string: voiceover, on-screen titles and the end-card message. (Nothing else reaches the screen: frames carry no generated text.) Save it as `projects/<id>/script/copy.txt`, one line per string.
2. Run the deterministic scan. It is local, fast, and reproducible:

   ```bash
   spotfoundry copy-check projects/<id>/script/copy.txt --category cosmetics > projects/<id>/reports/compliance.json
   ```

   The category comes from the brief. Exit code 1 means at least one `block` finding.
3. For each finding, read the matching section of `references/rules.md` before judging. The scan matches wording; whether a claim is substantiated depends on the brief's proof points.
4. Review what a wording scan cannot see: implied superlatives and comparisons with competitors, body or health effects claimed for food and drink ("提神醒脑", "解暑降火"), efficacy claims on cosmetics, statistics without a stated source, and register borrowed from another category (skincare vocabulary on a soda). The reviewer must not be the agent that wrote the copy; in Spotfoundry Harness it is a separate agent with this skill and a different system prompt.
5. Rewrite every `block` finding - keep the selling point, drop the restricted form - and rescan until the exit code is 0. Resolve `review` findings with proof from the brief, or rewrite them too.
6. **Every line you flag gets a replacement.** The harness applies your `revised` lines; a flagged beat with no replacement is asked for again, and a replacement that breaks the script checks (8-18 spoken characters, title length, no stock ad-speak) comes back to you with the failures. "脆爽一夏" was four characters, failed the length check, and "补脑增强免疫力" nearly reached the film. Write a full spoken line in the same rhythm.
7. Health effects are blocked outright for foods and everyday goods (*checked* `health_effect`): 补脑, 健脑, 益智, 增强 / 提高免疫, 抗疲劳, 助眠, 安神, 改善睡眠, 缓解焦虑, 减肥, 瘦身, 燃脂, 刮油, 排毒, 养颜, 抗衰老, 护肝, 养胃, 不长胖. Replace the effect with the experience (the taste, the feel, the moment) or with a fact from `proof` ("主要香调雪松和薰衣草", "40 小时燃烧时长").

## AI-generated content

Every film carries the explicit label "内容由 AI 生成" (opening seconds and end card) and AIGC metadata in the file (人工智能生成合成内容标识办法, in force 2025-09-01). Never write copy that implies the footage is real photography of a real event, a real customer or a real endorsement.

## Structured judge (optional)

When `TYPESAFE_API_KEY` is set, each beat is also put to Jev, a structured evaluation
model that returns calibrated probabilities instead of prose: absolute or superlative
claim, bodily or health effect, vocabulary register versus the product category, and how
natural the line sounds read aloud. The harness routes on the numbers: p >= 0.7 goes
straight back to the copywriter as a rewrite reason, 0.3-0.7 is handed to the reviewer
agent to decide, below 0.3 passes. Measured on this project's own lines: "全网第一…永不发胖"
0.99, "提神醒脑" as a health effect 0.95, skincare vocabulary on a soda 0.95, clean lines
under 0.1; about 1.6 s and 600 tokens per beat. Text leaves the machine, so the record
marks it `cloud`; it never sees images or product material, only the copy.

## Severity

- `block`: wording the rules prohibit outright. The copy must not go downstream.
- `review`: allowed only with substantiation. Ask for the proof or rewrite.

## Limits

This is a wording screen, not legal advice. When the user is about to publish, say so, and list what still needs human or legal confirmation instead of implying the copy is cleared.
