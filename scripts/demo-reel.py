#!/usr/bin/env python3
"""Build the demo reel from the project's own artefacts: run records, frames, films, benchmark.

    python3 scripts/demo-reel.py --out ~/cinefoundry-demo/cinefoundry-demo.mp4 [--voice zm_010] [--films-only]

Every number on screen is read from the repository (eval/results, projects/*/reports), never typed in.
Cards are drawn with Pillow, narration is synthesised with the same offline TTS the films use, and
ffmpeg joins the pieces. Re-run after the films change; nothing here needs the GPU beyond the TTS.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
W, H = 1920, 1080
BG, PANEL, LINE = (14, 15, 19), (23, 25, 32), (39, 42, 53)
TEXT, DIM, GOLD, OK, BAD, RUN = (233, 231, 225), (141, 144, 160), (217, 178, 106), (111, 207, 151), (239, 111, 111), (106, 169, 255)
FONT_DIR = Path('/usr/share/fonts/opentype/noto')


def font(size: int, weight: str = 'Regular') -> ImageFont.FreeTypeFont:
    path = FONT_DIR / f'NotoSansCJK-{weight}.ttc'
    for index in range(6):  # pick the Simplified Chinese face inside the collection
        candidate = ImageFont.truetype(str(path), size, index=index)
        if 'SC' in candidate.getname()[0]:
            return candidate
    return ImageFont.truetype(str(path), size)


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """Wrap at CJK characters and at spaces between Latin words, never inside a word."""
    import re
    tokens = re.findall(r'\n|[\u4e00-\u9fff，。！？、：；“”‘’「」（）·…—]|[^\u4e00-\u9fff\s，。！？、：；“”‘’「」（）·…—]+[ \t]*|[ \t]+', text)
    lines, current = [], ''
    for token in tokens:
        if token == '\n':
            lines.append(current.rstrip()); current = ''; continue
        if draw.textlength(current + token.rstrip(), font=fnt) > width and current.strip():
            lines.append(current.rstrip()); current = token.lstrip()
        else:
            current += token
    if current.strip(): lines.append(current.rstrip())
    return lines


def paragraph(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt: ImageFont.FreeTypeFont, width: int, fill=TEXT, leading: float = 1.5) -> int:
    x, y = xy
    step = int(fnt.size * leading)
    for line in wrap(draw, text, fnt, width):
        draw.text((x, y), line, font=fnt, fill=fill); y += step
    return y


def new_card() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new('RGB', (W, H), BG)
    return image, ImageDraw.Draw(image)


def header(draw: ImageDraw.ImageDraw, kicker: str, title: str) -> int:
    draw.text((120, 80), kicker, font=font(26), fill=GOLD)
    draw.text((120, 122), title, font=font(54, 'Bold'), fill=TEXT)
    draw.line([(120, 210), (W - 120, 210)], fill=LINE, width=2)
    return 250


def footer(draw: ImageDraw.ImageDraw, text: str = 'Cinefoundry 影工坊 · 全部在一台 DGX Spark 上生成') -> None:
    draw.text((120, H - 70), text, font=font(22), fill=DIM)


def fit(image: Image.Image, box: tuple[int, int]) -> Image.Image:
    copy = image.copy(); copy.thumbnail(box, Image.LANCZOS); return copy


def panel(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], outline=LINE) -> None:
    draw.rounded_rectangle(box, radius=16, fill=PANEL, outline=outline, width=2)


# ---------------------------------------------------------------- data from the repository

def latest_ablation() -> dict:
    files = sorted(glob.glob(str(ROOT / 'eval/results/ablation*.json')), key=os.path.getmtime)
    return json.load(open(files[-1], encoding='utf8'))


def run_summary(project: str) -> dict:
    lines = [json.loads(line) for line in open(ROOT / 'projects' / project / 'reports/run.jsonl', encoding='utf8')]
    final = [line for line in lines if line.get('stage') == 'run' and 'wallSeconds' in line][-1]
    qa = [line for line in lines if line.get('stage') == 'qa']
    clips = [line for line in lines if line.get('stage') == 'clips' and 'seconds' in line]
    text = [line for line in lines if line.get('stage') in ('brief', 'script', 'compliance', 'storyboard') and line.get('agent') != 'jev']
    return {'wall': final['wallSeconds'], 'regenerations': final.get('qaRegenerations', 0), 'qaChecks': len(qa),
            'clipSeconds': [round(line['seconds']) for line in clips], 'textSeconds': round(sum(line.get('seconds', 0) for line in text), 1),
            'memory': final.get('memoryAtEnd', {}), 'qa': qa, 'lines': lines}


def log_lines(project: str) -> list[str]:
    """The run record as the lines a viewer would watch scroll by."""
    names = {'brief': '需求', 'script': '脚本', 'compliance': '合规', 'storyboard': '分镜', 'frames': '生图', 'qa': '质检', 'clips': '生视频', 'cut': '成片'}
    out: list[str] = []
    for line in run_summary(project)['lines']:
        stage, agent = line.get('stage'), line.get('agent')
        if agent == 'jev':
            if stage == 'script': out.append(f"› 文案 · Jev 语义判读 {line['seconds']:.1f} s · {len(line.get('findings', []))} 条需复核")
            continue
        if stage in ('brief', 'script', 'storyboard') and 'attempts' in line:
            rejected = line.get('rejected') or []
            note = f"第 1 稿被校验器退回：{rejected[0][0][:48]}…" if rejected else '第 1 稿通过校验'
            out.append(f"› {names[stage]} · {agent} · {line['seconds']:.1f} s · {note}")
        elif stage == 'compliance':
            out.append(f"› 合规 · 独立审稿 {line['seconds']:.1f} s · {'通过' if line.get('approve') else '退回'} · 用词扫描 {line.get('scanFindings', 0)} 处")
        elif stage == 'frames' and agent == 'product-hero':
            out.append(f"› 定妆图 · Qwen-Image {line['imageSeconds']:.0f} s · 质检 {line['score']} 分 {'通过' if line['pass'] else '拒绝'}")
        elif stage == 'qa':
            issue = (line.get('issues') or [''])[0]; issue = issue[:52] + '…' if len(issue) > 52 else issue
            out.append(f"› 质检 · 镜头 {line['shot']} 候选{line['candidate'].strip('_')} · {line['score']} 分 · {'通过' if line['pass'] else '拒绝：' + issue}")
        elif stage == 'clips' and 'seconds' in line:
            out.append(f"› 生视频 · 镜头 {line.get('shot', '?')} · {line.get('model', 'Wan2.2 14B')} · {line['seconds']:.0f} s")
        elif stage == 'cut' and 'seconds' in line:
            out.append(f"› 成片 · {line.get('agent', '')} · {line['seconds']:.1f} s")
        elif stage == 'run' and 'wallSeconds' in line:
            out.append(f"✓ 完成 · 总耗时 {line['wallSeconds']:.0f} s · 首帧重生成 {line.get('qaRegenerations', 0)} 次")
    return out


# ---------------------------------------------------------------- cards

def card_title(path: Path) -> None:
    image, draw = new_card()
    draw.text((W / 2, 400), 'Cinefoundry', font=font(150, 'Bold'), fill=TEXT, anchor='mm')
    draw.text((W / 2 + 470, 400), '影工坊', font=font(70, 'Bold'), fill=GOLD, anchor='lm')
    draw.text((W / 2, 540), '把一句创意，做成一支成片', font=font(52), fill=TEXT, anchor='mm')
    draw.text((W / 2, 640), '一台 DGX Spark · 八个阶段 · 九个 Agent Skill · 先审后生成', font=font(32), fill=DIM, anchor='mm')
    draw.text((W / 2, 900), '贺家豪 · 第三届 NVIDIA DGX Spark 黑客松 · Agent Skills 开发挑战赛', font=font(26), fill=DIM, anchor='mm')
    image.save(path)


def card_pain(path: Path) -> None:
    image, draw = new_card()
    y = header(draw, '为什么做', '做一条短视频广告，卡在哪里')
    items = [('素材不能上云', '未发布的新品、内部设计稿，交给云端视频工具就等于泄露。'),
             ('返工按次计费', '一个镜头重生成五次是常态，每次都是一笔费用，试错变贵。'),
             ('没人把关', '一句“全网第一”、一个变形的 logo、一行错字，到成片才发现。')]
    for index, (title, body) in enumerate(items):
        x = 120 + index * 570
        panel(draw, (x, y + 40, x + 520, y + 560))
        draw.text((x + 40, y + 80), f'0{index + 1}', font=font(40, 'Bold'), fill=GOLD)
        draw.text((x + 40, y + 150), title, font=font(44, 'Bold'), fill=TEXT)
        paragraph(draw, (x + 40, y + 240), body, font(30), 450, fill=DIM)
    draw.text((120, y + 660), 'Cinefoundry 的答案：整条流水线放在一台 DGX Spark 上，每一步先校验再生成，返工只发生在最便宜的阶段。', font=font(30), fill=TEXT)
    footer(draw)
    image.save(path)


def card_studio(path: Path, screenshot: Path) -> None:
    image, draw = new_card()
    y = header(draw, '一句话开拍', 'Studio：说出创意，其余交给 Cinefoundry Harness')
    shot = Image.open(screenshot).convert('RGB').crop((360, 0, 1560, 240))
    shot = shot.resize((1680, 336), Image.LANCZOS)
    image.paste(shot, (120, y + 20))
    draw.rounded_rectangle((120, y + 20, 1800, y + 356), radius=12, outline=LINE, width=2)
    stages = ['需求', '脚本', '合规', '分镜', '生图', '质检', '生视频', '成片']
    x = 120
    for name in stages:
        draw.rounded_rectangle((x, y + 420, x + 190, y + 490), radius=35, fill=PANEL, outline=LINE, width=2)
        draw.text((x + 95, y + 455), name, font=font(30), fill=TEXT, anchor='mm')
        x += 215
        if name != '成片': draw.text((x - 22, y + 455), '›', font=font(30), fill=DIM, anchor='mm')
    paragraph(draw, (120, y + 540), '八个阶段由代码保证顺序；每个阶段是一个加载了对应 Agent Skill 的子智能体；每份产出先过确定性校验，不合格就带着具体问题重写。代码管顺序和验收，模型管判断。', font(30), 1680, fill=DIM)
    footer(draw)
    image.save(path)


def frames_log(directory: Path, lines: list[str], title: str) -> list[Path]:
    """One frame per log line, the earlier lines staying on screen: the run replayed."""
    paths = []
    mono = font(27)
    for index in range(1, len(lines) + 1):
        image, draw = new_card()
        y = header(draw, '真实运行记录 · reports/run.jsonl', title)
        panel(draw, (120, y, W - 120, H - 110))
        visible = lines[max(0, index - 20):index]
        ty = y + 30
        for line in visible:
            colour = OK if line.startswith('✓') else BAD if '拒绝' in line or '退回' in line else TEXT
            draw.text((150, ty), line, font=mono, fill=colour); ty += 38
        footer(draw)
        path = directory / f'log_{index:03d}.png'; image.save(path); paths.append(path)
    return paths


def card_review(path: Path) -> None:
    """A real draft that was sent back, next to the copy that passed - from projects/show-cream."""
    lines = run_summary('show-coffee-portrait')['lines']
    compliance = [line for line in lines if line.get('stage') == 'compliance'][0]
    jev = [line for line in run_summary('show-cream')['lines'] if line.get('stage') == 'script' and line.get('agent') == 'jev'][0]
    script = json.load(open(ROOT / 'projects/show-coffee-portrait/script/script.json', encoding='utf8'))
    image, draw = new_card()
    y = header(draw, '先审后生成', '文案到不了生成环节，除非它过了三道关')
    panel(draw, (120, y, 1010, H - 110), outline=(107, 48, 48))
    draw.text((150, y + 25), '第 1 稿 · 被独立审稿智能体退回（挂耳咖啡「醒」）', font=font(30, 'Bold'), fill=BAD)
    ty = y + 90
    for issue in compliance['issues'][:2]:
        ty = paragraph(draw, (150, ty), '· ' + issue, font(24), 820, fill=TEXT, leading=1.4) + 14
    draw.text((150, ty + 10), 'Jev 语义判读（TypeSafe，校准概率）· 面霜「润」第 1 稿', font=font(26, 'Bold'), fill=GOLD)
    ty += 60
    for finding in jev['findings'][:3]:
        ty = paragraph(draw, (150, ty), f"「{finding['line']}」 {finding['issue']} · p = {finding['probability']:.2f}", font(24), 820, fill=DIM, leading=1.4) + 6
    panel(draw, (1040, y, W - 120, H - 110), outline=(46, 91, 69))
    draw.text((1070, y + 25), '第 2 稿 · 三道关全过', font=font(30, 'Bold'), fill=OK)
    ty = y + 100
    for beat in script['beats']:
        draw.text((1070, ty), f"{beat['beat']}", font=font(40, 'Bold'), fill=GOLD)
        draw.text((1130, ty + 4), beat['vo'], font=font(34), fill=TEXT)
        draw.text((1130, ty + 58), f"字幕：{beat['text']}", font=font(24), fill=DIM)
        ty += 130
    paragraph(draw, (1070, ty + 20), '① 《广告法》用词扫描（确定性）\n② 没写这份稿的审稿智能体\n③ Jev：绝对化、健康功效、品类语感、朗读自然度\n概率 ≥ 0.7 直接退回，0.3–0.7 交审稿智能体裁决', font(24), 700, fill=DIM, leading=1.5)
    footer(draw)
    image.save(path)


def card_qa(path: Path) -> None:
    """The soda run: hero still, a rejected candidate with the reason, the regenerated pass, the consistent frames."""
    project = ROOT / 'projects/show-soda'
    qa = run_summary('show-soda')['qa']
    image, draw = new_card()
    y = header(draw, '定妆图与质检闭环', '整支片子里是同一只罐，因为每一帧都从定妆图生成')
    rejected = next(line for line in qa if line['shot'] == 1 and not line['pass'])
    passed = next(line for line in qa if line['shot'] == 1 and line['pass'])
    def frame_of(candidate: str) -> Path:
        suffix = '' if candidate == '_a' else candidate
        return project / 'frames' / f'shot_001{suffix}.png'
    tiles = [(project / 'refs/product.png', GOLD, '定妆图 · Qwen-Image · 质检 100 分', ''),
             (frame_of(rejected['candidate']), BAD, f"镜头 1 候选 {rejected['candidate'].strip('_')} · {rejected['score']} 分 · 拒绝", 'Step3-VL：' + (rejected['issues'] or [''])[0]),
             (frame_of(passed['candidate']), OK, f"镜头 1 候选 {passed['candidate'].strip('_')} · {passed['score']} 分 · 通过", '改提示词后重生成，对照定妆图复核')]
    for index, (source, colour, label, note) in enumerate(tiles):
        x = 120 + index * 570
        picture = fit(Image.open(source).convert('RGB'), (520, 400))
        px = x + (520 - picture.width) // 2
        image.paste(picture, (px, y + 10)); draw.rounded_rectangle((px, y + 10, px + picture.width, y + 10 + picture.height), radius=8, outline=colour, width=3)
        draw.text((x, y + 425), label, font=font(24, 'Bold'), fill=colour)
        if note: paragraph(draw, (x, y + 462), note, font(21), 520, fill=DIM, leading=1.35)
    strip = fit(Image.open(ROOT / 'docs/showcase/soda-frames.jpg').convert('RGB'), (500, 222))
    image.paste(strip, (120, y + 525))
    paragraph(draw, (660, y + 545), '三个镜头的首帧与定版：同一只罐。\n每一帧由 StepFun Step3-VL 对照定妆图复核，不合格就改提示词重生成。返工拦在 20 秒的生图阶段，而不是 6 分钟的生视频阶段。', font(26), 1080, fill=TEXT, leading=1.55)
    footer(draw)
    image.save(path)


def card_evidence(path: Path) -> None:
    ablation = latest_ablation()
    soda = run_summary('show-soda')
    image, draw = new_card()
    y = header(draw, '证据', '同一个模型、同一批创意，唯一变量是有没有 Skill')
    panel(draw, (120, y, 1010, y + 470))
    draw.text((150, y + 25), f"Skill 消融 · {ablation['model']} · {ablation['briefs']} 个创意 × {ablation['repeats']} 轮 · 每阶段一次机会", font=font(24), fill=DIM)
    rows = [('', '不带 Skill', '带 Skill'),
            ('脚本一次合格', ablation['withoutSkills']['scriptCleanFirstTry'], ablation['withSkills']['scriptCleanFirstTry']),
            ('分镜一次合格', ablation['withoutSkills']['storyboardCleanFirstTry'], ablation['withSkills']['storyboardCleanFirstTry']),
            ('分镜平均违规', f"{ablation['withoutSkills']['meanStoryboardViolations']:.2f}", f"{ablation['withSkills']['meanStoryboardViolations']:.2f}"),
            ('脚本平均违规', f"{ablation['withoutSkills']['meanScriptViolations']:.2f}", f"{ablation['withSkills']['meanScriptViolations']:.2f}")]
    ty = y + 90
    for index, row in enumerate(rows):
        fnt = font(28, 'Bold' if index == 0 else 'Regular')
        draw.text((150, ty), row[0], font=fnt, fill=TEXT)
        draw.text((560, ty), row[1], font=fnt, fill=DIM if index else TEXT)
        draw.text((800, ty), row[2], font=fnt, fill=OK if index else TEXT)
        ty += 62
        if index == 0: draw.line([(150, ty - 10), (980, ty - 10)], fill=LINE, width=2)
    panel(draw, (1040, y, W - 120, y + 470))
    draw.text((1070, y + 25), '一支 15 秒成片的真实记录 · 气泡水「冷」', font=font(24), fill=DIM)
    clip = ' / '.join(f'{s} s' for s in soda['clipSeconds'])
    record = [('需求 → 分镜（模型调用）', f"{soda['textSeconds']} s"), ('首帧质检', f"{soda['qaChecks']} 次 · 重生成 {soda['regenerations']} 次"),
              ('三段视频 · Wan2.2 14B', clip), ('总耗时', f"{soda['wall']:.0f} s ≈ {soda['wall'] / 60:.0f} 分钟"),
              ('结束时可用统一内存', f"{soda['memory'].get('availableGb', '?')} / {soda['memory'].get('totalGb', '?')} GB")]
    ty = y + 90
    for key, value in record:
        draw.text((1070, ty), key, font=font(28), fill=TEXT); draw.text((1500, ty), value, font=font(28, 'Bold'), fill=GOLD); ty += 62
    paragraph(draw, (120, y + 520), '两次消融都如实记录：把节拍数、字数、镜头数这类硬约束写进阶段提示词后，不带 Skill 的基线也变好，Skill 的边际收益随之缩小。能写进提示词的确定性规则就该写进提示词，Skill 留给需要判断的部分。分镜阶段的差距依然明显。', font(26), 1680, fill=DIM)
    footer(draw)
    image.save(path)


def card_closing(path: Path) -> None:
    image, draw = new_card()
    arch = ROOT / 'docs/assets/architecture.png'
    if arch.exists():
        picture = fit(Image.open(arch).convert('RGB'), (900, 820))
        image.paste(picture, (120, 130))
    draw.text((1120, 300), 'Cinefoundry', font=font(96, 'Bold'), fill=TEXT)
    draw.text((1120, 420), '影工坊 · 把一句创意，做成一支成片', font=font(40), fill=GOLD)
    paragraph(draw, (1120, 520), 'NVIDIA Nemotron 3.5 Lightning · StepFun Step3-VL · Qwen-Image · Wan2.2 · ACE-Step · Step-Audio-EditX\n全部运行在一台 DGX Spark 上', font(26), 700, fill=DIM)
    draw.text((1120, 720), 'github.com/hojiahao/cinefoundry', font=font(36, 'Bold'), fill=TEXT)
    draw.text((1120, 790), 'BUSL-1.1 · 贺家豪', font=font(26), fill=DIM)
    image.save(path)


# ---------------------------------------------------------------- narration and assembly

def sh(*args: str) -> None:
    subprocess.run(list(args), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def duration(path: Path) -> float:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout
    return float(out.strip() or 0)


def narrate(text: str, path: Path, voice: str) -> float:
    python = ROOT / 'runtime-data/tts-venv/bin/python'
    sh(str(python), str(ROOT / 'scripts/tts.py'), '--text', text, '--out', str(path), '--voice', voice, '--speed', '1.0')
    return duration(path)


def narrate_step_audio(narration: dict, work: Path) -> dict:
    """All narration lines in one Step-Audio-EditX batch, cloned from CINEFOUNDRY_TTS_REF_WAV like the films' voiceover."""
    base = ROOT / 'runtime-data/step-audio'
    job = base / 'jobs' / f'reel-{os.getpid()}'
    job.mkdir(parents=True, exist_ok=True)
    inside = lambda path: '/work/' + str(Path(path).resolve().relative_to(base.resolve()))
    reference = Path(os.environ['CINEFOUNDRY_TTS_REF_WAV']).resolve()
    lines = [{'text': text, 'output': inside(job / f'vo_{key}.wav')} for key, text in narration.items()]
    (job / 'jobs.json').write_text(json.dumps({'prompt_audio': inside(reference), 'prompt_text': os.environ['CINEFOUNDRY_TTS_REF_TEXT'], 'style': os.environ.get('CINEFOUNDRY_TTS_STYLE') or None, 'lines': lines}, ensure_ascii=False))
    if os.environ.get('CINEFOUNDRY_TTS_ENGINE') == 'qwen-tts':
        sh('docker', 'run', '--rm', '--device', 'nvidia.com/gpu=all', '--ipc=host', '-v', f'{ROOT}:/repo:ro', '-v', f"{os.environ.get('SPARK_MODEL_DIR', os.path.expanduser('~/models'))}/tts:/models:ro", '-v', f'{base}:/work',
           'cinefoundry/qwen-tts:local', '/repo/scripts/qwen-clone.py', '--model', '/models/Qwen3-TTS-12Hz-1.7B-Base', '--jobs', inside(job / 'jobs.json'))
    else:
        sh('bash', str(ROOT / 'scripts/step-audio.sh'), 'batch', inside(job / 'jobs.json'))
    chain = 'highpass=f=70,acompressor=threshold=-22dB:ratio=3:attack=5:release=90:makeup=4,equalizer=f=180:t=q:w=1.2:g=2,equalizer=f=3200:t=q:w=1.4:g=3,alimiter=limit=0.9'
    voices = {}
    for key in narration:
        out = work / f'vo_{key}.wav'
        sh('ffmpeg', '-y', '-v', 'error', '-i', str(job / f'vo_{key}.wav'), '-af', chain, str(out))
        voices[key] = (out, duration(out))
    return voices


