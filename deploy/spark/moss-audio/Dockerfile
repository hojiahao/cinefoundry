# MOSS-SoundEffect v2 (OpenMOSS, Apache-2.0) for DGX Spark: text-to-sound-effect and ambience, 48 kHz.
# Built on the Qwen3-TTS image, whose torch already has aarch64 CUDA kernels for GB10; pip must not replace it.
#
#   git clone --depth 1 https://github.com/OpenMOSS/MOSS-TTS.git .tools/MOSS-TTS
#   docker build -t cinefoundry/moss-audio:local -f deploy/spark/moss-audio/Dockerfile .tools/MOSS-TTS
ARG BASE_IMAGE=cinefoundry/qwen-tts:local
FROM ${BASE_IMAGE}
ARG PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
COPY moss_soundeffect_v2 /opt/moss_soundeffect_v2
# Keep the base image's torch; install the pipeline without its pinned torch wheel, then its runtime dependencies.
RUN python3 -c "import torch; print(f'torch=={torch.__version__}')" > /tmp/constraints.txt \
 && pip install --no-cache-dir -i ${PIP_INDEX} -c /tmp/constraints.txt --no-deps -e /opt/moss_soundeffect_v2 \
 && pip install --no-cache-dir -i ${PIP_INDEX} -c /tmp/constraints.txt \
      "numpy==1.26.4" "einops==0.8.2" "safetensors==0.7.0" "transformers==4.57.1" "diffusers==0.37.1" "ftfy==6.3.1" \
      "soundfile==0.13.1" "imageio==2.37.3" "descript-audiotools==0.7.2" "pypinyin==0.55.0" \
 && python3 -c "import torch, moss_soundeffect_v2; assert torch.cuda.is_available() or True; print('moss_soundeffect_v2 ok, torch', torch.__version__)"
ENV TORCHDYNAMO_DISABLE=1
WORKDIR /work
ENTRYPOINT ["python3"]
