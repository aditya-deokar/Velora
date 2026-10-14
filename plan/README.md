# Velora — AI-Agent-Native CLI-First Remotion Alternative: Implementation Plan

Source brief: `prompt.md` (4107 chars, single vision statement).
Repo audited: `2026-10-13`. Current version: `velora@0.1.2` (`velora` alias).

## 1. Vision (from prompt.md)

Evolve the existing **Velora MVP** into a **10× better, AI-agent-native, CLI-first alternative to Remotion**, designed for **AI coding agents, not GUI operators**.

> Defining principle: **the CLI provides the capabilities; the skills provide the intelligence for using those capabilities correctly.**

The agent execution loop is:

```
interpret request → load relevant skill(s) → inspect project →
plan composition → generate/modify source → invoke CLI →
render preview → inspect frames/video evidence → fix issues → repeat until validation passes
```

Everything built must serve that loop with **real, verified functionality — no mocks**.

## 2. What exists today (audit summary)

| Area | Current state | Location |
|---|---|---|
| Rendering engine | Live-DOM cinematic renderer: black void, camera (xyz + rotate + perspective), thin-lens focus v3 (`distance/fStop/focalLength/maxBlur`), `Surface` leaves + `preserve-3d` groups, native CSS filter approximation | `src/core/scene.ts`, `spatial.ts`, `motion.ts`, `choreography.ts`, `src/react/index.tsx`, `registry.ts`, `FocusFilter.tsx`, `capture.ts` |
| Preview / studio | Shared `ScenePreview` + `usePreviewSession` (single elapsed cursor, pause-on-edit, seek/replay/capture), `SceneLibrary` credits-scroll list, aspect-cover framing, snapshot tiles | `src/preview/*`, `src/core/preview.ts`, `app/main.tsx` |
| Authoring contract | `SceneSchema` / `MotionSchema` / `PreviewDefinitionSchema` / `SceneRecipeSchema` v1 + `getAuthoringGuide()` v2 + `reviewAuthoring()` advisory check | `src/core/authoring.ts`, `recipes.ts` |
| CLI (dual name `velora`/`velora`) | `guide, init, open, sync, scenes, load, validate, snapshot, export`, `--json`, exit codes 0/1/2, TTY/No-color handling, `--version/--help` | `src/cli/index.ts`, `main.ts`, `terminal.ts`, `vite.cli.config.ts`, `scripts/finalize-cli.mjs` |
| Project layer | `executeProjectCommand` (`init-project, open-preview, sync-project, load/validate-project`), portable Next/Vite/Electron adapters, `VELORA.md`/`VELORA.md` handoff, `discovery.ts`, scoped services | `src/project/*`, `src/core/project.ts`, `resources.ts` |
| Export | `executeVideoExport` + `executeSceneSnapshot` via Playwright Chromium + FFmpeg, `CaptureManifestSchema`, FPS 30/60/120 | `src/export/commands.ts`, `services.ts`, `src/core/export.ts` |
| Skills | 22 installed GSAP + Three.js + motion-engineer skills under `skills/` (not yet Velora-specific); no root `SKILL.md`, no installable Velora library | `skills/`, `skills-lock.json` |
| Tests / gates | `verify:*` chains (motion → launch → iterate → reuse → agent → release), Playwright browser + performance, architecture checker, `local-project/` installed-host fixture | `tests/`, `scripts/check-*.mjs`, `verify-mvp.mjs`, `playwright*.config.ts` |
| Docs / release | `docs/architecture.md` + `docs/product.md` only (checker-enforced), MIT, `npm install velora` + `npx velora init`, GitHub OIDC publish on `main` version bump | `docs/`, `scripts/release.mjs` |

### Highest-impact gaps (prioritized)

