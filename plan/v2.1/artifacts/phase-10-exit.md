# Phase 10 exit report · Composition editing

Date 2026-11-21

## Implementation

- Composition ops edit the original JSON through `applyEdits` and validate with the composition schema and the render timeline validator. The bridge and CLI share the formatting-preserving writer and compare revisions by SHA-256. Undo restores sparse fields, and ambiguous or three-way overlaps use the render error codes.
- V1 timing uses the canonical timeline and source offset in the player and frame, video and sequence renders. The editor reuses the Phase 05 ruler, frame grid and snapping. It has picture, overlay, caption, audio, marker and review lanes, plus a transition catalog, keyboard tools and property fields.
- Peaks are computed server-side from 8 kHz mono PCM in deterministic 10 ms buckets. The authenticated endpoint resolves only declared project audio assets and serves cached extrema by SHA-256. A 360-second analysis produces at most 96 KB of encoded extrema. The player keeps audio on its existing cursor.
- The scene breadcrumb maps between global and local time. Duration warnings use each recipe's presentation duration, and `velora validate --composition` reports out-of-range animated shots. Standalone render retains the existing last-frame hold when a scene ends. Entering transition motion follows the existing convention of authored recipe tracks, while A/B transitions are applied directly by the composition.
- A tab keeps its local bridge connection and composition checkpoint across host reloads. The bearer stays out of copied URLs, and checkpoints reconcile already-written batches against the disk revision. Windows retries briefly locked rename targets and checks the expected revision before each retry.

## Verification

- The in-house timeline is used per D6. Phase 05 proved virtualized rows for the scene dope sheet. No third-party timeline library was adopted or benchmarked in S1.
- The Phase 10 core, CLI, media and preview checks passed 22 tests. They cover ripple joins, roll span, slip, split-frame continuity, overlap refusals, exact inverses, no-op formatting, CLI dry runs, conflict handling and peaks scoping and size. TypeScript, the architecture suite, package and schema builds, the skill checker, and the core golden comparison passed.
- A Chromium journey scaffolded `launch-film-30s`, reordered shots, applied two transitions, changed track gain and fades, previewed beat deltas, applied them, and passed `velora validate --composition` on the resulting source.
- A second Chromium journey ripple-trimmed, dragged a crossfade into the cut, slipped a source, returned from scene editing at the same cursor, and undid beat snap in one step to the original bytes. Three real `velora render --frame` invocations compared a solid-color fixture against the player. The 500 ms and 900 ms endpoints matched exactly at the center pixel. At 700 ms the browser's sRGB mix and the render's linear-light mix differed by at most 61 of 255 per channel, as expected for a saturated half blend.

The frame comparison isolates the crossfade on solid color plates. It does not establish pixel equivalence for every styled caption, composited overlay, or export-only look on the 30-second blueprint.
