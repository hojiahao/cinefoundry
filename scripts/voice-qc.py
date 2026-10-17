#!/usr/bin/env python3
"""Choose each casting-library voice's reference clip from its designed takes (inside cinefoundry/moss-audio).

Every take is measured three ways and must pass all of them:
  - pronunciation: Whisper transcribes it; error rate against the reference text (English by word, Chinese by
    toned pinyin syllable) at most --max-error;
  - pitch: the median fundamental frequency of the voiced frames lies in the library's range for the voice's gender,
    so a voice written as a deep male narrator cannot come out as a tenor or a woman;
  - level: no clipping (peak below -0.3 dBFS) and enough signal (RMS above -40 dBFS).
Among the takes that pass, the one with the lowest error wins; ties go to the take whose length is closest to the
median of that voice's takes (a natural pace, neither rushed nor dragged). The winner is copied to <voices>/<id>.wav
and every measurement is written to <voices>/qc.json.

    python3 /repo/scripts/voice-qc.py --asr /asr/whisper-large-v3-turbo --candidates /work/voices/candidates --voices /work/voices
"""
import argparse
import json
import os
import shutil
import statistics
import sys

import numpy as np
import soundfile as sf
import torch
from transformers import pipeline

sys.path.insert(0, os.path.dirname(__file__))
from importlib import import_module  # noqa: E402

asr_score = import_module('asr-score')
LIBRARY = os.environ.get('CINEFOUNDRY_VOICE_LIBRARY', '/repo/deploy/voices/library.json')


def median_pitch(audio: np.ndarray, rate: int) -> float:
    """Median F0 of voiced frames by autocorrelation (60-400 Hz): enough to tell a bass from a tenor from a soprano."""
    frame, hop = int(0.04 * rate), int(0.01 * rate)
    energies = [float(np.sqrt(np.mean(audio[i:i + frame] ** 2))) for i in range(0, len(audio) - frame, hop)]
    if not energies:
        return 0.0
    gate = max(energies) * 0.2
    lo, hi = int(rate / 400), int(rate / 60)
    pitches = []
    for n, i in enumerate(range(0, len(audio) - frame, hop)):
        if energies[n] < gate:
            continue
        x = audio[i:i + frame] - np.mean(audio[i:i + frame])
        ac = np.correlate(x, x, mode='full')[frame - 1:]
        if ac[0] <= 0:
            continue
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] / ac[0] > 0.3:
            pitches.append(rate / lag)
    return float(np.median(pitches)) if pitches else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--asr', required=True)
    parser.add_argument('--candidates', required=True)
    parser.add_argument('--voices', required=True)
    parser.add_argument('--max-error', type=float, default=0.05)
    args = parser.parse_args()
    library = json.load(open(LIBRARY, encoding='utf8'))
    voices = {v['id']: v for v in library['voices']}
    takes = json.load(open(os.path.join(args.candidates, 'candidates.json'), encoding='utf8'))
    asr = pipeline('automatic-speech-recognition', model=args.asr, torch_dtype=torch.float16, device='cuda:0')
    report = {}
    by_voice = {}
    for name, take in takes.items():
        path = os.path.join(args.candidates, os.path.basename(take['path']))
        audio, rate = sf.read(path, dtype='float32', always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        voice = voices[take['voice']]
        language = 'chinese' if voice['language'] == 'Chinese' else 'english'
        heard = asr(path, generate_kwargs={'language': language, 'task': 'transcribe'})['text'].strip()
        error = asr_score.cer(take['text'], heard)
        pitch = median_pitch(audio, rate)
        peak = 20 * np.log10(max(1e-9, float(np.max(np.abs(audio)))))
        rms = 20 * np.log10(max(1e-9, float(np.sqrt(np.mean(audio ** 2)))))
        low, high = library['pitchHz'][voice['gender']]
        problems = []
        if error > args.max_error:
            problems.append(f'pronunciation error {error:.2f}')
        if not (low <= pitch <= high):
            problems.append(f'pitch {pitch:.0f} Hz outside {low}-{high} Hz for a {voice["gender"]} voice')
        if peak > -0.3:
            problems.append(f'clipping (peak {peak:.1f} dBFS)')
        if rms < -40:
            problems.append(f'too quiet (RMS {rms:.1f} dBFS)')
        entry = {'path': path, 'heard': heard, 'error': error, 'pitchHz': round(pitch), 'peakDb': round(peak, 1), 'rmsDb': round(rms, 1), 'seconds': take['seconds'], 'problems': problems}
        report[name] = entry
        by_voice.setdefault(take['voice'], []).append(entry)
        print(f"[QC] {name} error={error:.2f} pitch={pitch:.0f}Hz {'PASS' if not problems else '; '.join(problems)}", flush=True)
    chosen = {}
    for voice_id, entries in by_voice.items():
        median = statistics.median(e['seconds'] for e in entries)
        passing = [e for e in entries if not e['problems']]
        if not passing:
            chosen[voice_id] = None
            print(f'[FAIL] {voice_id}: no take passed', flush=True)
            continue
        best = min(passing, key=lambda e: (e['error'], abs(e['seconds'] - median)))
        shutil.copy(best['path'], os.path.join(args.voices, f'{voice_id}.wav'))
        chosen[voice_id] = os.path.basename(best['path'])
    with open(os.path.join(args.voices, 'qc.json'), 'w', encoding='utf8') as handle:
        json.dump({'chosen': chosen, 'takes': report}, handle, ensure_ascii=False, indent=2)
    print(json.dumps({'chosen': sum(1 for c in chosen.values() if c), 'failed': [k for k, c in chosen.items() if not c]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
