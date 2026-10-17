#!/usr/bin/env python3
"""Turn raw Studio screenshots into 1920x1080 frames for the demo reel.

Headless screen captures fire before the large PNG thumbnails finish loading, so the asset grid in
them is black. The top of each capture (run log, stage chips) is right; this keeps that part and
draws, underneath, the project's real hero still and shot frames, each shown from the moment its
file was written. Timing comes from file modification times, nothing is invented.

    python3 scripts/compose-recording.py --rec ~/cinefoundry-demo/studio-rec --project projects/summer-cool-soda
"""
import argparse
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
BG = (14, 15, 19)
CROP_HEIGHT = 570  # in capture pixels (1440 wide): header, brief box, run log, project title and stage chips


def font(size):
    return ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', size, index=2)


def assets(project: Path):
    """(time written, label, path) for the hero still and every shot candidate, in order."""
    items = []
    hero = project / 'refs/product.png'
    if hero.exists():
        items.append((hero.stat().st_mtime, '定妆图', hero))
    for path in sorted((project / 'frames').glob('shot_*.png')):
        stem = path.stem  # shot_003_c2
        parts = stem.split('_')
        label = f'镜头 {int(parts[1])}' + (f' · {parts[2]}' if len(parts) > 2 else '')
        items.append((path.stat().st_mtime, label, path))
    return sorted(items)


def compose(capture: Path, when: float, items, out: Path, thumbs: dict):
    """Left: the Studio (log and stage chips). Right: the newest image the pipeline has written so far."""
    canvas = Image.new('RGB', (W, H), BG)
    shot = Image.open(capture).convert('RGB')
    top = shot.crop((40, 0, shot.width - 40, min(CROP_HEIGHT, shot.height)))
    left_w = 1330
    top = top.resize((left_w, int(top.height * left_w / top.width)), Image.LANCZOS)
    canvas.paste(top, (20, (H - top.height) // 2))
    visible = [(label, path) for written, label, path in items if written <= when]
    draw = ImageDraw.Draw(canvas)
    x0, panel_w = left_w + 50, W - left_w - 70
    if visible:
        label, path = visible[-1]
        key = (path, 'big')
        if key not in thumbs:
            image = Image.open(path).convert('RGB')
            image.thumbnail((panel_w, 820), Image.LANCZOS)
            thumbs[key] = image
        image = thumbs[key]
        y = (H - image.height - 60) // 2
        draw.text((x0, y - 44), '最新生成', font=font(26), fill=(217, 178, 106))
        canvas.paste(image, (x0 + (panel_w - image.width) // 2, y))
        draw.text((x0, y + image.height + 12), f'{label}（共 {len(visible)} 张）', font=font(26), fill=(233, 231, 225))
    canvas.save(out, quality=90)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rec', required=True)
    parser.add_argument('--project', required=True)
    args = parser.parse_args()
    rec, project = Path(os.path.expanduser(args.rec)), Path(args.project)
    items = assets(project)
    thumbs = {}
    for name in ('typing', 'run'):
        source = rec / name
        target = rec / f'{name}-composed'
        target.mkdir(exist_ok=True)
        for old in target.glob('*.jpg'):
            old.unlink()
        for capture in sorted(source.glob('*.png')):
            when = capture.stat().st_mtime if name == 'run' else 0
            compose(capture, when, items, target / f'{capture.stem}.jpg', thumbs)
        print(name, len(list(target.glob('*.jpg'))))


if __name__ == '__main__':
    main()
