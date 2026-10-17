---
name: storyboard-design
version: "0.4.0"
description: Convert an approved ad script into a shot-by-shot storyboard with image prompts, video motion prompts and reference assignments that the local image and video models can execute. Use after the script passes compliance, when a reference breakdown must be mapped onto a new product, or when the user asks to change shots, framing, camera moves or pacing.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: picture
  tags:
    - advertising
    - storyboard
    - prompting
---

# Storyboard design

The storyboard is the contract between the script and the generators. Each shot must be
specific enough that a model with no memory of the other shots still produces a frame
that belongs to the same film.

## The standard: a film a top crew would have shot

The bar is a commercial from a top Chinese agency or a Hollywood product film - not "an AI video with nothing wrong in it". Every shot needs a reason, a light and a place in the rhythm. Before writing shots, decide the film as a director would.

### 1. The film is already decided - follow the treatment

The creative director's treatment comes with the brief (visual concept, light, palette, texture, rhythm). Do not invent a different film. Carry it into `style`, which code appends to every frame: the treatment's light (time of day, key direction, warm or cool), its three colours, its texture, and the mood - one line, words only, no numbers. Lighting, lenses, sets, props, product styling and people follow `cinematography-and-art-direction`, which you work from at the same time.

### 2. Rhythm of a 30-second master

The master is 30 seconds - six 5-second shots and a 3-second end card - the classic length of a broadcast spot. The 15- and 6-second versions are cut from the same shots afterwards (`editing-and-versioning`), so design shots that can stand alone.

| Shot | Seconds | Job | Typical shot |
|---|---|---|---|
| 1 | 0-5 | Hook: grab attention in the first second; must also open the 15 s version | the most striking image - a macro detail, a light moving across the product, a splash frozen in backlight |
| 2 | 5-10 | The world and the insight | the moment the product belongs to: a place, a time of day, a person from behind or out of focus |
| 3 | 10-15 | The product enters | first clear look at the product in that world |
| 4 | 15-20 | Experience or proof | texture, pour, steam, a hand at a low side angle, the feature the proof backs |
| 5 | 20-25 | Build | the strongest sensory moment, rising toward the hero |
| 6 | 25-30 | Hero: the product whole, upright, best-lit, with room for the title; must also carry the 6 s version | |
| End card | 3 s | Brand and closing line | typeset in post - never drawn |

10-, 15- and 20-second masters keep the same logic with fewer beats (hook, proof, hero). The first frame of shot 1 has to work as a thumbnail with the sound off.

### 3. Framing and progression

- Neighbouring shots differ in framing: macro / close-up -> medium -> wide, or the reverse for a reveal. Never two neighbours with the same framing and the same move (*checked*).
- 16:9 composition: subject on a third, never jammed against an edge; horizon on a third; foreground out-of-focus layers for depth. Keep the **upper third calm** (the title is typeset there) and the **bottom fifth clear** (subtitles). Vertical (9:16) films keep the product in the middle third.
- Express lenses in picture words, never numbers: "telephoto compression with a softly stacked background", "macro probe-lens view skimming the surface", "very shallow depth of field with creamy bokeh", "wide establishing view with the product small in the frame". The image model paints "50mm" or "f/1.4" into the frame as text.

### 4. What makes a frame look generated - design it out

Waxy or plastic skin, over-smooth surfaces, everything centred and symmetrical, light from nowhere, rainbow or neon colour nobody briefed, objects floating or melting, two of the product, text in the image. The quality gate rejects these and scores light, composition and realism; a shot designed around them costs a regeneration.

## Workflow

