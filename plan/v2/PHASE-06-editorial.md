# Phase 06 — Editorial: Overlay Tracks, Real Transitions, Rhythm, Sound & Launch Blueprints

## Goal
Edit like an editor:
- Titles and lower thirds ride **over** real-UI shots on V2/V3 tracks.
- Cuts dissolve, dip and whip for real (true A/B compositing, not entering-side tricks).
- Cuts land on the beat of the music.
- Transitions carry sound design.
- Loudness is broadcast-correct.
- Captions look native to social platforms.

On top of this, ship the launch blueprints that combine everything into a memorable 10–30 s film.

## Prerequisites
- Phase 04 (compositor, transparent capture, presets), Phase 05 (kit `CaptionTrack`, motion-graphics templates, brand).

## Scope IN
- Overlay tracks, overlap transitions, beat detection and snapping, procedural SFX, loudness normalization, styled captions, editorial review.
- Wave 3 blueprints.
- Skill `velora-editing`; updates to `velora-transitions`, `velora-audio`, `velora-composition`.

## Scope OUT
- Multi-platform delivery orchestration (08). Speech synthesis and transcription remain out of product scope.

## Tasks

### 06.1 Overlay tracks (V2/V3) — `CompositionSchema.overlays[]`
- Each overlay is `{id, recipe, startMs, durationMs, inMs?, opacity?, blend: normal|screen|multiply}`, in z-order.
- Overlays render with **transparent capture** (Phase 04) on their own local time, and the compositor alpha-blends them over the base timeline (V1) in linear light.
- Overlays may overlap each other and any segment; they are independent of `validateTimeline`'s V1 overlap rules.
- Manifest frames record overlay SHAs.
- The composition player (03) mounts overlay scenes above the active segment (CSS stacking) with the same time mapping.

### 06.2 True A/B transitions — `SegmentTransitionSchema.mode: "entering" | "overlap"`
- With `"overlap"`, segment B starts exactly `durationMs` before A ends.
  - `validateTimeline` (`src/core/timeline.ts:67`) permits overlap only for adjacent segments with a matching declared overlap transition. Any other overlap stays `ERR_TIMELINE_OVERLAP`.
  - Frames inside the window render **both** segments at their own local times. The compositor blends them using progress `p = ease((t − B.start)/d)`.
- Curated set:

  | Transition | Behavior |
  |---|---|
  | `crossfade` | linear-light mix |
  | `dip-to-black` / `dip-to-white` | A → color in the first half, color → B in the second |
  | `wipe` | direction + feather |
  | `iris` | circle radius |
  | `push` | A out / B in by pixel shift |
  | `zoom` | scale + dissolve |
  | `whip` | directional blur ramp + shift; combines with motion blur |
  | `light-leak` | seeded warm additive gradient over a crossfade |

- `TRANSITION_CATALOG` entries gain `mode`. `velora transitions ls/describe` shows both modes.
- **Match-cut helper:** for template-provenance recipes, `velora review` compares the subject's screen position and scale at A's out-frame vs B's in-frame and reports `ADV_MATCH_CUT_DRIFT`.

### 06.3 Rhythm — `src/core/rhythm.ts` (pure)
- Input: mono PCM `Float32Array` @ 22 050 Hz.
- Pipeline:
  1. STFT (1024 / hop 512, Hann).
  2. Half-wave-rectified spectral flux.
  3. Adaptive median threshold → onset peaks.
  4. Tempo via onset-envelope autocorrelation over 60–180 BPM.
  5. Beat phase by alignment maximization.
- Output `{bpm, confidence, beats[], onsets[], downbeats[]}`. Downbeats assume 4/4, a stated assumption.
- No randomness.
- `velora audio beats --file assets/music.mp3 [--json]`: services decode PCM via FFmpeg; core analyzes.
- `velora compose snap --composition FILE --to beats [--tolerance MS] [--write] [--json]`: a dry-run diff by default; `--write` applies `startMs`/`durationMs` changes explicitly.
- `CompositionSchema.markers[] {atMs, label, kind: beat|cue|section}` can be written by `velora audio beats --composition FILE --write-markers`.
- Validate gives advice `ADV_OFFBEAT_CUT` when markers exist and a cut misses a beat by more than the tolerance.

### 06.4 Sound
- **Procedural SFX presets:** `whoosh`, `swish`, `click`, `pop`, `tick`, `riser`, `impact`, `shimmer`. They are synthesized by FFmpeg lavfi (`anoisesrc` with an explicit `seed`, `aevalsrc`, band filters, envelopes) into temp WAVs. They are royalty-free by construction and deterministic.
- Audio tracks gain `kind: music|voice|sfx`; SFX entries take `{preset, atMs, gainDb}`.
- `transition.sfx` attaches a preset at the cut.
- **Loudness:** two-pass `loudnorm` to the delivery preset target (default −14 LUFS integrated, −1 dBTP), with measured values recorded in the manifest.
- J/L cuts: audio `offsetMs` relative to segment boundaries, documented in `velora-editing` and used by the blueprints.

