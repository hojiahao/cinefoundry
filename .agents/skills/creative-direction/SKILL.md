---
name: creative-direction
version: "0.1.0"
description: Decide the film before anyone writes or draws it - the insight, the single-minded proposition, the creative concept, the brand voice, and the director's treatment (visual concept, light logic, palette, texture, rhythm, and the sound - cast voice, score, ambience) that the copywriter, the storyboard artist and the sound designer all work from. Use after the brief is confirmed and before the script, or when the user asks for a new idea, a different tone or a re-think of an existing film.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: writing
  tags:
    - advertising
    - creative-direction
    - treatment
---

# Creative direction

At a top agency nothing is written or drawn until the creative director has decided what the film is. The copywriter, the director, the director of photography and the sound designer then each execute one idea instead of guessing four. This skill is that decision. Its output, the treatment, is pasted into every later stage.

## The standard

The bar is the work of a top Chinese agency or a Hollywood-grade brand film: one idea, precisely felt, executed with restraint. Not a list of selling points, not a mood board of everything nice. A good treatment can be said in one breath and a crew could light, cast and score from it.

## Workflow

1. **Read the brief and the client's own words.** The client's words win where they differ from the brief. Note what is fixed: product look (`appearance`), proof points, the closing line (`tagline`), ratio, duration.
2. **Insight** (Chinese, one sentence) - a true observation about the audience at the moment the product lives in. It is about people, not about the product. "加班到深夜的人，最想要的不是提神，是一口让自己停下来的东西" is an insight; "我们的茶零糖" is a feature.
3. **Proposition** (Chinese) - the one thing the film says, sharpened from the brief's `message`. If it needs "and", it is two propositions; choose one.
4. **Concept** (Chinese) - how the film dramatises the proposition: an image, a contrast, a turn. "城市很吵，罐子打开的那一秒世界安静了" is a concept; "展示产品的清爽" is not.
5. **Brand voice** (English) - the register every line speaks in: restrained and premium, warm and assured, bright and crisp, quietly confident. Never shouting, never pleading.
6. **Visual treatment** (English, words only - these words are pasted into image prompts):
   - `concept`: one sentence a crew could light from.
   - `light`: time of day, where the key light comes from, its quality and whether it is warm or cool. One light logic for the whole film.
   - `palette`: exactly three colours - dominant, supporting, accent - taken from the product.
   - `texture`: surfaces, haze, grain, materials.
   - No numbers anywhere (*checked*): no "5600K", no "f/1.4", no "35mm" - the image model paints digits into the frame. No named directors, films or artists (*checked*); describe the qualities instead.
7. **Rhythm** (English, one line) - how the beats build across the film: for a 30-second master, six 5-second shots, e.g. "a quiet macro hook, three shots of the ritual building in warmth, a hero reveal, a still close".
8. **Sound** (English):
   - `voice`: cast one announcer from the casting library listed in the prompt (*checked*: must be a listed id). Match the voice to the brand voice and the audience: a premium car is not read by a bright young voice; a soda is not read by a deep authority.
   - `voiceDirection`: pace, warmth, where the weight falls ("unhurried, warm, the weight on the last word of each line").
   - `music`: genre, instrumentation, tempo, mood and how it ends ("sparse felt piano and soft strings, slow, warm, resolves on a single held chord under the end card"). No artist names.
   - `ambience`: the world the film lives in ("a quiet kitchen at dawn, distant birdsong, the hum of a fridge").

## Output format

```json
{"insight": "中文一句", "proposition": "中文", "concept": "中文", "brandVoice": "English",
 "visual": {"concept": "English, one sentence", "light": "English", "palette": ["dominant", "supporting", "accent"], "texture": "English"},
 "rhythm": "English, one line",
 "sound": {"voice": "<casting library id>", "voiceDirection": "English", "music": "English", "ambience": "English"}}
```

This is a shape, not content: every value comes from this brief. Never reuse an example from this file.

## Quality bar

- The insight is about the viewer, the concept is an image, the proposition is one thing.
- The visual treatment and the sound tell the same story as the concept: a quiet concept is not scored with a driving beat.
- Everything stays inside the brief's proof points: the treatment never invents a claim the copy would then have to make.
- The product is the hero of the concept, not a prop in someone else's story.
