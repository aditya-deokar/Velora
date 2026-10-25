---
name: velora-typography
description: Style text and compile kinetic presets to motion tracks with Surface-leaf discipline. Use when titles must stay readable at output size.
license: MIT
version: 0.1.2
when-to-use: Authoring TextStyleSchema text, choosing a kinetic preset, or proving readability with frame evidence.
prerequisites:
- velora-scenes loaded for Surface ownership
- Text content finalized (no placeholder copy)
commands:
- validate
- frames
- render
related-skills:
- velora-scenes
- velora-render
- velora-verify
not-for: Body-copy typesetting, font licensing, or artistic taste judgments; this skill owns technical readability and track validity.
---

# Velora Typography — Styles and Kinetic Presets

Owns `TextStyleSchema`, four kinetic presets, the Surface-leaf rule, and the per-scene text budget.

## When to Use This Skill

Use this skill when titles, labels, or captions are part of the shot. Every animated text region must live in a `Surface` leaf or `content`; builders never invent surfaces.

## Commands

- `velora validate --json`: gates track validity and composition invariants.
- `velora frames --composition teaser.composition.json --out stills --every 30 --json`: readability proof across the timeline.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`: single-frame readability check at output size.

`TextStyleSchema` fields: `family`, `size`, `weight`, `tracking`, `leading`, `color` as `#rrggbb`, `align`, optional `kinetic` preset. Presets: `fade-slide`, `word-cascade`, `mask-reveal`, `typewriter-timed`.

## Prerequisites

- Explicit `Surface` IDs for every animated word or block; builders take `surfaceIds` plus `durationMs`.
- Budget: at most 12 animated text surfaces per scene; more triggers a warning to split or bake.
- Host UI paint preserved; styles apply only to explicitly authored text.

## Workflow

1. Define `TextStyleSchema` styles for the title.
2. Split words into one `Surface` per word for `word-cascade` or `typewriter-timed`; keep single blocks for `fade-slide` or `mask-reveal`.
3. Compile with `buildKineticTracks(preset, { surfaceIds, durationMs })` and paste `tracks` into recipe motion.
4. Run `velora validate --json`.
5. Prove with `velora frames --composition teaser.composition.json --out stills --every 30 --json` and read every still at output size.

## Worked Example

```bash
velora validate --json
velora render --composition teaser.composition.json --frame 0 --out proof.png --json
velora frames --composition teaser.composition.json --out stills --every 30 --json
```

Preset choice: `word-cascade` staggers depth plus opacity across words; `fade-slide` rises plus fades; `mask-reveal` is a true left-to-right reveal through a `clipRight` mask on each text leaf; `typewriter-timed` steps opacity per word with `linear` easing.

## Anti-Patterns

- Animating every character or huge filtered surface counts.
- Detaching labels from meaning or splitting without `Surface` ownership.
- Judging readability in metadata; inspect real PNGs at output size.
- Restyling host UI silently; style only authored text.

## Troubleshooting

- `kinetic-budget` warning: reduce to 12 or fewer surfaces, split across scenes, or bake to an asset.
- `kinetic-single` warning for one-surface typewriter: split words first.
- `ERR_SCENE_INVALID` or focus diagnostics: confirm every text region belongs to a visual leaf.
- Blurry titles: raise `fStop` before raising `maxBlur`; keep the subject on the focal plane.

## Validation

- `velora validate --json` passes.
- `velora frames --composition teaser.composition.json --out stills --every 30 --json` plus visual read at output size confirms every cue window is legible.
- No preset exceeds the surface budget without a recorded warning disposition.

## Related Skills

- `velora-scenes`: Surface ownership and camera framing.
- `velora-render`: frame extraction.
- `velora-verify`: caption coverage gates.

## When NOT to Use This Skill

- Do not use this skill for audio or caption file syntax; load `velora-audio`.
- Do not use this skill for transition entrances; load `velora-transitions`.
- Do not promise typeface taste; prove technical readability only.