### 06.5 Styled captions
- `CompositionCaptionsSchema` gains `style: burn|minimal|karaoke|bold-pop|lower` and `wordsFile?`.
  - `burn` is the current FFmpeg path.
  - The DOM styles render through kit `CaptionTrack` as a generated overlay track.
- Word timing comes from an optional `.words.json`, otherwise words are distributed by character count within each cue.
- Safe-zone aware for 9:16 (stays clear of approximate platform UI zones).

### 06.6 Wave 3 blueprints (details in `TEMPLATE-CATALOG.md`)
- `launch-film-30s` (16:9)
- `feature-drop-15s` (16:9 + 1:1)
- `social-teaser-9x16` (10 s)
- `changelog-20s`
- `product-hunt-kit` (gallery stills + 30 s film + GIF)
- `app-preview-25s` (portrait device)

Each ships:
- a composition with a section timing grid;
- scene template references;
- overlay titles;
- music cue markers;
- a caption skeleton;
- a `brief.md` story structure (Hook → Problem → Reveal → Proof → CTA, with a shot list and rationale).

### 06.7 Editorial review — `velora review --composition FILE [--platform P] [--json]`
- Advisory only (`requiresVisualReview: true`). Checks:
  - `ADV_HOOK_LATE`: no motion or text in the first 2 s.
  - `ADV_SHOT_LENGTH`: outside the platform pacing table.
  - `ADV_READING_TIME`: on-screen words exceed ~3 words/s, plus a 1 s floor.
  - `ADV_ENDCARD_SHORT`: < 2 s.
  - `ADV_EYE_TRACE_JUMP`: subject screen-center jump across a cut > 35% of the frame diagonal (template-provenance recipes).
  - `ADV_DIRECTION_FLIP`: consecutive camera travel reverses without a marker.
  - `ADV_LOOP_SEAM`.
  - `ADV_OFFBEAT_CUT`.
  - `ADV_MATCH_CUT_DRIFT`.
- Inspired by Murch's *Rule of Six*: emotion and story come first, and the tool only measures rhythm and eye-trace.

## Contracts
| Schema / command | Change |
|---|---|
| `CompositionSchema` | `overlays[]`, `markers[]`, `loudness?`, `look?` (05) |
| `SegmentTransitionSchema` | `mode`, `sfx?` |
| `AudioTrackSchema` | `kind`, SFX entries |
| `CompositionCaptionsSchema` | `style`, `wordsFile?` |
| CLI | `audio beats`, `compose snap`, `review`; `transitions` shows modes |

## Files
- New: `src/core/rhythm.ts`, `src/core/editorial.ts` (review rules), `skills/velora-editing/SKILL.md`, `templates/<blueprints>/**`
- Modified: `src/core/{composition,timeline,transitions,audio,captions,cli-schema,resources}.ts`, `src/export/{commands,services,compositor}.ts`, `src/preview/CompositionPlayer.tsx`, `src/cli/index.ts`

## Tests
- `tests/core/timeline.test.ts`: overlap legality matrix.
- `tests/export/transitions-ab.test.ts`: each blend on synthetic frames gives exact expected bytes.
- `tests/export/overlays.test.ts`: alpha compositing order and opacity.
- `tests/core/rhythm.test.ts`: synthetic click tracks at 90/120/150 BPM (±1 BPM, beats within 15 ms); determinism.
- `tests/export/sfx.test.ts`: identical WAV bytes for the same seed.
- `tests/export/loudness.test.ts`: output within ±1 LU of target.
- `tests/core/editorial.test.ts`: each advisory rule on fixtures.
- Blueprint certification: scaffold → validate → render frames → contact sheet; determinism.

## Validation criteria
- [ ] `launch-film-30s` scaffolded on a fixture host renders with:
  - a title overlay over a real-UI shot;
  - a crossfade and a whip;
  - beat-snapped cuts;
  - SFX on transitions;
  - −14 LUFS;
  - karaoke captions.

  `velora check --video` passes; `velora review` produces only intended advisories.
- [ ] Overlap transitions export the same frames as the player approximation within the documented tolerance (CSS vs compositor).

## Anti-patterns
- Allowing arbitrary V1 overlaps; transitions that re-render scenes at shifted times (time must stay local per segment).
- Bundling music; non-seeded noise.
- Silently rewriting compositions: snapping always requires `--write`.

## Definition of Done
All tests and validation green. Blueprints certified. Skills checked.
`plan/v2/artifacts/phase-06-exit.md` includes the launch-film MP4 hash, contact sheet, beat report and review output.
