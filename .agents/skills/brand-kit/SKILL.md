---
name: brand-kit
version: "0.1.0"
description: The brand manager's and brand guardian's craft - build a brand kit once (brand name and lettering, logos with clear-space and minimum-size rules, product line with reference photos, named palette, title and subtitle fonts, tone of voice with sample lines, substantiated claims, forbidden words and topics, mandatory legal lines, music direction, look and grade, the announcer voice, recurring presenters and mascots, platform handles and hashtags), check it, and make every ad, short and micro-drama with it so no film is ever re-briefed. Use when a client, agency, MCN or seller onboards a brand, when a film must be on-brand, when the user mentions brand guidelines, a VI manual, 品牌手册, 品牌规范 or `--brand`, or when a kit fails its check.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: production
  tags:
    - brand
    - brand-guidelines
    - logo
    - tone-of-voice
    - claims
    - legal
---

# Brand kit

An agency does not re-brief the brand for every spot: the brand book is agreed once and every film is held to it. In Cinefoundry that book is a brand kit, a folder `brands/<brand-id>/` with a `brand.json` and the files it names. The brand manager builds it with the client; the brand guardian checks it and refuses any film made under a kit that fails. Every rule below that code enforces is marked *checked*; the rest is judgement the agents carry out under this skill.

## The standard

A film made under a kit is indistinguishable from one the brand's own agency delivered: the product exactly as it is sold, the lettering exactly as printed, the brand's colours, fonts and grade, its voice in every line, only claims it can prove, its legal lines on the end card, its logo with its clear space. Anything the kit does not settle is decided by the film's crew as usual; anything it settles is never re-decided.

## Building a kit

1. `cinefoundry brand init <brand-id> --name "<Brand>"` scaffolds the folder: `brand.json`, `logos/`, `products/<product-id>/`, `cast/`, `voices/`. With `--brief "<the client's brand brief>"` the brand manager agent drafts the text fields from the brief; files are never invented. An existing `brand.json` is never overwritten (*checked*).
2. Collect the brand's own files: logo artwork, product photos, and for a presenter or mascot its cast record. Only material the client owns or has licensed.
3. Fill `brand.json` field by field (below), from the brand book and the client's answers. Ask the client only for what blocks the kit: the lettering as printed, the logo files, the product photos, the claims with their proof. Decide the rest and say what you chose.
4. `cinefoundry brand check <brand-id>` until it exits 0. It lists every problem at once.
5. `cinefoundry brand show <brand-id>` prints the kit and its version for the client to sign off.

Any change to a word, a colour, a logo or a photo gives the kit a new version (a content hash of `brand.json` and every file it names, *checked*). Every film records the version it was made with in `reports/run.jsonl` (*checked*).

## The fields

| Field | What it holds | Rules |
|---|---|---|
| `name` | The brand as the brand writes it | required (*checked*) |
| `lettering` | What is printed on the product, character for character | at most 4 Chinese characters or 12 Latin letters (*checked*): the gate reads it off every frame, so it is the mark on the pack, not the company name |
| `logos[]` | `file`, `clearSpace`, `minWidthPx`, `use` | SVG or PNG, inside the kit folder, readable (*checked*); at least one PNG, which the end card composites (*checked*; an SVG is kept as the master artwork); `clearSpace` is the free space on every side as a fraction of the logo's height, above 0 and at most 2 (*checked*); `minWidthPx` is the smallest width on a 1080-line frame (*checked*); the PNG is at least as wide as the 1080p end card sets it (*checked*), and the logo with its clear space fits the end card on 16:9, 9:16 and 1:1 without meeting the AI label or the closing line (*checked*) |
| `products[]` | `id`, `name`, `appearance`, `photos`, optional `category` and `industry` | at least one product with at least one readable PNG or JPEG photo (*checked*); the first photo is the hero still; `appearance` in words: container, material, colours, label |
| `palette[]` | `name`, `hex`, `role` | `#RRGGBB` (*checked*); names in English colour words without digits (*checked*: names are pasted into image prompts); one `primary`, one `secondary`, one `accent` at least (*checked*) |
| `typography` | `title.family`, `subtitle.family` | installed on this machine (fc-list, *checked*); every character on screen is checked against its font at the cut (*checked*) |
| `tone` | `do`, `dont`, `samples.en`, `samples.zh` | at least one of each (*checked*); English samples in English, Chinese samples in Chinese (*checked*); samples pass the Advertising Law scan and the kit's own forbidden words (*checked*) |
| `claims[]` | `claim`, `proof`, `source` | all three required (*checked*); a claim with an absolute term is refused whatever its proof (*checked*: 广告法 第九条 is not lifted by data) |
| `forbidden` | `words`, `topics` | lists (*checked*) |
| `legal[]` | Mandatory lines, e.g. 请适量饮用, 本品不能代替药物 | at most three, each 1 to 40 characters on one line (*checked*) |
| `music` | Score direction: genre, instrumentation, tempo, mood, ending | English, no named artists or films (*checked*) |
| `look` | `light`, `texture`, `grade` | light and texture in English words without numbers (*checked*); `grade` is an existing grade (`neutral`, `drink`, `food`, `skincare`, `fragrance`, `electronics`, `computing`, `automotive`, `home`, `drama`) or parameters `{contrast 0.8-1.3, saturation 0.6-1.4, gamma 0.8-1.25, warmth -0.1-0.1}` (*checked*) |
| `announcer` | A casting-library id (`deploy/voices/library.json`) | in the library, English, cast as an announcer, passed voice QC on this machine (*checked*) |
| `presenters[]` | Character ids with `cast/<id>/character.json` | the record loads as a cast member with its master portrait (*checked*), an adult (*checked*), its voice passed QC or its designed voice file exists (*checked*) |
| `voices[]` | `id`, `description`, `wav`, `text`: voices designed for the brand's characters | the file exists in the kit, the transcript is given (*checked*) |
| `platforms` | `handles` (platform -> handle), `hashtags` | handles without spaces (*checked*); at most five hashtags, each `#` and up to 30 characters (*checked*) |

