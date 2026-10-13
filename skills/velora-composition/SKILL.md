---
name: velora-composition
description: Author versioned composition files, inspect projects, and manage assets. Use when planning multi-scene timelines or validating the catalog before rendering.
license: MIT
version: 0.1.2
when-to-use: Writing a .composition.json file, inspecting project state, listing assets, or checking reusable scenes before rendering.
prerequisites:
- velora-init completed (velora doctor --json green)
- Scene recipes present in src/flute/scenes
commands:
- scenes
- load
- inspect
- assets
- validate
related-skills:
- velora
- velora-init
- velora-scenes
- velora-debug
not-for: Single-scene motion authoring, GSAP conversion, WebGL canvases, or export tuning; use velora-scenes, velora-gsap, velora-threejs, or velora-export instead.
---

# Velora Composition — Specs, Inspection, Assets

Owns the machine-readable composition spec plus `velora scenes`, `velora load`, `velora inspect`, `velora assets`, and composition-aware `velora validate`.

## When to Use This Skill

Use this skill when planning a whole video from one JSON file, auditing what exists before generating code, or wiring assets. It keeps compositions as IDs, paths, and timings only: never embedded React, credentials, or records.

## Commands

- `velora scenes --json`: list validated scene recipes in the catalog.
- `velora load --scene <id> --json`: return one recipe source.
- `velora inspect --json`: project identity plus recipe and asset counts without mutation.
- `velora inspect --scene <id> --json`: one scene with dimensions, duration, and node IDs.
- `velora inspect --composition teaser.composition.json --json`: resolved scenes, assets, and totals.
- `velora assets ls --json`: discovered assets with IDs and paths.
- `velora assets check --json`: oversize, unsupported, and dangling-alias diagnostics.
- `velora validate --composition teaser.composition.json --json`: full gate including audio, captions, and transitions.

## Prerequisites

- Initialized project with a valid scene catalog.
- Asset filenames as lowercase slugs; images, video, audio, or fonts only, each under 50MB.
- Composition files ending in `.composition.json` matching `CompositionSchema` version 1.

## Workflow

1. Run `velora inspect --json` and `velora scenes --json` to read the catalog.
2. Run `velora assets ls --json` to list addressable asset IDs.
3. Author `teaser.composition.json` with `version: 1`, canvas `width` and `height`, `fps` 30, `seed`, and butt-joined `scenes` segments.
4. Declare `assets`, `audio`, and `captions` by ID, never by bytes.
5. Run `velora inspect --composition teaser.composition.json --json` to review resolution and totals.
6. Run `velora validate --composition teaser.composition.json --json` and fix every issue before rendering.

## Worked Example

Minimal composition referencing a `demo` recipe:

```json
{
  "version": 1,
  "id": "teaser",
  "title": "Teaser",
  "width": 1280,
  "height": 720,
  "fps": 30,
  "seed": 7,
  "scenes": [
    { "id": "s1", "recipe": "demo", "startMs": 0, "durationMs": 2000 }
  ],
  "assets": []
}
```

Validate and inspect it:

```bash
velora validate --composition teaser.composition.json --json
velora inspect --composition teaser.composition.json --json
velora assets ls --json
```

Negative example: duplicate segment IDs or a recipe not in `velora scenes --json` fails with `ERR_TIMELINE_INVALID` or `ERR_SCENE_NOT_FOUND`. Fix the IDs; do not hand-edit the generated catalog.

## Anti-Patterns

- Embedding TSX, credentials, or base64 bytes in the composition file.
- Overlapping segments that start before the previous one ends (`ERR_TIMELINE_OVERLAP`); butt-join them.
- Declaring assets by path without matching discovered IDs (`ERR_ASSET_NOT_FOUND`).
- Skipping `velora inspect --composition` and rendering an unresolved timeline.
- Keeping helpers inside the discovery directory; they belong outside it.

## Troubleshooting

- `ERR_COMPOSITION_INVALID`: the file is not a `*.composition.json` version 1 document; check the schema path.
- `ERR_SCENE_NOT_FOUND`: run `velora scenes --json` and correct the `recipe` field.
- `ERR_ASSET_NOT_FOUND` or `ERR_ASSET_UNSUPPORTED`: run `velora assets check --json`, rename to a lowercase slug, or compress below 50MB.
- `ERR_TIMELINE_OVERLAP`: trim starts so no segment starts before the prior ends.
- `invalid-scenes`: read `velora validate --json` for recipe diagnostics.

## Validation

- `velora validate --composition teaser.composition.json --json` passes.
- `velora inspect --composition teaser.composition.json --json` resolves every scene and asset with correct totals.
- `velora assets check --json` reports `verdict: pass`.
- The same composition validates byte-identically on re-run.

## Related Skills

- `velora`: root routing and golden path.
- `velora-init`: setup before inspecting.
- `velora-scenes`: recipe and binding authoring for catalog entries.
- `velora-debug`: `velora validate --json` diagnostics and `ERR_*` lookup.

## When NOT to Use This Skill

- Do not use this skill for camera rails or Surface decomposition; load `velora-scenes`.
- Do not use this skill for frame extraction or MP4 encoding; load `velora-render` or `velora-export`.
- Do not invent a scene-create-from-template command; copy a template directory and validate it with real commands.
