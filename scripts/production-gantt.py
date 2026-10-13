#!/usr/bin/env python3
"""Render every completed production run as an interactive Gantt chart.

Reads projects/*/reports/run.jsonl and keeps each project's first complete run (up to the
first director summary line; later re-cuts are appended after it and are left out). Every
bar is the wall-clock interval between two logged events, so nothing is estimated.

    python scripts/production-gantt.py > docs/production-gantt.html
    python scripts/production-gantt.py --compare OLD_ID NEW_ID [--note TEXT] > docs/gantt-compare.html
"""

import argparse
import glob
import json
import os
import statistics
import sys
from datetime import datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SAME_TS = 0.05  # events logged within this many seconds belong to one bar


def ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def phase(e: dict) -> str:
    st, agent = e["stage"], e.get("agent")
    if st in ("brief", "script", "compliance", "storyboard"):
        return "copy"
    if agent == "scheduler":
        return "swap"
    if agent == "product-hero":
        return "hero"
    if st in ("frames", "qa"):
        return "frames"
    if st == "clips":
        return "clips"
    return "cut"


def label(e: dict) -> str:
    st, agent = e["stage"], e.get("agent")
    if agent == "scheduler":
        return f"调度：{e.get('phase', '')}" + (f"（唤醒 {e['woke']}）" if "woke" in e else "")
    if agent == "director":
        return "合成 + 交付报告"
    if agent == "product-hero":
        return f"产品主图 · {verdict(e)}"
    if agent == "quality-gate":
        return f"镜头{e['shot']} 候选{e.get('candidate', '')} · {verdict(e)}"
    if st == "clips":
        return f"clip {e['shot']}"
    if agent == "voiceover":
        return f"配音 beat {e.get('beat')}"
    if agent == "music":
        return "音乐"
    return {"brief": "brief 需求", "script": "script 脚本", "compliance": "compliance 合规",
            "storyboard": "storyboard 分镜"}.get(st, st)


def verdict(e: dict) -> str:
    score = e.get("score")
    return ("通过" if e.get("pass") else "未通过") + (" · 无评分" if score is None or score < 0 else f" {score} 分")


def failed(e: dict) -> bool:
    return e.get("agent") in ("quality-gate", "product-hero") and e.get("pass") is False


# Runs made with frameScheduling=queue before the harness logged render start times and the mode.
LEGACY_QUEUE_RUNS = {"summer-cool-soda-queue"}


def run_id(path: str) -> str:
    return os.path.basename(os.path.dirname(os.path.dirname(path)))


