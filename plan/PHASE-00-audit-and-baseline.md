# Phase 00 — Audit & Baseline (freeze what works)

## Goal
Produce a frozen, evidenced baseline of the Velora MVP so all later phases preserve working functionality and attack the highest-impact gaps first (per `prompt.md`: *"audit … preserve working functionality and identify the highest-impact improvements before implementing anything"*).

## Prerequisites
- Clean checkout, Node ≥22.12, FFmpeg + Playwright Chromium installed.
- Read: `prompt.md`, `docs/architecture.md`, `docs/product.md`, `src/cli/index.ts`, `src/core/authoring.ts`, `src/core/resources.ts`.

## Scope IN
- Capability inventory (every CLI command × JSON support × exit code × test).
- Architecture boundary map + allowed-dependency proof.
- Performance + determinism baseline (FPS, export duration, flake rate).
- Installed GSAP / Three.js / motion skills content survey (what they actually teach).
- Risk register + phased priority stack (feeds Phases 01–09).

## Scope OUT
- No feature code. No new commands. No skill writes. Audit artifacts only.

## Tasks

### 00.1 Capability inventory
1. Enumerate CLI surface from `src/cli/index.ts:runCli`: `guide, init, open, sync, scenes, load, validate, snapshot, export, --version, --help` + flag matrix + aliases (`init→init-project`, etc.).
2. For each: record human output vs `--json` output shape, exit code path (0/1/2), and covering test file under `tests/cli/`, `tests/project/`, `tests/export/`.
3. Enumerate `RESOURCES` keys in `src/core/resources.ts` and `VELORA_BRAND` consumers.
4. Output: `plan/artifacts/` is OPTIONAL — otherwise record table in the Phase 00 exit note / PR description. Do not add product fixtures outside `tests/`.

### 00.2 Architecture & purity check
1. Run: `npm run typecheck`, `npm run lint:architecture`, `npm run test:architecture`.
2. Confirm core purity (no browser/Node imports in `src/core/*`), preview→core-only direction, project/export services as sole effect owners.
3. Record any violations as P0 fix-ups for Phase 01.

### 00.3 Behavior baseline
1. Run `npm run verify:launch` (or at minimum `test:launch + test:installed`). Log pass/fail + durations.
2. In `local-project/` host: `scenes --json`, `load --scene <id> --json`, `snapshot --scene <id> --url …`, `export --url … --output … --fps 30` — capture outputs + MP4 frame count + wall time.
3. Record FPS evidence from `test:performance` if hardware allows; mark as device-specific (never a universal promise).

### 00.4 Installed-skills survey
1. For each dir in `skills/` (22: `gsap-*`, `threejs-*`, `understand-and-create-animation`), read its `SKILL.md` front-matter + headings.
2. Build table: skill → teaches → prerequisites → overlaps with Velora needs (GSAP timelines, ScrollTrigger≠video-time, Three.js loaders/materials/lighting, performance).
3. Decide integration pattern for Phase 05/08: **reference, don't copy** — Velora skills link to installed skills for deep API, and own only the video-time mapping (e.g. GSAP easing → `MotionKeyframe.easing`, ScrollTrigger → forbidden in render, Three.js scene → capture-safe bridge).
4. Check `Ewmotion` mention in `prompt.md`: search repo + installed skills; if absent, log as **open research item** for Phase 05 (candidate: motion-workflow helper or external lib — must resolve before building its skill).

### 00.5 Priority stack + exit report
Rank improvements by (agent-unblock × effort). Expected order (validate or correct):
1. Agent-first CLI envelope (Phase 01), 2. composition spec + inspect (02), 3. determinism/frames (03), 4. skills core (07), 5. render/verify (06), 6. audio/type (04), 7. transitions/3D (05), 8. specialized skills + demos (08–09).

## Files to touch
- None in `src/`. Audit notes live in the PR / issue tracker, not in `docs/` (checker allows only 2 files there).

## Tests / evidence
- `npm run typecheck` ✅
- `npm run lint:architecture` ✅
- `npm run test:launch` ✅ (log)
- Manual `export` MP4 + frame count recorded.

## Validation criteria
- [ ] Every current command documented with real `--json` sample + exit code.
- [ ] No undocumented command or flag ships.
- [ ] Skills survey table complete; Ewmotion status resolved to *integrate / defer / drop* with reason.
- [ ] Baseline timings + flake notes recorded.

## Anti-patterns
- Skipping the audit and building new commands on assumed behavior.
- Adding demo apps/galleries to the product build (retired per architecture — fixtures only under `tests/`).
- Copying GSAP/Three.js skill bodies into Velora instead of referencing them.

## Definition of Done
Phase 00 is done when a reviewer can reproduce the baseline table from the recorded commands and the priority stack is agreed for Phases 01–09.
