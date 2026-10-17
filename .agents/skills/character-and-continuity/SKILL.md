---
name: character-and-continuity
version: "0.2.0"
description: The casting director's, the costume designer's and the script supervisor's craft for narrative films - the casting department (a casting brief per character, a gated casting call of four Qwen-Image-2512 candidates, a reference pack edited from the chosen master with Qwen-Image-Edit-2511 and identity-gated, a cast record reused across episodes and series), the reference views each shot is edited from, wardrobe per scene, the continuity record (props, hair, wardrobe, screen direction and the 180-degree line, eyelines, light), and the identity checks the quality gate applies. Use when a series bible's characters are cast, before any frame with a person in it is generated, when a scene changes wardrobe or props, when a frame is regenerated, and before the edit of every episode.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: picture
  tags:
    - casting
    - costume
    - continuity
    - micro-drama
    - qwen-image-2512
    - qwen-image-edit-2511
---

# Character and continuity

In an ad the product hero still is generated once and every frame is edited from it, so the product never drifts. A narrative film does the same with people: each character is cast once into a locked master portrait and a reference pack edited from it, and every frame that shows them is an edit of those references. Viewers forgive flat light; they do not forgive a lead whose jaw, hair parting or jacket changes between a shot and its reverse. Audience complaints about AI dramas rank "stiff faces" and "odd movement" first (research, 3.4); a face that changes is worse than either.

## Casting rules

- Adults only: every character is 18-90 (*checked*). Write the age in words in `look` ("in her late twenties"), never digits (*checked*); the image model paints numbers.
- No real people. Never name or describe a celebrity, a public figure, a client's employee or "someone who looks like" anyone. Unauthorised likeness is the industry's main legal exposure (research, 3.4; NO FAKES Act passed committee 2026-06).
- At most five characters by default (*checked*): each needs a locked look and a designed voice, and a 10-20 episode season cannot develop more.
- `look`, `wardrobe` and `voice` are English (*checked*); `id` is a lowercase slug (*checked*) used in file names, shot lists and voice files.
- Cast for contrast. Two leads must be told apart in a thumbnail at phone size: different hair length and colour value, different silhouette, different wardrobe palette. Two dark-haired men in dark suits read as one person on a 6-inch screen.
- Write `look` as a casting director describes a face, specific and plain: face shape, brow, eyes, nose, mouth, skin tone and texture, hair (length, parting, texture, colour), build, one distinguishing detail (a small scar through the left eyebrow, a mole below the right eye). No adjectives of worth ("beautiful", "handsome"): they pull every face toward the same model average.

## The casting department

The casting stage (`src/crafts/narrative/casting.ts`) works as a real casting department, once per character, in pre-production. Its output is never regenerated mid-season.

1. **Casting brief.** The character designer (you, in this role) writes one brief per character from the bible, as JSON fields: `face` (shape, brow, cheekbones, jaw, chin), `features` (eyes, nose, mouth), `ethnicity` (consistent with the world, the name and the family), `skin` (tone and texture as fits the age), `hair` (length, parting side, texture, colour), `build`, `distinctive` (one identifying detail with its side), `wardrobe` (garment by garment) and `palette` (two or three named colours). The validator refuses the brief and asks again (*checked*) when a field is empty, has digits or Chinese, uses a word of worth ("beautiful", "handsome", "perfect"), refers to a real or famous person ("looks like", "resembles", "celebrity"), reads as a minor ("girl", "teen", "child"), names fewer than two colours, or repeats most of another character's palette - including characters already cast in an earlier run.
2. **Casting call.** Four candidates per role from Qwen-Image-2512 at full quality (fifty steps, CFG four, the model card's negative prompt; *checked*): the brief written as a casting photograph, head and shoulders, front three-quarter (face turned slightly off camera, eyes toward the lens side), neutral mid-grey seamless backdrop, large soft key from camera left, neutral expression, mouth closed, the age in words. Each candidate is saved in `cast/<id>/candidates/`.
3. **Casting gate.** Every candidate is judged with the masters of the characters already cast beside it (`sheetGate`). It is rejected (*checked* by the judge) for anything the sheet gate rejects (below), a face that contradicts the brief or lacks the distinctive detail, or a person who could be mistaken for an already-cast character at phone size; it is rated 0-10 on realism, match to the brief and distinctness, and every rating must reach the craft floor (*checked*). The keeper is a passing candidate over any reject, then the highest score, then the highest casting ratings (*checked*). When none of the four passes, a second call of four carries the gate's own words as "Avoid: ..."; after eight, the best is kept and reported as an open item (*checked*). The keeper is `cast/<id>/master.png`, the identity of record.
4. **Reference pack.** Edited from the master with Qwen-Image-Edit-2511 and its 8-step Lightning LoRA, never generated from text (*checked*): `profile.png` (left profile, head and shoulders) and `full-body.png` (head to feet in the default wardrobe), on the master's backdrop and light. Each view is judged against the master (`identityGate`): same face shape, eye spacing, nose, mouth, hairline and parting, hair, skin tone, age and build, the distinctive detail on the correct side, a true profile or both feet in frame, the wardrobe as written. Up to three edits per view; a view that never passes is left out, and frames use the master instead of a cousin (*checked*).
5. **Record.** `cast/<id>/character.json` holds the brief, look, wardrobe, voice (a casting-library id, or `voice.wav` designed for the character), every image with its gate score, issues and casting ratings, and every candidate.
6. **Lock and reuse.** A run loads a character from `cast/<id>/character.json` instead of casting again when the record is for the same id and gender and its master exists (*checked*): its look and wardrobe replace the bible's, its voice is kept. A new series with the same people passes `--cast projects/<earlier-id>/cast`; the records are copied into the project. A recast (rare, director's call) deletes the character's folder, and every frame of that character not yet in a delivered episode is regenerated.

