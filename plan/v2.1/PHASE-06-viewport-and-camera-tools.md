# Phase 06 — Viewport: direct manipulation, motion paths and camera tools

## Goal
Direct the scene where it is seen. Click the headline in the frame to select it, drag it in its
own 3D plane, rotate it on a ring, bend its motion path, orbit and dolly the camera, step into a
director view to see the camera in the set, and click a face to pull focus. Every manipulation is
computed by the single projection owner and lands as `EditOp`s.

## Prerequisites
- Phase 04 (intents, store), Phase 02 (paths, constraints). Phase 05 recommended (timeline shows
  the keys created here).

## Scope IN
- Inverse projection in `spatial.ts`; picking and selection in the viewport.
- Move/rotate/scale/pivot gizmos; numeric entry; snapping to guides.
- Motion-path overlay with keyframe dots and spatial tangents; onion skin.
- Camera tools (orbit, truck, pedestal, dolly, pan, tilt, roll, lens, dolly-zoom).
- Director view with camera frustum and focus plane; capture refusal in director view.
- Focus tool (pick, follow, rack-focus helper).

## Scope OUT
- 3D-object gizmos inside WebGL (09), clip/behavior tools (07).

## Tasks

### 06.1 Projection owner additions — `src/core/spatial.ts`
- `projectWorld(camera, frame, point) → {x,y,depth} | null` — the one forward projection;
  `src/core/shots.ts:projectPoints` is refactored to call it (goldens unchanged).
- `screenRay(camera, frame, {x,y}) → {origin, direction}` and
  `intersectPlane(ray, world: Matrix) → {u, v, t} | null` (local surface coordinates).
- `surfaceQuad(node: EvaluatedNode, camera, frame)` → projected corners for picking/outlines.
- All pure; property tests: `intersectPlane(screenRay(projectWorld(p)))` recovers `p` (< 1e-6).

### 06.2 Picking and selection — `src/editor/viewport/`
- An editor overlay (chrome-marked) above the frame takes pointer input only in Edit mode;
  host content stays non-interactive while a tool is active (Space-drag / middle-drag pans the
  viewport zoom, which is editor-only).
- Hit test: project each mounted Surface's quad (`useSceneInspector` world matrices +
  measurements) → point-in-quad, ordered by camera depth (nearest first); Alt+click cycles the
  stack under the cursor; double-click enters a group (selects the child); Esc goes up a level.
- Marquee selection; Shift add, Ctrl/⌘ toggle; locked layers are skipped.
- Selection outlines and handles drawn in frame coordinates (SVG), scale-aware via the
  ScenePreview cover scale.

### 06.3 Gizmos
- **Move (V):** drag moves in the parent plane (x/y in the parent's local frame via
  `intersectPlane`); axis handles constrain to X/Y; the depth handle moves along the camera ray
  (z, "push"); Shift snaps to 10 px; guides snapping (thirds, center, title/action safe from
  `StudioOverlays`) in projected space.
- **Rotate (R):** rings for rotateX/Y/Z in the surface's local frame; Shift snaps 15°.
- **Scale (S):** uniform from corners, axis handles for scaleX/scaleY (01.2); Alt from center.
- **Pivot:** draggable origin point writes `originX/originY` (01.2) — compensates position so the
  layer does not jump (two ops in one batch).
- Numeric entry during drag (type a value, Enter); Esc cancels and restores the pre-drag draft.
- All changes go through `intentToOps` (04.6) — auto-key and static semantics identical to the
  inspector.

### 06.4 Motion paths and onion skin
- For selected animated layers and the camera: sample evaluated position at frame rate across the
  work area (or whole scene) through the compiled evaluator; draw projected polyline with frame
  ticks (spacing shows speed); keyframe dots draggable (`key.set` on x/y or on `position`).
- Position path tracks (02.3): in/out spatial tangent handles editable (`path.tangent`); "Convert
  to path" command (`path.fromAxes`).
- Onion skin (toggle): ghost outlines of the selected layer at ±N frames (projected quads only —
  no second render of host DOM).

