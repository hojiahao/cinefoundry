#!/usr/bin/env python3
"""Sound effects and ambience with MOSS-SoundEffect v2 (Apache-2.0), 48 kHz, inside cinefoundry/moss-audio.

The model is loaded once for the whole film; each job is one prompt and a length (up to 30 s).

    python3 /repo/scripts/sfx.py --model /moss --jobs /work/jobs/x/sfx.json
    # sfx.json: [{"prompt": "English description", "seconds": 5, "output": "/work/jobs/x/sfx_1.wav", "seed": 1}]
"""
import argparse
import json
import os

import torch
from moss_soundeffect_v2 import MossSoundEffectPipeline


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--jobs', required=True)
    parser.add_argument('--steps', type=int, default=100)
    args = parser.parse_args()
    jobs = json.load(open(args.jobs, encoding='utf8'))
    pipe = MossSoundEffectPipeline.from_pretrained(args.model, torch_dtype=torch.bfloat16, device='cuda')
    results = []
    for job in jobs:
        os.makedirs(os.path.dirname(job['output']), exist_ok=True)
        torch.manual_seed(int(job.get('seed', 1)))
        audio = pipe(prompt=job['prompt'], seconds=min(30.0, float(job['seconds'])), num_inference_steps=args.steps, cfg_scale=4.0)
        pipe.save_audio(audio, job['output'])
        results.append({'output': job['output']})
        print(f"[Saved] {job['output']}", flush=True)
    print(json.dumps({'results': results}, ensure_ascii=False))


if __name__ == '__main__':
    main()
