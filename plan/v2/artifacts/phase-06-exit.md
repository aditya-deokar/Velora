# Phase 6 Exit — Editorial: Overlays, A/B Transitions, Rhythm, Sound, Launch Blueprints

Status: implemented, uncommitted. Date: 2026-11-03.

## Delivered

- **True A/B transitions.** `SegmentTransitionSchema` gains overlap types:
  - crossfade, dip-to-black, dip-to-white, wipe, iris, push, zoom, whip, light-leak;
  - options `mode`, `ease`, `direction`, `seed`, `sfx`.
  - `validateTimeline` permits only the declared window: exactly the transition length, shorter than both shots, never three-way.
  - `layersAt` gives the active segments and eased progress.
  - `blendTransition` (compositor) blends in linear light; dissolve-family endpoints return the input bytes exactly.
  - `velora transitions ls` shows each transition's mode.
- **Overlay tracks (V2/V3).** `composition.overlays[]` (`opacity`, `blend` normal|screen|multiply) are captured transparently on their own clock and composited in order (`compositeOverlay`). Missing overlay recipes are validation errors.
- **Layered render pipeline.** `renderTimelineFrames` now works in capture units (V1 segments, overlays, captions layer).
  - A frame with a single segment and no overlays keeps its capture bytes; agent-demo pixel hashes are unchanged.
  - Video mode spills layer frames to disk.
  - Manifests record per-frame `layers` SHAs.
- **Styled captions.** `captions.style` (karaoke, bold-pop, minimal, lower, burn) with optional `wordsFile`.
  - A captions scene (`preview/CaptionsScene.tsx`, opened by URL) draws kit `CaptionTrack` with per-word timing, or words spread by character count.
  - Placement is safe-zone aware, as a transparent top layer.
  - `CaptionTrack` gains `lower`, word timing and `cueWords`.
- **Rhythm** (`core/rhythm.ts`, pure): STFT flux onsets refined in the time domain, autocorrelation tempo with an octave check, a least-squares beat grid, and 4/4 downbeats by accent.
  - `velora audio beats [--write-markers]`.
  - `velora compose snap --to beats|downbeats [--tolerance] [--write]`: a dry run by default.
- **Sound** (`core/sound.ts`):
  - eight seeded lavfi SFX presets, rendered to bit-exact WAVs;
  - `sfx[]` entries and `transition.sfx` at the cut (mid-window for overlaps);
  - two-pass `loudnorm` (default −14 LUFS / −1 dBTP; skipped and recorded when the mix is too short to gate).
  - The manifest records `loudness` (target, measured, result) and `sfx`. Audio tracks gain `kind`.
- **Editorial review** (`core/editorial.ts`, `velora review --composition FILE [--platform ID]`), advisory only (`requiresVisualReview: true`):
  - ADV_HOOK_LATE, ADV_SHOT_LENGTH (platform pacing), ADV_READING_TIME, ADV_ENDCARD_SHORT;
  - ADV_EYE_TRACE_JUMP, ADV_MATCH_CUT_DRIFT (cuts marked by a "match" cue), ADV_DIRECTION_FLIP;
  - ADV_LOOP_SEAM, ADV_OFFBEAT_CUT.
- **Player.** Overlap transitions are CSS-approximated (`blendStyle`; endpoints match exactly), overlays are mounted with transparent stages, and the end clamps to the last frame.
- **Wave 3 blueprints:** launch-film-30s, feature-drop-15s, social-teaser-9x16, changelog-20s, product-hunt-kit, app-preview-25s.
  - `velora new video` writes shots, overlap transitions with sound, overlay scenes (`backdrop=off`), section and music-cue markers, a karaoke caption skeleton and `brief.md` (story structure plus shot list).
  - Graphics gain a `backdrop` on/off param.
- **Skills:** new `velora-editing` (21 skills); updated `velora-transitions`, `velora-audio`, `velora-composition` and root routing.
- **Docs:** architecture section and CHANGELOG.

## Verification

