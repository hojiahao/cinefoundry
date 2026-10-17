---
name: spark-local-media-generation
version: "0.2.0"
description: Generate a product hero still, storyboard frames anchored to it, and native-1080p video clips on the local DGX Spark with the cinefoundry CLI (ComfyUI running Qwen-Image, Qwen-Image-Edit, LTX-2.5 Fast NVFP4 or Wan2.2, and RIFE interpolation) instead of a cloud API. Use when product shots, storyboard frames or shot clips must be produced, when material is confidential or unreleased, or when choosing between local and cloud generation.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  tags:
    - dgx-spark
    - comfyui
    - qwen-image
    - wan2.2
---

# Spark local media generation

Hero still first, frames second, clips last. Each step is anchored to the one before it,
so product identity is decided where a retry costs seconds, not minutes.

## Workflow

1. Check memory with `spark-model-scheduler` before each phase. Only one diffusion family should be resident at a time; run `cinefoundry mem free` when switching between them.
2. Generate the **product hero still** from the storyboard's `product` description on a plain backdrop, and gate it:

   ```bash
   cinefoundry image --out projects/<id>/refs/product.png --size 1328x1328 --prompt "Studio product photograph of <product> ..."
   cinefoundry qa --frame projects/<id>/refs/product.png --expect "one container, upright, label reads \"<brand>\" clearly"
   ```

   If the user supplied real product photos, use those instead and skip this step.
3. Generate every storyboard frame **from the hero still**. A reference switches the request to the edit model and keeps the product the same product:

   ```bash
   cinefoundry image --project <id> --shot 1 --size 1920x1088 \
     --prompt "<image_prompt>. Image 1 is the product: keep its shape, colours and label exactly as in image 1. No captions, no subtitles, no lettering except the product label. <style>" \
     --ref projects/<id>/refs/product.png
   ```

   Generate two candidates per shot and let `shot-quality-gate` pick: the spread between seeds is often larger than what a prompt edit buys.
4. Only gated frames move on. Generate each clip from its approved frame:

   ```bash
   cinefoundry video --project <id> --shot 1 --model ltx25-fast-nvfp4 --duration 5 --ratio 16:9 --resolution 1080p \
     --prompt "<video_prompt>" --first-frame projects/<id>/frames/shot_001.png --keep-loaded
   ```

   Drop `--keep-loaded` on the last clip so the video model is released.
5. Every command prints measured `seconds` and records the asset with `execution: local-dgx-spark`. Keep these numbers for the delivery report.
6. Clips are saved near-lossless (H.264 crf 12 through ComfyUI's `format.codec.encoding.crf`; the old top-level `codec` input was ignored and wrote 0.6 Mbps). Never re-encode an intermediate at a lower quality - every generation of compression shows in the final grade.

## What the models do, measured on this machine

| Step | Model | Cost |
|---|---|---|
| Frame, no reference, 1920x1088 | Qwen-Image + 8-step LoRA (generated natively at about 1.76 MP, upscaled) | 22.7 s warm, 45.8 s cold |
| Frame from the hero still | Qwen-Image-Edit-2509 + 8-step LoRA | about 77 s |
| 5 s clip, native 1080p, from a first frame | **LTX-2.5 Fast 22B NVFP4 (default)**, sampled at half size and doubled by its latent upscaler | 247 s (measured 2026-10-17, 1088x1920, 121 frames) |
| 5 s clip, 720p, from a first frame | LTX-2.5 Fast NVFP4 | 90-160 s |
| 120 fps master from a 24 fps clip | RIFE 4.26 (ComfyUI FrameInterpolate, x5) | 49 s per 1080p clip |
| 5 s clip, 720p, from a first frame | Wan2.2 I2V A14B fp8 + 4-step LoRAs | 353 s |
| 5 s clip, 720p | Wan2.2 TI2V-5B (also text-to-video) | 365 s |

Sizes above the native budget (1328x1328 pixels in total) are generated natively and upscaled.

## Prompting the local models

- **Never ask the image model for captions or slogans.** Titles are typeset in post. Measured failures: a caption painted twice, the style token "50mm" painted as text, the rare character "泠" drawn as "冷". The only lettering in a frame is the product label, and it comes from the hero still.
- Keep numbers and lens specs out of image prompts for the same reason.
- With references, say what each one is: "Image 1 is the product". At most three; product first.
- The 14B video model wants one camera move and one action, described plainly. For product-only shots end the prompt with "No people and no hands enter the frame" - otherwise it tends to add a hand reaching for the product. It produces no audio.

## When something fails

- `ComfyUI rejected the workflow` or a missing model file: run `cinefoundry doctor`. It compares every workflow template with the running ComfyUI and lists unknown nodes and missing weights.
- Connection refused: ComfyUI is not up. See `deploy/spark/`.
- Allocation failures in the GPU driver log, or heavy swapping: more than one diffusion family is resident. Run `cinefoundry mem free`, then follow `spark-model-scheduler`.

Model files and graphs behind each route: `references/workflows.md`.
