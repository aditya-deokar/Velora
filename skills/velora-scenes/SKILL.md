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
- velora-templates
- velora-cinematography
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

### Size the app viewport

Render new app UI inside a laptop stage. Use `laptop-14` (1512×982 at 2×), `laptop-13` (1440×900 at 2×), or the user's detected viewport. Use `desktop-1080` at 1× only when requested. Keep the concrete size in `definition.stage` and use `AppStage` inside the app's Surface. Components in that tree can use `@container velora-app-stage` or `useAppStage()`. Use `RouteFrame` inside `AppStage` for apps that depend on window media queries.

1. Run `velora guide --json` and read the workflow plus `capabilities.api`.
2. Choose a shot family and state the near edge, subject, camera distance, one travel axis, focus region, and depth references.
3. Approve the opening still visually: near and far size difference, intentional crop, identifiable detail, black void.
4. Author `<id>.scene.json` with `scene.nodes`, optional `motion.durationMs` and tracks, plus `width` and `height`.
5. Author `<id>.tsx` returning stable `Surface` subtrees matching node IDs; keep providers outside or around them.
6. Run `velora scenes --json`, then `velora snapshot --scene <id> --url <origin> --json` to save the thumbnail.
7. Scrub `ScenePreview`, then prove with `velora shot --scene <id> --time <ms> --out <png> --json`.

Motion vocabulary (details in `velora guide --json` capabilities):

- **Smooth camera rails:** a multi-waypoint camera track with `"interpolation": "smooth"` and `"ease": "cinematic"` passes every waypoint without stopping, then accelerates and settles once. Segment tracks stop at each cinematic keyframe.
- **Lens language:** `lensFor(mm, frameHeight)` maps 24/35/50/85/135 mm to `camera.perspective` (frameHeight × mm / 24) plus the matching `focus.focalLength`. Wide lenses exaggerate depth; long lenses compress it. `perspective` is animatable: hold the subject on the projection plane and widen the lens for a dolly zoom.
- **Easing:** keyframes accept named families (`expo.out`, `back.out`), `{ cubicBezier: [...] }`, `{ spring: {...} }`, `{ steps: n }` and `hold`. Keep overshoot off camera tracks.
- **Handheld texture:** `"noise": { "amplitude": 6, "frequency": 0.6, "seed": 1 }` on camera position or rotation tracks adds seeded, replayable shake. Use it sparingly, never on loops or text-heavy close-ups.
- **Leaf visuals:** surface `blur` composes with depth of field; `clipTop/Right/Bottom/Left` (percent insets) and `clipRadius` (iris) are true masks on the visual leaf.
- **Channels:** a `{ "kind": "channel", "id": "revenue" }` track drives component state; read it with `useChannel("revenue")` instead of a component clock.
- **Loops:** `motion.loop: true` wraps preview playback. End every track on its starting value, or `reviewAuthoring` reports `loop-seam`.
- **Editor autocomplete:** add `"$schema": "../../../node_modules/@adityadeokar/velora/schemas/scene-recipe.schema.json"` to a recipe.

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
import { Surface } from '@adityadeokar/velora';
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

## Pivot, Skew, Grade and Style Variables (Velora 1.1)

- Transforms (Surface `transform` and surface tracks) accept optional `scaleX`/`scaleY`/`scaleZ` ((0, 100], multiplying `scale`), `skewX`/`skewY` (-89..89 deg) and `originX`/`originY` (-100..200 %, the pivot for rotation, scale and skew; default 50/50). Rotate a card about its corner with `originX: 0, originY: 0`. Absent fields keep the previous CSS and matrices exactly.
- Per-element grade tracks on surfaces: `brightness`, `contrast`, `saturate` (0..4), `hueRotate` (-360..360 deg) and `grayscale` (0..1). Like opacity and blur they style the content leaf only, so they never flatten 3D. A slow `grayscale` 1 to 0 on the hero card pulls the eye to it.
- Style tracks write CSS custom properties on a Surface's outer element: `{ "target": { "kind": "style", "id": "card" }, "property": "--accent", "keyframes": [{ "timeMs": 0, "value": "#3b82f6" }, { "timeMs": 1200, "value": "#f97316" }] }`. Host components read `var(--accent)` with no Velora code; descendants inherit it. Numeric style tracks take an optional `unit` (`px`, `%`, `deg`, `em`, `rem`, `vw`, `vh`). The style target must be a registered Surface id.
- Recipes may carry an optional `editor` block (`labels`, `colors`, `locked`, `markers`). It is editor-owned metadata that the renderer ignores; keep it accurate if you edit it.

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
## Promoting JSX to spatial layers

Use `useAnimatable` when an existing component prop needs a clocked value. Choose the smallest meaningful typed prop and verify it in the Studio Inspector. Keep data fetching, layout and providers in the host component.

Use the studio's **Pick source element** or `velora edit source outline --scene <id> --json` to find authored JSX. The source diff can wrap an element in a Surface and update its scene recipe in one transaction. **Group spatial layers** gives contiguous Surface siblings a common parent while retaining their IDs and tracks. Use a motion clip to group tracks in time.

Choose a stable, unique layer ID and verify the new wrapper's layout in Edit mode after applying. For JSX rendered in loops, conditions, or props, review the refusal and use **Ask agent** to request a manual change.
## Lift app layers

Set `definition.depth` by Surface ID or run `velora edit depth --scene home-hero --surface subject --mode auto --intensity subtle --write`. Scene props are a fallback. In rule mode, match `data-velora-anchor`, a CSS selector, or a detected tier. The first rule wins after explicit `data-velora-tier` markup. Use `flat` for a subtree or `none` to exclude one node. Use the `elevation` surface track to animate the tier multiplier from 0 to 1.

Run `velora depth resolve --scene home-hero --url http://127.0.0.1:5173 --write` after checking the shot. This freezes stable anchor or selector matches at the opening frame. Re-enable live depth before freezing a changed layout.
