# Phase 03 — Timeline Orchestration, Deterministic Rendering, Frame-Accurate Animation

## Goal
Turn single-scene playback into a **deterministic, frame-accurate multi-scene timeline** — the correctness core of a Remotion alternative. Implements `prompt.md`: *"timeline orchestration, deterministic rendering, frame-accurate animation."*

## Prerequisites
- Phases 01 (envelope) + 02 (`CompositionSchema`, inspect). Read `src/core/motion.ts`, `choreography.ts`, `preview.ts`, `src/preview/session.ts`, `src/react/capture.ts`.

## Scope IN
- Composition timeline model, global clock, seeded determinism, frame manifest, `render --frame/--time` precision primitives.
- Preview session upgrade to timeline-aware seeking (backward-compatible single-scene behavior).

## Scope OUT
- No audio mixing (04), no transitions/procedural content (05), no export parallelism (06). Timeline carries scenes; effects land later.

## Tasks

### 03.1 Timeline model (`src/core/timeline.ts` NEW)
- `TimelineSchema`: ordered segments from composition (`sceneId, startMs, durationMs, inMs/outMs?` for trimming) + global `durationMs` + `fps`.
- Helpers (pure, tested): `timelineDuration()`, `segmentAt(timeMs)`, `localTime(globalMs)`, `frameAt(timeMs, fps)`, `timeAtFrame(n, fps)`, `validateTimeline()` (overlap/gap policy: gaps render black void — explicit, not error; overlaps rejected `ERR_TIMELINE_OVERLAP`).
- Frame math is integer-exact: `frame = round(timeMs * fps / 1000)`; `timeMs = frame * 1000 / fps`. Document rounding once; use everywhere (preview, capture, export).

### 03.2 Deterministic clock
- `Scene timeMs` today = elapsed presentation ms with half-speed/speed modifiers (`MotionSchema`). Freeze semantics: authored ms × `1/speed` = presentation ms; `motionDuration()` = playback duration.
- Add `seed` (from composition, default 0): canonical `createRng(seed)` (mulberry32 or equivalent, NEW `src/core/random.ts`, pure) for any procedural/cascade jitter. Same seed + same source = same frames. Log seed in every render manifest.
- Forbid in render path: `Math.random`, `Date.now`, layout-dependent branching. Add architecture-test guard + lint note listing banned globals in `src/core/timeline.ts`, `motion.ts`, `spatial.ts` render paths.
- `sampleFrameTime(durationMs, frame, fps)` exists — promote to canonical frame sampler; preview scrub + export both call it.

### 03.3 Multi-scene preview session
- Extend `usePreviewSession` / `presentPreview` to accept optional `timeline`: single cursor still shared by playback/seek/replay/capture; `SceneLibrary` deep-links (`?velora-scene=`) keep working; timeline mode adds segment boundary seeking (`next/prev segment` ops for CLI-driven agents).
- `ScenePreview` props: optional `timelinePosition?` (global ms) — no second clock, no second capture bridge (architecture invariant preserved).
- Reduced-motion: start paused + seeking available (existing behavior — extend to timeline).

### 03.4 Frame-accuracy primitives (CLI-visible, export-consumed in Phase 06)
- `velora render --composition FILE --frame N --out frame.png --json` → seeks exact `timeAtFrame(N)` in headless Chromium, captures `[data-velora-capture="scene"]` viewport only, writes PNG + manifest `{frame, timeMs, fps, seed, sceneId, sha}`.
- `velora render --time MS` variant (resolves to nearest frame, reports both). Errors: `ERR_FRAME_OUT_OF_RANGE, ERR_CAPTURE_NO_BRIDGE, ERR_SCENE_INVALID`.
- Both reuse `executeSceneSnapshot`'s seek+exclude-chrome bridge — generalize, don't duplicate.

## Files to modify
- NEW `src/core/timeline.ts`, `src/core/random.ts`; extend `motion.ts` docs, `preview.ts` (`presentPreview` timeline overload).
- `src/preview/session.ts`, `ScenePreview` (timeline props), `src/react/capture.ts` (frame-exact seek).
- `src/export/commands.ts` + `services.ts` (frame render op), `src/cli/index.ts` (`render` command + help).
- Tests: `tests/core/timeline.test.ts` (frame math, overlaps, rng determinism), `tests/cli/*` (render frame/time), browser frame-equality test (same seed twice → byte-identical PNG).

## Tests
- Unit: frame↔time round-trips at 30/60/120fps; overlap rejection; gap=black; seeded RNG sequence stability.
- Integration: `render --frame` twice with same seed → identical hash; different seed → documented difference only where procedural used.
- Gates: `npm run test:core`, `test:browser` (frame subset), architecture checker.

## Validation criteria
- [ ] Scrubbing to frame N twice yields pixel-identical output (same seed/source).
- [ ] Timeline with 3 scenes plays end-to-end; segment boundaries seekable via CLI.
- [ ] Frame manifest (`frame/timeMs/fps/seed/sceneId`) present for every captured frame.
- [ ] No wall-clock/`Math.random` in deterministic render path (grep + arch test).

## Anti-patterns
- Per-scene clocks or duplicated playback state (one cursor only).
- Float-frame indexing (`frame 12.7`) — always resolve to integer frames with reported `timeMs`.
- Copying spatial/easing math into new modules (call `matrixFor/multiply`, `motionDuration`, `evaluateMotion`).

## Definition of Done
Timeline + determinism + frame-render merged, determinism test green on two consecutive runs, and Phases 04–06 can assume `frameAt/timeAtFrame/seed/manifest` without rework.
