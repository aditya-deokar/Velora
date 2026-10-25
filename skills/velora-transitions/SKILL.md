---
name: velora-transitions
description: Declare entering-side segment transitions and compile them to motion tracks. Use when joining scenes with consistent entrances.
license: MIT
version: 0.1.2
when-to-use: Choosing a catalog transition, checking span and leaf rules, or pasting builder output into recipe motion.
prerequisites:
- velora-composition loaded for segment structure
- Entering scene owns Surface leaves for leaf-targeted types
commands:
- transitions
- validate
- render
related-skills:
- velora-composition
- velora-scenes
- velora-render
not-for: True A/B crossfade compositing or CSS clipping masks; those belong to host CSS or future work, not motion tracks.
---

# Velora Transitions — Catalog and Builders

Owns the 8-transition catalog, overlap accounting, and the leaf-opacity rule. Entering-side model: every transition describes what the incoming scene does over the first `durationMs` of its segment; totals never change.

## When to Use This Skill

Use this skill at segment boundaries. Pick a catalog type, fit it inside the segment span, and paste builder tracks into the entering scene's motion.

## Commands

- `velora transitions ls --json`: catalog with descriptions and leaf requirements.
- `velora transitions describe --type dissolve --json`: one transition plus example tracks for a 1000ms entrance on `Surface main`.
- `velora validate --json`: checks span fit and leaf-targeted declarations.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`: proves the entrance replays.

Catalog: `cut` (no tracks), `dissolve` (fade), `slide-push` (x travel), `wipe-mask` (true left-to-right reveal through a `clipRight` inset mask on each entering leaf), `iris-mask` (true circular reveal through a `clipRadius` mask), `depth-dolly` (camera z), `focus-pull` (focus distance), `cascade-handoff` (staggered depth plus opacity).

## Prerequisites

- Butt-joined segments; transitions do not overlap prior content.
- `durationMs` positive and within the segment span.
- Leaf-targeted types (`dissolve`, `slide-push`, `wipe-mask`, `iris-mask`, `cascade-handoff`) resolve to scenes that declare leaves.

## Workflow

1. Run `velora transitions ls --json` and choose a type.
2. Run `velora transitions describe --type <type> --json` and copy the example `tracks`.
3. Set `transition: { type, durationMs }` on the entering segment and paste tracks into its recipe motion.
4. Run `velora validate --json`; fix `ERR_TRANSITION_INVALID` span or leaf failures.
5. Prove with `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`.

## Worked Example

```bash
velora transitions ls --json
velora transitions describe --type cascade-handoff --json
velora validate --json
velora render --composition teaser.composition.json --frame 0 --out proof.png --json
```

Segment declaration:

```json
{ "id": "s2", "recipe": "demo", "startMs": 2000, "durationMs": 2000, "transition": { "type": "dissolve", "durationMs": 500 } }
```

Group opacity does not fade descendants; animate the actual visual leaves.

## Anti-Patterns

- Declaring a transition longer than its segment.
- Using leaf-targeted types on leafless scenes.
- Expecting true crossfade compositing from tracks; `dissolve` fades entering leaves only.
- Hand-rolling entrances when the builder output validates.

## Troubleshooting

- `ERR_TRANSITION_INVALID` span: shorten `durationMs` to fit the segment.
- `ERR_TRANSITION_INVALID` leaves: add `Surface` leaves to the entering scene or choose `cut`, `depth-dolly`, or `focus-pull`.
- `transition-approx` warnings for wipe or iris: expected; true masks belong to host CSS.

## Validation

- `velora validate --json` passes with transitions declared.
- `velora transitions describe --type <type> --json` example tracks validate as motion tracks.
- Boundary frames show the entrance without overlap errors.

## Related Skills

- `velora-composition`: segment structure.
- `velora-scenes`: leaf ownership.
- `velora-render`: boundary frame proofs.

## When NOT to Use This Skill

- Do not use this skill for camera rails or kinetic text; load `velora-scenes` or `velora-typography`.
- Do not promise A/B compositing between scenes: transitions animate the entering scene only. Wipes and irises are true masks on its leaves, not crossfades with the previous scene.
- Do not skip `velora validate --json` span checks.
