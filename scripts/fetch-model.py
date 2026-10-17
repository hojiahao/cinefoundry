#!/usr/bin/env python3
"""Download Hugging Face model repos fast and resumably: aria2c with many connections per file.

Works through a mirror (HF_ENDPOINT, default https://hf-mirror.com for mainland networks) and resumes partial files.
Files already present in the Hugging Face cache are hard-linked instead of downloaded again.

    python3 scripts/fetch-model.py nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4 --out ~/models/nemotron-super-vl
    python3 scripts/fetch-model.py OpenMOSS-Team/MOSS-SoundEffect-v2.0 OpenMOSS-Team/MOSS-TTS --out ~/models/audio

Needs `huggingface_hub` (Python) and `aria2c` (ARIA2C=/path/to/aria2c to override). Each repo lands in <out>/<repo name>/.
"""
import argparse
import os
import shutil
import subprocess
import sys

from huggingface_hub import HfApi


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('repos', nargs='+')
    parser.add_argument('--out', required=True)
    parser.add_argument('--endpoint', default=os.environ.get('HF_ENDPOINT', 'https://hf-mirror.com'))
    parser.add_argument('--connections', type=int, default=16, help='connections per file')
    parser.add_argument('--parallel', type=int, default=8, help='files at once')
    args = parser.parse_args()

    aria2 = os.environ.get('ARIA2C') or shutil.which('aria2c')
    if not aria2:
        sys.exit('aria2c not found: install it or set ARIA2C (a static build: github.com/abcfy2/aria2-static-build)')
    api = HfApi(endpoint=args.endpoint)
    cache = os.path.join(os.environ.get('HF_HOME', os.path.expanduser('~/.cache/huggingface')), 'hub')
    out = os.path.expanduser(args.out)
    entries, total, reused = [], 0, 0
    for repo in args.repos:
        info = api.model_info(repo, files_metadata=True)
        snapshot = os.path.join(cache, f"models--{repo.replace('/', '--')}", 'snapshots', info.sha)
        for sibling in info.siblings:
            dest = os.path.join(out, repo.split('/')[1], sibling.rfilename)
            total += sibling.size or 0
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            cached = os.path.join(snapshot, sibling.rfilename)
            if not os.path.exists(dest) and os.path.exists(cached) and os.path.getsize(os.path.realpath(cached)) == sibling.size:
                os.link(os.path.realpath(cached), dest)
                reused += sibling.size or 0
            if os.path.exists(dest) and os.path.getsize(dest) == sibling.size:
                continue
            entries.append(f'{args.endpoint}/{repo}/resolve/{info.sha}/{sibling.rfilename}\n  dir={os.path.dirname(dest)}\n  out={os.path.basename(dest)}\n')
    print(f'{total / 1e9:.1f} GB in total, {reused / 1e9:.1f} GB reused from the cache, {len(entries)} files to fetch', flush=True)
    if not entries:
        return 0
    listing = os.path.join(out, '.aria2-input.txt')
    with open(listing, 'w') as handle:
        handle.write(''.join(entries))
    return subprocess.run([aria2, '-i', listing, f'-x{args.connections}', f'-s{args.connections}', f'-j{args.parallel}', '-c',
                           '--file-allocation=none', '--retry-wait=3', '--max-tries=0', '--summary-interval=60',
                           '--console-log-level=warn']).returncode


if __name__ == '__main__':
    sys.exit(main())
