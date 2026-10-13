---
name: velora-gsap
description: Convert GSAP tweens to Velora motion tracks and keep render paths free of competing clocks. Use when reusing GSAP knowledge without ScrollTrigger or tickers.
license: MIT
version: 0.1.2
when-to-use: Mapping GSAP easings to Velora, converting tweens to motion tracks, or fixing ERR_ANIMATION_CLOCK rejections.
prerequisites:
- velora-scenes loaded for recipe structure
- Installed gsap-* skills for deep GSAP API
commands:
- validate
- render
related-skills:
- velora-scenes
- velora-debug
- velora-render
not-for: Scroll-driven pinning, ticker clocks, or rAF loops in renders; those are forbidden and rejected by validation.
---

# Velora GSAP — Easing Map and Clock Discipline

Owns GSAP to `MotionSchema` mapping, the easing table, and the timeline builder. Deep GSAP API lives in the installed `gsap-*` skills and is linked here, never copied.

## When to Use This Skill

Use this skill when pasting GSAP knowledge into Velora: choose an easing, convert `from` and `to` tweens to tracks, and prove no competing clock survives. ScrollTrigger, `gsap.ticker`, and `requestAnimationFrame` loops are forbidden in render paths.

## Commands

- `velora validate --json`: rejects forbidden clocks with file and line numbers.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`: proves the converted timeline replays on the frame clock.
- `velora guide --json`: canonical motion defaults and track shapes.

Easing map (`GSAP_EASING_MAP`): `linear` and `none` map to `linear`; `power1.inOut`, `power2.in`, `sine.inOut`, and similar map to `easeInOut`; `power1.out` through `power4.out`, `expo.out`, `sine.out`, and `circ.out` map to `cinematic`. Elastic, bounce, back, rough, and stepped easings have no equivalent and are rejected with `ERR_ANIMATION_CLOCK`; pick `linear`, `easeInOut`, or `cinematic`.

## Prerequisites

- Scene recipe plus binding from `velora-scenes`.
- Installed `gsap-core`, `gsap-timeline`, and `gsap-easing` references for deep API (read there, do not duplicate here).
- All motion expressed as `MotionSchema` tracks in authored milliseconds.

## Workflow

1. Write each tween with explicit `from`, `to`, `at` seconds, `dur` seconds, and `ease` name.
2. Convert seconds to milliseconds and map the easing with `mapGsapEasing`; reject unmapped easings.
3. Emit `surface` tracks with keyframes at `atMs` and `endMs`; validate each track against `MotionTrackSchema`.
4. Paste tracks into the recipe `motion` and run `velora validate --json`.
5. Prove with `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`.

## Worked Example

GSAP-style input in seconds:

```json
[
  { "target": "page", "property": "y", "from": -100, "to": 100, "at": 0, "dur": 6, "ease": "power2.out" }
]
```

Converts to one Velora track (`power2.out` maps to `cinematic`):

```json
{
  "target": { "kind": "surface", "id": "page" },
  "property": "y",
  "keyframes": [
    { "timeMs": 0, "value": -100, "easing": "cinematic" },
    { "timeMs": 6000, "value": 100 }
  ]
}
```

Validate and prove:

```bash
velora validate --json
velora render --composition teaser.composition.json --frame 0 --out proof.png --json
```

## Anti-Patterns

- Using ScrollTrigger, `gsap.ticker`, or `requestAnimationFrame` in scene sources; drive motion from video time.
- Guessing current values; `from` and `to` are required.
- Silently remapping elastic or bounce easings; reject and choose a supported easing.
- Copying `gsap-*` skill bodies here; link to them.

## Troubleshooting

- `ERR_ANIMATION_CLOCK` with file and line: remove the reported ScrollTrigger, ticker, or `requestAnimationFrame` and re-run `velora validate --json`.
- Unmapped easing issue: replace with `linear`, `easeInOut`, or `cinematic`.
- Track schema rejection: check `target.kind`, `property`, and keyframe ordering against `velora guide --json`.
- Static scenes with no changing track still validate; motion is optional.

## Validation

- `velora validate --json` passes with no clock issues.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json` replays the converted motion deterministically.
- Every easing in the recipe maps through `GSAP_EASING_MAP`; no forbidden clock text remains.

## Related Skills

- `velora-scenes`: recipe and motion structure.
- `velora-debug`: `velora validate --json` and clock diagnostics.
- `velora-render`: frame proofs.
- Installed `gsap-core`, `gsap-timeline`, `gsap-utils`: deep API, linked not copied.

## When NOT to Use This Skill

- Do not use this skill for scroll-pinned or ticker-driven effects; they cannot replay on the frame clock.
- Do not use this skill for WebGL time loops; load `velora-threejs`.
- Do not use this skill to bypass `velora validate --json`; conversion output must validate.
