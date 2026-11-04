# Phase 09 — Three.js full control

## Goal
Put real 3D scenes under the same timeline as the UI. A product model, a particle field or an
abstract hero built with React Three Fiber renders deterministically from scene time, its objects
appear in the Layers panel, their position, rotation, materials, lights and camera are
keyframeable in the inspector and timeline, and they can be moved with a 3D gizmo — all exported
frame-exact alongside DOM surfaces, optionally sharing one camera.

## Prerequisites
- Phases 04 and 06; spike S3 (deterministic R3F) passed; decision D4 confirmed (React 19 for this
  entry).

## Scope IN
- New entry `@adityadeokar/velora/three` (`src/three/`): `ThreeSurface`, `useSceneClock`,
  `Animated` / `useAnimatable3D`, `useGLTFClips`, unified camera mode.
- Editor integration: 3D outliner, typed 3D properties, in-canvas `TransformControls` gizmo,
  raycast picking.
- Determinism and capture (settle, `preserveDrawingBuffer`), forbidden-clock checks, docs/skills.

## Scope OUT
- Physics engines, post-processing stacks inside R3F (looks/finishing stay Velora's), XR,
  `WebGLSurface` changes (it remains for raw WebGL).

## Tasks

### 09.1 Package and layer
- `package.json`: export `./three` → `dist/library/three.js` (+ types); `peerDependencies`
  `three >=0.160`, `@react-three/fiber ^9` with `peerDependenciesMeta: { optional: true }`;
  `vite.lib.config.ts` entry `three: "src/three/index.ts"` with `three` and
  `@react-three/fiber` external.
- Architecture: `three` layer (Phase 00) gains owners; fixtures prove `index`, `preview`, `kit`
  and `editor` never import `three`/R3F (React 18 hosts without three keep building — installed
  check).
- `velora doctor`: reports three/R3F versions and the React 19 requirement when the entry is
  used.

### 09.2 `ThreeSurface` — deterministic R3F
- Renders `<Canvas frameloop="never" gl={{ preserveDrawingBuffer: true, antialias }} dpr={min(devicePixelRatio, pixelRatioCap)}>`
  inside a Surface leaf (DOF, grade and looks apply like any leaf).
- On every scene-time change (layout effect) calls R3F `advance(timeSeconds)` exactly once;
  the signature is pinned by a test against the installed fiber version (S3 noted an upstream
  proposal to change it).
- `useSceneClock()` → `{ t, seconds, seed }` from `useSceneTime` for 3D components; `useFrame`
  callbacks are allowed but must read time from `useSceneClock`, never `state.clock`.
- Capture settle: `useCaptureSettle` waits for pending Suspense loaders (GLTF, textures) and one
  post-load `advance` before capture; a load failure surfaces as a Scene diagnostic.
- `detectForbiddenClock` (`src/core/gsap.ts`) and `validateWebGLSource` (`src/core/three.ts`)
  extend to flag `state.clock`, `clock.getElapsedTime`, `clock.getDelta` and delta-accumulating
  `useFrame((_, delta) => … += delta)` patterns in scene sources (advisory with fix hint).

### 09.3 Animatable 3D objects
- `<Animated id="hero-mesh">{mesh}</Animated>` / `useAnimatable3D(ref, id, spec?)` registers an
  Object3D with default animatables (channel ids `three:<id>.<prop>`):
  - Object3D: `position.x/y/z`, `rotation.x/y/z` (degrees), `scale.x/y/z`, `visible`;
  - Mesh material (standard/physical): `opacity`, `color`, `emissive`, `emissiveIntensity`,
    `roughness`, `metalness`;
  - Light: `intensity`, `color`; PerspectiveCamera: `fov`, `position.*`, `target.*` (look-at).
- Values are applied imperatively **before** each `advance` from the evaluated channels (pure
  function of time); objects without tracks keep their authored props.
- Registration feeds the Scene registry's animatables (01.5) with an `owner` = the ThreeSurface
  layer and a `kind: "three"` tag, so the existing inspector/timeline handle them without
  importing three.

### 09.4 GLTF animation clips
- `useGLTFClips(gltf, id)` → each clip exposed as animatables `three:<id>.<clip>.time` (seconds)
  and `.weight`; an `AnimationMixer` is driven by `setTime` per frame (no mixer.update deltas),
  so scrubbing backwards is exact.

### 09.5 Unified camera (optional)
- `ThreeSurface camera="velora"` (full-frame mode): the three camera derives from Velora's camera
  each frame — `fov = 2·atan(frameHeight / 2 / perspective)`, position/rotation from the
  `cameraToCss` convention (spatial owner provides `cameraWorld(camera)`), so meshes and DOM
  surfaces move as one world; lookAt/focusFollow constraints (02.5) may target 3D anchors via
  their registered world positions.
- Documented limits: DOM and WebGL do not occlude each other (layer order only); DOF applies to
  the canvas leaf as one plane unless the 3D scene renders its own depth effect.
- Cinematic track alignment:
  - `camera.zoom` (14.2) narrows the field of view: `fov = 2·atan(frameHeight / 2 / (perspective · zoom))`;
  - the canvas `dpr` follows the page device scale, which equals the stage DPR at export (12.4), capped by `pixelRatioCap`;
  - registered 3D anchors are valid element targets for `lookAt`, `focusFollow`, `frame` and rigs (15, 16).

### 09.6 Editor integration
- Layers: the ThreeSurface layer expands into a 3D outliner (named objects with animatables);
  inspector shows typed 3D properties with stopwatches (same intents as 04.6).
- Viewport: when a 3D object is selected and the editor is active, the ThreeSurface mounts
  `TransformControls` (from `three/addons`) **inside the canvas**, provided to the editor through
  a registry contract (`registerGizmo`) — the editor never imports three. Gizmo drags emit
  transient ops on the 3D animatables; it never mounts on capture pages (no editor flag) and is
  removed before any capture seek (test).
- Picking: click inside a ThreeSurface raycasts against registered objects (nearest hit) and
  selects them; falls back to selecting the surface.

### 09.7 Example and docs
- `local-project` (test host only) gains a `product-orbit` scene: a GLB (procedurally generated
  in-test or CC0 asset with license note — never bundled in the package), animated materials,
  unified camera orbit with follow focus on a DOM caption.
- Skills: `velora-threejs` rewritten around `/three` (determinism rules, animatables, clips,
  unified camera, limits); `velora-performance` (pixel-ratio caps, draw calls).

## Contracts
- `@adityadeokar/velora/three` exports: `ThreeSurface`, `useSceneClock`, `Animated`,
  `useAnimatable3D`, `useGLTFClips`, types; animatable id scheme `three:<id>.<prop>`.

## Files
- New: `src/three/{index,ThreeSurface,clock,animated,gltf,camera,gizmo}.ts(x)`
- Modified: `package.json`, `vite.lib.config.ts`, `tsconfig.lib.json`, `src/core/{three,gsap,spatial}.ts`,
  `src/react/{registry.ts,animatable.ts}`, `src/editor/{Layers,Inspector,viewport/picking}.tsx`,
  `scripts/{check-architecture,check-installed,release}.mjs`, skills `velora-threejs`,
  `velora-performance`

## Tests
- `tests/three/determinism.spec.ts` (browser): same time → same SHA twice; seek backwards exact;
  GLTF settle before capture; mixer `setTime` scrubbing.
- `tests/three/animated.test.tsx`: channel → object property application; untracked objects keep
  authored values; registry entries tagged `three`.
- `tests/three/camera.spec.ts`: a DOM surface and a mesh placed at the same world point project to
  the same pixel ± 1 px through a camera move.
- `tests/browser/editor-three.spec.ts`: select mesh by click → move with gizmo → file gains
  `three:hero-mesh.position.x` keyframes → export frame matches; gizmo absent from exported
  frames.
- `tests/core/three-clock.test.ts`: forbidden-clock patterns flagged with hints.
- Installed checks: React 18 host without three builds and runs the studio; package budget.

## Validation criteria
- [ ] A product-orbit film (3D model + DOM caption, unified camera, follow focus) renders
  identically twice and matches the editor preview.
- [ ] Hosts that never import `/three` are byte-identical in their production assets to before
  this phase.

## Anti-patterns
- Letting R3F's own loop run (`frameloop="always"`/`"demand"`) in a Velora scene.
- Reading `state.clock` or accumulating `delta` for animation.
- Importing three from the editor or preview layers.

## Definition of Done
Tests and validation green; skills updated; `plan/v2.1/artifacts/phase-09-exit.md` written with
determinism evidence.
