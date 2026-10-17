# How Cinefoundry maps real production

**English** · [简体中文](production-pipeline.zh-CN.md)

Cinefoundry makes three formats: ad films, creator shorts and micro-dramas. Each one follows the workflow a professional
crew uses for that format. Every crew role is a skill (`.agents/skills/<name>/SKILL.md`), every production step is a
pipeline stage (`src/pipelines`), and every hand-off between roles is a gate that code enforces. This document sets
out how the three are matched: the industry workflow, the roles and the 25 skills, the stages of each pipeline, the
gates and the delivery specifications. The industry sources are collected in
[`research/film-shortvideo-drama-standards.md`](research/film-shortvideo-drama-standards.md).

## 1. The industry workflow

### Ad film

A top commercial is made by three companies in sequence: the agency (account planning, strategy, creative, copy,
legal), the production house (director, DP, art department, casting, crew) and the post house (edit, grade, titles,
sound, versioning, QC).

| Phase | Step | Who |
|---|---|---|
| Pre-production | Client brief: objective, audience, single-minded proposition, channels, specs | Account manager, planner |
| | Insight, big idea, director's treatment (visual concept, light, palette, rhythm, sound) | Strategist, creative director, director |
| | Script and announcer copy | Copywriter |
| | Legal clearance of claims, wording, music and likeness | Agency legal |
| | Storyboard and shot list | Director, storyboard artist |
| | Casting, production design, product styling, light plan | Casting director, production designer, stylist, DP |
| Production | The shoot: performance, camera, light | Director, DP, gaffer, crew |
| | Video assist and footage checks: focus, exposure, product correct, nothing out of place | Video assist, DIT |
| Post-production | Offline edit: rhythm, story, length | Editor |
| | Grade, titles and end card | Colourist, title designer |
| | Announcer, sound design, music, mix to the broadcast or web loudness | Voice director, sound designer, composer, mixer |
| | Versioning: 30-second master, 15- and 6-second cutdowns | Versioning editor |
| | Technical QC and delivery | QC and delivery |

### Creator short

Leading creator teams split production into fixed roles, one person per job, each with a fixed checklist
(research §2.2). The structure is built for the feed: a hook in the first three seconds, a visual change every few
seconds, a turn every 30 to 60 seconds in a skit, and packaging that decides whether the video is played at all.

| Phase | Step | Who |
|---|---|---|
| Development | Topic and angle; format: presenter piece, review, explainer, skit, product short | Creator, content writer |
| Writing | Hook, retention structure, pattern interrupts, lines | Content writer |
| Review | Platform rules, AI labelling, likeness | Platform compliance |
| Production | Presenter or cast on camera, B-roll, inserts | Director, camera |
| Post | Retention edit, subtitles in the vertical safe zone, sound, mix to the platform loudness | Editor, subtitle editor, sound |
| Packaging | Three titles to A/B test, cover frame and its words, description, hashtags, AI disclosure | Packaging and growth editor |

### Micro-drama

A micro-drama is a vertical series of short episodes with a hook in the opening seconds, an emotional beat every 20
to 30 seconds and a cliffhanger at every episode end; the paywall falls on an emotional peak (research §3.2). Its
crew follows film and television practice: a showrunner who holds the series bible, writers working inside it,
casting and a script supervisor who keep faces, wardrobe and props continuous, dialogue editing and ADR, sound design,
score and a re-recording mix. Every episode of an AI-generated micro-drama carries an AI label (NRTA Order No. 16, in
force 2026-09-01).

