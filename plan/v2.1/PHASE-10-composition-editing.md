# Phase 10 — Composition editing (the cut)

## Goal
Edit the whole film the way an editor cuts: scenes on V1, overlays on V2/V3, music and SFX on
audio lanes with waveforms, captions, markers and beats — move, trim, ripple, roll, slip, split,
drop in transitions, snap cuts to the beat, and jump into any scene's keyframes at the right
local time. The composition file stays the source; every gesture is an `EditOp` that passes the
same timeline validation as `velora render`.

## Prerequisites
- Phase 05 (timeline infrastructure, snapping, clipboard), Phase 03 (ops, bridge), spike S1
  verdict on lane rendering.

## Scope IN
- Composition `EditOp`s; Edit-composition mode with lanes and NLE tools; transitions UI;
  waveform peaks; beat snapping and review advisories inline; scene ↔ composition navigation;
  CLI parity.

## Scope OUT
- New transition types or audio processing (v2 catalogs are reused), multicam, proxy media.

## Tasks

### 10.1 Composition ops — `src/core/edit.ts` (extends the vocabulary)
| Group | Ops |
|---|---|
| Segments (V1) | `segment.add {recipe, atMs, durationMs, inMs?}`, `segment.move`, `segment.trim {id, edge: "in"\|"out", deltaMs, mode: "plain"\|"ripple"}`, `segment.roll {leftId, rightId, deltaMs}`, `segment.slip {id, deltaMs}` (changes `inMs` only), `segment.split {id, atMs}`, `segment.remove {id, ripple?}` |
| Transitions | `transition.set {segmentId, type, durationMs, mode, direction?, ease?, seed?, sfx?}`, `transition.remove` |
| Overlays | `overlay.add/move/trim/remove`, `overlay.set {opacity?, blend?}` |
| Audio | `audio.add/move/trim/remove`, `audio.set {gain?, fadeInMs?, fadeOutMs?, offsetMs?}` |
| Markers, captions, look | `marker.add/move/remove`, `captions.set`, `look.set` (composition default) |
- `applyEdits` gains a composition target: validates with `CompositionSchema` **and**
  `validateTimeline` (overlap rules: only declared overlap-transition windows, never three-way) so
  an invalid cut is refused with the same codes as `velora validate --composition`.
- Invariants (tested): ripple keeps downstream segments joined; roll preserves the sum of the two
  durations; slip preserves position and duration; split produces two segments whose concatenated
  frames equal the original (local times continue via `inMs`).

### 10.2 Edit-composition mode — `src/editor/composition/`
- Entered from the Compositions tab (**Edit**) or `velora edit --composition <file>`; URL
  `velora-edit=composition&velora-composition=<file>`.
- Uses the existing `CompositionPlayer` session (single cursor, shuttle, boundaries) as the
  viewport; lanes below:
  - **V1** segments with snapshot thumbnails (recipe `snapshot` when present) and transition
    handles between adjacent segments (drag to change the overlap window);
  - **V2/V3** overlays (opacity/blend badges);
  - **Captions** lane (cues from `parseCaptions`, styles from the composition);
  - **Audio** lanes with waveforms, gain line and fade handles;
  - **Markers/Beats** lane (beats, downbeats, cues, sections).
- Tools (mode keymap, `EDITOR-UX.md` §5): V select/move, B ripple, N roll, Y slip, C razor,
  M marker; drag a transition from the catalog panel (`velora transitions` data) onto a cut.
- Lane rendering reuses the Phase 05 timeline engine (or the S1-approved library behind an
  adapter).

### 10.3 Waveforms — bridge `/v1/media/peaks`
- Commands layer computes min/max peaks per 10 ms bucket from `decodePcm` (services, FFmpeg),
  cached by asset SHA in `.velora/cache/peaks/`; response ≤ 256 KB; only composition-declared
  assets (`assets[]` paths) are readable; deterministic output (test).

### 10.4 Beat-aware editing
- Beat/downbeat markers (from `velora audio beats --write-markers`) feed snapping; "Snap all cuts
  to beats" runs the existing `snapToBeats` plan (`src/core/rhythm.ts`) as a preview with per-cut
  deltas, applied as one op batch (one undo step).
- `reviewComposition` advisories (hook, pacing per platform, reading time, end card, eye trace,
  direction flip, loop seam, off-beat cut) drawn inline on the lanes at their times; click selects
  the segment.

### 10.5 Scene ↔ composition
- Double-click a segment → Edit-scene mode for its recipe at local time `inMs + (cursor −
  startMs)`; a breadcrumb returns to the composition at the same global time.
- Scene duration changes that would make a segment exceed its recipe's duration show a warning in
  the composition lane (and `velora validate --composition` already rejects it).

### 10.6 CLI parity
- `velora compose edit --composition <file> --ops <file|-> [--expect-sha] [--write]` plus
  ergonomic `velora compose trim|move|split|transition` (dry-run by default, like `compose snap`).

## Contracts
- Composition ops in `EditOpSchema`; bridge `/v1/compositions/:file` (read/edits, same CAS and
  conflict semantics as scenes) and `/v1/media/peaks`; `velora compose edit` and helpers.

## Files
- New: `src/editor/composition/{CompositionEditor,Lanes,SegmentClip,TransitionHandle,AudioLane,Waveform,MarkersLane,tools}.ts(x)`
- Modified: `src/core/{edit,timeline}.ts`, `src/preview/CompositionPlayer.tsx` (editor slots,
  no behavior change without them), `src/project/{edit,services/bridge}.ts`, `src/cli/index.ts`,
  `src/core/cli-schema.ts`, skills `velora-editing`, `velora-composition`, `velora-editor`

## Tests
- `tests/core/composition-ops.test.ts`: ripple/roll/slip/split invariants; `validateTimeline`
  refusals (three-way overlap, window longer than a shot); inverse exactness; formatter no-op.
- `tests/project/peaks.test.ts`: determinism, cache keying, asset scoping.
- `tests/browser/composition-editor.spec.ts`: trim a segment with ripple → downstream joined in
  file; add a crossfade by drag → render the cut frame with `velora render --frame` and compare
  with the player (documented blend tolerance; endpoints exact); slip changes `inMs` only;
  snap-all-cuts is one undo step.
- `tests/cli/compose-edit.test.ts`: dry-run vs `--write`, conflict, envelopes.

## Validation criteria
- [ ] A 30 s launch blueprint can be recut (reorder two shots, retime to beats, add two
  transitions, set the music bed's gain and fades on its lane) entirely in the editor, and
  `velora render` output matches the player at every cut endpoint. (Gain *automation* over time
  is not in `AudioTrackSchema` today; it is listed as a follow-up in Phase 11, not promised here.)
- [ ] Every composition op is reachable via `velora compose edit`.

## Anti-patterns
- A second timeline validator in the editor (use `validateTimeline`).
- Moving audio by wall-clock playback (audio follows the cursor via `syncMedia`, as today).
- Decoding audio in the browser for waveforms (peaks come from the CLI, cached).

## Definition of Done
Tests and validation green; skills updated; `plan/v2.1/artifacts/phase-10-exit.md` written.
