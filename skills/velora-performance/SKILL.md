---
name: velora-performance
description: Hold frame budgets with surface, filter, and draw discipline plus memoization. Use when playback stutters or check reports budget pressure.
license: MIT
version: 0.1.2
when-to-use: Diagnosing slow scenes, reducing filter cost, stabilizing wrapper identity, or interpreting fps-budget evidence.
prerequisites:
- velora-verify evidence showing which check strained
- Real device for measurement (no universal promises)
commands:
- check
- render
- validate
related-skills:
- velora-verify
- velora-scenes
- velora-debug
not-for: Claiming a universal FPS guarantee; budgets are device evidence, not promises.
---

# Velora Performance — Budgets and Memoization

Owns surface, filter, and draw budgets, memoization plus stable wrapper identity, `pixelRatio` caps, and device-evidence discipline.

## When to Use This Skill

Use this skill when `velora check --frames stills --json` reports budget pressure, preview stutters, or a scene uses many filtered surfaces. It reduces cost without changing the shot intent.

## Commands

- `velora check --frames stills --budget-ms <ms> --json`: enforce an explicit frame budget as evidence.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`: single-frame cost probe.
- `velora validate --json`: gates structural issues before tuning.

Budgets table: procedural nodes at most 200; kinetic text surfaces at most 12; `pixelRatioCap` 1 to 2 (default 1.5); composition scenes at most 256; assets at most 256 files and 50MB each.

## Prerequisites

- A failing or near-limit `fps-budget` check with device details recorded.
- Scene sources with stable `Surface` wrapper identity during playback.
- Changing clock passed only to components that consume scene time.

## Workflow

1. Run `velora check --frames stills --budget-ms <ms> --json` and record p95 evidence on the real device.
2. Reduce filtered surface counts; bake static layers to assets when over budget.
3. Memoize the composed host subtree keyed by recipe; keep wrapper identity stable.
4. Cap `pixelRatio`, isolate transforms and filters on visual leaves, and avoid flattening `preserve-3d` ancestors.
5. Re-prove with `velora render --composition teaser.composition.json --frame 0 --out proof.png --json` and `velora check --frames stills --budget-ms <ms> --json`.

## Worked Example

```bash
velora check --frames stills --budget-ms 22 --json
velora validate --json
velora render --composition teaser.composition.json --frame 0 --out proof.png --json
```

Expected: raising `--budget-ms` is a measurement change, not a fix; real fixes lower surface counts, stabilize identity, or cap pixels.

## Anti-Patterns

- Promising 60 FPS everywhere; report device evidence instead.
- Adding layers to fix slowness; fewer filtered surfaces render faster.
- Rerendering the whole host subtree on every clock tick.
- Flattening 3D with filters or opacity on grouping ancestors.

## Troubleshooting

- `ERR_VISUAL_BUDGET`: reduce scene cost or raise `--budget-ms` with a recorded reason.
- `ERR_PROCEDURAL_BUDGET`: reduce counts below 200 nodes or bake layers.
- Jank without a budget failure: profile on the target device; metadata never certifies performance.
- Wrapper churn: memoize elements and pass clock only to consumers.

## Validation

- `velora check --frames stills --budget-ms <ms> --json` passes on the target device.
- Re-renders share frame SHAs; tuning did not change timing.
- Budgets table holds for the shipped scene.

## Related Skills

- `velora-verify`: budget evidence and gates.
- `velora-scenes`: stable composition structure.
- `velora-debug`: structural diagnostics.

## When NOT to Use This Skill

- Do not use this skill for correctness failures; load `velora-debug`.
- Do not use this skill for audio drift or caption coverage; load `velora-audio` or `velora-verify`.
- Do not quote this skill as a universal guarantee.
