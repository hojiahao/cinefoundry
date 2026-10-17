---
name: spark-local-media-generation
version: "0.3.0"
description: Generate a product hero still, storyboard frames anchored to it, and native-1080p video clips on the local DGX Spark with the cinefoundry CLI (ComfyUI running Qwen-Image, Qwen-Image-Edit, LTX-2.5 Fast NVFP4 by default or Wan2.2, and RIFE interpolation to the delivery frame rate) instead of a cloud API. Use when product shots, storyboard frames or shot clips must be produced, when material is confidential or unreleased, or when choosing between local and cloud generation.
license: BUSL-1.1
metadata:
  author: 贺家豪 (Jiahao He)
  category: picture
  tags:
    - dgx-spark
    - comfyui
    - qwen-image
    - ltx-2.5
    - rife
---

# Spark local media generation

Hero still first, frames second, clips last, interpolation after. Each step is anchored to the one before it, so product identity is decided where a retry costs seconds, not minutes. The default film is a 30-second master: six storyboard shots, so six frames and six 5-second clips, generated at native 1080p and interpolated to 60 fps.

## Before every GPU phase

1. Check memory with `spark-model-scheduler`. One diffusion family resident at a time; `cinefoundry mem free` when switching between them. The harness does this at every phase boundary (`enterPhase`) and puts the language models to sleep for frames and clips.
2. **Evict the page cache of the model files.** On DGX Spark CUDA can only allocate memory that is truly free (`MemFree`), not what Linux counts as available: `MemAvailable` includes the page cache, and every model file just read from NVMe - tens of GB of safetensors - sits there looking reclaimable. With a warm cache a video model load can fail, or sample with far less room than `cinefoundry mem status` suggests. Compare the two, and drop the cache when the gap is large:

   ```bash
   grep -E '^(MemFree|MemAvailable|Cached):' /proc/meminfo
   sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'
   ```

   Do it after `cinefoundry mem free` and before the video phase above all: LTX-2.5 at native 1080p is the largest allocation of the film.

## Workflow

1. Generate the **product hero still** from the storyboard's `product` description on a plain backdrop, and gate it:

   ```bash
   cinefoundry image --out projects/<id>/refs/product.png --size 1328x1328 --prompt "Studio product photograph of <product> ..."
   cinefoundry qa --frame projects/<id>/refs/product.png --expect "one product, fully visible, label reads \"<brand>\" clearly"
   ```

   If the user supplied a photo of the real product (`--product-image`), it is the hero: skip this step.
2. Generate every storyboard frame **from the hero still**. A reference switches the request to the edit model and keeps the product the same product:

   ```bash
   cinefoundry image --project <id> --shot 1 --size 1920x1088 \
     --prompt "<image_prompt>. Image 1 is the product: keep its shape, colours and label exactly as in image 1. No captions, no subtitles, no lettering except the product label. <style>" \
     --ref projects/<id>/refs/product.png
   ```

   Generate two candidates per shot (the harness's `--candidates`, default 2) and let `shot-quality-gate` pick: the spread between seeds is often larger than what a prompt edit buys.
3. Only gated frames move on. Generate each clip from its approved frame, one per shot:

   ```bash
   cinefoundry video --project <id> --shot 1 --model ltx25-fast-nvfp4 --duration 5 --ratio 16:9 --resolution 1080p \
     --prompt "<video_prompt>" --first-frame projects/<id>/frames/shot_001.png --keep-loaded
   ```

   Drop `--keep-loaded` on the last clip so the video model is released. Always pass `--ratio`: the standalone command defaults to 9:16.
4. Above 24 fps the harness interpolates every clip with RIFE 4.26 to a master of about 120 fps (24 fps x5; Wan2.2 14B's 16 fps x8) once the video model is freed, and the cut conforms it to the delivery rate by dropping frames evenly - so 60 fps lands exactly on the generated motion.
5. Every command prints measured `seconds` and records the asset with `execution: local-dgx-spark`. Keep these numbers for the delivery report; never replace them with an estimate.
6. Clips are saved near-lossless (H.264 crf 12 through ComfyUI's `format.codec.encoding.crf`). Never re-encode an intermediate at a lower quality - every generation of compression shows in the final grade.

## What the models do, measured on this machine

| Step | Model | Measured |
|---|---|---|
| Frame, no reference, 1920x1088 | Qwen-Image + 8-step LoRA (generated natively at about 1.76 MP, upscaled) | 22.7 s warm, 45.8 s cold |
| Frame from the hero still | Qwen-Image-Edit-2509 + 8-step LoRA | about 77 s |
| 5 s clip, native 1080p, from a first frame | **LTX-2.5 Fast 22B NVFP4 (default, `ltx25-fast-nvfp4`)**, sampled at half size and doubled by its latent upscaler | 247 s (2026-10-17, 1088x1920, 121 frames) |
| 5 s clip, 720p, from a first frame | LTX-2.5 Fast NVFP4 | 90-160 s |
| 120 fps master from a 24 fps clip | RIFE 4.26 (ComfyUI `FrameInterpolate`, x5) | 49 s per 1080p clip |
| 5 s clip, 720p, from a first frame | Wan2.2 I2V A14B fp8 + 4-step LoRAs (`wan22-14b`, 16 fps) | 353 s |
| 5 s clip, 720p | Wan2.2 TI2V-5B (`wan22-5b`, also text-to-video) | 365 s |

Native 1080p is the generation ceiling: `2k`, `4k` and `6k` deliveries are generated at 1080p and upscaled in the cut, and the delivery report says so. LTX-2.5 samples at half size and its latent upscaler doubles it, so 1080p frames are 1920x1088 (both halves divisible by 32). The total time of a film comes from its run log, not from multiplying this table.

## Prompting the local models

- **Never ask the image model for captions or slogans.** Titles and subtitles are typeset in the cut. Measured failures: a caption painted twice, the style token "50mm" painted as text, a rare brand character drawn as a common look-alike. The only lettering in a frame is the product label, and it comes from the hero still.
- Keep numbers and lens specs out of image prompts for the same reason (code strips them from the style line).
- With references, say what each one is: "Image 1 is the product". At most three; product first.
- The video models want one camera move and one action, described plainly. For product-only shots end the prompt with "No people and no hands enter the frame" - otherwise they tend to add a hand reaching for the product. Code appends the category's motion rules and a cinematic-motion clause to every clip prompt, and the category's negatives to the negative prompt.

## When something fails

- `ComfyUI rejected the workflow` or a missing model file: run `cinefoundry doctor`. It compares every workflow template with the running ComfyUI and lists unknown nodes and missing weights.
- Connection refused: ComfyUI is not up. See `deploy/spark/`.
- CUDA out of memory, allocation failures in the GPU driver log, or heavy swapping: more than one diffusion family is resident, or the page cache is holding the memory CUDA needs. `cinefoundry mem free`, drop the page cache, then follow `spark-model-scheduler`.

Model files and graphs behind each route: `references/workflows.md`.