Write tone the way a brand book does: what the voice does and never does, in a few concrete words ("quiet confidence", "sensory detail"; never "shouting", "discount talk"), and two or three approved lines per language that sound like the brand. Write claims only with the document that proves them; a claim without a source is not a claim, it is a risk.

## Making films with a kit

`cinefoundry ad|short|drama "<brief>" --brand <brand-id> [--product <product-id>]`. The kit is checked in preflight and the run is refused before any model call when the check fails (*checked*). The product is the one `--product` names, else the one the request names, else the kit's first (*checked*). Where the kit lands:

- **Brief** (*checked*): product, appearance and lettering are the kit's; the kit's claims are the proof and the only proof (`--proof` beside `--brand` is refused); forbidden words, topics and legal lines travel with the brief to every later stage and to a re-cut.
- **Creative treatment** (*checked*): palette (primary, secondary, accent by name), light, texture and music are the kit's whatever the draft said; the announcer is fixed to the kit's voice and is the only voice offered.
- **Copy and screenplay** (*checked*): the kit's forbidden words are restricted wording in the English line, the Chinese subtitle and the title alike, and a draft with one goes back; Latin words match whole words, Chinese words anywhere. The writers are told the tone, the sample lines, the forbidden topics and the claims.
- **Compliance** (*checked*): the scan blocks the kit's forbidden words like the law's; the independent reviewer is told the kit's claims are the only proof and which topics the brand keeps out.
- **Frames** (*checked*): an ad's hero still is the kit's first photo of the product, read before anyone writes; its next two photos join every frame as references. A narrative shot that shows the product takes its photo as a reference when a slot is free.
- **Finishing** (*checked*): titles and the closing line in the title font, subtitles, legal lines and the AI label in the subtitle font; the kit's grade; on the end card the legal lines at the foot, the closing line above them, the logo above that with its clear space, composited after the grade so its colours are exact. A narrative film carries the logo and legal lines over its last three seconds.
- **Packaging** (*checked*): the kit's hashtags lead the film's own (eight at most) and its handles are attached by code; packaging copy may not use a forbidden word.
- **Presenters and mascots** (*checked*): the bible must cast each presenter under its own id, gender and age; casting reuses its cast record (after the project's own and `--cast`) instead of casting again; a character the kit designed a voice for speaks with it.

## Guarding the kit

- A kit that fails its check makes no film. Fix the kit, never the film around it.
- Never draw the logo with the image model or describe it in a prompt: it is the brand's artwork, composited in the cut.
- Never paraphrase the lettering, recolour the product or add a claim the kit does not hold, in any language, on screen or in packaging.
- Faces and voices of presenters are designed, never a real person's, unless the client holds the person's written consent and the rights; record that with the cast record.
- When the client changes the brand book, change the kit and check it; films already delivered keep the version they were made with.
