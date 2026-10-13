# Phase 04 — Audio Synchronization, Subtitles, Typography & Kinetic Text

## Goal
Add **audio sync, subtitles, and a typography/kinetic-text system** as real CLI-verified capabilities — not styling advice. Implements `prompt.md`: *"audio synchronization, subtitles, typography."*

## Prerequisites
- Phases 01–03 (envelope, `CompositionSchema`, timeline + frame clock). FFmpeg present (Phase 01 `doctor` proves it).

## Scope IN
- Audio track schema + mix + sync check; SRT/VTT ingest + burn-in; text/kinetic-text authoring helpers + Surface-text rules.
- CLI: `audio`, `subtitles`/`captions` ops + extended `validate`/`export`.

## Scope OUT
- No TTS/voice synthesis, no auto-transcription (deferred; document as non-goal). No 3D text extrusion (Phase 05).

## Tasks

### 04.1 Audio (`src/core/audio.ts` NEW)
- `AudioTrackSchema`: `{id, assetId, startMs, offsetMs?, gain?, fadeInMs?, fadeOutMs?, duckUnder?: {trackId, amount}}`. Composition gains `audio: []`.
- Rules: sample-accurate placement via frame clock (`startMs` snaps to frame, reported); mixed in FFmpeg at export (not in DOM preview — preview plays video clock; audio preview is best-effort with sync warning).
- Commands: `velora audio ls --composition FILE --json`, `velora audio check --composition FILE --json` (missing asset, codec, drift, clipping diagnostics → `ERR_AUDIO_*`).
- Sync guarantee: export manifest records `audioOffsetMs` per track + measured A/V drift; `audio check` fails closed over threshold (default 40ms) with `hint`.

### 04.2 Subtitles (`src/core/captions.ts` NEW)
- Ingest `.srt`/`.vtt` → canonical `CaptionCueSchema {startMs, endMs, text, style?}`. Composition gains `captions: {file, burnIn?: boolean, style?}`.
- Commands: `velora captions validate --file X.srt --json`, `velora captions check --composition FILE --json` (overlap, reading-speed, out-of-range cues → `ERR_CAPTION_*` with cue index `path`).
- Export: optional burn-in via FFmpeg subtitles filter (fonts from `assets/`); preview overlays cues on DOM clock (visual parity check in Phase 06).

### 04.3 Typography & kinetic text (`src/core/typography.ts` NEW + `src/react/` helper)
- `TextStyleSchema`: font family (from assets), size, weight, tracking, leading, color (host theme preserved — Velora never restyles host UI silently), alignment, `kinetic?` preset ref.
- Kinetic presets (pure motion-track builders reusing `MotionSchema`): `fade-slide`, `word-cascade` (via `createCascadeTracks`), `mask-reveal`, `typewriter-timed` (cue-synced, NOT layout-thrashing per-char splits by default — warn over N surfaces; see perf note).
- Rules honoring the renderer: every animated text region belongs to a `Surface` leaf/`content` (existing focus/coverage invariant); per-character splits require explicit opt-in + `validate` warning over budget.
- Component helper `KineticText` (in library, thin wrapper over `Surface` + motion builders) with TS declarations; no second clock.

### 04.4 Validate + export wiring
- `validate --composition` covers audio/captions/typography (missing font asset, unsupported codec, cue overlap, surface-budget exceeded).
- `export` mixes audio + burns captions when requested; manifest records audio/caption digests. New flags: `--mix-audio/--no-mix-audio`, `--burn-captions`.

## Files to modify
- NEW `src/core/audio.ts`, `captions.ts`, `typography.ts`; extend `composition.ts`, `cli-schema.ts`.
- `src/project/*` (audio/caption ops), `src/export/*` (FFmpeg mix + burn-in), `src/cli/index.ts` (subcommands + help).
- Library: kinetic-text helper + declarations. Tests: `tests/core/{audio,captions,typography}.test.ts`, `tests/cli/*`, export fixture with tone + SRT asserting A/V duration match.

## Tests
- Unit: SRT/VTT parse, overlap detection, frame-snapping, fade/duck param validation, preset builders produce valid `MotionSchema`.
- Integration: export 3s fixture with audio + burn-in → probe streams (duration, codec) + manifest drift field.
- Architecture checker green (core pure; FFmpeg only in export services).

## Validation criteria
- [ ] Agent can add audio/captions to a composition using only CLI + schema, and `validate` catches drift/overlap/codec issues with cue-accurate paths.
- [ ] Exported MP4 has mixed audio within drift budget and (when asked) visible burned-in captions on extracted frames.
- [ ] Kinetic preset renders deterministically under Phase 03 seed/clock; surface-budget warning fires when exceeded.

## Anti-patterns
- Baking audio playback into the DOM render clock (DOM clock is video; FFmpeg owns the mix).
- Auto-splitting every character/word without budget guards (kills the live-DOM filter budget).
- Claiming transcription/translation/TTS — out of scope; fail honestly if asked.

## Definition of Done
Audio + captions + typography schemas, CLI ops, export wiring, and tests merged; skills in Phase 08 can quote these commands without caveats.
