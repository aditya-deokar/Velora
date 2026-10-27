---
name: velora-render
description: Render exact frames, PNG sequences, and stills with cache and progress discipline. Use when proving timelines with frame evidence before export.
license: MIT
version: 0.1.2
when-to-use: Extracting a single frame, a PNG sequence, or a single-scene still, reading manifests, or running the fix loop on visual evidence.
prerequisites:
- Validated composition (velora validate --composition <file> --json green)
- Running dev server for non-gap timelines
commands:
- render
- frames
- shot
- snapshot
- check
related-skills:
- velora
- velora-scenes
- velora-export
- velora-verify
not-for: Full MP4 encoding flags, audio mixes, caption burns, or artistic scoring; use velora-export or velora-verify for those decisions.
---

# Velora Render — Frames, Sequences, Stills

Owns `velora render --frame`, `velora frames`, `velora shot`, and `velora snapshot`, plus progress NDJSON, cache flags, and manifest reading.

## When to Use This Skill

Use this skill when the timeline is validated and the next step is evidence: one exact PNG, a sequence plus `manifest.json`, or a composition-free still. It runs the fix loop of render, inspect, and re-render until `velora check` passes.

## Commands

- `velora render --composition teaser.composition.json --frame 30 --out frame.png --json`: one exact timeline frame plus manifest.
- `velora render --composition teaser.composition.json --time 1000 --out frame.png --json`: same frame addressed by milliseconds.
- `velora frames --composition teaser.composition.json --out stills --every 30 --json`: PNG sequence with `manifest.json`; default is one frame per second.
- `velora frames --composition teaser.composition.json --out stills --at 0,500,1000 --json`: explicit millisecond list.
- `velora shot --scene demo --time 500 --out shot.png --json`: single-scene still without a composition.
- `velora shot --scene demo --time 500 --out master.png --quality master --motion-blur 180 --fps 24 --json`: preview export finishing (supersampling and motion blur) on one frame before a long master render.
- `velora snapshot --scene demo --url http://127.0.0.1:5173 --json`: thumbnail capture into the recipe.
- `velora check --frames stills --json`: technical gates over the evidence.

Cache flags apply to still and sequence renders.
Video envelope control: `velora render --composition teaser.composition.json --out teaser.mp4 --no-stream --json` prints only the final envelope.

## Prerequisites

- Composition validates; segments butt-join without overlap.
- Output paths are project-relative (`.png` for stills, directory for sequences) without traversal.
- Frame indices within the timeline span; `velora inspect --composition <file> --json` reports totals.

## Workflow

1. Run `velora validate --composition teaser.composition.json --json`.
2. Render one frame: `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`.
3. Read `proof.png` at output size plus its manifest (`frame`, `timeMs`, `sceneId`, `sha`).
4. Extract a sequence: `velora frames --composition teaser.composition.json --out stills --every 30 --json`.
5. Run `velora check --frames stills --json`; fix blank, dimension, or coverage failures.
6. Re-render only after fixing sources; cache hits prove determinism (`serial` versus `parallel` SHAs match).

## Worked Example

```bash
velora validate --composition teaser.composition.json --json
velora render --composition teaser.composition.json --frame 0 --out proof.png --json
velora frames --composition teaser.composition.json --out stills --every 30 --json
velora check --frames stills --json
velora shot --scene demo --time 500 --out shot.png --json
```

Expected: frame mode reports `frame`, `timeMs`, `sceneId`, `cached`, and manifest path. `velora frames` reports `total` and `manifest`.
Video progress streams NDJSON lines ending with the envelope; see the video command above for envelope-only control.

## Anti-Patterns

- Rendering video before a single frame proves the timeline.
- Judging equality on container bytes or `createdAt`; compare frame SHAs.
- Using `--frame` and `--time` together, or mixing still flags (`--parallel`, `--fps`) into frame mode.
- Treating cached hits as stale; identical SHAs are the determinism proof.
- Skipping `velora check --frames` and eyeballing one PNG.

## Troubleshooting

- `ERR_FRAME_OUT_OF_RANGE`: pick a frame within the span from `velora inspect --composition <file> --json`.
- `ERR_TIMELINE_OVERLAP` or `ERR_COMPOSITION_INVALID`: fix the composition, re-validate.
- `ERR_CAPTURE_NO_BRIDGE`: open a scene with capture enabled and retry.
- `ERR_SERVER_UNREACHABLE`: start the dev server and retry with its loopback origin.
- Blank frames: the scene is empty or the viewport was lost; inspect sources and retry.

## Validation

- Frame PNG plus manifest exist; manifest validates as `RenderManifestSchema`.
- `velora frames --composition <file> --out <dir> --json` plus `velora check --frames <dir> --json` pass.
- Re-render is cache-consistent; edited scenes re-render only their seeks.
- Evidence is inspected at output size before export.

## Related Skills

- `velora`: root golden path.
- `velora-scenes`: scene sources behind the frames.
- `velora-export`: full MP4 mode, `velora render --composition <file> --out <mp4> --json`.
- `velora-verify`: technical gates and `requiresVisualReview` discipline.

## When NOT to Use This Skill

- Do not use this skill for MP4 encoding options or FFmpeg prerequisites; load `velora-export`.
- Do not use this skill for audio drift or caption coverage verdicts; load `velora-audio` and `velora-verify`.
- Do not use this skill to approve artistic quality; it proves technical reproducibility only.
