#!/usr/bin/env python3
"""Render the README banner as pure vector shapes.

The lettering is FIGlet's "ANSI Shadow" font: block characters become rectangles and
box-drawing characters become polylines. Caption text is converted to glyph outlines
(Latin in Google Sans Code, CJK in Noto Sans CJK), so the banner looks identical
everywhere instead of depending on the fonts installed on the viewer's machine.

    pip install pyfiglet fonttools
    python scripts/make-banner.py --latin GoogleSansCode[wght].ttf > docs/assets/banner.svg            # English README
    python scripts/make-banner.py --latin GoogleSansCode[wght].ttf --lang zh > docs/assets/banner.zh-CN.svg   # Chinese README

Google Sans Code: https://github.com/google/fonts/tree/main/ofl/googlesanscode (OFL-1.1)
"""

import argparse

import pyfiglet
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTCollection, TTFont
from fontTools.varLib import instancer

CELL_W, CELL_H = 15, 28
PAD_X, TOP = 48, 78
# Which cell edges a box-drawing character connects to its centre.
ARMS = {"═": "lr", "║": "tb", "╔": "rb", "╗": "lb", "╚": "rt", "╝": "lt"}


def load_cjk(path: str) -> TTFont:
    if not path.endswith(".ttc"):
        return TTFont(path)
    faces = TTCollection(path).fonts
    return next((face for face in faces if "SC" in (face["name"].getDebugName(1) or "")), faces[0])


def outline(text: str, x: float, baseline: float, size: float, fonts: list[TTFont], anchor: str = "start") -> str:
    """SVG path data for `text`, taking each character from the first font that has it."""
    runs, cursor = [], 0.0
    for char in text:
        font = next((candidate for candidate in fonts if ord(char) in candidate.getBestCmap()), fonts[0])
        scale = size / font["head"].unitsPerEm
        name = font.getBestCmap().get(ord(char), ".notdef")
        runs.append((font, name, cursor, scale))
        cursor += font["hmtx"][name][0] * scale
    shift = {"start": 0.0, "middle": -cursor / 2, "end": -cursor}[anchor]
    parts = []
    for font, name, offset, scale in runs:
        pen = SVGPathPen(font.getGlyphSet(), ntos=lambda value: f"{value:.1f}")
        # Font units are y-up; SVG is y-down.
        font.getGlyphSet()[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x + shift + offset, baseline)))
        parts.append(pen.getCommands())
    return "".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--latin", required=True, help="Google Sans Code TTF (variable or static)")
    parser.add_argument("--cjk", default="/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc")
    parser.add_argument("--weight", type=int, default=500)
    parser.add_argument("--lang", choices=["en", "zh"], default="en", help="tagline and caption language")
    args = parser.parse_args()

    latin = TTFont(args.latin)
    if "fvar" in latin:
        latin = instancer.instantiateVariableFont(latin, {"wght": args.weight})
    fonts = [latin, load_cjk(args.cjk)]

    rows = [line for line in pyfiglet.figlet_format("CINEFOUNDRY", font="ansi_shadow", width=200).splitlines() if line.strip()]
    width = max(len(row) for row in rows) * CELL_W + PAD_X * 2
    height = TOP + len(rows) * CELL_H + 96

    blocks, shadows = [], []
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            char = row[x]
            if char == "█":
                end = x
                while end < len(row) and row[end] == "█":
                    end += 1
                # One rect per run of blocks, overlapped by half a pixel to hide seams.
                blocks.append(f'<rect x="{PAD_X + x * CELL_W}" y="{TOP + y * CELL_H}" width="{(end - x) * CELL_W + 0.5}" height="{CELL_H + 0.5}"/>')
                x = end
                continue
            if char in ARMS:
                cx, cy = PAD_X + x * CELL_W + CELL_W / 2, TOP + y * CELL_H + CELL_H / 2
                ends = {"l": (cx - CELL_W / 2, cy), "r": (cx + CELL_W / 2, cy), "t": (cx, cy - CELL_H / 2), "b": (cx, cy + CELL_H / 2)}
                first, second = (ends[arm] for arm in ARMS[char])
                shadows.append(f"M{first[0]} {first[1]}L{cx} {cy}L{second[0]} {second[1]}")
            x += 1
    shadow = "".join(shadows)

    tagline_y, caption_y = height - 54, height - 24
    prompt = outline("$", PAD_X, tagline_y, 21, fonts)
    text = {
        "en": ("One idea in, a finished film out", "agentic film studio · ads, shorts, micro-dramas · on one NVIDIA DGX Spark",
               "Cinefoundry: an agentic film studio on one NVIDIA DGX Spark. One idea in, a finished film out."),
        "zh": ("影工坊 · 一个想法进去，一部成片出来", "智能体影像工作室 · 广告片 · 短视频 · 微短剧 · 单台 NVIDIA DGX Spark",
               "Cinefoundry 影工坊：运行在单台 NVIDIA DGX Spark 上的智能体影像工作室。一个想法进去，一部成片出来。"),
    }[args.lang]
    tagline = outline(text[0], PAD_X + 26, tagline_y, 21, fonts)
    caption_text = text[1]
    caption = outline(caption_text, PAD_X, caption_y, 16, fonts)
    # The cursor sits after the caption: CJK characters are one em wide, Latin ones use the monospace advance.
    mono = latin["hmtx"]["a"][0] / latin["head"].unitsPerEm
    caption_width = sum(1.0 if "\u3000" <= ch <= "\u9fff" or "\uff00" <= ch <= "\uffef" else mono for ch in caption_text) * 16

    print(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="{text[2]}">
  <defs>
    <linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="{PAD_X}" y1="0" x2="{width - PAD_X}" y2="0">
      <stop offset="0" stop-color="#f6e2b0"/><stop offset="0.55" stop-color="#d9a441"/><stop offset="1" stop-color="#e0724f"/>
    </linearGradient>
  </defs>
  <rect width="{width}" height="{height}" rx="14" fill="#0e0f13"/>
  <rect x="0.75" y="0.75" width="{width - 1.5}" height="{height - 1.5}" rx="13.5" fill="none" stroke="#272a35" stroke-width="1.5"/>
  <circle cx="30" cy="30" r="6.5" fill="#ef6f6f"/><circle cx="52" cy="30" r="6.5" fill="#e6c15a"/><circle cx="74" cy="30" r="6.5" fill="#6fcf97"/>
  <path d="{outline("cinefoundry — dgx-spark", width / 2, 35, 14, fonts, "middle")}" fill="#5d6070"/>
  <!-- double-line shadow: a wide dim stroke with a background-coloured stroke inside it -->
  <path d="{shadow}" fill="none" stroke="#7a5f2c" stroke-width="7" stroke-linejoin="miter"/>
  <path d="{shadow}" fill="none" stroke="#0e0f13" stroke-width="2.6" stroke-linejoin="miter"/>
  <g fill="url(#ink)">{"".join(blocks)}</g>
  <path d="{prompt}" fill="#d9b26a"/>
  <path d="{tagline}" fill="#e9e7e1"/>
  <path d="{caption}" fill="#8d90a0"/>
  <rect x="{PAD_X + caption_width + 8:.1f}" y="{caption_y - 14}" width="9" height="18" fill="#d9b26a"/>
</svg>''')


if __name__ == "__main__":
    main()