One diffusion family in memory at a time: Qwen-Image-2512 is released before Qwen-Image-Edit-2511 loads for the packs (*checked*).

## Every frame with a person is an edit

- First frames of shots that show a character are edited with Qwen-Image-Edit-2511 from the reference pack (*checked*). The view follows the framing (*checked*): a wide, full or long shot, or a prompt where the character walks or is seen full length, takes `full-body`; a profile shot or "in profile" takes `profile`; every closer framing (close-up, medium, over-the-shoulder) takes the master. A missing view falls back to the master.
- At most three references across everyone in frame (*checked*): one per character in the shot's order, the speaker first; a spare slot then takes the master of a character whose first reference was the full-length or profile, so a small face in a wide still has its portrait.
- The prompt says what each reference is (*checked*): "Image 1 is Mia full length: the same person - keep the face, hair, build and wardrobe exactly; wearing ... Image 2 is Mia's face: the same person - keep the face, hair and skin exactly."
- Never re-describe the face in `image_prompt`. Describe pose, framing, expression, action and wardrobe change only; re-describing features drifts the face exactly as re-describing a product drifts the label.
- Expression is directed in the prompt in small, physical terms - "jaw set, eyes wet but holding" - not with emotion labels ("sad", "angry"), which produce stock theatrical faces.
- Across episodes, re-anchor every episode from the master portrait, never from the last frame of the previous episode: chaining edits compounds drift. Long seasons drift anyway (research, 5.3); keep first seasons at 10-20 episodes.

## Wardrobe per scene

- `Character.wardrobe` is the default. A scene that changes it records the change in the continuity record with the scene number, and the derived wardrobe view is made once and used for every shot of that scene.
- Wardrobe is specific enough to repeat: garment, colour, fabric, fit, what is open or rolled. "Charcoal wool overcoat, open, over a cream roll-neck" repeats; "smart casual" does not.
- No logos, no printed text, no brand marks on clothes. Jewellery and glasses are continuity items: if she wears a thin gold ring in scene 2, she wears it in every shot of scene 2.
- Story time drives changes: the same day keeps the same clothes. A change needs a reason the audience can infer (next morning, a gala).

## The continuity record

The script supervisor's notes, kept per episode at `projects/<id>/continuity/ep<NN>.json`, written before frames are generated and updated after every gated frame.

```json
{
  "episode": 3,
  "scenes": [{
    "scene": 2,
    "heading": "INT. CAFÉ - MORNING",
    "time": "morning, overcast",
    "key_light": "soft window light from frame left",
    "line_of_action": "mia frame left facing right, leo frame right facing left",
    "characters": [{
      "id": "mia",
      "wardrobe": "charcoal wool overcoat open over cream roll-neck",
      "hair": "shoulder length, side parting on her left, tucked behind right ear",
      "props": ["paper coffee cup in right hand"],
      "state": "eyes slightly red from scene one"
    }],
    "props_on_set": ["two cups on the table, laptop closed"],
    "shots": [{"shot": 4, "frame": "frames/shot_004.png", "eyeline": "to frame right, slightly above lens", "notes": ""}]
  }]
}
```

