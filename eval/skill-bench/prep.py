"""Build the with/without-skill benchmark cases for the eight stage skills that had no ablation yet,
from this machine's own project history (cinefoundry/projects/*). Output: eval/skill-bench/cases.json.
Every case carries what the scorer needs; nothing is judged by a model."""
import glob, json, os, random, re, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
P = ROOT / 'projects'
random.seed(7)
load = lambda p: json.load(open(p))

def projects():
    for d in sorted(P.iterdir()):
        if (d / 'state.json').exists():
            yield d

# ---- requests: what users actually typed (state.json "brief"), plus the eval brief set ----------
requests = []
for d in projects():
    st = load(d / 'state.json')
    req = (st.get('brief') or '').strip()
    if req and req not in [r['request'] for r in requests]:
        photo = (d / 'brief.json').exists() and bool(load(d / 'brief.json').get('photo'))
        requests.append({'project': d.name, 'request': req, 'photo': photo})
for i, req in enumerate(load(ROOT / 'eval' / 'briefs.json')):
    text = req if isinstance(req, str) else req.get('brief') or req.get('request')
    if text and text not in [r['request'] for r in requests]:
        requests.append({'project': f'eval-brief-{i + 1}', 'request': text, 'photo': False})

# ---- compliance: historical copy that passed, clean and with one injected restricted claim -----
SCAN = [('全网第一', 'general'), ('100%天然', 'food'), ('永不', 'general'), ('立竿见影', 'general'), ('最好', 'general'), ('绝对安全', 'food')]
IMPLIED = {'food': ['提神醒脑', '解暑降火', '补充能量又养胃'], 'cosmetics': ['三天告别细纹', '修复受损肌底'], 'general': ['让你效率翻倍']}
compliance = []
for d in projects():
    sj, bj = d / 'script' / 'script.json', d / 'brief.json'
    if not (sj.exists() and bj.exists()):
        continue
    script, brief = load(sj), load(bj)
    beats = script.get('beats') or []
    if not beats:
        continue
    cat = brief.get('category', 'general')
    compliance.append({'project': d.name, 'category': cat, 'beats': beats, 'inject': None})
    b = random.randrange(len(beats))
    phrase, _ = random.choice(SCAN)
    if cat == 'cosmetics' and random.random() < .5:
        phrase = '美白祛斑'
    compliance.append({'project': d.name, 'category': cat, 'beats': beats, 'inject': {'beat': beats[b]['beat'], 'phrase': phrase, 'kind': 'scan'}})
    phrase = random.choice(IMPLIED.get(cat, IMPLIED['general']))
    compliance.append({'project': d.name, 'category': cat, 'beats': beats, 'inject': {'beat': beats[(b + 1) % len(beats)]['beat'], 'phrase': phrase, 'kind': 'implied'}})

# ---- quality-gate repair: frames the gate actually rejected, with the shot they belong to -------
repair = []
for d in projects():
    sb, rl = d / 'storyboard' / 'storyboard.json', d / 'reports' / 'run.jsonl'
    if not (sb.exists() and rl.exists()):
        continue
    board = load(sb)
    shots = {s['shot']: s for s in board.get('shots', [])}
    seen = set()
    for line in open(rl, errors='ignore'):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get('stage') == 'qa' and r.get('pass') is False and r.get('score', 0) >= 0 and r.get('issues') and r.get('shot') in shots:
            key = (r['shot'], r['issues'][0][:40])
            if key in seen:
                continue
            seen.add(key)
            repair.append({'project': d.name, 'shot': shots[r['shot']], 'storyboard': {k: board.get(k) for k in ('style', 'product')}, 'issues': r['issues'][:3]})
random.shuffle(repair)
repair = repair[:24]

# ---- media generation: one historical storyboard shot per project, with its delivery facts -----
media = []
for d in projects():
    sb, bj = d / 'storyboard' / 'storyboard.json', d / 'brief.json'
    if not (sb.exists() and bj.exists()):
        continue
    board, brief = load(sb), load(bj)
    shots = board.get('shots') or []
    if not shots:
        continue
    shot = random.choice(shots)
    st = load(d / 'state.json')
    media.append({'project': d.name, 'ratio': brief.get('ratio', '9:16'), 'brandText': brief.get('brandText'), 'productPhoto': bool(brief.get('photo')),
                  'product': board.get('product'), 'style': board.get('style'), 'shot': shot, 'lastShot': shot['shot'] == len(shots)})

# ---- final cut: historical approved scripts with the measured voiceover lengths ---------------
def wav_seconds(path):
    try:
        out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], capture_output=True, text=True).stdout
        return round(float(out), 2)
    except Exception:
        return None

