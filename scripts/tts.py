#!/usr/bin/env python3
"""Offline Mandarin voiceover with Kokoro-82M-v1.1-zh. One line in, one WAV out.

    python scripts/tts.py --text "第一口下去，冰凉满口" --out vo_1.wav [--voice zf_001] [--speed 1.0]

The model directory is a local download of hexgrad/Kokoro-82M-v1.1-zh (scripts/download-models.sh).
"""

import argparse
import os
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from kokoro import KModel, KPipeline

REPO = "hexgrad/Kokoro-82M-v1.1-zh"
SAMPLE_RATE = 24000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--text", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--voice", default="zf_001")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--model-dir", default=os.environ.get("CINEFOUNDRY_TTS_MODEL", os.path.join(os.environ.get("SPARK_MODEL_DIR", os.path.expanduser("~/models")), "tts/Kokoro-82M-v1.1-zh")))
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    model = KModel(repo_id=REPO, config=str(model_dir / "config.json"), model=str(model_dir / "kokoro-v1_1-zh.pth")).eval()
    pipeline = KPipeline(lang_code="z", repo_id=REPO, model=model)
    voice = torch.load(model_dir / "voices" / f"{args.voice}.pt", weights_only=True)

    chunks = [result.audio.numpy() for result in pipeline(args.text, voice=voice, speed=args.speed) if result.audio is not None]
    if not chunks:
        raise SystemExit("TTS produced no audio")
    audio = np.concatenate(chunks)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    sf.write(args.out, audio, SAMPLE_RATE)
    print(f"{len(audio) / SAMPLE_RATE:.3f}")


if __name__ == "__main__":
    main()
