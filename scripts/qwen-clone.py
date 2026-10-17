#!/usr/bin/env python3
"""Voice every line of a job file with Qwen3-TTS Base, cloning one reference clip (inside cinefoundry/qwen-tts).

Job file (same shape as scripts/step-audio-batch.py):
    {"prompt_audio": "/work/voices/male-2.wav", "prompt_text": "...", "lines": [{"text": "...", "output": "/work/jobs/x/vo_1.wav"}]}
The reference is encoded once and reused, so every line has the same voice.
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
    args = parser.parse_args()
    with open(args.jobs, encoding='utf8') as handle:
        jobs = json.load(handle)
    model = Qwen3TTSModel.from_pretrained(args.model, device_map='cuda:0', dtype=torch.bfloat16)
    prompt = model.create_voice_clone_prompt(ref_audio=jobs['prompt_audio'], ref_text=jobs['prompt_text'])
    results = []
    for line in jobs['lines']:
        os.makedirs(os.path.dirname(line['output']), exist_ok=True)
        torch.manual_seed(7)
        wavs, rate = model.generate_voice_clone(text=line['text'], language='Chinese', voice_clone_prompt=prompt)
        sf.write(line['output'], wavs[0], rate)
        results.append({'output': line['output'], 'seconds': round(len(wavs[0]) / rate, 2)})
        print(f"[Saved] {line['output']}", flush=True)
    print(json.dumps({'results': results}, ensure_ascii=False))


if __name__ == '__main__':
    main()
