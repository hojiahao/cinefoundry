---
name: storyboard-design
version: "0.1.0"
description: Convert an approved ad script into a shot-by-shot storyboard with image prompts, video motion prompts and reference assignments that the local image and video models can execute. Use after the script passes compliance, when a reference breakdown must be mapped onto a new product, or when the user asks to change shots, framing, camera moves or pacing.
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - advertising
    - storyboard
    - prompting
---

# Storyboard design

The storyboard is the contract between the script and the generators. Each shot must be
specific enough that a model with no memory of the other shots still produces a frame
that belongs to the same film.

## Workflow

1. Read the brief and the approved script. One script beat becomes one shot of 5 seconds.
2. Describe the product once, in `product`, in English, following the brief's `appearance` to the letter (container, material, colours - the client chose them; a silver can that became a glass bottle was rejected): container type, material, colours, and the label text in quotes (the only place Chinese may appear - anything else in Chinese gets painted onto the product). Every shot shows that same product. In `image_prompt` call it "the product" and do not describe it again - the pipeline generates one approved hero still from `product` and anchors every frame to it, because a product described per shot drifts (a can in shot 1 became a bottle in shot 2).
3. Write one `style` line - palette, light, texture, mood - and nothing else. No numbers, no lens specs, no resolution tags: the image model paints short tokens like "50mm" into the picture as text. Style and the no-text rule are appended to every shot automatically.
4. Never ask for captions, slogans or subtitles in `image_prompt`. On-screen text is typeset in post-production in a real font; text drawn by the model warps, duplicates and turns rare characters into common ones. Put the beat's text in `on_screen_text` only.
5. Design around what the models do badly. Prefer product, liquid, ice, glass, steam, light and macro compositions. Use at most one shot with a person, framed so that hands and face are not the subject. Never two subjects or two actions in one shot: the video model picks one.
6. Vary the shots like a cinematographer: change framing between neighbours (macro -> medium -> wide), give each shot a motivated light source, and build to the product reveal.
7. `image_prompt` in English: subject first, then action, setting, light, framing.
8. `camera` is one move verb with its qualifiers ("slow push-in", "low-angle slow orbit"). "Handheld" is a move of its own: "slow push-in with a subtle handheld float" counts two and is rejected, as is "push-in then pan". Put a float or sway in `video_prompt` instead. `video_prompt` in English, separate from the look: what moves, that one camera move described the way a cinematographer would, and what stays still. For product-only shots end with "No people and no hands enter the frame" - otherwise the video model tends to add a hand.
9. `must_show` is what the quality gate checks on a single still frame, so write something visible and specific in one picture: the product, its placement, what surrounds it. Never motion ("cursor moving", "steam rising"), never screen or UI content, never sound. Motion belongs in `video_prompt`. One subject per shot: if a second object stands with the product (a glass, a cup, a plate), say where in `must_show` ("a glass of soda to the right of the can"), and preferably in `image_prompt` too; the validator rejects a second object that `must_show` does not place, and an image prompt without a placement borrows the one from `must_show`.
10. If a reference breakdown exists, keep its shot count, durations, framing and camera moves; replace subject, product and scene.

## Category playbooks

How real commercials shoot each kind of product. The validator enforces the rules marked *checked*; the
rest is craft.

**Consumer electronics (keyboards, earphones, phones, cameras).** Dark studio, reflective black tabletop,
one or two light colours: a cool rim light along the edges plus a single accent, never rainbow or RGB unless
the brief asks for it (*checked*). Shot list that works: (1) macro on a detail - two or three keys, a
switch, a hinge, a port - with a light sweep; (2) low-angle three-quarter hero with a slow orbit or dolly
and the backlight travelling across the product; (3) the product in a use context or in profile, then the
end card. Small printed legends (keycap letters, port labels) are where image models fail: go macro on a
few of them, or keep the whole product at a shallow depth of field so they fall out of focus; a whole
keyboard in sharp focus is rejected (*checked*). Hands in at most one shot (*checked*), only from a low side angle with the wrists in
frame, never from above (*checked*), and never as the subject; a shot that asks for a finger and also says "no hands" is rejected (*checked*). No screens, cursors or interfaces
(*checked*). Motion vocabulary for `video_prompt`: light sweeping across the keys row by row, a slow
ten-degree orbit, a rack focus from the badge to the keys, dust motes in the rim light.