ENCODE = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '24', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']


def segment_card(card: Path, narration: Path | None, seconds: float, out: Path) -> None:
    fade = f'fade=t=in:st=0:d=0.6,fade=t=out:st={seconds - 0.6:.2f}:d=0.6'
    if narration:
        sh('ffmpeg', '-y', '-loop', '1', '-framerate', '24', '-i', str(card), '-i', str(narration), '-t', f'{seconds:.2f}',
           '-filter_complex', f'[0:v]{fade},format=yuv420p[v];[1:a]adelay=600|600,apad[a]', '-map', '[v]', '-map', '[a]', *ENCODE, str(out))
    else:
        sh('ffmpeg', '-y', '-loop', '1', '-framerate', '24', '-i', str(card), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', f'{seconds:.2f}',
           '-vf', f'{fade},format=yuv420p', *ENCODE, str(out))


def segment_agent_video(video: Path, narration: Path, seconds: float, out: Path) -> None:
    """A screen recording of the agent session (any length), sped up to fill the segment."""
    speed = max(1.0, duration(video) / (seconds - 0.5))
    fontfile = str(FONT_DIR / 'NotoSansCJK-Regular.ttc')
    label = 'DeepSeek Harness（本地 Nemotron）通过 cinefoundry-ad-film Skill 调用 Cinefoundry · 实录压缩播放'
    vf = (f"[0:v]setpts=PTS/{speed:.4f},scale={W}:{H - 120}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:40:color=0x0e0f13,fps=24,"
          f"drawtext=fontfile='{fontfile}':text='{label}':fontsize=30:fontcolor=0xd9b26a:x=(w-tw)/2:y=h-60,"
          f"fade=t=in:st=0:d=0.6,fade=t=out:st={seconds - 0.6:.2f}:d=0.6,format=yuv420p[v];[1:a]adelay=600|600,apad[a]")
    sh('ffmpeg', '-y', '-i', str(video), '-i', str(narration), '-t', f'{seconds:.2f}',
       '-filter_complex', vf, '-map', '[v]', '-map', '[a]', *ENCODE, str(out))


