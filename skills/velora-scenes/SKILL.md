---
name: velora-scenes
description: Create scene recipes, TSX bindings, and timeline motion with ScenePreview and Surface discipline. Use when turning live UI into a dramatic shot.
license: MIT
version: 0.1.2
when-to-use: Authoring a scene pair, choosing a shot family, wiring ScenePreview, or debugging framing and focus before export.
prerequisites:
- velora guide --json read for this CLI version
- Existing live component with providers identified
commands:
- guide
- scenes
- load
related-skills:
- velora
- velora-composition
- velora-render
not-for: Multi-scene composition files, audio mixes, caption files, or MP4 encoding; use velora-composition, velora-audio, or velora-export for those.
---

# Velora Scenes — Recipes, Bindings, Camera

Owns scene creation: recipe JSON plus TSX binding, `ScenePreview` and `Surface` rules, the single elapsed cursor, frame math, and seed discipline.

## When to Use This Skill

Use this skill when the task is one shot: frame a real component, travel the camera, settle a cascade, and prove the still before animating. Shot families (travel, plating, micro detail, floating foreground) are options, not mandates; user direction overrides defaults.

## Commands

- `velora guide --json`: canonical authoring guide with `commands[]` index for this CLI version.
- `velora scenes --json`: confirm the new recipe appears after authoring.
- `velora load --scene <id> --json`: read back the recipe source.

Preview and capture run through the app dev server; rendering proofs use `velora render --composition <file> --frame <n> --out <png> --json` and `velora shot --scene <id> --time <ms> --out <png> --json` from `velora-render`.

## Prerequisites

- The requested page route or component path plus its providers and styles inspected.
- Recipe directory `src/velora/scenes` with `<id>.scene.json` version 1 and sibling `<id>.tsx` default export.
- No ScrollTrigger, ticker, or `requestAnimationFrame` clocks in scene sources; motion comes from video time only.

## Workflow

1. Run `velora guide --json` and read the workflow plus `capabilities.api`.
2. Choose a shot family and state the near edge, subject, camera distance, one travel axis, focus region, and depth references.
3. Approve the opening still visually: near and far size difference, intentional crop, identifiable detail, black void.
4. Author `<id>.scene.json` with `scene.nodes`, optional `motion.durationMs` and tracks, plus `width` and `height`.
5. Author `<id>.tsx` returning stable `Surface` subtrees matching node IDs; keep providers outside or around them.
6. Run `velora scenes --json`, then `velora snapshot --scene <id> --url <origin> --json` to save the thumbnail.
7. Scrub `ScenePreview`, then prove with `velora shot --scene <id> --time <ms> --out <png> --json`.

## Worked Example

Recipe `src/velora/scenes/page-survey.scene.json`:

```json
{
  "version": 1,
  "id": "page-survey",
  "title": "Page survey",
  "definition": {
    "width": 1400,
    "height": 980,
    "scene": {
      "camera": { "perspective": 1400, "rotateY": -24, "rotateX": 10 },
      "focus": { "distance": 1400, "fStop": 5.6, "focalLength": 100, "maxBlur": 6 },
      "nodes": [{ "id": "page" }]
    },
    "motion": {
      "durationMs": 6000,
      "tracks": [
        {
          "target": { "kind": "camera" },
          "property": "y",
          "keyframes": [
            { "timeMs": 0, "value": -100 },
            { "timeMs": 6000, "value": 100 }
          ]
        }
      ]
    }
  }
}
```

Binding `src/velora/scenes/page-survey.tsx`:

```tsx
import { Surface } from 'velora';
import { App, DashboardProvider } from '../../App';

export default function PageSurvey() {
  return (
    <DashboardProvider>
      <Surface id="page" style={{ width: 1400, height: 980 }}>
        <App />
      </Surface>
    </DashboardProvider>
  );
}
```

Verify:

```bash
velora scenes --json
velora load --scene page-survey --json
velora guide --json
```

Frame math: `frame = round(timeMs * fps / 1000)`; one cursor owns elapsed time; `seed` makes randomness deterministic.

## Anti-Patterns

- Copying a demo instead of reusing the requested live component.
- Animating page position to fake a camera rail; move the camera.
- Crossing the CSS projection plane or spinning 360 degrees without reason.
- Duplicating subtrees to fake focus; keep one live instance per component.
- Rendering `Scene` or `ScenePreview` inside the binding; the library owns them.

## Troubleshooting

- `ERR_BINDING_MISSING`: add the sibling `<id>.tsx` component, then run `velora sync --json`.
- `ERR_SCENE_INVALID`: run `velora validate --json` for field diagnostics.
- `ERR_FOCUS_INVALID`: keep `distance` above `focalLength`; version 2 radial fields are rejected.
- `ERR_ANIMATION_CLOCK`: remove ScrollTrigger, ticker, and `requestAnimationFrame` clocks.
- Blank or clipped frames: inspect at output size, reduce depth range, keep the subject on the focal plane.

## Validation

- `velora scenes --json` lists the new ID; `velora load --scene <id> --json` returns its source.
- `velora validate --json` passes for the recipe and binding.
- `velora shot --scene <id> --time <ms> --out <png> --json` produces a readable still at output size.
- Preview scrub of beginning, middle, and end shows no inversion or disappearance.

## Related Skills

- `velora`: root index and execution loop.
- `velora-composition`: catalog and composition wiring.
- `velora-render`: frame proofs and `velora snapshot --scene <id> --url <origin> --json`.
- Installed `gsap-*`: easing choice without ScrollTrigger.
- Installed `threejs-fundamentals`: scene graph discipline for WebGL leaves.

## When NOT to Use This Skill

- Do not use this skill for composition timelines or asset management; load `velora-composition`.
- Do not use this skill for audio, captions, or transitions; load `velora-audio` or `velora-transitions`.
- Do not use this skill to judge export readiness; load `velora-verify` and inspect real frames.
