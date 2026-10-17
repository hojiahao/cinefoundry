#!/usr/bin/env python3
"""Design fictional narrator voices with Qwen3-TTS VoiceDesign, inside the spotfoundry/qwen-tts container.

Each voice is generated from a written description: it is nobody's recording. The resulting clip is
the reference that Step-Audio-EditX clones for every voiceover line, so a whole film keeps one voice.

    python3 /repo/scripts/voice-design.py --model /models/Qwen3-TTS-12Hz-1.7B-VoiceDesign --out /work/voices
"""
import argparse
import json
import os

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

REFERENCE_TEXT = '清晨的第一缕阳光，落在桌面上。好的产品，不需要大声说话，它会安静地陪你，度过每一个认真生活的日子。'

VOICES = {
    'male': '中年男性，声音低沉饱满，普通话标准，语速平稳，自信从容，像电视广告的旁白配音。',
    'female': '成年女性，声音清亮温润，普通话标准，语速平稳，大方亲切，像电视广告的旁白配音。',
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--takes', type=int, default=3, help='candidates per voice; the reference is chosen by ear')
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    model = Qwen3TTSModel.from_pretrained(args.model, device_map='cuda:0', dtype=torch.bfloat16)
    index = {}
    for name, description in VOICES.items():
        for take in range(1, args.takes + 1):
            torch.manual_seed(1000 * take + len(name))
            wavs, rate = model.generate_voice_design(text=REFERENCE_TEXT, instruct=description, language='Chinese')
            path = os.path.join(args.out, f'{name}-{take}.wav')
            sf.write(path, wavs[0], rate)
            index[f'{name}-{take}'] = {'path': path, 'description': description, 'text': REFERENCE_TEXT, 'seconds': round(len(wavs[0]) / rate, 2)}
            print(f'[Saved] {path} {index[f"{name}-{take}"]["seconds"]} s', flush=True)
    with open(os.path.join(args.out, 'voices.json'), 'w', encoding='utf8') as handle:
        json.dump(index, handle, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