| Phase | Step | Who |
|---|---|---|
| Development | Logline, genre and tone, world, characters, episode plan with hooks, cliffhangers and paywall | Showrunner, head writer |
| | Premise clearance against broadcast rules and the 2026 content clean-up | Content review |
| Writing | Episode screenplays inside the bible | Screenwriter |
| Pre-production | Shot breakdown: coverage, dialogue framing, screen direction | Director, DP, script supervisor |
| | Casting, reference looks, wardrobe and continuity | Casting director, costume designer, script supervisor |
| Production | Performance and dialogue on camera | Director, cast |
| Post | Dialogue edit and ADR, sound effects and ambience, score, four-stem mix | Dialogue editor, sound designer, composer, mixer |
| | Cut, grade, bilingual subtitles, AI label, technical QC per episode | Editor, colourist, subtitle editor, QC |

## 2. Roles and skills

25 skills, one per role, in six categories (the `metadata.category` field of each `SKILL.md`). The *Runs in* column
says where the role works: a pipeline stage whose agent loads the skill, or a step the engine carries out in code
following the skill's rules (rules the code enforces are marked *checked* in the skill).

### Production (7)

| Skill | Role | Runs in |
|---|---|---|
| `cinefoundry-ad-film` | Ad producer | Entry point for external agents: runs `cinefoundry ad` and reports from the delivery record |
| `cinefoundry-short-video` | Short-video producer | Entry point: runs `cinefoundry short` |
| `cinefoundry-micro-drama` | Series producer | Entry point: runs `cinefoundry drama` |
| `ad-brief-intake` | Account planner | Ad stage `brief` |
| `ad-compliance-review` | Advertising legal | Ad stage `compliance` and the cutdown copy in `versions` |
| `content-compliance` | Content review | Short and drama stages `development` (premise) and `compliance` |
| `spark-model-scheduler` | Technical producer | Engine phase boundaries: language models rested, one diffusion family loaded at a time |

### Writing (5)

| Skill | Role | Runs in |
|---|---|---|
| `creative-direction` | Creative director | Ad stage `creative`: insight, proposition, concept, treatment, cast voice, score and ambience direction |
| `ad-script-writing` | Copywriter | Ad stage `script`, and the cutdown copy in `versions` |
| `series-development` | Showrunner | Drama stage `development`: the series bible |
| `short-video-scripting` | Creator-content writer | Short stages `development` (topic) and `screenplay` |
| `screenwriting` | Screenwriter | Drama stage `screenplay` |

### Picture (5)

| Skill | Role | Runs in |
|---|---|---|
| `storyboard-design` | Director, storyboard artist | Ad stage `storyboard`; short and drama stage `shots` |
| `cinematography-and-art-direction` | DP, production designer, product stylist | Ad stage `storyboard`; short and drama stage `shots` |
| `character-and-continuity` | Casting director, costume designer, script supervisor | Short and drama stages `shots` and `casting` |
| `spark-local-media-generation` | Camera crew | Code: hero still, reference-anchored frames, clips at native 1080p, RIFE interpolation |
| `shot-quality-gate` | Video assist, QC | Ad stage `frames` (gate verdicts and prompt repairs); narrative frames are gated in code |

### Sound (2)

| Skill | Role | Runs in |
|---|---|---|
| `dialogue-and-voice` | Voice casting, dialogue director, ADR | Code: voice casting from the library, Whisper-checked takes and retakes, lip-sync rules |
| `sound-design-and-music` | Sound designer, composer | Short and drama stage `sound` |

### Post (5)

| Skill | Role | Runs in |
|---|---|---|
| `editing-and-versioning` | Editor, versioning editor | Ad stage `versions`: the 15- and 6-second cutdowns |
| `final-cut-assembly` | Finishing: grade, titles, mix | Code: ad stage `cut`, and `cinefoundry cut --project <id>` to re-finish |
| `bilingual-subtitles` | Timed-text lead | Code: Chinese over English subtitles in every cut |
| `platform-packaging` | Packaging and growth editor | Short stage `packaging` |
| `delivery-qc` | QC and delivery | Ad stage `qc`; the QC pass at the end of the short and drama stage `cut` |

### Research (1)

