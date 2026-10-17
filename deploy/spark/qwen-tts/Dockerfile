# Qwen3-TTS (VoiceDesign + Base) for DGX Spark: designs a fictional broadcast voice from a text description.
# Built on the vLLM image already proven on GB10 (its torch has aarch64 CUDA kernels).
ARG BASE_IMAGE=vllm/vllm-openai:v0.27.1
FROM ${BASE_IMAGE}
# pip reads PIP_INDEX_URL from the environment; declared build args are exported to RUN (mainland mirror: https://pypi.tuna.tsinghua.edu.cn/simple).
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg sox && rm -rf /var/lib/apt/lists/*
# --no-deps keeps the base image's torch/transformers; the listed extras are what qwen_tts imports.
RUN pip install --no-cache-dir --no-deps qwen-tts && pip install --no-cache-dir soundfile librosa einops onnxruntime sox "accelerate==1.12.0" "transformers==4.57.3"
WORKDIR /work
ENTRYPOINT ["python3"]
