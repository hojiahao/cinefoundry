#!/usr/bin/env python3
"""Synthesise several voiceover lines with Step-Audio-EditX in one model load.

Runs inside the cinefoundry/step-audio container (scripts/step-audio.sh batch <jobs.json>). The job file:

    {"prompt_audio": "/work/src/ref.wav", "prompt_text": "<what the reference says>",
     "style": "advertising",              # optional Step-Audio style edit applied after cloning
     "lines": [{"text": "...", "output": "/work/jobs/<id>/vo_1.wav"}, ...]}

Every line is cloned from the reference voice; with a style, the clone is then re-voiced in that
style (a second pass through the model, as the upstream CLI does). Outputs are 24 kHz mono WAV.
"""
import argparse
import json
import os
import sys

import torchaudio

sys.path.insert(0, '/app')
from tokenizer import StepAudioTokenizer  # noqa: E402
from tts import StepAudioTTS  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--jobs', required=True)
    parser.add_argument('--model-path', required=True)
    parser.add_argument('--tokenizer-path', required=True)
    parser.add_argument('--model-source', default='local')
    parser.add_argument('--gpu-memory-utilization', type=float, default=0.12)
    parser.add_argument('--max-model-len', type=int, default=3072)
    parser.add_argument('--enforce-eager', action='store_true')
    parser.add_argument('--cosyvoice-dtype', default='bfloat16')
    args, _ = parser.parse_known_args()

    with open(args.jobs, encoding='utf8') as handle:
        jobs = json.load(handle)
    tokenizer = StepAudioTokenizer(args.tokenizer_path, model_source=args.model_source)
    model = StepAudioTTS(args.model_path, tokenizer, model_source=args.model_source, gpu_memory_utilization=args.gpu_memory_utilization,
                         max_model_len=args.max_model_len, enforce_eager=args.enforce_eager, cosyvoice_dtype=args.cosyvoice_dtype)
    style = jobs.get('style') or ''
    results = []
    for line in jobs['lines']:
        os.makedirs(os.path.dirname(line['output']), exist_ok=True)
        audio, rate = model.clone(prompt_wav_path=jobs['prompt_audio'], prompt_text=jobs['prompt_text'], target_text=line['text'])
        if style:
            clone_path = line['output'].replace('.wav', '.clone.wav')
            torchaudio.save(clone_path, audio.cpu(), rate)
            audio, rate = model.edit(prompt_wav_path=clone_path, prompt_text=line['text'], target_text=line['text'], edit_type='style', edit_info=style)
        torchaudio.save(line['output'], audio.cpu(), rate)
        results.append({'output': line['output'], 'seconds': round(audio.shape[-1] / rate, 2)})
        print(f"[Saved] {line['output']}", flush=True)
    print(json.dumps({'results': results, 'style': style or None}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