| Skill | Role | Runs in |
|---|---|---|
| `ad-reference-breakdown` | Reference research | On request: `cinefoundry shots <video>` cuts a reference film into shots, `cinefoundry qa` describes them |

## 3. The pipelines

One engine (`src/engine`) runs every format: preflight checks, the one-film-at-a-time lock
(`projects/.harness.lock`), stage status in `projects/<id>/state.json`, the run log `reports/run.jsonl` and model
scheduling. A format is an ordered list of stages. With `--plan-only` every format stops after its writing and shot
stages, before any GPU time is spent.

### Ad film: `cinefoundry ad "<brief>"`

Defined in `src/pipelines/ad/index.ts`. A 30-second master is six 5-second shots and a 3-second end card.

| Stage | Role and skills | Writes | Gate |
|---|---|---|---|
| `brief` (需求) | Intake producer: `ad-brief-intake` | `brief.json` | `checkBrief`; the client's stated ratio, length, closing line and product appearance override the agent's choices; a product photo is read by Step3-VL |
| `creative` (创意) | Creative director: `creative-direction` | `creative/treatment.json` | `checkTreatment`, 4 attempts; the voice must be a QC-passed English announcer from the library |
| `script` (脚本) | Copywriter: `ad-script-writing` | `script/script.draft.json` | `checkScript`, 6 attempts; the run stops if hard problems remain |
| `compliance` (合规) | Independent reviewer: `ad-compliance-review` | `script/script.json`, `script/copy.txt`, `reports/compliance.json` | Advertising Law scan, then a reviewer who did not write the copy; a `block` finding stops the run |
| `storyboard` (分镜) | Storyboard artist with the DP: `storyboard-design`, `cinematography-and-art-direction` | `storyboard/storyboard.json` | `checkStoryboard`, 6 attempts; the run stops if hard problems remain |
| `frames` (生图) | Camera crew and video assist: `shot-quality-gate` | `frames/` | Hero still gated against the brief; every first frame gated against the hero still (see §4) |
| `clips` (生视频) | Camera crew | `clips/shot_001.mp4` … | First-frame-driven video, LTX-2.5 Fast NVFP4 by default; RIFE to a high-frame-rate master above 24 fps |
| `cut` (成片) | Finishing: `final-cut-assembly`, `bilingual-subtitles`, `dialogue-and-voice` | `cut/final.mp4`, `cut/titles.ass`, `reports/delivery.md` | Announcer lines checked by Whisper; title font checked for every glyph |
| `versions` (版本) | Versioning editor: `editing-and-versioning`, `ad-script-writing` | `cut/final_15s.mp4`, `cut/final_06s.mp4`, `cut/version_<id>.json` | `checkVersion`, 4 attempts; cutdown copy passes the same compliance review; a version that cannot pass is reported, not cut |
| `qc` (技术质检) | QC: `delivery-qc` | `reports/qc.json` | Every deliverable measured (§4) |

### Creator short: `cinefoundry short "<topic>"`

Defined in `src/pipelines/short/index.ts` on the narrative stages of `src/crafts/narrative/pipeline.ts`. One video,
60 seconds by default (12 shots of 5 seconds), up to 180 seconds.

