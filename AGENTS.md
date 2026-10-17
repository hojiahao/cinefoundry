# Cinefoundry

Cinefoundry (影工坊) is an agentic film studio on one NVIDIA DGX Spark: one idea in, a finished film out. One agent
engine (`src/engine`) runs a pipeline per format (`src/pipelines`); every stage is an agent working under its skills
(`.agents/skills`), and code checks every result before the next stage starts. This file is read by every agent that
works on or with this repository. The `## Rules` section at the end is also injected into every agent the engine runs.

## Formats

| Format | Command | Pipeline | Defaults |
|---|---|---|---|
| Ad film | `cinefoundry ad "<brief>"` | brief → creative → script → compliance → storyboard → frames + gate → clips → cut → versions → qc | 30 s master (15 s and 6 s cutdowns), 16:9, native 1080p, 60 fps, −16 LUFS |
| Short video | `cinefoundry short "<topic>"` | topic → screenplay → compliance → shots → casting → frames + gate → dialogue → clips → sound → cut + qc → packaging | 60 s (up to 3 min), 9:16, 1080p, 30 fps, −14 LUFS |
| Micro-drama | `cinefoundry drama "<story>"` | development → screenplay → compliance → shots → casting → frames + gate → dialogue → clips → sound → cut + qc | 2-minute episodes, 9:16, 1080p, 24 fps, −14 LUFS |

Entry skills: `cinefoundry-ad-film`, `cinefoundry-short-video`, `cinefoundry-micro-drama`. Each project records its
stages in `projects/<id>/state.json`; the studio board reads it.

## The standard

Every film, every line of code, every skill and every sentence of documentation is held to the standard of a Hollywood
production and a top Chinese studio. The purpose is commercial: Cinefoundry is built to win paying clients and
investors, so nothing ships that a top agency, studio or engineering team would send back.

**Films.** Picture, performance, dialogue, sound, music, edit, grade and subtitles meet broadcast and platform
specifications (`docs/research/film-shortvideo-drama-standards.md`) and read as shot by a real crew, not generated.
A frame or a line that fails its gate is redone, and whatever is kept after the limit is reported as an open item.

**Code and engine.** Clear module boundaries (engine / crafts / pipelines / lib), typed interfaces, every rule that can
be checked is a validator with a test, every failure path leaves the project record truthful. Behaviour changes ship
with tests and the whole suite green (`npx tsc -p . --noEmit && npx vitest run`).

**Skills.** One skill per real production role, grounded in industry practice, concrete enough to act on, consistent
with the code that runs it (rules the code enforces are marked *checked*). Adding or removing a skill updates the
README's Agent Skills badge and skill list in the same change.

**Words.** README, GitHub About, docs and commit messages are written as a finished, professional product: precise,
confident, no filler. They state only what is true and measured: no unmeasured number, no claim the code does not
deliver, no development-status notes, no history of former names in the README.

## Working on this repository

- Measure, don't estimate: timings come from run logs, memory from `cinefoundry mem status`.
- One film at a time on the GPU; never start a run while another holds `projects/.harness.lock`.
- Faces and voices are designed, never a real person's; every deliverable carries the explicit AI label and the implicit AIGC metadata, never removable.
- Outward-facing actions (pushing, publishing, renaming the repository, editing the GitHub About) follow the owner's instruction for that change.
- License: BUSL-1.1, source-available. Never describe the project as open source.

## Rules

- Copy, screenplays and dialogue that fail compliance with a `block` finding never reach media generation. Rewrite, rescan, then continue.
- What must stay the same is decided once and every frame is generated from it: the product's gated hero still in an ad, each character's locked reference portrait in a narrative film. Never describe the product or a character's face again per shot.
- The image model never draws captions. All on-screen text is typeset in the cut, in a font checked to contain every character.
- A frame that fails the quality gate is regenerated within its limit. After that, keep the best attempt, report it as an open item, and move on.
- Characters are adults. Dialogue is shot single - the speaker alone facing camera, or over the listener's shoulder - and every line fits one 5-second shot.
- Generation is local by default. Never send user material to a cloud service unless the user asked for it in this conversation; if they did, record the asset with `execution: cloud`.
- One diffusion family in memory at a time; release at every phase boundary.
- Report measured numbers only: seconds from the CLI output, memory from `cinefoundry mem status`. Never estimate a timing.
- Ask the user only for what blocks the work: for an ad the product, the audience and the one message; for a story, the premise. Decide the rest and state your choice.
- When subagents are available, give each one a single stage with its inputs and the file it must write. Keep compliance and the quality gates with a different agent than the one that produced the work being checked.
