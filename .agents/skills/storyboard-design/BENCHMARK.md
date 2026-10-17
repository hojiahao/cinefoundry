# Skill Benchmark: storyboard-design

Baseline versus skill on the same model and the same briefs. The only variable is whether the
agent's system prompt contains this skill. Each run gets **one attempt** and is scored by the
validators in `src/agent/checks.ts` - the same code the director uses to accept or reject work -
so a violation is a rule the retry loop would otherwise have to clean up.

## Evaluation metadata

- Date: 2026-09-23
- Model: `nemotron-3.5-lightning` served locally by vLLM on one DGX Spark (GB10), thinking off
- Briefs: 8 advertising requests in `eval/briefs.json`, 2 runs each
- Raw data: `eval/results/ablation-v3.json` · Reproduce: `cinefoundry eval --repeats 2 && cinefoundry eval --report-only`

## Results

| Measure | Baseline (no skill) | With skill |
|---|---:|---:|
| Runs scored | 15 | 15 |
| Clean on the first attempt | 0/15 (0%) | 6/15 (40%) |
| Mean rule violations per run | 3.8 | 0.8 |

### Most frequent violations without the skill

| Count | Violation |
|---:|---|
| 25 | image_prompt must be in English; Chinese is only allowed inside the quoted on-screen text |
| 10 | style line contains numbers, which the image model paints into the frame |
| 9 | image_prompt asks the model to draw text |
| 2 | video_prompt must be in English and must not contain on-screen text |
| 1 | camera must be exactly one move (found: static, subtle pan down as sweat rolls down face) |
| 1 | camera must be exactly one move (found: slow dolly-in with focus pull) |

### Violations that remain with the skill

| Count | Violation |
|---:|---|
| 3 | camera must be exactly one move (found: slow push-in with subtle handheld float) |
| 3 | no usable JSON: nemotron did not return usable JSON after 1 attempts: reply was not valid  |
| 1 | camera must be exactly one move (found: Slow push-in with a subtle handheld float) |
| 1 | camera must be exactly one move (found: Slow pull-back with gentle tilt) |
| 1 | camera must be exactly one move (found: slow pull-back with subtle handheld float) |
| 1 | camera must be exactly one move (found: slow push-in with steady tilt) |

## Reading these numbers

- The validators check form - beat count, line length, language, one camera move, no text drawn
  inside frames - not whether the copy is good. A clean run is a usable draft, not a good ad.
- Timings from this run are not reported: it shared the GPU with a film generation job.
- Remaining violations are the skill's to-do list; they are fed back into the skill text.
