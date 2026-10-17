import type { Feature, Layout } from './manifest.js'

/**
 * What the manifest is built from: one line per upstream file or repository, maintained by hand. `cinefoundry setup
 * manifest --refresh` resolves each line against the Hugging Face API (current revision, every file's lfs.oid or git
 * blob id, its size, the repo's license) and writes deploy/models.json. Paths and folders mirror what the code loads:
 * workflows/*.json and src/lib/media.ts (ComfyUI folders), deploy/spark/compose.yaml (vLLM, hf-cache), src/lib/speech.ts
 * and scripts/voice-*.py (TTS, ASR and sound-effect directories under the model root).
 */
export interface HfFileSource {
  kind: 'hf-file'
  repo: string
  /** Commit to pin instead of the current main. */
  revision?: string
  path: string
  /** ComfyUI model folder (under `comfyui/`) or directory under the model root. */
  target: string
  features: Feature[]
  license: string
}
export interface HfRepoSource {
  kind: 'hf-repo'
  repo: string
  /** Commit to pin instead of the current main. */
  revision?: string
  layout: Layout
  /** For `file`: the directory the repo is mirrored into. For `hf-cache` it is derived from the repo id. */
  target?: string
  features: Feature[]
  license: string
  /** Repo paths to leave out (exact or prefix ending in `/`); `.gitattributes` is repository metadata and always left out. */
  exclude?: string[]
  /** Only these repo paths (when the code reads a handful of files from a larger repo). */
  only?: string[]
}
export interface UrlFileSource {
  kind: 'url'
  url: string
  filename: string
  target: string
  features: Feature[]
  license: string
  size: number
  sha256: string
}
export type Source = HfFileSource | HfRepoSource | UrlFileSource

/** Gated repositories: the download needs an account that accepted the terms, and a token. */
export const GATED: Record<string, { url: string; note: string }> = {
  'Lightricks/LTX-2.5': {
    url: 'https://huggingface.co/Lightricks/LTX-2.5',
    note: 'Sign in, open the URL and accept the LTX-2 Community License; then create a read token at https://huggingface.co/settings/tokens and export HF_TOKEN=<token> (or run `hf auth login`).',
  },
}

/**
 * SHA-256 of gated files as hashed from the copies the production runs used (2026-10-17). The Hub hides lfs.oid of a
 * gated repo from anonymous requests; with a token the refresh and the installer check the API value against these.
 */
export const MEASURED_SHA256: Record<string, string> = {
  'Lightricks/LTX-2.5/diffusion_models/ltx-2.5-22b-distilled-transformer-nvfp4.safetensors': '4b94231e734c1950f8f6826cb8bd8715d94be5b3e04f8256ee060c5bc3886c30',
  'Lightricks/LTX-2.5/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors': 'c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334',
  'Lightricks/LTX-2.5/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors': '6ce688a0aa98a5fa36a9f1e6c3f42152a498cc2b53ee8c15674c64244f91487f',
  'Lightricks/LTX-2.5/vae/ltx-2.5-video-vae-bf16.safetensors': '847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3',
  'Lightricks/LTX-2.5/vae/ltx-2.5-audio-vae-bf16.safetensors': 'c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5',
  'Lightricks/LTX-2.5/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors': 'eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8',
}

const comfy = (repo: string, path: string, folder: string, features: Feature | Feature[], license: string): HfFileSource => ({ kind: 'hf-file', repo, path, target: `comfyui/${folder}`, features: Array.isArray(features) ? features : [features], license })
const APACHE = 'Apache-2.0'
const LTX = 'LTX-2 Community License (gated; commercial use above the revenue threshold needs a license from Lightricks)'
const NVIDIA = 'NVIDIA Open Model License'