def load(path: str):
    events = [json.loads(line) for line in open(path) if line.strip()]
    director = next((e for e in events if e.get("agent") == "director" and "wallSeconds" in e), None)
    if director is None:
        return None
    events = events[: events.index(director) + 1]
    end = ts(director["ts"])
    start = end - director["wallSeconds"]

    queue = director.get("frameScheduling") == "queue" or director.get("frameScheduling") is None and run_id(path) in LEGACY_QUEUE_RUNS
    bars, pending, prev = [], [], start
    frames_start, shot_last = None, {}
    for e in events:
        if e.get("agent") == "jev":  # cloud lint sub-call inside the next bar
            pending.append(e)
            continue
        t = ts(e["ts"])
        if e.get("agent") == "scheduler" and str(e.get("phase", "")).startswith("frames"):
            frames_start = t
        if e.get("agent") == "quality-gate":
            if "renderStartedAt" in e:
                issued = ts(e["renderStartedAt"])
            elif queue:
                # Logged before render start times were recorded: in queue mode a shot's first
                # render is requested when the phase opens, each later one when its previous verdict lands.
                issued = shot_last.get(e["shot"], frames_start if frames_start is not None else prev)
            else:
                issued = None
            shot_last[e["shot"]] = t
            if issued is not None:
                rendered = issued + e["imageSeconds"]
                gate_from = t - e["gateSeconds"] if "gateSeconds" in e else rendered
                common = {"phase": "frames", "lane": e["shot"], "events": pending + [e]}
                bars.append({**common, "s": round(issued - start, 3), "e": round(rendered - start, 3), "kind": "render",
                             "label": f"镜头{e['shot']} 候选{e.get('candidate', '')} · 出图（含排队）", "fail": False})
                bars.append({**common, "s": round(gate_from - start, 3), "e": round(t - start, 3), "kind": "gate",
                             "label": label(e), "fail": failed(e)})
                pending = []
                prev = max(prev, t)
                continue
        if t - prev < SAME_TS and e.get("agent") == "scheduler":  # zero-length wake: attach to next bar
            pending.append(e)
            continue
        if bars and t - prev < SAME_TS and bars[-1]["phase"] == phase(e) and "lane" not in bars[-1]:
            bars[-1]["events"].append(e)
            bars[-1]["label"] += " / " + label(e)
            bars[-1]["fail"] = bars[-1]["fail"] or failed(e)
        else:
            bar = {"s": round(prev - start, 3), "e": round(t - start, 3), "phase": phase(e),
                   "label": label(e), "fail": failed(e), "events": pending + [e]}
            if e.get("agent") == "quality-gate":
                bar.update(lane=e["shot"], kind="attempt")
            bars.append(bar)
        pending = []
        prev = max(prev, t)
    gates = [e for e in events if e.get("agent") == "quality-gate"]
    clips_phase = next((e["phase"] for e in events if e.get("agent") == "scheduler" and str(e.get("phase", "")).startswith("clips")), "")
    return {
        "id": run_id(path),
        "frameScheduling": "queue" if queue else "serial",
        "videoModel": "LTX-2.5 Fast" if "ltx" in clips_phase.lower() else clips_phase[clips_phase.find("(") + 1:-1] or "Wan2.2",
        "startedAt": datetime.fromtimestamp(start).astimezone().isoformat(timespec="seconds"),
        "wall": director["wallSeconds"],
        "regen": director.get("qaRegenerations"),
        "gates": len(gates),
        "gatesPassed": sum(1 for e in gates if e.get("pass")),
        "memoryAtEnd": director.get("memoryAtEnd"),
        "bars": bars,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compare", nargs=2, metavar=("OLD", "NEW"), help="two project ids to draw on one time axis")
    parser.add_argument("--note", default="", help="caveat printed under the comparison")
    parser.add_argument("--changed", default="frames", help="phases the new version changed, comma separated (copy,hero,frames,clips,cut)")
    args = parser.parse_args()
    runs = [r for r in (load(p) for p in sorted(glob.glob(os.path.join(ROOT, "projects/*/reports/run.jsonl")))) if r]
    if not runs:
        sys.exit("no completed runs found")
    runs.sort(key=lambda r: r["startedAt"])
    clips = [e["seconds"] for r in runs if r["videoModel"] == "Wan2.2" for b in r["bars"] for e in b["events"]
             if e["stage"] == "clips" and "seconds" in e]
    summary = {
        "runs": len(runs),
        "wallMedian": statistics.median(r["wall"] for r in runs),
        "gates": sum(r["gates"] for r in runs),
        "gatesPassed": sum(r["gatesPassed"] for r in runs),
        "clipMedian": statistics.median(clips),
        "clips": len(clips),
    }
    extra = {}
    if args.compare:
        by_id = {r["id"]: r for r in runs}
        missing = [i for i in args.compare if i not in by_id]
        if missing:
            sys.exit(f"no completed run for: {', '.join(missing)}")
        extra["compare"] = {"old": by_id[args.compare[0]], "new": by_id[args.compare[1]], "note": args.note,
                           "changed": args.changed.split(",")}
    template = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "production-gantt.template.html")).read()
    data = json.dumps({"runs": runs, "summary": summary, **extra}, ensure_ascii=False).replace("</", "<\\/")
    sys.stdout.write(template.replace("/*__DATA__*/null", data))


if __name__ == "__main__":
    main()
