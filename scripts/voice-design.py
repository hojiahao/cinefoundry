#!/usr/bin/env python3
"""Design fictional narrator voices with Qwen3-TTS VoiceDesign, inside the spotfoundry/qwen-tts container.

Each voice is generated from a written description: it is nobody's recording. The resulting clip is
the reference that the voice engine clones for every voiceover line, so a whole film keeps one voice.

    python3 /repo/scripts/voice-design.py --model /models/Qwen3-TTS-12Hz-1.7B-VoiceDesign --out /work/voices
"""
import argparse
import json
import os

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

LIBRARY = os.environ.get('SPOTFOUNDRY_VOICE_LIBRARY', '/repo/deploy/voices.json')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--out', required=True, help='directory for the candidate takes')
    parser.add_argument('--takes', type=int, default=4, help='candidates per voice; scripts/asr-score.py picks the cleanest')
    parser.add_argument('--only', nargs='*', help='voice ids to design (default: the whole library)')
    args = parser.parse_args()
    library = json.load(open(LIBRARY, encoding='utf8'))
    text = library['referenceText']
    os.makedirs(args.out, exist_ok=True)
    model = Qwen3TTSModel.from_pretrained(args.model, device_map='cuda:0', dtype=torch.bfloat16)
    index = {}
    for voice in library['voices']:
        if args.only and voice['id'] not in args.only:
            continue
        for take in range(1, args.takes + 1):
            torch.manual_seed(1000 * take + len(voice['id']))
            wavs, rate = model.generate_voice_design(text=text, instruct=voice['design'], language='Chinese')
            path = os.path.join(args.out, f"{voice['id']}-take{take}.wav")
            sf.write(path, wavs[0], rate)
            index[f"{voice['id']}-take{take}"] = {'voice': voice['id'], 'path': path, 'text': text, 'seconds': round(len(wavs[0]) / rate, 2)}
            print(f'[Saved] {path} {index[f"{voice['id']}-take{take}"]["seconds"]} s', flush=True)
    with open(os.path.join(args.out, 'candidates.json'), 'w', encoding='utf8') as handle:
        json.dump(index, handle, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
