# Phase 05 — Transitions, Procedural Graphics, GSAP & Three.js/WebGL Bridges

## Goal
Deliver **transitions, procedural graphics, and high-quality 2D/3D motion** by bridging the installed GSAP / Three.js skills to Velora's deterministic timeline — without forking their math. Implements `prompt.md`: *"transitions, procedural graphics, high-quality 2D/3D motion graphics … integrate the installed GSAP, Three.js, and Ewmotion skills by inspecting their actual contents."*

## Prerequisites
- Phases 00 (skills survey), 02 (composition spec), 03 (timeline + seed + frame clock). Installed skills present under `skills/` + `skills-lock.json`.

## Scope IN
- Transition library, procedural-surface primitives, GSAP mapping, Three.js/WebGL capture-safe bridge, Ewmotion resolution.
- CLI: `transition`/`effect` listing + validation; no new render path — everything compiles to `MotionSchema`/timeline.

## Scope OUT
- No ScrollTrigger-in-render (page-scroll ≠ video-time — explicitly forbidden). No ray-traced bokeh claims (renderer stays a live-DOM Gaussian approximation per architecture).

## Tasks

### 05.1 Transitions (`src/core/transitions.ts` NEW)
- Catalog v1 (pure builders → motion tracks + segment crossfade metadata): `cut, dissolve (opacity on leaves), slide-push, wipe-mask, iris-mask, depth-dolly (camera z through boundary), focus-pull (focus.distance across boundary), cascade-handoff`.
- Rules: transitions live BETWEEN timeline segments (Phase 03 `TimelineSchema` gains optional `transition: {type, durationMs}` on boundaries); total duration accounts for overlap vs butt-join explicitly; group-opacity caveat honored (animate visual leaves, not spatial groups — per `authoring.ts` composition concept).
- `velora transitions ls --json` + `validate` coverage (`ERR_TRANSITION_INVALID`, duration exceeds segment, masked-surface coverage).

### 05.2 Procedural graphics (`src/core/procedural.ts` NEW)
- Seeded primitives compiling to scene nodes/tracks: `grid-field, dot-matrix, gradient-veil, line-sweep, particle-drift (bounded count), waveform-bar (audio-data optional, else seeded)`.
- All randomness from Phase 03 `createRng(seed)`; counts/durations bounded with `validate` budgets (surfaces, filters, draw calls). Over-budget → warning + `hint` (reduce count / bake to asset).

### 05.3 GSAP bridge (reference, don't reimplement)
- Mapping table (owned by the new `velora-gsap` skill in Phase 08, implemented here): GSAP easing names → `MotionKeyframe.easing` values; GSAP timelines → `MotionSchema.tracks` via builder `gsapToVelora()`; `createCascadeTracks` stays canonical for staggers.
- FORBIDDEN in render: ScrollTrigger, ticker-driven clocks, `gsap.ticker` — video-time comes only from the Phase 03 clock. `validate` rejects ScrollTrigger imports in scene bindings with `ERR_ANIMATION_CLOCK` + hint.
- Reuse installed skills (`gsap-core, gsap-timeline, gsap-plugins, gsap-react, gsap-performance…`) for deep API; Velora owns only the mapping + budgets. Check `skills-lock.json` before citing versions.

### 05.4 Three.js / WebGL bridge (`src/react/three-bridge.tsx` + `src/core/three.ts` schema)
- Contract: a `WebGLSurface` (Surface leaf hosting a `<canvas>`) with `{sceneId, timeMs-driven update(t), seed, width/height, pixelRatioCap}`. Scene update is a pure function of video-time — no rAF loop ownership; capture bridge samples it like any Surface.
- Validation: `ERR_WEBGL_CONTEXT` (context creation fail), `ERR_WEBGL_TIMELOOP` (rAF/clock import detected), overdraw/perf budget warnings (materials/shadows/pixelRatio caps from `threejs-performance` guidance).
- Reference installed skills (`threejs-fundamentals, -geometry, -materials, -lighting, -loaders, -animation, -postprocessing…`) for authoring; Velora validates time-discipline + capture-safety only.

### 05.5 Ewmotion resolution
- Phase 00 determines status. If Ewmotion is a workflow/motion helper: add `src/core/ewmotion.ts` adapter (import → `MotionSchema` builder) + `velora-ewmotion` skill entry; if external/dead: record defer/drop with reason in the phase exit note and remove from skill routing table. No silent stub.

## Files to modify
- NEW `src/core/transitions.ts`, `procedural.ts`, `three.ts`, `gsap.ts` (mappings/builders), `src/react/three-bridge.tsx` (+ declarations).
- Extend `timeline.ts` (boundary transitions), `cli-schema.ts`, `validate` ops, `src/cli/index.ts` (`transitions ls`, bridge checks).
- Tests: `tests/core/{transitions,procedural,gsap,three}.test.ts` (builders valid, determinism, budget guards, ScrollTrigger/rAF rejection fixtures).

## Tests
- Unit: every transition/procedural builder → valid `MotionSchema`; same seed → same tracks; budget guards fire.
- Integration: 1 GSAP-mapped scene + 1 Three.js canvas scene render via `render --frame` → deterministic PNGs; ScrollTrigger fixture rejected by `validate`.
- `lint:architecture` green (no copied easing/spatial math; bridges call canonical owners).

## Validation criteria
- [ ] Agent can list transitions, apply one to a composition boundary, and `validate` + frame renders prove it.
- [ ] GSAP easing/timeline maps to Velora tracks with no second clock; ScrollTrigger correctly rejected.
- [ ] Three.js scene renders deterministically under video-time and survives snapshot/export capture.
- [ ] Ewmotion status closed (integrated or explicitly deferred with reason).

## Anti-patterns
- Copying GSAP/Three.js internals into Velora (reference installed skills; map, don't fork).
- Letting WebGL own its own clock (all motion is a function of `timeMs` + `seed`).
- Claiming bokeh/ray-tracing/path-morphing the DOM renderer can't do — borrow language from `authoring.ts` focus concept verbatim.

## Definition of Done
Transitions + procedural + GSAP/Three.js bridges merged with mapping tables, budget guards, and deterministic render proof; Phase 08 skills can teach them without new core work.
