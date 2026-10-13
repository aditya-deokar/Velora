# Phase 03 Exit — Timeline, Determinism, Frame Accuracy (2026-10-13)

## Delivered
- `src/core/random.ts`: `createRng` (mulberry32), `hashSeed` (FNV-1a), `rngRange/Int/Pick`. No unseeded randomness, wall-clock, or layout reads.
- `src/core/timeline.ts`: `TimelineSchema`, canonical frame clock (`frameAt` round / `timeAtFrame`), `segmentAt` (half-open), `localTime` (+trim), `timelineDuration`, `nextBoundary/prevBoundary`, `validateTimeline` (overlaps → `ERR_TIMELINE_OVERLAP`, gaps = explicit black void), `timelineFromComposition`.
- `src/core/export.ts`: `FrameRenderSchema` (`--frame` XOR `--time`), `RenderManifestSchema` v1 lineage (frame/frames/video kinds, frame SHAs, seed, checks, audio/captions slots), `FrameRenderResultSchema`. `RESOURCES["render-frame"]` registered.
- `src/export/services.ts`: content-hash frame cache (verify-on-read, never mtime), `voidPng` black-frame encoder, dependency-free PNG decoder + luminance stats (for Phase 06 checks), scoped no-overwrite file publication, `sha256Hex`.
- `src/export/commands.ts`: `executeFrameRender` — composition → timeline → segment → scene URL → one capture session → PNG + companion manifest. Gaps render void without a browser; overlong segments clamp with `clamped:true`; cache shared across runs.
- `src/preview/session.ts` + `ScenePreview.tsx`: additive optional timeline descriptor (rescales the single cursor span + `seekNext/seekPrev`). No second clock/bridge; undefined = byte-identical behavior.
- CLI `render --composition --frame/--time --out` (+`--url/--no-cache/--cache-dir`), per-command help, `CLI_COMMANDS` entry. New codes: `ERR_TIMELINE_INVALID/OVERLAP`, `ERR_FRAME_OUT_OF_RANGE`.

## Validation proof
- Unit: frame↔time round-trips @30/60/120, boundaries, overlap/span rejection, RNG determinism + no-`Math.random`/`Date.now`/`performance.now` source scan of render-path files.
- `tests/export/frame-browser.test.ts`: **same frame byte-identical on consecutive real-Chromium runs**, plus early/late frames differ (seek proven live).
- Mocked: manifest validity + SHA match, `--time` grid convergence, cache hit/miss/invalidation, clamping, gap void, fail-closed paths (range/recipe/composition/overlap/overwrite/bridge).
- Preview session: duration rescale + boundary jumps under jsdom; unchanged behavior without timeline.

## Deviations (documented)
- ScenePreview takes a `timeline` descriptor, not a `timelinePosition` prop: same invariant (one cursor), less API.
- `sampleFrameTime` (floor, cadence preview) kept distinct from the round-based frame clock; motion.ts comment says so.
- Composition SHA in manifests = source file bytes (best provenance).
- `render` grows a video mode in Phase 06 on the same command (frame mode = `--frame/--time` + `.png`).

## Gates
typecheck ✅, arch ✅, test:launch ✅ (330), full unit suites green (isolated load-contention flakes in pre-existing browser tests, green standalone/on rerun).
