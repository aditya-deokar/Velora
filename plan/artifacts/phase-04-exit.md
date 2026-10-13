# Phase 04 Exit — Audio, Subtitles, Typography (2026-10-13)

## Delivered
- `src/core/audio.ts`: `AudioTrackSchema` (gain 0–2, fades, single-duck rule), `audioPlacement` (frame-snapped starts), `AUDIO_DRIFT_BUDGET_MS=40`, codec allowlist. DOM preview explicitly never mixes; FFmpeg owns the mix.
- `src/core/captions.ts`: `CaptionCueSchema`, SRT/VTT ingest (`parseCaptions`, NOTE/STYLE/REGION-aware, tag-stripping, block-accurate `ERR_CAPTION_*`), `checkCaptions` (overlap/range/20cps), `formatSrt` (VTT→SRT for the burn filter).
- `src/core/typography.ts`: `TextStyleSchema`, 4 kinetic presets compiled by `buildKineticTracks` to valid `MotionSchema` tracks (word-cascade timing FITTED to duration by construction; `MAX_KINETIC_SURFACES=12` budget warnings; single-surface typewriter warning). No TTS/transcription/translation anywhere.
- `src/core/composition.ts`: additive `audio[]` + `captions{file,burnIn?}` (old files parse unchanged).
- `src/react/kinetic-text.tsx`: `KineticText` (+`kineticStyle`, `kineticWordIds`) — markup paired with builder IDs, no clock; exported from the React entry.
- Export: `probeAudioFile` (codec/duration/peak, single pass, lives in project/services for reuse), `buildMuxFilter` (delay/gain/fades, single-ducker sidechain, amix, caption burn), `muxAudioCaptions` (one pass, stream-copy unless burning), `probeAvDrift` (ffprobe start-times), `mixPostAudioCaptions` (VTT conversion, existence guards, fail-closed drift with no partial publish). Single `export` gains `--audio/--captions`; success data extended ONLY when used (existing `toEqual` green untouched).
- Project: `executeAudioCommand` (list with snapped placement / check failing closed), `executeCaptionsCommand` (validate file / check vs span), `validate --composition` folding (asset/type/size/codec/fades/ducking/cues/overlap/range/speed). One shared audio checker feeds both (no duplication).
- CLI `audio ls|check`, `captions validate|check` (subcommand parsing, lazy manager defaults so mocked suites survive), export flags plumbed with human summaries.

## Validation proof
- Unit: 17 audio/caption/typography tests (parse matrices, cue classes, preset validity + determinism + budgets).
- `tests/export/mux.test.ts` (real FFmpeg): filter builder matrix, probe, **mixed AAC + burned captions with measured drift ≤40ms**, VTT path, fail-closed codec/caption/overwrite; burn proven by pixel diff.
- Project: 11 media tests incl. 10 validate failure classes with field-accurate codes.
- Component: KineticText single/words + builder pairing under jsdom.

## Deviations (documented)
- Drift semantics: placement quantization (≤½ frame, always in budget) + manifest `driftMs` measured from output stream starts at export; `audio check` enforces everything static; `check --video` (Phase 06) enforces recorded/measured drift. No fake sync numbers.
- Clipping is recorded as `peakDb` evidence, never a failure (hot masters are not clipping proof).
- `duckUnder` beyond one declarer is rejected at validation, never silently dropped.
- Subtitles filter path MUST be single-quoted (verified against FFmpeg 9); the escaper does this and is unit-pinned.
- VTT burns via validated conversion to temp SRT (libass reads SRT).

## Gates
typecheck ✅, arch ✅, full suites green (same load-contention note as Phase 03).