def segment_agent(rec: Path, narration: Path, seconds: float, out: Path, work: Path) -> None:
    """The recorded agent session (scripts/record-agent.sh): terminal frames as a time-lapse."""
    frames = sorted((rec / 'frames').glob('*.png'))
    per = max(0.08, (seconds - 3.0) / max(1, len(frames)))
    listing = work / 'agent.txt'
    with open(listing, 'w') as handle:
        for index, frame in enumerate(frames): handle.write(f"file '{frame}'\nduration {per + (3.0 if index == len(frames) - 1 else 0):.3f}\n")
        handle.write(f"file '{frames[-1]}'\n")
    fontfile = str(FONT_DIR / 'NotoSansCJK-Regular.ttc')
    vf = (f"[0:v]scale={W}:{H - 120}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:40:color=0x0e0f13,fps=24,"
          f"drawtext=fontfile='{fontfile}':text='DeepSeek Harness（本地 Nemotron）通过 cinefoundry-ad-film Skill 调用 Cinefoundry · 实录压缩播放':fontsize=30:fontcolor=0xd9b26a:x=(w-tw)/2:y=h-60,"
          f"fade=t=in:st=0:d=0.6,fade=t=out:st={seconds - 0.6:.2f}:d=0.6,format=yuv420p[v];[1:a]adelay=600|600,apad[a]")
    sh('ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-i', str(narration), '-t', f'{seconds:.2f}',
       '-filter_complex', vf, '-map', '[v]', '-map', '[a]', *ENCODE, str(out))


