---
name: velora-verify
description: Run technical visual gates over frame evidence and require human review for taste. Use as the last check before calling video done.
license: MIT
version: 0.1.2
when-to-use: Gating rendered frames or video, comparing preview versus export, or recording requiresVisualReview before handoff.
prerequisites:
- Rendered PNG sequence or MP4 plus manifest
- Frames inspected at output size once by the agent
commands:
- check
- frames
- render
related-skills:
- velora-render
- velora-export
- velora-debug
not-for: Artistic scoring, taste judgments, or automatic approval; technical checks pass and humans still review.
---

# Velora Verify — Technical Quality Gate

Owns `velora check`, `velora frames` evidence, and `reviewAuthoring` advisory checks. Technical checks only; `requiresVisualReview: true` always.

## When to Use This Skill

Use this skill after rendering and before handoff. It runs the automated gates, compares preview versus export frames, and records that a human must still review taste.

## Commands

- `velora check --frames stills --json`: frames suite with manifest validation, blank, dimensions, caption coverage, drift, and optional budget.
- `velora check --video teaser.mp4 --manifest stills/manifest.json --json`: video suite plus manifest cross-check.
- `velora frames --composition teaser.composition.json --out stills --json`: evidence the gates read.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`: single-frame evidence.

Suites: `manifest-valid`, `no-blank` (gaps excluded), `dimensions-consistent`, `caption-coverage` and `caption-visible`, `av-drift` within 40ms, `fps-budget` only with `--budget-ms`, `streams-present`. Inapplicable checks are omitted, never faked.

## Prerequisites

- PNG sequence plus `manifest.json` or MP4 plus manifest for cross-checks.
- Caption windows and audio drift recorded in the manifest when applicable.
- No expectation that gates score artistry.

## Workflow

1. Extract evidence: `velora frames --composition teaser.composition.json --out stills --json`.
2. Run `velora check --frames stills --json` and fix every failing suite.
3. For video, run `velora check --video teaser.mp4 --manifest stills/manifest.json --json`.
4. Compare preview versus export frames pixel-wise; record `requiresVisualReview: true`.
5. Hand off with the manifest path and the recorded human review step.

## Worked Example

```bash
velora frames --composition teaser.composition.json --out stills --json
velora check --frames stills --json
velora check --video teaser.mp4 --manifest stills/manifest.json --json
```

Expected: failures carry `ERR_VISUAL_MANIFEST`, `ERR_VISUAL_BLANK`, `ERR_VISUAL_DIMENSIONS`, `ERR_VISUAL_COVERAGE`, `ERR_VISUAL_DRIFT`, or `ERR_VISUAL_BUDGET` with frame paths. Success still requires human review.

## Anti-Patterns

- Calling video done on gates alone without inspecting frames.
- Scoring artistry or taste from technical checks.
- Faking omitted suites as passes; omitted means inapplicable.
- Comparing container bytes instead of decoded pixels or frame SHAs.

## Troubleshooting

- `ERR_VISUAL_MANIFEST`: re-render to regenerate the manifest.
- `ERR_VISUAL_BLANK`: inspect reported frames; the scene is empty or the viewport was lost.
- `ERR_VISUAL_DIMENSIONS`: re-render; dimensions must match the canvas.
- `ERR_VISUAL_COVERAGE`: add frames covering every cue window or trim captions.
- `ERR_VISUAL_DRIFT` or `ERR_VISUAL_BUDGET`: trim audio within 40ms or reduce cost with `velora-performance`.

## Validation

- `velora check --frames stills --json` passes.
- Preview versus export frames match within the recorded tolerance.
- Handoff records `requiresVisualReview: true` with the manifest path.

## Related Skills

- `velora-render`: evidence extraction.
- `velora-export`: video manifests.
- `velora-debug`: failure triage.

## When NOT to Use This Skill

- Do not use this skill to tune motion or budgets; load `velora-scenes` or `velora-performance`.
- Do not use this skill to bypass frame inspection.
- Do not present technical passes as artistic approval.