| Gate | Result |
|---|---|
| typecheck, lint:architecture | pass |
| test:architecture | 147 pass |
| test:core | 698 pass (overlap legality matrix, rhythm at 90/120/150 BPM within 1 BPM and 15 ms, editorial rules, blueprints) |
| test:react | 71 pass |
| test:launch | 464 pass (all 6 blueprints scaffold and validate; beats, snap and review on a real click track) |
| test:export | 291 pass (exact blend bytes, overlay order and blend modes, SFX bit-exact, loudness within ±1 LU, layered video render) |
| test:release | 41 pass |
| test:browser | 10 pass |
| test:skills | 21 green |
| test:installed | pass |
| test:agent-demos | pass; pixel hashes unchanged |

## Launch film validation (smoke Vite app, installed build)

1. `velora new video --blueprint launch-film-30s --id launch --route /`.
2. A synthetic 120 BPM bed (kicks offset 30 ms) was added as `assets/music.wav` (`kind: music`).
3. `velora audio beats --write-markers`: **120 BPM, confidence 0.99**, beats at 470 + k·500 ms (exact), 60 markers.
4. `compose snap --to beats` dry run: 8 changes; two cuts (200 ms off) were reported as unsnapped, and `review` flagged the same two as ADV_OFFBEAT_CUT. After `--write` and `--tolerance 260 --write`, every cut is on a beat and `review` reports **no advisories**.
5. Draft render `p6/launch.mp4`:
   - 894 frames, 1920×1080, 30 fps, in 771 s;
   - SHA-256 `2672f4dc80e0e8a5673a241acf39576e0aa8f4172a7cde38be1bd55b217c3733` (render made before the whip edge fix);
   - all frames layered (captions span the film).
6. Loudness: measured −23.96 LUFS, **result −13.91 LUFS, −1.0 dBTP**. Four transition SFX at 3270, 13070, 18720 and 23170 ms. A/V drift 0 ms.
7. `velora check --video`: pass. Flash safety at most 1 per second; caption cue windows covered; banding advisory on the large light gradients.

Evidence (session scratchpad):
- `smoke/app/p6/board/contact-sheet.png`: the whole film.
- `smoke/app/p6/board3/contact-sheet.png`: karaoke captions, lower-third overlay.
- `shots3/launch-transitions.png`: whip, crossfade, dip-to-black, push and crossfade midpoints from the encoded MP4.
- `shots3/whip-fixed.png`: the whip after the edge fix.

## Bugs found and fixed during verification

- **Video render dropped transitions.** `executeVideoRender` built its own timeline without segment transitions, so every overlap was rejected (frames and stills used `timelineFromComposition` and worked). A regression test now renders an overlap and an overlay to video.
- **Captions rendered off-frame.** They were positioned against Surface content's zero-height leaf, 159 px above the frame. They are now positioned in a full-frame box.
- **Loudness on short clips.** `loudnorm` failed on clips under 400 ms (non-finite measurement). Normalization is now skipped and recorded.
- **Whip edge fill.** The second half of a whip filled off-frame pixels with the unshifted frame (a ghost panel). It now clamps to the edge pixels.
- **Beat tracking:**
  - an octave error (120 detected as 60 BPM), fixed with the half-grid onset check;
  - downbeats picked by flux, now by peak accent;
  - snapping left later segments unshifted.
- **Gray+alpha PNG.** It is now decodable (robustness; Chromium emits RGB/RGBA).

## Deviations and open items

- **SFX** live in a composition `sfx[]` array plus `transition.sfx`, rather than inside `audio[]` entries; audio tracks only gain `kind`.
- **Match-cut drift** is checked only for cuts marked by a cue marker labeled "match" (intent must be declared); eye-trace and drift checks need template-provenance recipes.
- **Downbeats** assume 4/4 and pick the loudest phase. When every beat is equally loud (as in the synthetic bed) the choice is arbitrary.
- **Player parity.** CSS approximations match the compositor at the endpoints only. Mid-transition pixel parity is not measured (sRGB vs linear light; whip and light-leak differ most).
- **Frame cache staleness.** Cache keys include the Velora version, not the package build. Changing the installed package without a version bump reuses cached layers (seen when iterating locally; use `--no-cache`). Real releases bump the version.
- **Render cost.** Captions are a full-length transparent layer, so every frame is composited; the 30 s draft took 13 minutes on this machine with 2 workers (memory-limited).
- **Captions** load from the dev server (Vite serves root files); Next.js hosts need the file under `public/`.
- **Not run:** blueprint determinism (two renders compared by SHA); the `product-hunt-kit` stills and GIF outputs (documented in its brief).