| Stage | Role and skills | Writes | Gate |
|---|---|---|---|
| `development` (选题) | Creator-content writer: `short-video-scripting`, `content-compliance` | `story/bible.json` | `checkBible`, 5 attempts; premise reviewed by an independent reviewer, sent back at most twice, then the run stops |
| `screenplay` (剧本) | Writer: `short-video-scripting` | `story/` | `checkScreenplay`, 6 attempts; every line fits one 5-second shot |
| `compliance` (合规) | Independent reviewer: `content-compliance` | `reports/compliance.ep<n>.json` | Wording scan of the subtitles, then a reviewer whose every finding must quote the page; an episode not approved after its rewrite stops the run |
| `shots` (分镜) | Director, DP, script supervisor: `storyboard-design`, `cinematography-and-art-direction`, `character-and-continuity` | `storyboard/ep01.shots.json` | `checkShots`, 6 attempts; dialogue shot single |
| `casting` (选角定妆) | Casting: `character-and-continuity` | `cast/<id>/character.json` | Casting call of 4 candidates, 2 calls per role; reference views gated for identity; a voice from the library or designed for the character |
| `frames` (生图质检) | Camera crew | `frames/` | Each frame gated against the master portraits of the characters in it |
| `dialogue` (对白) | Code, `dialogue-and-voice` | voice takes | Whisper on every line, retaken until heard right |
| `clips` (生视频) | Camera crew | `clips/` | Dialogue shots lip-synced to the frozen line (LTX-2.5 audio-driven); RIFE above 24 fps |
| `sound` (声音) | Sound designer and composer: `sound-design-and-music` | `audio/` | Ambience per scene, effects on at most half the shots (MOSS-SoundEffect v2), score (ACE-Step) |
| `cut` (成片) | Code: finishing, `bilingual-subtitles`, `delivery-qc` | `cut/ep01.mp4`, `cut/ep01.ass`, `reports/qc.json` | Hard cuts, four-bus mix, subtitles timed to the spoken line, AI label, −14 LUFS; delivery QC |
| `packaging` (平台包装) | Packaging editor: `platform-packaging` | `reports/packaging.json`, `cut/cover.jpg` | `checkPackaging`, 4 attempts: three titles, at least one in Chinese, no click-bait; the description discloses AI |

### Micro-drama: `cinefoundry drama "<story>"`

Defined in `src/pipelines/drama/index.ts` on the same narrative stages. `--episodes` plans the series (1 to 30
episodes), `--produce` makes the first *n* of them; episodes run 120 seconds by default (24 shots), up to 180 seconds.
`--cast <dir>` reuses characters already cast, so a later episode or series run puts the same people on screen.

| Stage | Difference from the short |
|---|---|
| `development` (剧本开发) | The showrunner (`series-development`) writes the series bible: logline, world, look, up to five characters, and an episode plan with hook and cliffhanger per episode |
| `screenplay` (剧本) | `screenwriting`: each episode opens on its hook, ends on its cliffhanger and continues from the previous episode |
| `compliance` … `cut` | As for the short, per produced episode: `cut/ep01.mp4`, `cut/ep02.mp4` … |
| — | No packaging stage |

## 4. The gates

Every stage hands over only what passed its gate. A gate that cannot be satisfied within its limit either stops the
run (when going on would make the film wrong) or keeps the best attempt and reports it as an open item in the log and
the delivery report.

| Gate | Where | Limit | When it is not met |
|---|---|---|---|
| Deterministic validators (`src/agent/checks.ts`, `src/crafts/narrative/checks.ts`) | Every writing and shot stage | 4 to 6 attempts, the last two with reasoning on; each rejection returns the exact reasons | Script, storyboard, development, screenplay and shots: the run stops. Treatment and packaging: the best draft is kept with its open points logged. A cutdown: not cut, reported open |
| Structured copy judge (Jev, optional, cloud, `TYPESAFE_API_KEY`) | Ad `script` and `storyboard` | Probability ≥ 0.7 returns the line for rewrite; 0.3 to 0.7 goes to the reviewer | — |
| Advertising compliance | Ad `compliance` and every cutdown | Scan, independent review, rewrites kept only if they pass `checkScript` | A `block` finding stops the run |
| Content compliance | Short and drama `development` and `compliance` | Premise sent back at most twice; each episode rewritten once and reviewed again | The run stops before any frame is generated |
| Product hero still | Ad `frames` | 3 attempts, prompts repaired against the gate's words | The run stops: every frame is anchored to it. A supplied product photo is the reference instead |
| Frame gate (Step3-VL) | Ad `frames` | 2 seeds, then 2 prompt repairs | Best attempt kept, reported as an open item |
| Casting gate | Short and drama `casting` | 4 candidates per call, 2 calls per role; 3 edits per reference view | Best candidate kept as an open item; a view that never matches is dropped and frames use the master |
| Identity gate on frames | Short and drama `frames` | 3 tries, the last carrying the gate's issues | Best attempt kept, reported as an open item |
| Spoken-line check (Whisper large-v3-turbo) | Ad announcer, narrative dialogue | Error above 8 % is retaken, 2 retakes | The line is reported as an open item: listen before release |
| Delivery QC (`src/crafts/qc.ts`) | Ad `qc`, narrative `cut` | Container, codec, resolution, frame rate and frame count, duration, bitrate, colour, faststart, black frames, frozen picture, audio, loudness and range, true peak, clipping, silence, subtitles, AI label, AIGC metadata | Every fail and warn is an open item; the file is kept and the fix goes back to the stage that owns it |