cut = []
for d in projects():
    sj, bj = d / 'script' / 'script.json', d / 'brief.json'
    if not (sj.exists() and bj.exists()):
        continue
    script, brief = load(sj), load(bj)
    vo = [wav_seconds(d / 'audio' / f'vo_{b["beat"]}.wav') for b in script.get('beats', [])]
    if not script.get('beats') or any(v is None for v in vo):
        continue
    cut.append({'project': d.name, 'brief': {k: brief.get(k) for k in ('title', 'brandText', 'message', 'ratio', 'durationSeconds')}, 'beats': script['beats'], 'voSeconds': vo})

# ---- scheduler: memory situations measured at phase boundaries (delivery.md tables) -----------
sched = []
for d in projects():
    dm = d / 'reports' / 'delivery.md'
    if not dm.exists():
        continue
    rows = re.findall(r'\| (product hero|frames|clips|music) \(([^)]*)\) \| ([\d.]+) GB \| ([\d.]+) GB', open(dm).read())
    for i, (phase, model, before, after) in enumerate(rows[:-1]):
        nxt = rows[i + 1]
        sched.append({'project': d.name, 'resident': rows[i][1], 'availableGb': float(before), 'next': nxt[1], 'nextPhase': nxt[0]})
random.shuffle(sched)
sched = sched[:16]
# questions from the skill's own failure history (no project numbers needed)
sched_fixed = [
    {'kind': 'cgroup', 'question': 'docker stats 显示 vLLM 容器只用了 4 GB，统一内存 121.7 GB。还能再起一个 40 GB 的模型吗？请按实际可用内存判断。', 'availableGb': 9.0},
    {'kind': 'step37', 'question': '想把 Step-3.7-Flash（198B，IQ4_XS 约 116 GB）和现有的 Nemotron、Step3-VL、ComfyUI 一起放在本机跑。', 'availableGb': 47.6},
    {'kind': 'parallel', 'question': '一支片子正在生成视频，能不能同时再跑一轮评测或者另一支片子？', 'availableGb': 26.5},
]

# ---- reference breakdown: our own finished films. Shot cuts are crossfaded and graded, so `cinefoundry shots`
# finds one shot; the timeline is known instead: N beats of 5 s with 0.4 s crossfades, then a 3 s end card.
refs = []
for d in projects():
    f, sj = d / 'cut' / 'final.mp4', d / 'script' / 'script.json'
    if not (f.exists() and sj.exists()) or len(refs) >= 6 or any(d.name.split('-')[0] == x['project'].split('-')[0] and d.name.split('-')[1:2] == x['project'].split('-')[1:2] for x in refs):
        continue
    n = len(load(sj)['beats'])
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], capture_output=True, text=True).stdout)
    cuts = [round(k * 4.6 + 4.8, 2) for k in range(n - 1)] + [round(dur - 3.2, 2)]
    bounds = [0.0] + cuts + [round(dur, 2)]
    out = ROOT / 'eval' / 'skill-bench' / 'shots' / d.name
    out.mkdir(parents=True, exist_ok=True)
    shots = []
    for k in range(len(bounds) - 1):
        a, b = bounds[k], bounds[k + 1]
        kf = out / f'shot_{k + 1:03d}.jpg'
        if not kf.exists():
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str((a + b) / 2), '-i', str(f), '-frames:v', '1', '-vf', 'scale=640:-2', str(kf)])
        shots.append({'index': k + 1, 'start': a, 'end': b, 'duration': round(b - a, 2), 'keyframe': str(kf)})
    json.dump({'source': str(f), 'duration': round(dur, 2), 'shots': shots}, open(out / 'shots.json', 'w'), indent=1)
    refs.append({'project': d.name, 'shotsDir': str(out), 'shotCount': len(shots)})

# keep each group to ~16 cases (2 arms x 2 repeats each)
requests = requests[:16] if sum(r['photo'] for r in requests[:16]) else requests[:13] + [r for r in requests if r['photo']][:3]
compliance = compliance[:45]
media = media[:16]
cut = cut[:16]
# ---- entry skill: what an outside agent is asked, from historical requests ---------------------
film = []
for r in requests[:12]:
    film.append({'project': r['project'], 'message': r['request'], 'photo': f'/data/uploads/{r["project"]}.png' if r['photo'] else None, 'planOnly': False})
for r in requests[12:16]:
    film.append({'project': r['project'], 'message': r['request'] + ' 先给我看脚本和分镜，我确认了再生成视频。', 'photo': None, 'planOnly': True})

cases = {'brief': requests, 'compliance': compliance, 'repair': repair, 'media': media, 'cut': cut, 'scheduler': sched, 'schedulerFixed': sched_fixed, 'film': film, 'breakdown': refs}
json.dump(cases, open(Path(__file__).parent / 'cases.json', 'w'), ensure_ascii=False, indent=1)
print({k: len(v) for k, v in cases.items()})