1. Read the brief and the approved script. One script beat becomes one shot of 5 seconds.
2. Describe the product once, in `product`, in English (*checked*), following the brief's `appearance` to the letter (container, material, colours - the client chose them; a container other than the one the request names is rejected, *checked*): container type, material, colours, and the label text `brandText` in quotes (*checked*: it must appear; the quotes are the only place Chinese may appear - anything else in Chinese gets painted onto the product). With a product photo, `product` describes exactly what the photo shows, and `style` may not give the product a colour or finish (*checked*). Every shot shows that same product. In `image_prompt` call it "the product" and do not describe it again - the pipeline generates one approved hero still from `product` and anchors every frame to it, because a product described per shot drifts (a can in shot 1 became a bottle in shot 2).
3. Write one `style` line in English (*checked*) - palette, light, texture, mood - and nothing else. No numbers, no lens specs, no resolution tags: the image model paints short tokens like "50mm" into the picture as text. Style and the no-text rule are appended to every shot automatically.
4. Never ask for captions, slogans or subtitles in `image_prompt`. On-screen text is typeset in post-production in a real font; text drawn by the model warps, duplicates and turns rare characters into common ones. Put the beat's title in `on_screen_text` only (at most 8 characters, *checked*).
5. Design around what the models do badly. Prefer product, liquid, glass, steam, light and macro compositions. Use at most one shot with a hand (*checked*), and at most one with a person, framed so that hands and face are not the subject. Never two subjects or two actions in one shot: the video model picks one.
6. Vary the shots like a cinematographer: change framing between neighbours (macro -> medium -> wide), give each shot a motivated light source, and build to the product reveal.
7. `image_prompt` in English (*checked*; Chinese only inside quoted label text): subject first, then action, setting, light, framing.
8. `camera` is one move verb with its qualifiers (*checked*) ("slow push-in", "low-angle slow orbit"). "Handheld" is a move of its own: "slow push-in with a subtle handheld float" counts two and is rejected, as is "push-in then pan". Put a float or sway in `video_prompt` instead. `video_prompt` in English with no Chinese (*checked*), separate from the look: what moves, that one camera move described the way a cinematographer would, and what stays still. For product-only shots end with "No people and no hands enter the frame" - otherwise the video model tends to add a hand.
9. `must_show` is what the quality gate checks on a single still frame, so write something visible and specific in one picture: the product, its placement, what surrounds it. Never motion ("cursor moving", "steam rising", *checked*), never screen or UI content (*checked*), never sound. Motion belongs in `video_prompt`. One subject per shot: if a second object stands with the product (a glass, a cup, a plate), say where in `must_show` ("a cup of coffee to the left of the bag"), and preferably in `image_prompt` too; the validator rejects a second object that `must_show` does not place (*checked*), and an image prompt without a placement borrows the one from `must_show`.
10. If a reference breakdown exists, keep its shot count, durations, framing and camera moves; replace subject, product and scene.

## Semantic checks

The validator counts beats, checks languages and lengths. With `TYPESAFE_API_KEY` set,
each shot is also judged by Jev on what a regex cannot see: does the prompt ask for
lettering, does it pack two actions or two camera moves, does it re-describe the product,
does it call for a hand or person the `must_show` did not ask for. Findings above p = 0.7
come back as rewrite reasons in the same loop as the validator's own.

## Output format

```json
{
  "style": "<one line: light, palette, texture, mood - no numbers>",
  "product": "<THIS brief's product: container type, material, colours, and its label text \"<brandText>\" in quotes>",
  "shots": [
    {"shot": 1, "seconds": 5, "framing": "<macro | close-up | medium | wide>", "camera": "<exactly one move>",
     "image_prompt": "<subject first, action, setting, light, framing; refer to 'the product'>",
     "video_prompt": "<what moves, one camera move, what stays still; for product-only shots end with: No people and no hands enter the frame>",
     "on_screen_text": "<the beat's title, or empty>", "must_show": "<something visible and specific>"}
  ]
}
```

This is a shape, not content. Every value comes from the brief and the script in front of
you. A storyboard that describes a product other than the brief's (a drink can for a perfume)
is rejected by the validator before anything is generated (*checked*). Exactly one shot per beat, in beat order (*checked*).

## Common failures

- Two subjects or two actions in one shot: the video model picks one. Split the shot.
- Text requested inside the image, or a style line with numbers in it: it shows up as stray lettering and the gate rejects the frame.
- Re-describing the product in a shot: the description competes with the hero still and the product drifts - a finish word ("brass-finish texture") repaints the product's own colour. Judged by Jev and rejected.
- The same framing three times in a row, or two shots with the same framing and camera move: the film reads as one long shot (three near-identical three-quarter views). Rejected by the validator (*checked*), wherever in the film the two shots sit.
- A shot that depends on something the models cannot draw reliably (a cursor moving across a screen, a specific UI): four attempts failed on it. Keep shots physical: product, hands-free material, light, liquid, texture.
- A shot built around a screen, a display or UI: image models invent gibberish interfaces and the gate rejects them. Show the device, not what it shows.
- A product covered in small printed legends (keys, dials, scales, engraved numerals) shown whole and sharp: dozens of tiny legends, all garbled, and the badge drawn in the wrong place. Go macro on a few, or keep them in shallow depth of field; a whole keyboard in sharp focus is rejected (*checked*).
- A hand in every shot: the film is about the hand, not the product, and the model changes the product under it. One hand shot at most (*checked*), from a low side angle, never from above (*checked*).
- A second object with no place (a poured glass next to the product): every frame is edited from the hero still of the product alone, so an unplaced glass made the model pour liquid onto the product, then put the product inside the glass, then draw only the glass. Four rejects. Place it beside the product, or leave it out.
- must_show written as motion ("light sweeping row by row"): the gate looks at one still and rejects every candidate. Name what one picture shows.
- Rainbow RGB light nobody asked for on electronics (*checked*), or blue, cyan or neon light on a computer (*checked*): it reads as cheap and the models spread it over the product's own colours. Light with one or two colours.
