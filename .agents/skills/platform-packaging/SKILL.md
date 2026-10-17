---
name: platform-packaging
version: "0.1.0"
description: The packaging and growth editor's craft - three title variants for A/B testing, cover and thumbnail frame choice and its text, descriptions, hashtags, chapters, per-platform conventions for Douyin, Bilibili, YouTube and YouTube Shorts, the AIGC disclosure each platform asks for, and the rule that packaging never misstates the content. Use when a film, short or episode is ready to publish, when a version is made for another platform, or when the user asks for titles, a cover, a thumbnail, a description, tags or upload settings.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: post
  tags:
    - packaging
    - titles
    - thumbnails
    - douyin
    - bilibili
    - youtube
---

# Platform packaging

The title and the cover are the first shot of the film: most viewers decide on them alone. Packaging is written after the cut is locked, from what the film actually shows, and it promises exactly what the first seconds deliver. A cover that wins the click and loses the viewer in three seconds is a failed cover; YouTube's own test picks winners by watch time per impression, not click-through (research, 4.2).

## Workflow

1. Watch the locked cut. Write down the hook (first 3 s), the turn, the payoff and, for an episode, the cliffhanger.
2. Write three title variants that frame the same truth three ways (below).
3. Choose three cover frames from the cut and design their text.
4. Write the description, hashtags and, for long-form, chapters.
5. Fill each target platform's AIGC disclosure and settings.
6. Check every element against the content rule and the governance list; hand the package to `delivery-qc`.

## Titles: three variants

YouTube lets eligible creators test up to three title and thumbnail combinations on long-form videos (not Shorts), with results in about two weeks, judged on watch time per impression (research, 4.2). Produce three for every platform anyway: the variants are also the A/B set for Douyin ad placements and the fallback when one reads wrong.

| Variant | Angle | Example (micro-drama ep. 3) |
|---|---|---|
| A - conflict | the confrontation, as it happens | 她当众拿出那份合同 |
| B - question | what the viewer needs answered | 他到底瞒了她什么 |
| C - character | who and what is at stake | 被辞退的第三天 她回来了 |

- The first spoken line and the first shot agree with every variant (research, 4.2): a title about the contract over an opening on the café is a broken promise.
- Specific beats general: a concrete object, a number, a name the series has established.
- Chinese titles for Chinese platforms, English for YouTube's English audience, written natively - not translated from each other.
- No clickbait that misstates the content: no event that does not happen, no character who does not appear, no implied real person or real news, no fake "part 2" or "ending revealed". No ALL CAPS, no "!!!", no emoji runs.
- Governance (research, 3.5): no 低俗 titles, nothing trading on 拜金炫富 or violent revenge, no 霸总-style words in a micro-drama title (2024-11 notice). Titles that need these words mean the story needs another look.

## Covers and thumbnails

- Choose real frames from the cut, never a new generated image: the cover must be something the viewer will see. Prefer a frame with one readable face with a clear expression, or the product at its hero angle; strong value contrast; the subject large.
- The cover of variant A matches the first shot of the film (research, 4.2).
- Text on the cover: Chinese at most about 8-10 characters, English at most 5 words, two lines at most, set in the film's title font (Noto Sans CJK SC). Never over the face or the product label.
- Ratios: 16:9 for YouTube long-form and Bilibili; 9:16 for Douyin and Shorts, with text and face inside the vertical safe zone x ∈ [60, 900], y ∈ [380, 1440] (research, 4.3). YouTube's custom thumbnail is 1280×720 (YouTube Help, not in the research; check the file-size limit at upload).
- The cover carries no AI-generated text from a model: type is set in post, the same as titles.
- A cover never removes or covers the explicit AI label where the platform shows the first frame as the cover.

## Descriptions, hashtags, chapters

- **Description**: first line restates the promise in plain words (it is what shows before "more"); then two or three sentences on the story or the product; then credits and the AI disclosure sentence: "本片画面、声音与音乐均由 AI 生成" / "Picture, voices and music in this film are AI-generated."
- **Hashtags**: three to five, specific to the content and the series. On YouTube the first three appear above the title and a description with more than 60 hashtags has all of them ignored (YouTube Help, not in the research; verify). No trending tags unrelated to the content.
- **Chapters** (YouTube long-form only): the first at 0:00, at least three, each at least 10 s (YouTube Help, not in the research). Name chapters by what happens, not "Part 1".
- Micro-drama series: the series name and episode number in every title or description the same way, so the platform groups them.

## Per-platform conventions

| | Douyin | Bilibili | YouTube long-form | YouTube Shorts |
|---|---|---|---|---|
| Ratio | 9:16, 1080×1920 | 16:9 main; vertical supported | 16:9 | 9:16, ≤ 3 min (since 2024-10) |
| Hook | first 3 s; 5 s completion watched (research, 4.2) | first 30 s; viewers expect depth | best material in the first 60 s | first 1-2 s; views count on every start or replay since 2025-03-31 |
| Title | short, concrete, conflict-led | longer, descriptive, searchable | 3-variant test available | test not available |
| Subtitles | burned-in, big Chinese | burned-in bilingual welcome | upload SRT for auto-translation (research, 5.4) | burned-in |
| Cover | 9:16 frame in safe zone | 16:9 | 1280×720 | frame chosen in app |

Bilibili and Douyin title and tag length limits are not in the research; check the upload form rather than assume.

## AIGC disclosure

Every Cinefoundry film contains photo-real people and voices that do not exist, which is exactly the content the rules target. Declare it everywhere; never rely on the burned-in label alone.

- **YouTube**: tick the altered or synthetic content declaration (renamed AI content labeling in 2026-05, secondhand) on every upload, Shorts included; realistic AI-generated people trigger it, and repeated non-disclosure risks removal or Partner Programme suspension (research, 4.4).
- **Douyin**: choose the AI-generated option in 创作声明 at publish; undeclared AI content can be penalised up to account bans (research, 4.4).
- **Bilibili**: has its own rules under the national labelling measures; the exact upload page was not obtained (research, 4.4). Use its AI declaration option and record what was selected.
- **Everywhere**: the file keeps its explicit label (内容由 AI 生成, first frame and end card) and its implicit AIGC metadata (GB 45438-2025); platforms read the metadata and may add their own label (research, 3.5). Never strip, crop out or cover either.
- **Micro-drama**: an AI label in a prominent position on every episode (广电总局第 16 号令, in force 2026-09-01); the classification tier recorded (AI micro-dramas under 800,000 yuan on ordinary subjects normally fall to platform self-review, with the platform's programme number shown; research, 3.5 and 5.5).

## Output format

```json
{
  "platform": "douyin",
  "titles": [{"variant": "A", "angle": "conflict", "text": "..."}, {"variant": "B", "angle": "question", "text": "..."}, {"variant": "C", "angle": "character", "text": "..."}],
  "covers": [{"variant": "A", "frame_at": 0.4, "text": ["..."], "file": "packaging/cover_a.png"}],
  "description": "...",
  "hashtags": ["..."],
  "chapters": [{"at": "0:00", "title": "..."}],
  "aigc": {"declared": true, "field": "创作声明: AI 生成", "explicit_label": true, "implicit_metadata": true},
  "checks": {"first_shot_matches_cover_a": true, "first_line_matches_titles": true, "governance_flags": []}
}
```

## Common failures

- A thumbnail generated fresh instead of taken from the cut: the viewer never sees it.
- Three titles that are the same title reworded.
- A title promising an event that happens off screen or not at all.
- The AI disclosure ticked on the main upload and forgotten on the Shorts cut.
- Cover text in the bottom 25% of a vertical frame, under the caption.
