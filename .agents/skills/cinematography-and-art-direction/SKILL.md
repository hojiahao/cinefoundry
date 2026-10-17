---
name: cinematography-and-art-direction
version: "0.1.0"
description: The director of photography's, the production designer's, the product stylist's and the casting director's craft for every shot - light setups by category, lens language in picture words, camera moves with speed and end frame, sets, surfaces and props, how the product is styled and presented, and how people are cast, dressed and directed so they read as real. Use together with storyboard-design whenever shots are designed or changed, or when a frame is regenerated after the quality gate.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: picture
  tags:
    - advertising
    - cinematography
    - art-direction
    - casting
---

# Cinematography and art direction

On a real shoot the director decides what a shot is about; the director of photography decides how it is lit and seen, the production designer what surrounds the product, the stylist how the product itself looks, and the casting director who appears and how. The storyboard artist works from this skill and `storyboard-design` at the same time: every `image_prompt`, `video_prompt` and `style` carries these decisions in words.

## Lens language - in picture words, never numbers

The image model paints "50mm", "f/1.4" or "5600K" into the frame as text. Say what the lens does:

| Intent | Write |
|---|---|
| Intimate macro | "macro probe-lens view skimming the surface", "extreme close-up where the label fills the frame" |
| Product hero | "slightly low three-quarter angle, the product filling the middle third, background softly falling away" |
| Compression and calm | "telephoto compression with a softly stacked background" |
| Place and scale | "wide establishing view with the product small in the frame" |
| Depth | "very shallow depth of field with creamy round bokeh", "soft out-of-focus foreground layer" |

## Light

One light logic for the whole film, from the treatment: the same time of day, the same key direction, the same colour temperature in every shot - a warm shot cut against a cold one reads as two films. Every light has a motivation (a window, a lamp, the sun low behind, a studio strip). Name the key, the edge and the fill in plain words: "warm low key light from the left, a hard edge light from behind carving the silhouette, deep soft shadows on the right".

## Light and texture by category

| Category | Key light | What must read | Avoid |
|---|---|---|---|
| Drinks | strong backlight plus a hard edge light along the silhouette | condensation beads with tiny highlights, liquid glowing where light passes, ice with real refraction | flat front light, milky liquid, cartoon splashes |
| Skincare | large soft wrap-around light, gentle highlight roll-off | cream texture, glass and stone surfaces, real skin texture | waxy skin, beauty-filter faces, harsh specular |
| Food | warm low side light raking across texture, backlit steam | crumbs, oil sheen, grain, steam | over-saturated colour, plastic-looking food |
| Consumer electronics | dark studio, cool rim light along the bevels, one or two colours | crisp edges, machined metal, a light sweep across the surface | rainbow RGB unless briefed (*checked*), sharp tiny legends |
| Computers and servers | soft warm gold key and rim light, at most a faint green accent far back | weight and craftsmanship of the casing, scale | blue, cyan or neon light (*checked*), screen contents (*checked*) |
| Home and lifestyle | motivated practical light - a window, a lamp, a candle | lived-in warmth, layered depth | sterile studio emptiness |

Code already appends the category anchor and a realism clause to every frame (real materials, accurate reflections, natural falloff, grain; not CGI). Put the scene, its light direction and its composition in `image_prompt`; do not repeat the anchor.


## Camera moves that read as a real crew

- One move per shot, said the way a camera operator would: slow push-in, slow pull-back, lateral dolly, low-angle orbit, crane down, rack focus, locked-off static.
- State the speed and the end frame in `video_prompt`: "a very slow push-in that travels only a short distance over the whole shot and ends on the label, centred". Fast or wandering moves warp the product.
- Locked-off shots are not a weakness: light moving across a still product (a sweep, a shadow passing, steam drifting) is a classic product move.


## Production design: sets, surfaces and props

- One surface, one backdrop, one prop at most per shot. Clutter reads as cheap and the edit model redraws the product into it.
- Surfaces that photograph well and carry the palette: stone, brushed metal, linen, oiled wood, dark glass, wet slate.
- Props support the story, never compete: a glass beside a drink, coffee beans beside a pack, a folded towel beside a cream. Place them ("a glass to the right of the can") - an unplaced second object is rejected (*checked*).
- Practical light sources in frame (a lamp, a window, a candle) make light motivated and add depth.

## Product styling

- The product is always the sharpest and best-lit thing in the frame, front label facing the camera, upright unless its natural position is flat (keyboards, laptops).
- Drinks: fresh condensation beads, not a wet mess; ice with clear refraction; liquid at the right colour (a clear drink stays clear).
- Skincare: jar closed in the hero, a clean swirl of texture in the macro, never smeared.
- Food: steam, a few crumbs, an oil sheen - appetising, never piled.
- Electronics and computers: dust-free, fingerprint-free, edges catching a single highlight.
- Never describe the product's look again in a shot: the approved hero still carries it, and a re-description drifts the product (*checked* by the judge).

## Casting and performance

At most one shot with a person, and the person is never the subject - the product is. Frame them so face and hands are not the focus: from behind, in profile, out of focus, or a hand at a low side angle with the wrist in frame. Ask for a real person: "natural skin with pores, relaxed candid expression, unposed". Never ask for a celebrity, a specific real person or a recognisable face.

- Cast for the audience in the brief (age, style), dressed in plain, timeless clothing in the film's palette - no logos, no text on clothes.
- Hair and make-up natural: real skin, real hair, no glossy beauty-filter finish.
- Performance is small and true: a breath, a glance down, a half smile. No posing to camera, no exaggerated delight.

## Category playbooks

How real commercials shoot each kind of product. The validator enforces the rules marked *checked*; the
rest is craft.

**Consumer electronics (keyboards, earphones, phones, cameras).** Dark studio, reflective black tabletop,
one or two light colours: a cool rim light along the edges plus a single accent, never rainbow or RGB unless
the brief asks for it (*checked*). Shots that work: macro on a detail - two or three keys, a
switch, a hinge, a port - with a light sweep; low-angle three-quarter hero with a slow orbit or dolly
and the backlight travelling across the product; the product in a use context or in profile, then the
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
does, so the person and the result may appear. Shots that work: the product on a desk at night,
three-quarter, slow push-in; the moment of use - a hand at a keyboard from a low side angle, or a face lit
by a screen that faces away from camera or sits out of focus - one hand shot at most (*checked*); a
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