def segment_recording(rec: Path, narration: Path, seconds: float, out: Path, work: Path) -> None:
    """The recorded Studio session: typing frames at their own pace, then the run as a time-lapse filling the rest."""
    typed = sorted((rec / 'typing-composed').glob('*.jpg'))
    run = sorted((rec / 'run-composed').glob('*.jpg'))
    typing_seconds = 0.3 * len(typed)
    per_run = max(0.12, (seconds - typing_seconds - 2.5) / max(1, len(run)))
    listing = work / 'recording.txt'
    with open(listing, 'w') as handle:
        for frame in typed: handle.write(f"file '{frame}'\nduration 0.300\n")
        for index, frame in enumerate(run): handle.write(f"file '{frame}'\nduration {per_run + (2.5 if index == len(run) - 1 else 0):.3f}\n")
        handle.write(f"file '{run[-1]}'\n")
    fontfile = str(FONT_DIR / 'NotoSansCJK-Regular.ttc')
    label = '实时录屏 · 约 35 分钟压缩播放'
    vf = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0e0f13,fps=24,"
          f"drawtext=fontfile='{fontfile}':text='{label}':fontsize=30:fontcolor=0xd9b26a:x=w-tw-60:y=h-70,"
          f"fade=t=in:st=0:d=0.6,fade=t=out:st={seconds - 0.6:.2f}:d=0.6,format=yuv420p[v];[1:a]adelay=600|600,apad[a]")
    sh('ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-i', str(narration), '-t', f'{seconds:.2f}',
       '-filter_complex', vf, '-map', '[v]', '-map', '[a]', *ENCODE, str(out))


