---
name: creative-direction
version: "0.2.0"
description: Decide the film before anyone writes or draws it - the insight, the single-minded proposition, the creative concept, the brand voice, and the director's treatment (visual concept, light logic, palette, texture, rhythm, and the sound - the English announcer cast from the voice library, score, ambience) that the copywriter, the storyboard artist and the sound designer all work from. Use after the brief is confirmed and before the script, or when the user asks for a new idea, a different tone or a re-think of an existing film.
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
4. **Concept** (Chinese) - how the film dramatises the proposition: an image, a contrast, a turn. "人人都在连拍，只有他在等按下快门的那一秒" is a concept for a retro camera; "展示产品的清爽" is not.
5. **Brand voice** (English) - the register every line speaks in: restrained and premium, warm and assured, bright and crisp, quietly confident. Never shouting, never pleading.
6. **Visual treatment** (English, *checked*; words only - these words are pasted into image prompts):
   - `concept`: one sentence a crew could light from.
   - `light`: time of day, where the key light comes from, its quality and whether it is warm or cool. One light logic for the whole film.
   - `palette`: exactly three colours (*checked*) - dominant, supporting, accent - taken from the product.
   - `texture`: surfaces, haze, grain, materials.
   - No numbers anywhere (*checked*): no "5600K", no "f/1.4", no "35mm" - the image model paints digits into the frame. No named directors, films or artists (*checked*); describe the qualities instead.
7. **Rhythm** (English, one line) - how the beats build across the film. The prompt states the count: `durationSeconds / 5` shots of 5 seconds and a 3-second end card - six shots for the default 30-second master - e.g. "a quiet macro hook, three shots of the ritual building in warmth, a hero reveal, a still close". The copywriter writes one English line per beat to this rhythm.
8. **Sound** (English; `music` and `ambience` *checked*, they prompt the music and sound models):
   - `voice`: cast one **English announcer** (*checked*: must be one of the listed ids). The list in the prompt is `castableVoices({language: 'English', use: 'announcer'})` from `src/lib/voices.ts`: the voices in `deploy/voices/library.json` - designed voices, General American, female and male, across the age bands 18-25, 26-35, 36-50, 51-65 and 66+ - that tagged `announcer` and whose reference clip passed voice QC on this machine. Each entry shows its description and age band. When none has passed QC the list holds only `default`, the configured narrator.
   - Cast like a casting director: the voice's age, timbre and the categories in its description against the brand voice and the audience. A luxury perfume is read low and intimate, not by a bright 21-year-old presenter; earbuds for young commuters are not read by a 60-year-old authority; a grand tourer wants weight and resonance, a specialty coffee warmth. Cutdowns of a campaign keep the master's announcer.
   - `voiceDirection`: pace, warmth, where the weight falls ("unhurried, warm, the weight on the last word of each line"). The copywriter reads it before writing, so it shapes the lines as well as the read.
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
