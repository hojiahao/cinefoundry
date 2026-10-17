#!/usr/bin/env bash
# Run Step-Audio-EditX (StepFun) inference in the local container. Arguments are passed to tts_infer.py,
# or to scripts/step-audio-batch.py after the word `batch`.
#   scripts/step-audio.sh --prompt-audio /work/ref.wav --prompt-text "..." --generated-text "..." --edit-type clone --output-dir /work/out
# Paths given to the model must be inside /work (= runtime-data/step-audio) or /app/examples.
set -euo pipefail
cd "$(dirname "$0")/.."
HF="${SPARK_MODEL_DIR:-$HOME/models}/hf"
EDITX=/root/.cache/huggingface/hub/models--stepfun-ai--Step-Audio-EditX/snapshots/$(ls $HF/hub/models--stepfun-ai--Step-Audio-EditX/snapshots | head -1)
TOK=/root/.cache/huggingface/hub/models--stepfun-ai--Step-Audio-Tokenizer/snapshots/$(ls $HF/hub/models--stepfun-ai--Step-Audio-Tokenizer/snapshots | head -1)
mkdir -p runtime-data/step-audio
deploy/spark/step-audio/apply-patches.sh
# `scripts/step-audio.sh batch /work/jobs/x.json` synthesises every line of a job file in one model load.
ENTRY=tts_infer.py
if [ "${1:-}" = "batch" ]; then
  shift; cp scripts/step-audio-batch.py runtime-data/step-audio/batch.py; ENTRY=/work/batch.py; set -- --jobs "$@"
fi
docker run --rm --device nvidia.com/gpu=all --ipc=host --network host \
  -v "$PWD/runtime-data/Step-Audio-EditX:/app" \
  -v "$PWD/runtime-data/step-audio:/work" -v "$HF:/root/.cache/huggingface:ro" \
  -e STEP_AUDIO_ATTENTION_BACKEND="${STEP_AUDIO_ATTENTION_BACKEND:-TRITON_ATTN}" -e HF_HUB_OFFLINE=1 -e HF_MODULES_CACHE=/work/.hf_modules -e MODELSCOPE_CACHE=/work/.modelscope -e PYTHONPATH=/app \
  cinefoundry/step-audio:local "$ENTRY" --model-path "$EDITX" --tokenizer-path "$TOK" --model-source local \
  --gpu-memory-utilization "${STEP_AUDIO_GPU_MEM:-0.12}" --max-model-len 3072 --enforce-eager --cosyvoice-dtype bfloat16 "$@"
