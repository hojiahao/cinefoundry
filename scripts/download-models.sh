#!/usr/bin/env bash
# Download every weight the Spark stack needs: ~38 GB LLMs, ~100 GB image/video, ~8 GB music, ~9 GB voice.
# Safe to re-run: finished files are skipped and partial downloads resume.
#   HF_ENDPOINT=https://hf-mirror.com scripts/download-models.sh     # mainland mirror
set -uo pipefail
MODELS="${SPARK_MODEL_DIR:-$HOME/models}"
export HF_HOME="$MODELS/hf" HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"
command -v hf >/dev/null || { echo "Install the Hugging Face CLI first: pip install -U huggingface_hub" >&2; exit 1; }
mkdir -p "$MODELS"/comfyui/{diffusion_models,text_encoders,vae,loras,checkpoints} "$MODELS/tts"

retry() { for _ in 1 2 3 4 5 6 7 8; do "$@" && return 0; sleep 10; done; echo "FAILED: $*" >&2; return 1; }

# LLMs, served by vLLM from the shared Hugging Face cache.
for repo in \
  nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 \
  nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark \
  stepfun-ai/Step3-VL-10B-FP8
do retry hf download "$repo" >/dev/null && echo "done $repo"; done

# fetch <repo> <path in repo> <ComfyUI model folder>
fetch() {
  local target="$MODELS/comfyui/$3/$(basename "$2")"
  [ -s "$target" ] && { echo "have $target"; return 0; }
  retry hf download "$1" "$2" --local-dir "$MODELS/.staging/$1" >/dev/null \
    && mv "$MODELS/.staging/$1/$2" "$target" && echo "done $target"
}
fetch Comfy-Org/Qwen-Image_ComfyUI split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors diffusion_models
fetch Comfy-Org/Qwen-Image_ComfyUI split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors text_encoders
fetch Comfy-Org/Qwen-Image_ComfyUI split_files/vae/qwen_image_vae.safetensors vae
fetch lightx2v/Qwen-Image-Lightning Qwen-Image-Lightning-8steps-V1.0.safetensors loras
fetch Comfy-Org/Qwen-Image-Edit_ComfyUI split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors diffusion_models
fetch lightx2v/Qwen-Image-Lightning Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors loras
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors diffusion_models
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors text_encoders
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/vae/wan2.2_vae.safetensors vae
# Default video model: Wan2.2 I2V A14B (two experts) with the 4-step LoRAs.
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors diffusion_models
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors diffusion_models
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors loras
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors loras
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/vae/wan_2.1_vae.safetensors vae
# Music bed
fetch Comfy-Org/ACE-Step_ComfyUI_repackaged all_in_one/ace_step_v1_3.5b.safetensors checkpoints
rm -rf "$MODELS/.staging"

# Offline Mandarin voiceover. Files are fetched one by one: a whole-repo download of this
# model silently skipped the weight file here.
TTS="$MODELS/tts/Kokoro-82M-v1.1-zh"; mkdir -p "$TTS/voices"
for file in config.json kokoro-v1_1-zh.pth voices/zf_001.pt voices/zm_010.pt; do
  [ -s "$TTS/$file" ] || retry curl -sL --fail -C - -o "$TTS/$file" "$HF_ENDPOINT/hexgrad/Kokoro-82M-v1.1-zh/resolve/main/$file"
done
[ -x runtime-data/tts-venv/bin/python ] || { python3 -m venv runtime-data/tts-venv && runtime-data/tts-venv/bin/pip install -q "kokoro>=0.8" "misaki[zh]" soundfile; }

# Broadcast narrator voices (optional): Qwen3-TTS VoiceDesign designs a voice from a written description,
# Base clones it line by line. Run in the spotfoundry/qwen-tts container (deploy/spark/qwen-tts).
for repo in Qwen3-TTS-12Hz-1.7B-VoiceDesign Qwen3-TTS-12Hz-1.7B-Base; do
  [ -s "$MODELS/tts/$repo/model.safetensors" ] || retry hf download "Qwen/$repo" --local-dir "$MODELS/tts/$repo" >/dev/null && echo "done Qwen/$repo"
done
du -sh "$MODELS/hf" "$MODELS/comfyui" "$MODELS/tts"