## 5. Delivery specifications

| | Ad film | Creator short | Micro-drama |
|---|---|---|---|
| Length | 30 s master, 15 s and 6 s cutdowns (`--duration` 5 to 30 s, in steps of 5) | 60 s (`--seconds` 10 to 180) | 2-minute episodes (`--seconds` 10 to 180), up to 30 planned |
| Frame | 16:9; 9:16 and 1:1 with `--ratio` | 9:16 | 9:16 |
| Resolution | Native 1080p (1920×1080); `2k`, `4k`, `6k` presets upscaled in the cut and reported as upscaled | Native 1080p (1080×1920) | Native 1080p (1080×1920) |
| Frame rate | 60 fps, RIFE-interpolated from the clips | 30 fps | 24 fps |
| Voice | English announcer from the casting library | Presenter or characters, lip-synced English | Characters, lip-synced English |
| Sound | Announcer over a ducked ACE-Step score | Four buses: dialogue, effects, ambience, score | Four buses: dialogue, effects, ambience, score |
| Subtitles | Chinese over English; at most 16 Chinese characters a line on 16:9, 12 on 9:16 | Chinese over English, inside the vertical safe zone | Chinese over English, inside the vertical safe zone |
| Loudness | −16 LUFS ±1, true peak −1.5 dBTP | −14 LUFS ±1, true peak −1.0 dBTP | −14 LUFS ±1, true peak −1.0 dBTP |
| Edit | Hard cuts, a 0.5 s dissolve into the 3 s end card | Hard cuts at 5 s | Hard cuts at 5 s |
| AI labels | 内容由 AI 生成 on the opening and the end card; implicit AIGC metadata (GB 45438-2025) | Same, plus the disclosure in the description | Same, on every episode |
| Deliverables | `cut/final.mp4`, `cut/final_15s.mp4`, `cut/final_06s.mp4`, `reports/delivery.md`, `reports/qc.json` | `cut/ep01.mp4`, `cut/cover.jpg`, `reports/packaging.json`, `reports/qc.json` | `cut/ep<nn>.mp4` per produced episode, `reports/qc.json` |

## 6. Where an AI crew works differently

- **Fixed 5-second shots.** The video models generate 5-second clips, so every narrative shot is 5 seconds and every
  line of dialogue fits one shot; an ad cutdown trims shots from their heads.
- **Dialogue is shot single.** Two people speaking in one frame is not reliable, so every line is filmed on its
  speaker alone or over the listener's shoulder, the shot / reverse-shot coverage a director would use anyway.
- **Continuity is decided once.** The script supervisor's job is carried by references: one gated hero still per
  product, one locked portrait and reference pack per character, and every frame generated from them.
- **No text in the picture.** Titles, subtitles, the end card and the AI label are typeset in the cut, in a font
  checked for every glyph.
- **Finishing is code.** Grade, titles and the mix are three roles on a live production; here they are one finishing
  pass run by code with parameters from the treatment and the category, so the master and every cutdown are finished
  alike.
