#!/usr/bin/env python3
"""Design a voice for each character from a written description (Qwen3-TTS VoiceDesign, inside cinefoundry/qwen-tts).

Nobody's recording is involved: the voice comes from the words. Several takes per character are written; scripts/asr-score.py
then picks the take that says the reference line most cleanly, and that clip is cloned for every line the character speaks.

    python3 /repo/scripts/voice-cast.py --model /models/Qwen3-TTS-12Hz-1.7B-VoiceDesign --jobs /work/jobs/x/cast.json
    # cast.json: [{"id": "mia", "design": "...", "text": "reference line", "language": "English", "out": "/work/voices/x"}]
"""
import argparse
import json
import os

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--jobs', required=True)
    parser.add_argument('--takes', type=int, default=3)
    args = parser.parse_args()
    jobs = json.load(open(args.jobs, encoding='utf8'))
    model = Qwen3TTSModel.from_pretrained(args.model, device_map='cuda:0', dtype=torch.bfloat16)
    results = []
    for job in jobs:
        os.makedirs(job['out'], exist_ok=True)
        for take in range(1, args.takes + 1):
            torch.manual_seed(1000 * take + len(job['id']))
            wavs, rate = model.generate_voice_design(text=job['text'], instruct=job['design'], language=job.get('language', 'English'))
            path = os.path.join(job['out'], f"{job['id']}-take{take}.wav")
            sf.write(path, wavs[0], rate)
            results.append({'id': job['id'], 'path': path, 'text': job['text'], 'seconds': round(len(wavs[0]) / rate, 2)})
            print(f'[Saved] {path}', flush=True)
    print(json.dumps({'results': results}, ensure_ascii=False))


if __name__ == '__main__':
    main()
