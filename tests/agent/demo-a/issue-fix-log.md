# Demo A — Issue-Fix Log (all detected by real CLI runs)

## 1. `ERR_CAPTION_TIMING` — cue outlives the timeline

First draft placed segment `s2` at 1500ms (span 3500ms) while cue 2 ends at
4500ms. `velora validate --composition teaser.composition.json --json` failed:

```json
{"code": "ERR_CAPTION_TIMING", "path": "captions.cues.1",
 "message": "Cue ends at 4500ms but the timeline spans 3500ms."}
```

Fix: butt-joined the timeline (`s2.startMs` 1500 → 2500, span 4500ms) so every
cue window fits. Re-ran `velora validate` → success (`durationMs: 4500`).

## 2. Truncated MP4 — narration shorter than the video

The first narration asset was 0.5s of silence. The full render encoded only
500ms / 15 frames, and `velora check --video demo-a.mp4 --manifest
demo-a.manifest.json --json` reported:

- `ERR_VISUAL_MANIFEST`: `frames 15 != 135`
- `ERR_VISUAL_COVERAGE`: `1 caption cue windows have no sampled video frame`

Fix: regenerated `assets/narr.wav` as 4.5s of silence to cover the timeline,
re-validated, re-rendered (120/135 frames served from the content-hash cache),
and re-checked. Manifest, coverage, and drift all passed.

## 3. Blank sample on the kinetic fade-in

`velora check --video` then reported one blank sample at the head of segment
`s2`: both title leaves start at opacity 0, so the first sampled frame is
legitimately near-black. The agent confirmed the frame, kept the staggered
entrance, and steepened only the first word (`linear` fade over 400ms, with
the advisory `linear-motion` note confirmed as intentional) so content is
visible at sampling time. Re-rendered and re-checked → all suites green,
including `no-blank` over 14 samples with gaps excluded.

## Re-replay note (2026-11-03)

The first draft (`s2` at 1500 ms) also overlapped `s1` by 500 ms under an entering
`depth-dolly`, which only render rejected at the time. `velora validate --composition`
now runs the same timeline gate, so the replayed draft step reports
`ERR_TIMELINE_OVERLAP` first. The fix recorded above (butt-join at 2500 ms) resolves
both issues; the recorded pixel hashes are unchanged.
