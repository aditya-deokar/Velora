# Phase 09 — Agent Loop Closure, Example Projects, Test Gates & Adoption

## Goal
Prove **an AI agent can create, render, inspect, and refine a complete video using only Velora's CLI and skills** — with production-oriented packaging, tests, setup docs, and E2E demonstrations. Implements `prompt.md`'s delivery clause: *"production-oriented CLI, the complete Skills library, realistic example projects, automated tests, agent setup instructions, and end-to-end demonstrations."*

## Prerequisites
- All Phases 00–08 merged. `local-project/` fixtures healthy. Release pipeline understood (`scripts/release.mjs`, `verify:release`, `verify:ci`).

## Scope IN
- E2E agent-loop demos, example projects, full gate wiring, adoption docs, release readiness.
- Honest scope: local-first, React DOM 18.2+/19, FFmpeg+Chromium prerequisites.

## Scope OUT
- No hosted service, accounts, licensing, visual builder, or focus-position editor (deferred per product boundaries — restate, don't smuggle in).

## Tasks

### 09.1 End-to-end agent demonstrations (2+, real, recorded)
1. **Demo A — product teaser (live-UI path):** agent takes a host route/component → `velora init` (if needed) → `inspect` → writes recipe + composition (multi-scene + transition + kinetic title + audio + captions) → `validate` → `render` → `frames` → `check --visual` → fixes at least one real detected issue on camera → final MP4 + manifests committed under `tests/agent/<demo>/` (fixtures only, never product build).
2. **Demo B — procedural/3D path:** seeded procedural + time-disciplined WebGL scene + focus-pull transition → determinism proof (two renders, identical hashes) + `check --visual` green.
3. Each demo ships: starting prompt, skill-load trace (which skills, in which order), CLI transcript (`--json` excerpts), before/after frames, final MP4, manifest, issue-fix log.
4. Use REA / parallel subagents for independent demo builds + review, per `prompt.md` allowance — but demos run against the real CLI/skills, never stubs.

### 09.2 Realistic example projects
- 3+ examples (disposable-host compatible, derived from Phase 08 templates): SaaS product tour, kinetic-title explainer, dashboard data-story (seeded procedural + captions).
- Each: README (prompt → skills → commands), composition + recipes + assets, `validate` clean, `check --visual` green, expected frame hashes recorded.
- Keep out of product build + npm package (fixtures under `tests/` unless an `examples/` exclusion is explicitly wired into Vite + `release.mjs` allowlist).

### 09.3 Gates + release readiness
1. Wire gates: every phase's tests fold into `verify:launch → verify:iterate → verify:reuse → verify:agent → verify:release`; update `scripts/check-*.mjs` (skills lint, determinism, transcript replay) without breaking `lint:architecture`.
2. Branding/attribution intact (`FLUTE_BRAND`, creator link — checker-enforced owner).
3. `prepack`/`release.mjs` include skills + templates + reference + schemas; package excludes tests/fixtures/demo MP4s (allowlist check).
4. Version-bump flow documented: maintainer runs `verify:release` locally → pushes `main` → GitHub OIDC publishes (existing workflow — no new CI jobs per product stance).

### 09.4 Adoption docs
- README section: *Install (`npm i velora`) → `npx velora init` → `npx velora guide` → skills install → first `render`* (5-minute path, copy-pasteable, `--json`-first).
- Compatibility matrix (agents × React × Node × FFmpeg/Chromium) + *"bring your own agent subscription"* (Velora owns no AI auth — per product doc).
- Migration notes: `flute`↔`velora` dual-name, recipe v1/scene-v3 compat, legacy wrapper migration (already owned by project layer — surface it).

## Files to create/modify
- `tests/agent/<demo-a>/`, `tests/agent/<demo-b>/` (prompts, transcripts, manifests, frames — small; MP4s git-ignored with hashes recorded, or LFS-free tiny fixtures).
- `examples/` ONLY if excluded from product build + package (else keep under `tests/` — architecture rule wins; decide in exit note).
- `README.md` adoption section, `skills/velora/COMPATIBILITY.md`, release-checklist update.
- `scripts/verify-mvp.mjs` / `check-agent.mjs` extensions (skills-trace assertion, determinism assertion).

## Tests / gates
- Full chain green: `verify:launch → verify:iterate → verify:reuse → verify:agent → verify:release` (hardware-gated perf where available; `verify:ci` otherwise).
- New: `test:agent` asserts both demos' CLI transcripts replay cleanly; determinism assertion (same seed → same hashes); skills-trace coverage (every demo step maps to a loaded skill).

## Validation criteria
- [ ] Untrained-agent replay: a reviewer following only the root `SKILL.md` + CLI `--help` reproduces Demo A to a passing `check --visual` without human GUI work.
- [ ] `verify:agent` + `verify:release` green; package installs from tarball AND registry path with working `init → render` proof.
- [ ] Docs state prerequisites, limits (DOM-only, local-only, no TTS/transcription, technical-not-artistic verification), and deferred items honestly.
- [ ] No mock command or unexecuted skill example anywhere in the shipped surface.

## Anti-patterns
- Demo MP4s/large binaries in the npm package or product build.
- Claiming universal quality/perf ("cinematic guaranteed", "60fps everywhere") — evidence is device/scene-specific.
- Tight-coupling core to one agent (snippets additive; `--json` contract is the coupling surface).

## Definition of Done
Phase 09 closes the program: CLI + skills + examples + tests + adoption docs prove the defining principle in action — **agents discover what's possible, understand how to do it, select the right tools, and consistently produce production-quality videos without a GUI** — and `prompt.md`'s delivery list is checked off item by item.
