---
name: velora-debug
description: Diagnose failures with the error catalog, doctor, and minimal repros. Use when any Velora command fails or validation blocks rendering.
license: MIT
version: 0.1.2
when-to-use: Triaging ERR_* codes, running doctor and validate, or building a minimal repro for bridge, binding, or focus failures.
prerequisites:
- Failing command output with --json saved
- Project root known
commands:
- doctor
- validate
- inspect
related-skills:
- velora
- velora-init
- velora-verify
not-for: Performance tuning or visual approval; use velora-performance or velora-verify for those verdicts.
---

# Velora Debug — Error Catalog and Repros

Owns `velora doctor`, `velora inspect`, `velora validate`, log reading, and the `ERR_*` to fix mapping.

## When to Use This Skill

Use this skill when any command exits 1 or 2. It looks up the stable code, runs the read-only diagnostics, and reduces the failure to the smallest repro before changing sources.

## Commands

- `velora doctor --json`: Node, package, React, toolkit, scenes, FFmpeg, Chromium, plus optional dev-server reachability with `--url <origin>`.
- `velora validate --json`: project, recipes, bindings, assets, and clock discipline.
- `velora validate --composition teaser.composition.json --json`: timeline plus audio, captions, and transitions.
- `velora inspect --json`: project identity without mutation.
- `velora inspect --scene <id> --json`: one scene with node IDs and dimensions.

## Prerequisites

- The exact failing command plus its `--json` output.
- No source changes made blindly before diagnostics.

## Workflow

1. Save the failure: rerun the command with `--json` and record `issues[].code`, `path`, `message`, `hint`, and `next`.
2. Run `velora doctor --json` and fix environment prerequisites first.
3. Run `velora validate --json` or `velora validate --composition <file> --json` for field-accurate paths.
4. Run `velora inspect --scene <id> --json` when the path names a scene or composition.
5. Reduce to a minimal repro: one scene, one segment, one track, then re-add complexity.
6. Fix, re-validate, and prove with `velora render --composition <file> --frame 0 --out proof.png --json`.

## Worked Example

```bash
velora doctor --json
velora validate --json
velora inspect --scene demo --json
velora validate --composition teaser.composition.json --json
```

Common mappings: bridge missing means open a capture-enabled scene; binding mismatch means add the sibling TSX; focus rejection means `distance` must exceed `focalLength`; projection-plane crossing means reduce depth range; caption timing means split cues.

## Anti-Patterns

- Guessing fixes without reading `issues[].code` and `hint`.
- Editing generated catalogs or adapters instead of sources.
- Re-running renders before `velora validate --json` passes.
- Pasting secrets or private data into repros.

## Troubleshooting

- `ERR_FOCUS_INVALID`: read `velora guide --json` focus concept; fix `distance`, `fStop`, or `maxBlur`.
- `ERR_BINDING_MISSING`: add the sibling component, then run `velora sync --json`.
- `ERR_SCENE_NOT_FOUND`: run `velora scenes --json` and correct the ID.
- `ERR_CAPTURE_NO_BRIDGE`, `ERR_SERVER_UNREACHABLE`, `ERR_FFMPEG_MISSING`, `ERR_CHROMIUM_MISSING`: follow `velora doctor --json` hints.
- `ERR_ANIMATION_CLOCK` or `ERR_WEBGL_TIMELOOP`: remove the reported clock line.

## Validation

- `velora doctor --json` and `velora validate --json` pass after the fix.
- The minimal repro renders one frame before the full timeline does.
- The same failure does not recur on re-run.

## Related Skills

- `velora`: root routing.
- `velora-init`: setup failures.
- `velora-verify`: evidence gates after the fix.

## When NOT to Use This Skill

- Do not use this skill for fps budgets or memoization; load `velora-performance`.
- Do not use this skill to approve visuals; load `velora-verify` and inspect frames.
- Do not bypass the catalog; every fix maps to a stable code.
## Depth diagnostics

- `depth-flattened` identifies the grouping property and ancestor. Move clipping, opacity or filters to a content leaf, or mark that region `data-velora-tier="flat"`. Flattened chains can use projected depth.
- `depth-contested` identifies a host style that keeps replacing a property the depth ledger composes. Move that host change to a separate inner element when the visual intent permits it.
- `depth-focus-deferred` identifies volumetric layers that need a filter-free leaf to preserve 3D. Use projected depth if the shot depends on whole-surface blur.
