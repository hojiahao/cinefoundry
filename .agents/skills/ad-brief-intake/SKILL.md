---
name: ad-brief-intake
version: "0.2.0"
description: Turn a rough advertising request into a confirmed production brief and open a Spotfoundry project. Use at the start of any new ad, commercial, product video or 广告片 request, or when the user changes the product, audience, platform, duration or aspect ratio of an existing project.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  tags:
    - advertising
    - brief
    - planning
---

# Ad brief intake

A vague brief produces a generic film. Fix the few decisions everything else depends on,
then open the project so every later stage has one source of truth.

## Workflow

1. Extract what the request already states and keep it verbatim: an aspect ratio (横版 = 16:9, 竖版 = 9:16, 方形 = 1:1) or a duration written in the request is not yours to change. A coffee brief that said 横版 once came back as 9:16; the harness now overrides the agent with the stated values, but do not make it necessary.
2. Resolve the blocking unknowns, in this order, in one message: the product (and whether
   reference photos exist), the audience, the single message the viewer should remember.
3. Decide the rest yourself and say what you chose: platform, aspect ratio (**16:9 by default** - broadcast, web pre-roll and the big screen; 9:16 only when the request says 竖版 / 竖屏 or names a vertical platform such as 抖音, 快手, 小红书, 视频号; 1:1 for marketplaces), duration (15 s default; 5 s steps because clips are generated in 5 s segments), tone, product category for compliance (`general`, `food`, `health_food`, `cosmetics`, `medical`). Delivery format defaults to native 1080p at 60 fps; record `resolution` (1080p, 2k, 4k, 6k) and `fps` (24 for a film look, 30, 60, 120) only when the request asks.
4. Open the project:

   ```bash
   spotfoundry project init --id summer-soda --title "夏日气泡水" --brief "<one-paragraph brief>" --ratio 16:9 --duration 15
   ```

   The id is lowercase letters, digits and dashes.
5. Write `projects/<id>/brief.json` with the fields below (this is what every later stage reads). Put user-supplied reference
   images in `projects/<id>/refs/` and list them.

## brief.json fields

```json
{"id": "summer-soda", "title": "夏日气泡水", "product": "...", "category": "food", "audience": "...",
 "message": "the one thing the viewer should remember, in Chinese", "ratio": "16:9", "durationSeconds": 15, "resolution": "1080p", "fps": 60,
 "tone": "tone and visual style, in English", "brandText": "the brand as printed on the product, at most 4 common characters",
 "tagline": "the closing line the request quotes (字幕：“…”, 口号, 广告语), copied character for character; empty if none",
 "proofPoints": ["claims the user can substantiate"], "references": ["refs/can_front.png"], "delivery": "local only | cloud allowed for <step>"}
```

`brandText` matters more than it looks: it is the only lettering that will ever appear inside a generated frame (on the product label, via the hero still), so keep it to common characters - the image model draws rare ones wrong ("泠" came out as "冷").

## Notes

- Record only claims the user can back up under "proof points". Anything else is a wish, and the script must not state it as fact.
- If the user says the product is unreleased or under NDA, write "local only" under delivery route. That line is what later stages check.

## The product's look

When the request says what the product looks like ("银色铝罐，青绿色标签上有白色书法字“冷”"), copy it word for word into `appearance`. It is the client's decision, not the studio's: a storyboard that turns the can into a glass bottle is rejected against this field.