export const SOURCES: Source[] = [
  // Language models, served by vLLM from the shared Hugging Face cache (deploy/spark/compose.yaml).
  { kind: 'hf-repo', repo: 'nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4', layout: 'hf-cache', features: ['core'], license: NVIDIA },
  // Pinned to the drafter revision the reference Spark serves (main has since replaced model.safetensors).
  { kind: 'hf-repo', repo: 'nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark', revision: '8a0177116d138011e63103110f136ec0ca09ebbf', layout: 'hf-cache', features: ['core'], license: NVIDIA },
  { kind: 'hf-repo', repo: 'stepfun-ai/Step3-VL-10B-FP8', layout: 'hf-cache', features: ['core'], license: APACHE },

  // Image: shared text encoder and VAE.
  comfy('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors', 'text_encoders', 'core', APACHE),
  comfy('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/vae/qwen_image_vae.safetensors', 'vae', 'core', APACHE),
  // Ad film: Qwen-Image Lightning for the hero and layouts, Qwen-Image-Edit-2509 Lightning for frames from the hero.
  comfy('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors', 'diffusion_models', 'ad', APACHE),
  comfy('lightx2v/Qwen-Image-Lightning', 'Qwen-Image-Lightning-8steps-V1.0.safetensors', 'loras', 'ad', APACHE),
  comfy('Comfy-Org/Qwen-Image-Edit_ComfyUI', 'split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors', 'diffusion_models', 'ad', APACHE),
  comfy('lightx2v/Qwen-Image-Lightning', 'Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors', 'loras', 'ad', APACHE),
  // Narrative formats: Qwen-Image-2512 casts people, Qwen-Image-Edit-2511 holds identity across frames.
  comfy('Comfy-Org/Qwen-Image_ComfyUI', 'split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors', 'diffusion_models', 'narrative', APACHE),
  comfy('Comfy-Org/Qwen-Image-Edit_ComfyUI', 'split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors', 'diffusion_models', 'narrative', APACHE),
  comfy('lightx2v/Qwen-Image-Edit-2511-Lightning', 'Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors', 'loras', 'narrative', APACHE),

  // Video: LTX-2.5 Fast (default ltx25-fast-nvfp4), with lip-sync against a dialogue track.
  comfy('Lightricks/LTX-2.5', 'diffusion_models/ltx-2.5-22b-distilled-transformer-nvfp4.safetensors', 'diffusion_models', 'core', LTX),
  comfy('Lightricks/LTX-2.5', 'text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors', 'text_encoders', 'core', LTX),
  comfy('Lightricks/LTX-2.5', 'vae/ltx-2.5-video-vae-bf16.safetensors', 'vae', 'core', LTX),
  comfy('Lightricks/LTX-2.5', 'vae/ltx-2.5-audio-vae-bf16.safetensors', 'vae', 'core', LTX),
  comfy('Lightricks/LTX-2.5', 'latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors', 'latent_upscale_models', 'core', LTX),
  comfy('Lightricks/LTX-2.5', 'diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors', 'diffusion_models', 'ltx-int8', LTX),
  // Frame interpolation to the 60 fps master: RIFE 4.26 as packaged by ComfyUI-Frame-Interpolation (release digest).
  {
    kind: 'url', url: 'https://github.com/Fannovel16/ComfyUI-Frame-Interpolation/releases/download/models/rife426.pth', filename: 'rife426.pth',
    target: 'comfyui/frame_interpolation', features: ['core'], license: 'MIT (hzwer/Practical-RIFE)', size: 24620531,
    sha256: '606421fe2148a9fdeca14e58d94dc339e87b87e0ebcc5dec84a50d6f488cfe7b',
  },
  // Music bed.
  comfy('Comfy-Org/ACE-Step_ComfyUI_repackaged', 'all_in_one/ace_step_v1_3.5b.safetensors', 'checkpoints', 'core', APACHE),

  // Alternative video models.
  comfy('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', 'diffusion_models', 'wan22-14b', APACHE),
  comfy('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', 'diffusion_models', 'wan22-14b', APACHE),
  comfy('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors', 'loras', 'wan22-14b', APACHE),
  comfy('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors', 'loras', 'wan22-14b', APACHE),
  comfy('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/vae/wan_2.1_vae.safetensors', 'vae', 'wan22-14b', APACHE),
  comfy('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'text_encoders', ['wan22-14b', 'wan22-5b'], APACHE),
  comfy('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors', 'diffusion_models', 'wan22-5b', APACHE),
  comfy('Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'split_files/vae/wan2.2_vae.safetensors', 'vae', 'wan22-5b', APACHE),

  // Voices (src/lib/speech.ts): Qwen3-TTS designs and clones, Whisper checks what the listener hears.
  { kind: 'hf-repo', repo: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', layout: 'file', target: 'tts/Qwen3-TTS-12Hz-1.7B-VoiceDesign', features: ['core'], license: APACHE },
  { kind: 'hf-repo', repo: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', layout: 'file', target: 'tts/Qwen3-TTS-12Hz-1.7B-Base', features: ['core'], license: APACHE },
  { kind: 'hf-repo', repo: 'openai/whisper-large-v3-turbo', layout: 'file', target: 'asr/whisper-large-v3-turbo', features: ['core'], license: 'MIT' },
  // Sound effects and ambience for the narrative formats.
  { kind: 'hf-repo', repo: 'OpenMOSS-Team/MOSS-SoundEffect-v2.0', layout: 'file', target: 'audio/MOSS-SoundEffect-v2.0', features: ['narrative'], license: APACHE },
  // Mandarin narrator (scripts/tts.py reads these four files).
  { kind: 'hf-repo', repo: 'hexgrad/Kokoro-82M-v1.1-zh', layout: 'file', target: 'tts/Kokoro-82M-v1.1-zh', features: ['kokoro'], license: APACHE, only: ['config.json', 'kokoro-v1_1-zh.pth', 'voices/zf_001.pt', 'voices/zm_010.pt'] },

  // Opt-in flagship planner and reviewer (compose profile `super`), mounted from nemotron-super-vl/.
  { kind: 'hf-repo', repo: 'nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4', layout: 'file', target: 'nemotron-super-vl/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4', features: ['super-vl'], license: NVIDIA },
  { kind: 'hf-repo', repo: 'nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4-LiLiCorr', layout: 'file', target: 'nemotron-super-vl/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4-LiLiCorr', features: ['super-vl'], license: NVIDIA },
]
