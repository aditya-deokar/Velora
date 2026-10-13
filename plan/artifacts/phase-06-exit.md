# Phase 06 Exit — Render, Frames, Check (2026-10-13)

## Delivered
- `src/core/export.ts`: `VideoRenderSchema` (parallel 1–4, fps/dim overrides), `FramesRenderSchema` (every/at, default 1/sec), `ShotRenderSchema`, `CheckRenderSchema` (+`--manifest`), `RenderManifestSchema` (+caption windows), `CheckRenderResultSchema` (data allowed on failure, doctor-style), `VisualCheckSchema`.
- Shared `renderTimelineFrames` core: segment-grouped sessions, concurrent segments / serial frames, gap void synthesis, content-hash cache (cross-op: single↔frames↔video share hits), clamp flags, abort + progress hooks. Single-frame op refactored onto it (all 9 frame tests green unchanged).
- `executeVideoRender`: full checkCompositionFull gate (fail closed), override-aware timeline, global PNG stream → single encode (no concat needed for butt-join timelines), composition audio mix (placed starts, single-duck enforced) + caption burn with windows, fail-closed drift (no partial publish), manifest with per-frame SHAs + audio/captions/ffmpegArgs/checks. Progress via context callback.
- `executeFramesRender` (PNG sequence + manifest.json), `executeShotRender` (composition-free still with clamp), `executeCheck` (frames + video suites, inapplicable checks OMITTED not faked).
- Services: `coverFilter`/`videoEncodeArgs` shared with live encode (refactor proven by pre-existing browser encode tests), `encodeFrameBuffers`, `defaultParallelism` (CPU-capped 4), `probeVideoFile`, `decodeVideoSamples` (`-fps_mode passthrough`; ffmpeg 9 removed `-vsync`), `resolveOutput`/`makeTempDir`/`cleanupTemp`/`existingDir`/`writeTempText`.
- Check suite v1 (technical only): manifest-valid (schema+existence+SHA), no-blank (near-black floor, gaps excluded), dimensions(-consistent), caption-coverage/-visible (window coverage; burn proven at render), av-drift (recorded or fresh vs 40ms), fps-budget (p95 evidence; enforced only with `--budget-ms`), streams-present. `surface-coverage`/`focus-active` deferred to a live-scene harness (Phase 09) — omitted, not faked.
- CLI: `render` video mode (mode fenced by extension: `.png`+frame/time vs `.mp4`), `frames`, `shot`, `check` (checks table in human failure output, doctor-style), NDJSON progress lines + final envelope (`--no-stream` for envelope-only), 14 positional deps with lazy per-branch defaults (mocked suites unaffected).
- Codes: `ERR_VISUAL_MANIFEST/BLANK/DIMENSIONS/COVERAGE/DRIFT/BUDGET` (+`encoding-failed` was already catalogued).

## Validation proof
- Video (mocked capture, REAL ffmpeg): MP4 validity (h264/frames/dims via ffprobe), manifest validity, progress completion, cache all-hit rerun, serial≡parallel SHAs, edit-one-scene re-renders only its seeks (URL-attributed seek log), gaps, audio mix + drift + windows + mux args, fail-closed paths.
- Frames/shot (mocked): selection/writing/manifest, clamping, failure codes.
- Check (crafted + real ffmpeg fixtures): all suites incl. blank-skip-gap, SHA mismatch, dimensions, coverage, budget over/under, streams, drift recorded/fresh, manifest cross-checks.
- Offline gap tripwire: gap-only composition renders with a DEAD server URL — any future browser use fails loudly.
- `test:launch` 330/330; full suites 656+/657 with isolated load-contention flakes (pre-existing browser tests, green standalone/rerun).

## Deviations (documented)
- One global PNG stream instead of per-segment MP4s + concat: identical bytes for butt-join timelines, less machinery; parallelism still segment-based.
- `check` failure envelopes carry `data.checks` (doctor precedent) — validated by `CheckRenderResultSchema`, not the strict `CliEnvelopeSchema`.
- `inspect --render` merged into `check` (manifest validation is its manifest-valid suite); no separate command.
- Human progress is a final summary; JSON progress streams in-band (lines + envelope) because runCli owns no process-write contract. Live TTY animation explicitly deferred.
- Drift equality is judged on frame SHAs / decoded pixels, never container bytes or `createdAt`.

## Gates
typecheck ✅, arch ✅, test:launch 330 ✅, full suites green modulo noted contention flakes.