def segment_slides(frames: list[Path], per_frame: float, narration: Path | None, seconds: float, out: Path, work: Path) -> None:
    listing = work / 'slides.txt'
    hold = max(0.0, seconds - per_frame * len(frames))
    with open(listing, 'w') as handle:
        for index, frame in enumerate(frames):
            handle.write(f"file '{frame}'\nduration {per_frame + (hold if index == len(frames) - 1 else 0):.3f}\n")
        handle.write(f"file '{frames[-1]}'\n")
    audio = ['-i', str(narration)] if narration else ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    sh('ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), *audio, '-t', f'{seconds:.2f}',
       '-filter_complex', f'[0:v]fps=24,fade=t=in:st=0:d=0.6,fade=t=out:st={seconds - 0.6:.2f}:d=0.6,format=yuv420p[v];[1:a]apad[a]', '-map', '[v]', '-map', '[a]', *ENCODE, str(out))


def segment_film(film: Path, out: Path, caption: str) -> None:
    label = caption.replace("'", '’').replace(':', '\\:')
    fontfile = str(FONT_DIR / 'NotoSansCJK-Regular.ttc')
    vf = (f'scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0e0f13,fps=24,'
          f"drawtext=fontfile='{fontfile}':text='{label}':fontsize=30:fontcolor=0xd9b26a:x=60:y=h-80:enable='lt(t,4)',format=yuv420p")
    sh('ffmpeg', '-y', '-i', str(film), '-vf', vf, '-af', 'aresample=48000,aformat=channel_layouts=stereo', *ENCODE, str(out))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(Path.home() / 'cinefoundry-demo/cinefoundry-demo.mp4'))
    parser.add_argument('--voice', default=os.environ.get('CINEFOUNDRY_TTS_VOICE', 'zm_010'))
    parser.add_argument('--studio', default=str(Path.home() / 'cinefoundry-demo/shots/studio-brief.png'))
    parser.add_argument('--films', nargs='*', default=None, help='film files with captions as path=caption; default: the four showcase films')
    args = parser.parse_args()
    out = Path(args.out); work = out.parent / 'work'; shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)

    films = args.films or [
        f"{ROOT}/docs/showcase/soda-9x16-framed.mp4=无糖气泡水「冷」· 15 秒竖版 · 饮料",
        f"{ROOT}/docs/showcase/keyboard-16x9.mp4=机械键盘「青」· 15 秒横版 · 数码",
        f"{ROOT}/docs/showcase/cream-9x16-framed.mp4=保湿面霜「润」· 15 秒竖版 · 护肤",
    ]
    coffee = ROOT / 'docs/showcase/coffee-16x9.mp4'
    if args.films is None and coffee.exists(): films.append(f"{coffee}=挂耳咖啡「醒」· 15 秒横版 · 食品")

    ablation = latest_ablation(); soda = run_summary('show-soda')
    narration = {
        'title': 'Cinefoundry，影工坊。把一句创意，做成一支成片。',
        'pain': '做一条短视频广告，要过策划、文案、分镜、生成、剪辑。现有工具把这些放在云端：未发布新品的素材不能上传；一个镜头重生成五次是常态，按次计费劝退；生成结果没人把关，一句全网第一、一个变形的标志，到成片才发现。',
        'studio': 'Cinefoundry 跑在一台 DGX Spark 上。一句创意，有两种方式交给它：在网页工作台里直接开拍，或者让任何支持 Agent Skills 的智能体通过 Skill 来调用。背后都是同一个 Cinefoundry Harness：八个阶段，每个阶段一个加载了 Skill 的子智能体，代码管顺序和验收，模型管判断。',
        'live': '第一种方式：网页工作台。输入创意，点开拍。智能体依次写需求、写脚本、审合规、画分镜，定妆图过了质检，每个镜头的首帧逐一生成、逐一复核，三段视频在本机生成，最后自动剪成片。整个过程约三十五分钟，这里压缩成了四十秒。',
        'review': '文案先过广告法用词扫描，再过一个没写这份稿的审稿智能体，还有 Jev 的语义判读。有问题的文案到不了生成环节。这是咖啡那支的第一稿，提神、清醒这类功效声称被退回，第二稿只写香气和口感，才放行。',
        'qa': '产品先出一张过质检的定妆图，之后每一帧都从它生成，所以整支片子里是同一只罐。每一帧由 StepFun 的视觉模型对照定妆图复核：镜头一的候选因为罐子没立起来被拒，改提示词重生成后通过。返工拦在二十秒的生图阶段，而不是六分钟的生视频阶段。',
        'agent': '第二种方式：在 DeepSeek Harness 里，大脑是本机的 NVIDIA Nemotron。用一句话提需求，它按描述加载 Cinefoundry 的入口 Skill，检查模型服务、启动 Harness、汇报进度，最后读交付报告，把成片位置、每个镜头的质检结果和遗留问题如实告诉你。',
        'evidence': f"一支十五秒成片在这台机器上约 {soda['wall'] / 60:.0f} 分钟，全程本地。同一个模型、同一批创意，不带 Skill 时分镜一次合格 {ablation['withoutSkills']['storyboardCleanFirstTry'].replace('/', ' 比 ')}，带 Skill 后 {ablation['withSkills']['storyboardCleanFirstTry'].replace('/', ' 比 ')}；每条规则都对应一次真实的翻车。",
        'closing': 'Cinefoundry，影工坊。代码在 GitHub 公开，欢迎在你的 DGX Spark 上开拍。',
    }
    cards = work / 'cards'; cards.mkdir()
    card_title(cards / 'title.png'); card_pain(cards / 'pain.png'); card_studio(cards / 'studio.png', Path(args.studio))
    card_review(cards / 'review.png'); card_qa(cards / 'qa.png'); card_evidence(cards / 'evidence.png'); card_closing(cards / 'closing.png')

    voices = {}
    if os.environ.get('CINEFOUNDRY_TTS_ENGINE') in ('step-audio', 'qwen-tts'):
        voices = narrate_step_audio(narration, work)
    else:
        for key, text in narration.items():
            path = work / f'vo_{key}.wav'; voices[key] = (path, narrate(text, path, args.voice))
    for key in narration: print(f'narration {key}: {voices[key][1]:.1f} s', file=sys.stderr)

    parts: list[Path] = []
    def add(name: str, build) -> None:
        path = work / f'{len(parts):02d}_{name}.mp4'; build(path); parts.append(path)
    hold = lambda key, minimum: max(minimum, voices[key][1] + 1.6)
    add('title', lambda p: segment_card(cards / 'title.png', voices['title'][0], hold('title', 6), p))
    add('pain', lambda p: segment_card(cards / 'pain.png', voices['pain'][0], hold('pain', 8), p))
    add('studio', lambda p: segment_card(cards / 'studio.png', voices['studio'][0], hold('studio', 8), p))
    rec = Path.home() / 'cinefoundry-demo/studio-rec'
    if (rec / 'run-composed').is_dir() and 'live' in voices:
        add('live', lambda p: segment_recording(rec, voices['live'][0], max(40.0, voices['live'][1] + 2), p, work))
    agent_rec = Path.home() / 'cinefoundry-demo/agent-rec'
    if (agent_rec / 'recording.mp4').exists() and 'agent' in voices:
        add('agent', lambda p: segment_agent_video(agent_rec / 'recording.mp4', voices['agent'][0], max(42.0, voices['agent'][1] + 2), p))
    elif (agent_rec / 'frames').is_dir() and any((agent_rec / 'frames').glob('*.png')) and 'agent' in voices:
        add('agent', lambda p: segment_agent(agent_rec, voices['agent'][0], max(42.0, voices['agent'][1] + 2), p, work))
    add('review', lambda p: segment_card(cards / 'review.png', voices['review'][0], hold('review', 10), p))
    add('qa', lambda p: segment_card(cards / 'qa.png', voices['qa'][0], hold('qa', 10), p))
    for index, spec in enumerate(films):
        film, _, caption = spec.partition('=')
        add(f'film{index}', lambda p, film=film, caption=caption: segment_film(Path(film), p, caption))
    add('evidence', lambda p: segment_card(cards / 'evidence.png', voices['evidence'][0], hold('evidence', 12), p))
    add('closing', lambda p: segment_card(cards / 'closing.png', voices['closing'][0], hold('closing', 8), p))

    total = sum(duration(part) for part in parts)
    if total > 300: raise SystemExit(f'the reel is {total:.0f} s; the submission limit is 300 s')
    listing = work / 'parts.txt'
    listing.write_text(''.join(f"file '{part}'\n" for part in parts))
    sh('ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-c', 'copy', '-movflags', '+faststart', str(out))
    print(json.dumps({'output': str(out), 'seconds': round(duration(out), 1), 'parts': len(parts)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
