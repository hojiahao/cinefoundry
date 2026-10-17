#!/usr/bin/env python3
"""Check synthesized speech against the words it should say: Whisper transcribes each clip and the character error
rate (CER) against the script is reported. Used to pick the cleanest take when a voice is designed, and to send a
voiceover line back for another take when the voice model dropped, added or mispronounced characters.

Runs inside the cinefoundry/qwen-tts container (transformers' Whisper pipeline):

    python3 /repo/scripts/asr-score.py --model /asr/whisper-large-v3-turbo --jobs /work/jobs/x/asr.json
    # asr.json: [{"path": "/work/...wav", "text": "expected words"}, ...]; prints one JSON line with the results

Punctuation, spaces and letter case are ignored. With pypinyin installed (the cinefoundry/moss-audio image) the
comparison is on toned syllables, so homophones Whisper writes differently (它/他, 的/地) are not counted as errors -
what is checked is what the listener hears. Without it, characters are compared.
"""
import argparse
import json
import re
import unicodedata

import torch
from transformers import pipeline

PUNCT = re.compile(r'[\s\W_]+', re.UNICODE)


try:
    from pypinyin import Style, lazy_pinyin
except ImportError:
    lazy_pinyin = None


def normalise(text: str) -> list:
    clean = PUNCT.sub('', unicodedata.normalize('NFKC', text)).lower()
    return lazy_pinyin(clean, style=Style.TONE3, neutral_tone_with_five=True) if lazy_pinyin else list(clean)


def cer(expected: str, heard: str) -> float:
    a, b = normalise(expected), normalise(heard)
    if not a:
        return 0.0 if not b else 1.0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return round(previous[-1] / len(a), 4)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--jobs', required=True)
    args = parser.parse_args()
    jobs = json.load(open(args.jobs, encoding='utf8'))
    asr = pipeline('automatic-speech-recognition', model=args.model, torch_dtype=torch.float16, device='cuda:0')
    results = []
    for job in jobs:
        heard = asr(job['path'], generate_kwargs={'language': 'chinese', 'task': 'transcribe'})['text']
        results.append({'path': job['path'], 'text': job['text'], 'heard': heard.strip(), 'cer': cer(job['text'], heard)})
    print(json.dumps({'results': results}, ensure_ascii=False))


if __name__ == '__main__':
    main()
