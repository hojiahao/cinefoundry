# Skill Benchmark: ad-script-writing

Baseline versus skill on the same model and the same briefs. The only variable is whether the
agent's system prompt contains this skill. Each run gets **one attempt** and is scored by the
validators in `src/agent/checks.ts` - the same code the director uses to accept or reject work -
so a violation is a rule the retry loop would otherwise have to clean up.

## Evaluation metadata

- Date: 2026-09-23
- Model: `nemotron-3.5-lightning` served locally by vLLM on one DGX Spark (GB10), thinking off
- Briefs: 8 advertising requests in `eval/briefs.json`, 2 runs each
- Raw data: `eval/results/ablation-v3.json` · Reproduce: `spotfoundry eval --repeats 2 && spotfoundry eval --report-only`

## Results

| Measure | Baseline (no skill) | With skill |
|---|---:|---:|
| Runs scored | 16 | 16 |
| Clean on the first attempt | 11/16 (69%) | 14/16 (88%) |
| Mean rule violations per run | 0.38 | 0.13 |

### Most frequent violations without the skill

| Count | Violation |
|---:|---|
| 2 | restricted wording "治愈" (medical_claim): 非医疗、药品、医疗器械广告不得涉及疾病治疗功能或使用医疗用语（《广告法》第十七条）。 |
| 1 | restricted wording "最佳" (absolute_terms): 《广告法》第九条第（三）项禁止使用“国家级”“最高级”“最佳”等绝对化用语。 |
| 1 | restricted wording "极致" (absolute_terms): 《广告法》第九条第（三）项禁止使用“国家级”“最高级”“最佳”等绝对化用语。 |
| 1 | voiceover has only N characters; write 8-18 so the beat is not mostly silence |
| 1 | no usable JSON: nemotron did not return usable JSON after 1 attempts: reply was not valid  |

### Violations that remain with the skill

| Count | Violation |
|---:|---|
| 1 | restricted wording "治愈" (medical_claim): 非医疗、药品、医疗器械广告不得涉及疾病治疗功能或使用医疗用语（《广告法》第十七条）。 |
| 1 | no usable JSON: nemotron did not return usable JSON after 1 attempts: reply was not valid  |

## Reading these numbers

- The validators check form - beat count, line length, language, one camera move, no text drawn
  inside frames - not whether the copy is good. A clean run is a usable draft, not a good ad.
- Timings from this run are not reported: it shared the GPU with a film generation job.
- Remaining violations are the skill's to-do list; they are fed back into the skill text.