1. **CLI is human-readable first, not agent-first** — partial `--json`, no uniform envelope, no machine error codes catalog, no `inspect/describe`, no progress streaming, no non-interactive guarantee.
2. **No Velora Skills library** — agents only have `velora guide` text; no progressive-discovery `SKILL.md` tree, no per-domain skills, no command↔skill routing table.
3. **No first-class timeline/composition spec** — recipes are single-scene JSON+TSX; no multi-scene timeline, no reusable components catalog, no asset management, no schema-validated composition file.
4. **Determinism + frame accuracy missing** — wall-clock preview, no seeded RNG, no frame-time manifest, no `render --frame` / `--time` extraction contract beyond snapshot.
5. **Audio/subtitles/typography/transitions/procedural/2D-3D are concepts, not CLI capabilities** — no audio mix schema, no SRT/VTT pipeline, no kinetic-text helper, no transition library, no GSAP/Three.js bridge commands.
6. **No verify loop primitives** — no `frames extract`, `check --visual`, `diff`, caching, or parallel-safe render.

## 3. Phase map

| Phase | File | Goal | Depends on |
|---|---|---|---|
| 00 | `PHASE-00-audit-and-baseline.md` | Freeze audit, preserve working surface, set gates + metrics | — |
| 01 | `PHASE-01-agent-first-cli-foundation.md` | Discoverable, JSON-first, non-interactive CLI with stable exit codes + error catalog | 00 |
| 02 | `PHASE-02-composition-spec-and-project-inspection.md` | Machine-readable composition spec, `inspect`/`validate`, assets, reusable scenes | 00, 01 |
| 03 | `PHASE-03-timeline-determinism-frame-accuracy.md` | Multi-scene timeline orchestration, deterministic seeded rendering, frame-accurate clock | 01, 02 |
| 04 | `PHASE-04-audio-subtitles-typography-kinetic-text.md` | Audio sync, subtitles, typography/kinetic-text system | 02, 03 |
| 05 | `PHASE-05-transitions-procedural-2D-3D.md` | Transitions library, procedural graphics, GSAP + Three.js/WebGL + Ewmotion bridges | 02, 03 |
| 06 | `PHASE-06-render-export-inspect-verify.md` | Progress, frame extraction, screenshots, auto visual checks, cache, parallel render | 01–05 |
| 07 | `PHASE-07-skills-library-core.md` | Root `SKILL.md`, install flow, progressive discovery, first skill batch | 01, 02 |
| 08 | `PHASE-08-skills-library-specialized.md` | Remaining specialized skills, templates, reference docs, scripts | 03–07 |
| 09 | `PHASE-09-agent-loop-examples-tests-adoption.md` | E2E agent loop demos, example projects, test gates, adoption docs | all |

Read in order. Each phase file is self-contained: goal → prerequisites → scope in/out → tasks → CLI/skill contracts → files → tests → validation → anti-patterns → Definition of Done.

## 4. Global rules (apply to every phase)

1. **Preserve working functionality.** Never break `init/open/sync/scenes/load/validate/snapshot/export/guide` behavior or the `verify:*` gates. Extend, don't fork.
2. **Real functionality only.** Every command + skill maps to executed code covered by a test. No mocks, no placeholder skills.
3. **Core stays pure.** `src/core/*` = pure, browser/Node-independent, Zod-validated. Side effects only in `src/project/services.ts` + `src/export/services.ts` behind command boundaries (`architecture.md` § Boundaries).
4. **Agent-first DX.** Every command: `--help` + `--json`, stable exit codes (`0 ok / 1 operational fail / 2 usage error`), machine-readable `code+path+message+hints`, non-interactive by default (no prompts, `NO_COLOR`/pipe safe).
5. **Progressive skills.** Root `SKILL.md` < 500 lines; specialized skills loaded on demand; every skill states *when to use / which command / which skill next / when NOT to use*.
6. **Verify loop.** Every feature ships with: schema validation → CLI invocation → rendered evidence (frame/MP4) → automated check → troubleshooting entry.
7. **Docs budget.** `docs/` stays at 2 files per architecture checker unless the checker is explicitly migrated in Phase 07 (plan calls this out).

## 5. How to execute

- Work phase-sequentially; do not start 03+ before 01's JSON envelope + error catalog land (all later phases depend on them).
- Use REA / parallel subagents for research, implementation, and review where a phase file says so — but keep the architecture-checker green after every slice.
- After each phase: run that phase's **Validation** section, then the repo gate it extends (`verify:launch` → `verify:iterate` → `verify:reuse` → `verify:agent`).
