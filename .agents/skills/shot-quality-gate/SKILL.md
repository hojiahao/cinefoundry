---
name: shot-quality-gate
version: "0.3.0"
description: Inspect a generated advertisement frame with the local vision model and decide whether it may proceed to video generation - product identity against references, warped text or logos, anatomy errors, and whether the required content is present. Use after every generated frame and before any clip is made from it, or when the user asks to check, QA or verify generated shots.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: picture
  tags:
    - dgx-spark
    - stepfun
    - vision
    - quality
---

# Shot quality gate

Video generation is the expensive step - 247 s for one native-1080p clip on this machine, measured - and it
faithfully animates whatever is wrong in its first frame. Gate frames with a second pair of
eyes that did not write the prompt, on a different model from the one that did.

## Workflow

1. Gate every frame against the approved product hero still and the storyboard's `must_show`:

   ```bash
   cinefoundry qa --project <id> --shot 1 --frame projects/<id>/frames/shot_001.png \
     --ref projects/<id>/refs/product.png --expect "the product upright on dark stone with its label readable"
   ```

   The local StepFun vision model returns `{"pass", "score", "issues"}`; the report is saved to `reports/qa_1.json`. Exit code 1 means rejected.
2. Reject on any one of these, whatever the score:
   - the required content is missing;
   - the product is a different product from the hero still: container type, main colours or brand lettering. Condensation, lighting, angle, scale and fine print are expected to change and are not grounds;
   - any text outside the product label - captions, slogans, numbers, lens specs, watermarks - or any garbled or duplicated lettering;
   - a person, hand or fingers in a shot that does not call for them; extra limbs, malformed hands, a distorted face;
   - the product cropped, floating, physically implausible, or a drink that should be clear in an odd colour.
3. **Craft.** Beyond the reject list, the gate rates the frame as a commercial cinematographer would, 0-10 each:
   - light: motivated, sculpted, one clear key; the product the best-lit thing in the frame
   - composition: balanced, depth from foreground to background, calm space for the title in the upper third
   - realism: reads as a photograph - real materials, accurate reflections, natural skin
   Any axis below 6 (`CINEFOUNDRY_CRAFT_FLOOR`) regenerates the frame even when nothing is wrong with it. CGI or AI-art looks are rejected outright: waxy or plastic skin, over-smooth surfaces, melted or warped geometry, impossible reflections, a glossy illustration finish, flat or muddy light, clutter.
4. With several candidates for a shot, keep the passing one with the highest score.
5. When every candidate is rejected, change the prompt according to the issue before regenerating - the same prompt mostly fails the same way:
   - product mismatch -> do not describe the product again: image 1 already carries its shape, colours, cap and lettering, and the fixed sentences already say its label must not change. Instead delete every word about the product's look (colour, cap, logo, label text) and every prop or effect around it, until the scene is the product, one surface and one light - shorter than before. Keep the framing and the must-show content
   - stray text -> remove whatever in the prompt reads like a caption, a number or a spec
   - unwanted hands or people -> reframe as a product-only composition
   - missing content -> move it to the front of the prompt
6. At most two regenerations per shot. Then keep the best attempt and note the open issue for the delivery report.
7. If the vision model cannot return a verdict, retry once with a larger token budget. If it still cannot, accept the frame **marked as unverified** and say so in the delivery report. The gate must never take the whole film down, and it must never claim a check it did not make.
8. Record pass rate, craft scores and regeneration count across the project; they are the evidence that the loop works.

## Limits

The vision model judges one frame. It does not see motion, it can miss small logo errors,
and it always reasons before answering, so give it at least 3500 output tokens. For hero
product shots, show the frame to the user as well.