### 06.5 Camera tools (C)
| Drag / modifier | Effect (camera properties) |
|---|---|
| Drag | orbit around the focus point (or lookAt target) — x/z + rotateY, y + rotateX |
| Shift+drag | truck/pedestal (x/y) |
| Wheel / Alt+drag vertical | dolly (z) |
| Ctrl/⌘+drag | pan/tilt (rotateY/rotateX) in place |
| R-ring overlay | roll (rotateZ) |
| Alt+wheel (`[`/`]` stay transport keys) | focal length mm ↔ perspective (`lens.ts`) |
| Alt+Shift+wheel | **dolly-zoom**: change lens while compensating z to keep the selected subject's projected size (solved with `projectWorld`) |

- Writes keyframes at the playhead when the property is animated or auto-key is on; otherwise
  `camera.set` (recipe camera base, applied at runtime).

### 06.6 Director view (Tab)
- An editor-only viewpoint: `ScenePreview` accepts `viewCamera` (editor slot prop) which replaces
  the camera passed to `Scene` for display only; the real camera is drawn as a gizmo (position,
  orientation, frustum from perspective and frame size) and the focus plane as a translucent
  rectangle at `focus.distance` (or the follow target depth).
- Manipulating the camera gizmo edits the real camera (same ops as 06.5).
- **Capture refusal**: while `viewCamera` is set the capture viewport carries
  `data-velora-view="director"`; the capture bridge's verify step throws "Return to camera view
  before exporting" (extends `useSceneCapture` verify; test).
- Depth of field in director view is disabled (would mislead); a badge says so.

### 06.7 Focus tool (F)
- Click a point on a surface → `focus.distance` = that point's camera-space depth (keyframe at the
  playhead if animated); Shift+click → `constraint.set focusFollow` on that surface/anchor.
- Rack-focus helper: select two layers + a time range → two focus keyframes (cinematic ease)
  landing sharp on each (verified with `sampleFocus` < 0.5 px).
- Focus peaking (`StudioOverlays`) auto-enables while the focus tool is active.

### 06.8 Lock and solo in the viewport
- Locked layers are not pickable; solo dims other layers in the overlay (editor-only), never in
  capture.

## Contracts
- `projectWorld`, `screenRay`, `intersectPlane`, `surfaceQuad` (spatial owner).
- `ScenePreview` `viewCamera` (editor-only) + capture refusal semantics.

## Files
- New: `src/editor/viewport/{Overlay,picking,Gizmo,MovePlane,RotateRings,ScaleHandles,Pivot,MotionPath,OnionSkin,CameraTool,DirectorView,FocusTool}.ts(x)`
- Modified: `src/core/{spatial,shots}.ts`, `src/preview/ScenePreview.tsx` (`viewCamera`),
  `src/react/capture.ts` (director refusal), `src/editor/{commands,intents}.ts`,
  `scripts/check-architecture.mjs` (owners `projectWorld`, `screenRay`, `intersectPlane`,
  `surfaceQuad`), skills `velora-editor`, `velora-cinematography`

## Tests
- `tests/core/projection.test.ts`: round-trip property tests; `projectPoints` golden unchanged.
- `tests/editor/picking.test.ts`: depth ordering, Alt-cycle, locked skip, group enter/exit.
- `tests/browser/viewport.spec.ts`:
  - click headline in `hero-depth`-style fixture → selected; drag move 100 px right → x keyframe
    within ±0.5 px of the expected local delta (perspective-correct);
  - rotate ring with Shift → 15° multiples;
  - pivot drag → no visual jump (frame diff before/after < 1 px);
  - dolly-zoom tool keeps subject projected width within ±1% while background warps;
  - director view: export attempt fails with the documented message; camera gizmo drag edits
    the real camera;
  - focus click → subject `data-velora-blur` < 0.5 at playhead.
- `tests/performance/viewport.spec.ts`: gizmo drag → repaint ≤ 16 ms p95 (60-surface scene).

## Validation criteria
- [ ] All manipulations produce the same file bytes as the equivalent `velora edit` commands
  (journey records the ops and replays them headlessly; files equal).
- [ ] No editor overlay pixels in any exported frame (SHA comparison Preview vs Edit).

## Anti-patterns
- Projection/unprojection math outside `spatial.ts`.
- Moving layers with CSS outside the scene evaluation (e.g., dragging DOM nodes directly).
- Rendering host DOM twice for director view or onion skin.

## Definition of Done
Tests, journeys and budgets green; skills updated; `plan/v2.1/artifacts/phase-06-exit.md`
written.
