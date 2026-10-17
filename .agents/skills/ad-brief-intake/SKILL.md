---
name: ad-brief-intake
version: "0.3.0"
description: Turn a rough advertising request into a confirmed production brief and open a Cinefoundry project. Use at the start of any new ad, commercial, product video or 广告片 request, or when the user changes the product, audience, platform, duration or aspect ratio of an existing project.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: production
  tags:
    - advertising
    - brief
    - planning
---

# Ad brief intake

A vague brief produces a generic film. Fix the few decisions everything else depends on, then open the project so every later stage has one source of truth. The brief is validated by `checkBrief` in `src/agent/checks.ts`; rules marked *checked* are enforced there.

## Workflow

1. Extract what the request already states and keep it verbatim: an aspect ratio (横版 / 横屏 = 16:9, 竖版 / 竖屏 or a vertical platform = 9:16, 方形 = 1:1) or a duration written in the request is not yours to change. A request that said 横版 once came back as 9:16; the pipeline now overrides the agent with the stated values (`statedFormat`), but do not make it necessary.
2. Resolve the blocking unknowns, in this order, in one message: the product (and whether a photo of it exists), the audience, the single message the viewer should remember. In a non-interactive run nobody can answer: decide them from the request.
3. Decide the rest yourself and say what you chose:
   - Aspect ratio: **16:9 by default** - broadcast, web pre-roll and the big screen; 9:16 only when the request says 竖版 / 竖屏 or names a vertical platform (抖音, 快手, 小红书, 视频号, TikTok, Reels, Shorts); 1:1 for marketplaces.
   - Duration: **30 s by default** - the master, from which the 15 s and 6 s cutdowns are cut. Any multiple of 5 from 5 to 30 (*checked*), because clips are generated in 5 s segments and each beat is one clip.
   - Tone, in English; the compliance category (`general`, `food`, `health_food`, `cosmetics`, `medical`, *checked*); the industry the product is shot as (below).
   - Delivery: native 1080p at 60 fps. Record `resolution` (1080p, 2k, 4k, 6k) and `fps` (24 for a film look, 30, 60, 120) only when the request asks.
4. Open the project:

   ```bash
   cinefoundry project init --id <lowercase-dashed-id> --title "<短中文标题>" --brief "<one-paragraph brief>" --ratio 16:9 --duration 30
   ```

   The id is lowercase letters, digits and dashes (*checked*). The pipeline never reuses an id silently: a run asked for by id archives the previous run of that id, and a made-up id that collides gets a suffix.
5. Write `projects/<id>/brief.json` with the fields below (this is what every later stage reads). A product photo the user supplied goes to `refs/product.png` through `--product-image`; the vision model reads its look into `photo`, and the lettering it reads off the photo replaces a `brandText` that is not printed on the product.

## brief.json fields

```json
{"id": "...", "title": "short Chinese title", "product": "what is being advertised", "category": "general|food|health_food|cosmetics|medical",
 "audience": "...", "message": "the one thing the viewer should remember, in Chinese", "ratio": "16:9", "durationSeconds": 30,
 "tone": "tone and visual style, in English", "brandText": "the lettering printed on the product, copied exactly",
 "industry": "computing|electronics|drink|skincare|food|general",
 "tagline": "the closing line the request quotes, character for character; omitted if none",
 "appearance": "the product's look copied word for word from the request; omitted if it says nothing",
 "proof": "facts the client can substantiate", "resolution": "1080p", "fps": 60}
```

This is a shape: every value comes from this request.

- `message` is in Chinese (*checked*): it is the line the viewer remembers and the end card's fallback. `title`, `product`, `audience`, `message` and `tone` may not be empty (*checked*).
- `brandText` (*checked*: at most 4 Chinese characters or 12 Latin letters) is the only lettering that will ever appear inside a generated frame - on the product label, via the hero still - so copy it exactly as printed, never an abbreviation or a model name that is not on the product. Prefer common characters: the image model draws a rare character as a common look-alike.
- `industry` (*checked*) decides how the product is lit, graded and sold, not its legal category: a computer, workstation, server or GPU is `computing`; earbuds, a phone or a camera is `electronics`. When it is missing the pipeline reads it from the product's name.
- `tagline`: when the request quotes a closing line (字幕：“…”, 口号, 广告语, slogan), the pipeline takes it from the request itself, character for character, and the end card shows it instead of `message`. A line you wrote that is not in the request is dropped.
- `proof`: only claims the user can back up - specs, figures, a source. Anything else is a wish, and the script must not state it as fact. On the command line it is `--proof`.

## The product's look

When the request says what the product looks like (container, material, colours, label), copy it word for word into `appearance`. It is the client's decision, not the studio's: a storyboard that changes the container the request names - a bottle into a can, a pouch into a box - is rejected against this field (*checked* in `checkStoryboard`).

## Notes

- If the user says the product is unreleased or under NDA, say that generation stays local - it is the default, and nothing goes to a cloud service unless the user asks for it in the conversation.
- Never ask for what you can decide. The blocking questions are the product, the audience and the one message.
