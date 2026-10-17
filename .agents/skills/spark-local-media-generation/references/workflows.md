# Workflow catalogue

Templates live in `workflows/` in ComfyUI API format with `{{placeholder}}` inputs.
Run `spotfoundry doctor` after any ComfyUI upgrade.

| Template | Used for | Models (ComfyUI folders) | Sampling |
|---|---|---|---|
| `qwen_image_lightning` | text -> frame | `diffusion_models/qwen_image_fp8_e4m3fn`, `text_encoders/qwen_2.5_vl_7b_fp8_scaled`, `vae/qwen_image_vae`, `loras/Qwen-Image-Lightning-8steps-V1.0` | 8 steps, cfg 1, euler/simple, shift 3.1 |
| `qwen_image_edit_lightning` | 1-3 references -> frame | `qwen_image_edit_2509_fp8_e4m3fn` + `Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16` | 8 steps, cfg 1 |
| `wan22_ti2v_5b_t2v` | text -> 5 s clip | `wan2.2_ti2v_5B_fp16`, `umt5_xxl_fp8_e4m3fn_scaled`, `wan2.2_vae` | 20 steps, cfg 5, uni_pc, shift 8 |
| `wan22_ti2v_5b_i2v` | first frame + text -> 5 s clip | same | same |

Raise steps or native resolution only after measuring the time it costs on this machine.