**Computers (desktops, mini PCs, workstations, servers, GPUs).** Dark studio and reflective tabletop like
consumer electronics, but lit soft warm gold, with at most a faint green accent in the background: blue,
cyan, "cool" or neon light is rejected (*checked*) because the models spread it over the metal and a gold
DGX Spark came out blue, LED strips glowing along its edges. Data-center racks stay dim and warm. The story is what the machine
does, so the person and the result may appear. Shot list that works: (1) the product on a desk at night,
three-quarter, slow push-in; (2) the moment of use - a hand at a keyboard from a low side angle, or a face lit
by a screen that faces away from camera or sits out of focus - one hand shot at most (*checked*); (3) a
pull-back or wide reveal of scale: the desk, then rows of server racks, or the product against a data-center
backdrop. Never ask the image model for screen contents (code, charts, chat windows): it invents gibberish
(*checked*); show the glow, not the text. The product has no screen of its own: a monitor or keyboard in the shot is a second object, so `must_show` says where it stands ("a monitor behind the product, out of focus") (*checked*). A shot with a hand does not also say "no hands" anywhere, video prompt included (*checked*). No keyboard macros of keys and switches unless the product is the keyboard.

**Drinks.** Backlight, condensation, ice, pour and splash in macro; the container upright and whole in at
least two shots; the last shot hands over to the end card.

**Skincare.** Soft diffused light, pale surfaces, texture macros (cream, water, silk); the jar closed and
readable in the reveal; one hand at most, and only applying.

**Food.** Warm directional light, steam and texture; the pack or cup in frame with what it makes.

The category anchor (studio, light, depth of field) is appended to every frame prompt by code from the
brief's product, so put the scene in `image_prompt` and leave the lighting base to the pipeline.

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
you. A storyboard that describes a product other than the brief's (a can for a face cream)
is rejected by the validator before anything is generated.

```text
```

## Common failures

- Two subjects or two actions in one shot: the video model picks one. Split the shot.
- Text requested inside the image, or a style line with numbers in it: it shows up as stray lettering and the gate rejects the frame.
- Re-describing the product in a shot: the description competes with the hero still and the product drifts ("brass-finish texture" made a dark grey keyboard gold). Judged by Jev and rejected.
- The same framing three times in a row, or two neighbours with the same framing and camera move: the film reads as one long shot (the keyboard film was three near-identical three-quarter views). Rejected by the validator.
- A shot that depends on something the models cannot draw reliably (a cursor moving across a screen, a specific UI): four attempts failed on it. Keep shots physical: product, hands-free material, light, liquid, texture.
- A shot built around a screen, a display or UI: image models invent gibberish interfaces and the gate rejects them. Show the device, not what it shows.
- A keyboard shown whole and sharp: sixty tiny legends, all of them garbled, and a "青" badge that landed on the space bar. Macro on a few keys, or shallow depth of field.
- A hand in every shot (a finger pressing a key three times): the film is about the hand, not the keyboard, and the model changed the product under it. One hand shot at most.
- A second object with no place ("icy bubbles in a poured glass" next to the can): every frame is edited from the hero still of the can alone, so the model poured water onto the can, then put the can inside the glass, then drew only a glass. Four rejects. Place it beside the product, or leave it out.
- must_show written as motion ("keys glowing row by row"): the gate looks at one still and rejects every candidate. Name what one picture shows.
- Two macro push-ins on a pressed key, one at each end of the film: same framing and move twice is rejected wherever the two shots sit.
- Rainbow RGB underglow nobody asked for: it reads as cheap on a product that was briefed as cool-toned rim light. Light with one or two colours.