What it tracks, because these are what break first: hair parting and tucks, which hand holds which prop and how full the cup is, jewellery, wardrobe state (buttoned, sleeves rolled), injuries and make-up states that carry across scenes, set dressing that appears in more than one shot, and time of day with key direction.

## Screen direction and eyelines

- **The 180-degree line.** In a two-person scene, decide who is frame left and who is frame right in the wide, record it as `line_of_action`, and keep it: singles and over-the-shoulders show each character looking the same way across the cut. Crossing is allowed only on screen (a character walks across, the camera dollies across) or through a neutral shot straight down the line.
- **Eyelines.** A single of A looking frame right, slightly above lens, cuts with a single of B looking frame left at the matching height. The taller character looks down, the shorter up, consistently. Record the eyeline per shot and write it into `image_prompt` ("looking off to frame right, just past the camera").
- Lip-sync constrains framing: a dialogue shot frames its speaker first, in medium, medium close-up, close-up or over-the-shoulder, and only the speaker faces camera (*checked*). Plan the coverage of every exchange as single / reverse single or over-the-shoulder pairs, never a two-shot with both faces talking (see `dialogue-and-voice`).
- **Light direction** follows the room, not the camera: if the window is frame left in the wide, it lights A's right cheek in her single and B's left cheek in his reverse.

## Identity checks for the gate

The vision reviewer (`src/crafts/narrative/gate.ts`) judges three things; an image passes only with `pass`, score ≥ 80 and light, composition and realism each at or above the craft floor (6 by default), and on the casting gate realism, brief and distinct at or above it too (*checked*).

- **Sheet gate** on every casting candidate, with up to four already-cast masters beside it, rejects (*checked* by the judge): not exactly one person, not clearly an adult of the written age and gender, a face or hair that contradicts `look` or the casting brief, a missing distinctive detail, a person who could be mistaken for an already-cast character, distortion or malformed hands, a CGI or beauty-filtered look (waxy, poreless skin, glossy eyes, perfect symmetry), a face recognisable as a well-known person, any text or logo, a face that is cropped or not clearly lit.
- **Identity gate** on every reference-pack view, against the master, rejects (*checked* by the judge): a different person, the distinctive detail missing or on the wrong side, not a true profile or not head to feet, wardrobe that contradicts the record, an extra person, distortion, a CGI look, lettering.
- **Shot gate** on every first frame, with the masters of up to three characters in frame as references (whatever views the frame was edited from), rejects (*checked* by the judge): a character who is a different person from their master (another face shape, eye spacing, hairline, hair colour or style, skin tone, age or build), more people facing camera than the shot lists or an unexpected extra person, the speaker's mouth hidden or soft on a lip-synced shot, distorted faces or hands, any lettering, a CGI look, flat light or a tilted, cluttered frame.

The shot gate deliberately ignores wardrobe changes the scene calls for, so it cannot tell a correct change from a continuity error. Those checks are yours, against the continuity record, on every gated frame:

- Hair parting, length, tucks and colour as recorded for the scene; the distinguishing detail on the correct side.
- Wardrobe garment, colour and state as recorded; no logo or lettering on clothing.
- Props in the recorded hand, at the recorded state; no unrecorded prop.
- Screen direction and eyeline consistent with `line_of_action`.
- Background faces soft or absent (crowds degrade - research, 5.3); hand contact scripted around where possible.

Two candidates per frame (more with `candidates`); keep the passing one with the highest score. After a clip is generated, check its last frame too: video models drift the face over five seconds, and a shot whose face changes by the end is regenerated even though its first frame passed.

## Common failures

- A derived view generated from text instead of edited from the master: a cousin, not the character.
- Chaining edits frame to frame across a scene or an episode: drift accumulates; always edit from the master.
- Re-describing the face in each shot prompt: features average toward a generic face.
- Two similar-looking leads: the audience loses who is who in the first episode.
- Editing a character's look in the bible after casting and expecting a new face: the cast record wins. Recast by deleting `cast/<id>/`.
- Continuity record written after the frames: the frames become the record, and the errors with them.
- Crossing the line between a single and its reverse: both characters appear to face the same way.
