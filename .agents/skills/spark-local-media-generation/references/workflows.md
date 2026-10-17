# Workflow catalogue

Templates live in `workflows/` in ComfyUI API format with `{{placeholder}}` inputs; the routes that use them are in
`src/lib/media.ts`. Run `cinefoundry doctor` after any ComfyUI upgrade.

| Template | Used for | Models (ComfyUI folders) | Sampling |
|---|---|---|---|
| `qwen_image_lightning` | text -> frame | `diffusion_models/qwen_image_fp8_e4m3fn`, `text_encoders/qwen_2.5_vl_7b_fp8_scaled`, `vae/qwen_image_vae`, `loras/Qwen-Image-Lightning-8steps-V1.0` | 8 steps, cfg 1, euler/simple, shift 3.1 |
| `qwen_image_edit_lightning` | 1-3 references -> frame | `qwen_image_edit_2509_fp8_e4m3fn` + `Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16` | 8 steps, cfg 1 |
| `ltx25_fast_i2v` | first frame + text -> 5 s clip at 24 fps, 121 frames (8n+1) - the default route | `{{unet_name}}`: `ltx-2.5-22b-distilled-transformer-nvfp4` (`ltx25-fast-nvfp4`, default) or `-comfy-int8-convrot` (`ltx25-fast`); text encoder `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot`; `ltx-2.5-video-vae-bf16`, `ltx-2.5-audio-vae-bf16`; `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0` | distilled, manual sigmas; sampled at half size, latent upscaled x2 |
| `ltx25_fast_lipsync` | first frame + dialogue audio -> lip-synced 5 s clip (narrative formats) | same as `ltx25_fast_i2v`; the audio latent is encoded from the line and held fixed | euler_ancestral |
| `rife_interpolate` | 24 fps clip -> about 120 fps master | RIFE 4.26 (`{{model}}`) via `FrameInterpolationModelLoader` / `FrameInterpolate` | x5 for 24 fps, x8 for 16 fps |
| `wan22_i2v_14b_4step` | first frame + text -> 5 s clip at 16 fps | `wan2.2_i2v_high_noise_14B_fp8_scaled` + `wan2.2_i2v_low_noise_14B_fp8_scaled`, 4-step lightx2v LoRAs, `umt5_xxl_fp8_e4m3fn_scaled`, `wan_2.1_vae` | 4 steps, euler |
| `wan22_ti2v_5b_t2v` | text -> 5 s clip | `wan2.2_ti2v_5B_fp16`, `umt5_xxl_fp8_e4m3fn_scaled`, `wan2.2_vae` | 20 steps, cfg 5, uni_pc, shift 8 |
| `wan22_ti2v_5b_i2v` | first frame + text -> 5 s clip | same | same |
| `ace_step_instrumental` | the score: tags + length -> instrumental bed | `ace_step_v1_3.5b` | 50 steps, euler |

Raise steps or native resolution only after measuring the time and memory it costs on this machine.
