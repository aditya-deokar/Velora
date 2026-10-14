# Phase 06 — Rendering, Export, Frame Extraction, Inspection & Automated Visual Checks

## Goal
Complete the **agent execution loop's evidence side**: render progress, frame extraction, screenshot inspection, automated visual checks, caching, and safe parallel rendering. Implements `prompt.md`: *"render progress, frame extraction, screenshot inspection, automated visual checks, caching, and parallel rendering where safe."*

## Prerequisites
- Phases 01–05 (envelope, composition, frame clock, audio/captions, transitions/3D). Chromium + FFmpeg verified by `doctor`.

## Scope IN
- `render`/`export`/`frames`/`check` commands, progress streaming, content cache, parallel-segment rendering, visual-check suite.
- Export manifest v2 (reproducibility record).

## Scope OUT
- No cloud render farm, no hosted service (per product boundaries — local only). No artistic-quality scoring (technical checks only, per `authoring.ts` delivery concept).

## Tasks

### 06.1 Render & export (`src/export/commands.ts`, `services.ts`)
- `velora render --composition FILE --out video.mp4 [--fps 30|60|120] [--width N --height N] [--parallel N] [--cache/--no-cache] [--json]`:
  - Progress: human mode TTY bar; `--json` streams newline-delimited `{type:"progress", frame, total, pct}` on stdout OR single envelope at end behind `--no-stream` (agents choose). Non-interactive default still exits 0/1 correctly.
  - Determinism: manifest records `{compositionSha, seed, fps, frames, segments[], audioDigest, captionDigest, ffmpegArgs, veloraVersion}`.
  - Caching: frame-hash cache (`node_modules/.cache/velora` or `--cache-dir`): unchanged segments (by content sha + seed + fps) skip re-render; `--no-cache` forces full. Cache invalidation proven by test (edit one scene → only its frames re-render).
  - Parallel: segment-level parallelism (default min(CPU, segments), cap 4) — safe because segments are independent frame ranges joined by FFmpeg concat; overlapping transitions render in the owning worker explicitly. `--parallel 1` = deterministic serial fallback.
- Keep `export --url --output` (single-scene legacy) working; document `render --composition` as the timeline path.

### 06.2 Frame extraction & inspection
- `velora frames --composition FILE --out DIR [--every N | --at 0,1500,3000] --json` → PNG sequence + `manifest.json` (frame/timeMs/sceneId/sha per file). Reuses Phase 03 `render --frame` op in a loop with cache.
- `velora shot --scene ID --time MS --out shot.png` (ergonomic alias over frame render for single scenes).
- Screenshots exclude `data-velora-preview-chrome` (existing export behavior — preserve).

### 06.3 Automated visual checks (`velora check --visual`)
- Technical-only suite (never artistic scores):
  1. `bridge-present` (capture selector exists), 2. `no-blank` (frame variance floor — catches black/empty renders), 3. `surface-coverage` (registered vs rendered Surface IDs via registry diagnostics), 4. `focus-active` (near/far blur differs on tilted planes — pixel-sample, device-relative), 5. `caption-visible` (when burn-in: text-region energy in cue windows), 6. `av-drift` (Phase 04 manifest field vs threshold), 7. `fps-budget` (frame render p95 vs device baseline from Phase 00 — evidence, not promise).
- Output: per-check `{id, pass, detail, frameRefs[]}` in envelope; failures carry `ERR_VISUAL_*` + `hint` + frame paths. `reviewAuthoring` stays advisory; `check --visual` is evidential (real pixels).

### 06.4 Manifest + diagnostics
- Export/frame manifests are the reproducibility record: any MP4 can be traced to composition sha + seed + code version. `velora inspect --render manifest.json` pretty-validates a past render.
- Actionable diagnostics: every failure names the segment/frame/scene, shows the FFmpeg/Chromium stderr tail (truncated, no secrets), and suggests exactly one next command.

## Files to modify
- `src/export/commands.ts`, `services.ts` (render pipeline, cache, parallel workers, FFmpeg concat/mix), `src/core/export.ts` (manifest v2 schemas).
- `src/cli/index.ts` (`render/frames/shot/check` + streaming JSON), `src/project/commands.ts` (check ops), `RESOURCES` bindings.
- Tests: `tests/export/*` (manifest, cache-hit, parallel-vs-serial equality, progress stream parse), `tests/browser/*` (visual checks on fixtures), perf budget test.

## Tests
- `vitest run tests/export tests/cli` + Playwright visual suite on `local-project/` fixtures.
- Key proofs: parallel render ≡ serial render (frame hashes); cache re-run skips unchanged segments; `check --visual` fails a deliberately blank scene with `ERR_VISUAL_BLANK`.

## Validation criteria
- [ ] Agent loop closable: `render → frames → check --visual → fix → re-render` using only CLI JSON + PNG evidence.
- [ ] Same composition + seed twice → identical MP4 frame hashes (serial and parallel).
- [ ] Progress consumable by an agent (NDJSON) and by a human (TTY bar) without breaking `--json` parse.
- [ ] Every render failure points at segment/frame + one fix command.

## Anti-patterns
- Parallelizing within a frame (segments only — frame renders stay serial-deterministic).
- Caching on mtime (hash content + seed + fps + version).
- Scoring "cinematic quality" numerically (technical checks + `requiresVisualReview:true` only).

## Definition of Done
Render/export/frames/check merged with manifest v2, cache + parallel proofs, and visual-check suite green on fixtures — the loop's evidence side is complete before skills teach it (Phases 07–08).
