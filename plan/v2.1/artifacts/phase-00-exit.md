# Phase 00 exit report: foundations, decisions and spikes

Date: 2026-11-14. Branch `feat/v2.1-motion-graphics-suite-plan`, starting commit `88d8b7a`.
Reference machine: Windows 11 (win32-x64), Node 24.12.0, vitest 4.1.11, Playwright 1.58.2 (Chromium build 1208).

## 00.1 Decisions
D1–D14 are recorded in `README.md` §3 as accepted at their recommendations, based on the maintainer's
instruction to implement Phases 00–01. Explicit per-decision confirmation is still pending (before 03 for D1,
and before 12 for D9; both are stop conditions). D6, D10 and D11 also wait on the spikes that have not run (S1, S7, S6).
`docs/product.md` and `docs/architecture.md` are untouched, as the plan requires.

## 00.2 Goldens (`tests/core/fixtures/v21-golden/`)
| Golden | Contents | Count |
|---|---|---|
| `motion.json` | `evaluateMotion` at 25 sample times plus `loopSeam` | 27 committed recipes (from `git ls-files` under `tests/`, `local-project/src/velora/scenes/`, `skills/velora/templates/`) and 310 scaffolds (every template × aspect × intensity, through `templateDefinition`/`compositePreview`) |
| `spatial.json` | `evaluateScene` with fixed synthetic measurements (roots 1400×980, nested 400×300) at 5 times: world matrices, blur, focus depth, issues, `cameraToCss` and `transformToCss` strings | Same 27 + 310 |
| `optics.json` | `lensFor` at 16/24/35/50/85/135/200 mm × 1080/1350/1920 px; `buildShot` and `framingReport` summaries for every `SHOT_KINDS` × aspect × intensity | 21 lenses (3 recorded throws: 135 mm@1920, 200 mm@1350, 200 mm@1920), 180 shots |
| `format-corpus.json` | Exact committed blob bytes (`git show HEAD:<path>`, independent of `core.autocrlf`), base64 plus SHA-256; CRLF and BOM variants are generated in-test | 38 files (`*.scene.json` + `*.composition.json`) |
| `capture.json` | Frame SHAs of the browser fixtures at device scale 1, each captured twice (identical) | 7 frames, keyed `win32-x64` (other machines skip with a notice) |

Regeneration: `node scripts/golden.mjs` only compares; `--update` regenerates; `--update --capture` also
re-records frame SHAs. Any other argument is refused with exit code 2 (verified). The lens test reports a
recorded throw that becomes a value as a conversion, and fails on any other change.

## 00.3 Performance baselines (record only)
Measured at `88d8b7a` in an isolated worktree, with the same `tests/core/perf.test.ts` and `tests/react/perf.test.tsx`:

| Measurement | Baseline |
|---|---|
| `evaluateMotion`, 10 tracks | 13,213 µs/call |
| `evaluateMotion`, 100 tracks | 155,376 µs/call |
| `evaluateMotion`, 300 tracks | 381,114 µs/call |
| Scene render plus evaluation per scrub step, 60 Surfaces and 300 tracks (jsdom) | 1,816 ms/step |

The cost was dominated by `MotionTrackSchema`'s refinement constructing a `.partial()` schema for every
keyframe on every parse (fixed in Phase 01). Other test runs were active on the machine, so treat these
numbers as order-of-magnitude.
The hardware preview frame budget (`playwright.performance.config.ts`) was **not** measured: it requires
headed full Chromium with GPU compositing. It remains open for Phase 11.

## 00.4 Spikes
See `phase-00-spikes.md`. S5 partly run: the editor chunk is emitted separately, and installed-host
exclusion is not yet verified. S1–S4 and S6–S8 were not run. Each blocks the phase noted there.

## 00.5 Architecture layers (`scripts/check-architecture.mjs`)
New layers: `editor` (`src/editor/**`), `three` (`src/three/**`), `bridgeServices` (`src/project/services/**`) and
`sourceAdapter` (`src/project/source.ts`). `src/project/edit.ts` joins the `commands` layer. No owners are
registered for unbuilt layers. New rule ids, each covered by negative fixtures in `tests/architecture.test.mjs`:

| Rule | Rejects |
|---|---|
| `editor-project-boundary` | editor → project commands, services or export (static or dynamic) |
| `editor-lazy-boundary` | preview → editor, except a dynamic `import()` from `src/preview/EditMode.tsx` |
| `editor-three-boundary` | editor → `three`, `@react-three/fiber` or `src/three` |
| `gsap-ban` | `gsap` and `@gsap/*` in any layer (D8) |
| `module-boundary` (existing) | core → anything but zod (incl. React and R3F); three → Node built-ins or editor; source/bridge escapes |

The positive fixture (editor importing preview and React; three importing R3F; a lazy EditMode; bridge
services using `node:http`; `edit.ts` using source and bridge) passes. Checker suite: 172/172 including
Phase 01 owners. `node scripts/check-architecture.mjs` passes on the real tree.

## Environment notes
- Vitest must run from a path with an uppercase drive letter on this machine (`C:\…`). A lowercase `c:\`
  working directory loads vitest twice ("failed to find the runner").
- Playwright's pinned Chromium build (1208) was missing; it was installed with `npx playwright install chromium`.

## Validation
- [x] D1–D14 recorded (confirmation pending, see above).
- [x] Goldens committed and green; `scripts/golden.mjs` refuses to update without `--update`.
- [ ] Baselines: evaluator and scrub recorded; capture ms/frame at DPR 1/2 (S7) and the hardware frame budget not measured.
- [ ] S1–S8 verdicts: only S5 (partial).
- [~] `npm run verify:ci`: not fully green on this Windows machine; see `phase-01-exit.md` (run at the end of Phase 01 with both phases in place).
