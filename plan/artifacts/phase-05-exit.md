# Phase 05 Exit — Transitions, Procedural, GSAP, Three.js (2026-10-13)

## Delivered
- `src/core/transitions.ts`: 8-transition catalog + `buildTransition` compiling entering-side effects to valid motion tracks (butt-join timeline, totals unchanged; wipe/iris are documented travel+fade approximations — true masks belong to host CSS). `cut` emits nothing; cascade timing fitted to duration.
- `src/core/procedural.ts`: 6 seeded primitives → valid nodes + tracks (`MAX_PROCEDURAL_NODES=200`); length-mismatched waveform data is a schema error, never a silent fallback. All randomness from `createRng(seed)`.
- `src/core/gsap.ts`: lossy-but-explicit easing map (unmappable easings rejected, never remapped), `gsapToVelora` (seconds→ms, required from/to, property-checked), `detectForbiddenClock` (ScrollTrigger/ticker/rAF with line numbers).
- `src/core/three.ts` + `src/react/three-bridge.tsx`: `WebGLSceneSchema` bounds + `WebGLSurface` rendering purely from `timeMs` (no loop/clock), graceful `ERR_WEBGL_CONTEXT` fallback, exported from the React entry.
- `src/core/composition.ts`: additive per-segment `transition?` (old files parse unchanged).
- Validate: transition span/leaf checks (`ERR_TRANSITION_INVALID`); project-wide forbidden-clock scan of bindings + shared components (`ERR_ANIMATION_CLOCK`, file:line). Existing fixtures contain no clocks — gates unaffected by construction (verified by scan).
- CLI `transitions ls|describe` (pure, no I/O; describe shows REAL builder output as documentation).
- Codes: `ERR_TRANSITION_INVALID/PROCEDURAL_BUDGET/ANIMATION_CLOCK/WEBGL_CONTEXT/WEBGL_TIMELOOP`.

## Validation proof
- 19 transition/procedural tests (catalog, validity, determinism, budgets, fit), GSAP map/converter/detector tests, three schema/source tests, WebGL bridge jsdom tests (fallback diagnostics, time-discipline, bounds).
- Project: transition accept/overrun/leafless/unknown-type + ScrollTrigger/ticker/rAF rejection with file:line.
- CLI: catalog envelope, describe examples, usage errors, help.
- Frame-render path is scene-content-agnostic (bridge seek + screenshot), so GSAP/Three scenes need no separate render integration; determinism proof in Phase 03 covers all content.

## Deviations (documented)
- Transitions are authoring accelerators (builders → paste into recipe motion), NOT runtime effects: composition declares intent, validate checks sanity, builders produce the tracks. True A/B crossfade compositing explicitly out of scope (would need xfade; recorded as future).
- Wipe/iris approximations labeled `transition-approx` warnings in builder output.
- **Ewmotion: DEFERRED (closed).** Zero hits for `ewmotion` in `src/`, `tests/`, `scripts/`, `skills/`, `skills-lock.json`, `package.json` — only `prompt.md`/plan mention it. No source, package, or skill to integrate; no stub created per the no-mock rule. Reopen if a source surfaces.

## Gates
typecheck ✅, arch ✅, full suites green.
