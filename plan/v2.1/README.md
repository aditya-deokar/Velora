# Velora v2.1 — Studio Editor: keyframes, easing, groups and full scene control

Source brief: the maintainer's request (2026-11-04). It asks to take the Velora studio to the
next level as a cinematic animation builder:
- keyframes and easing for every element on screen (real React elements);
- groups whose animation can be eased and retimed as a unit;
- full control of React components and Three.js scenes;
- everything else a cinematic video editor needs, configurable through the real codebase.

Where an existing open-source editor helps without compromising that aim, it should be used.

Second brief, the **cinematic track** (2026-11-04). It asks for scenes that read like an
Apple-grade product film of a real modern laptop screen, shot with a drone and a 200 mm cinema lens:
1. A laptop-true app viewport (16:10, Retina 2×, or the user's own laptop), decoupled from the output frame.
2. Automatic 3D DOM depth with edges, shadows and camera-reactive light.
3. Real lens presets with telephoto compression, per-layer depth of field and rack focus with breathing.
4. Physical drone and cinema rigs (mass, banking, inertia).
5. Camera and focus locked to live DOM targets.

It must preserve every CLI contract, deterministic frame sampling and back-compat. Phases 12–16
cover it (§7).

Repo audited: 2026-11-04 at `@adityadeokar/velora@0.1.2` (branch `feat/v2-phase5-7-director-skills`,
commit `746cdd9`). v2 roadmap: `plan/v2/README.md` (phases 00–09, all done; 1.0 tag pending).

Companion documents:
- `OPEN-SOURCE-EVALUATION.md`: every candidate editor and library, its license, its last release, and a verdict.
- `EDITOR-UX.md`: layout, panels, interaction rules, keyboard map, accessibility.

## 1. Vision

v1 made Velora a rigorous, agent-first engine. v2 made it cinematic by default. **v2.1 makes it
directable by hand.** The developer opens the studio on their running app and switches a scene
into **Edit**. Then they can:
- click any layer, including a headline, a portrait or a dashboard card;
- set keyframes with a stopwatch, shape the easing in a graph editor and drag it along a motion path;
- group layers and stagger them;
- aim the camera at a subject and pull focus onto it;
- reach into a Three.js scene and keyframe a mesh.

Every change lands in the same recipe JSON the coding agent edits, so the hand and the agent
co-author one file. Export is unchanged and still frame-exact.

Four paths, one engine:

1. **Zero code.** Quick shots and templates (v2).
2. **Scaffold.** `velora new scene --template …` (v2).
3. **Direct by hand (new).** The Edit mode of the studio: keyframes, graph editor, gizmos, clips, presets.
4. **Direct by agent.** The same edit operations through `velora edit` and the skills.

The defining principle extends again. The CLI provides the capabilities, the skills provide the
intelligence, the templates provide the taste, and **the editor provides the hand. All four
write the same source.**

**The cinematic track makes the camera physical** (Phases 12–16):
- The app renders on a laptop-true stage (`laptop-14`: 1512×982 @2×, or the user's own laptop) that is independent of the export frame, so UI keeps its natural density and stays sharp under a 200 mm close-up.
- The UI hierarchy rises into real depth tiers, with edges, contact shadows and a sheen that moves with the camera.
- Lenses come from one physical model. Every depth layer blurs by its signed distance from the focal plane, and focus pulls breathe like glass.
- Drone, telephoto-orbit and whip-pan rigs carry mass and bank into turns. They are simulated offline and baked into plain data.
- Aim, focus and framing lock onto real DOM elements (`data-velora-anchor`), never guessed pixels.

## 2. Audit summary (what blocks the goal)

| # | Gap | Evidence |
|---|---|---|
| P0 | The studio is read-only by design: "The studio writes no files." There is no visual builder. Any editor needs a new, reviewed write boundary. | `docs/product.md` (Studio, opening paragraph), `plan/v2/PHASE-03-studio-v2.md` (Goal), `docs/architecture.md` (Current scope) |
| P0 | Only Surfaces, camera, focus and named channels animate. There is no anchor/pivot, non-uniform scale, skew, per-element grade, CSS-variable/color animation, or typed component props. | `src/core/motion.ts` (`SurfaceMotionSchema`), `src/core/scene.ts` (`TransformSchema`) |
| P0 | Base transforms of a layer live in TSX (`<Surface transform>`). Recipe `scene.nodes[].transform` is validated but never applied. Every motion target must still be listed in `scene.nodes` or the recipe is invalid. | `src/react/index.tsx` (`Scene` builds nodes from the registry), `src/core/authoring.ts` (`reviewAuthoring`, `unknown-surface`) |
| Gap | Easing is per outgoing segment, and smooth interpolation is all-or-nothing per track. There is no per-keyframe auto-bezier or continuous tangents, so a graph editor has nothing to edit beyond `cubicBezier`. | `src/core/motion.ts` (`interpolate`, `smoothInterpolate`), `src/core/easing.ts` |
| Gap | Animation can't be grouped in time: no clips/precomps, no additive layers, no general stagger (only `createCascadeTracks` on `z`). | `src/core/choreography.ts`, `MotionSchema` |
| Gap | Position animates per axis. There are no spatial motion paths, orient-to-path, look-at, or follow-focus. | `src/core/motion.ts`, `src/core/spatial.ts` |
| Gap | Projection runs one way only (`projectPoints` in shots). There is no screen-to-surface-plane inverse for gizmos and picking. | `src/core/shots.ts`, `src/core/spatial.ts` |
| Gap | Three.js is a raw WebGL callback: no scene graph, no React Three Fiber, no animatable objects, no 3D picking. | `src/react/three-bridge.tsx`, `src/core/three.ts` |
| Gap | `evaluateMotion` re-parses the whole motion schema on every call. That's fine for playback, but too slow for interactive drafts with hundreds of tracks. | `src/core/motion.ts` (`evaluateMotion`) |
| Gap | No formatting-preserving JSON writer exists: `json.ts` only parses, and scaffolders write whole files. Editor writes would reformat author files and produce noisy diffs. | `src/core/json.ts`, `src/project/templates.ts` |
| Gap | The browser studio has no network client by design (no server, websocket or polling loop). A bridge client is a new browser boundary. | `src/preview/connection.ts`, `docs/architecture.md` (Installed application) |

Cinematic track gaps (second brief):

| # | Gap | Evidence |
|---|---|---|
| P0 | The app stage is coupled to the aspect table and written into TSX as literals (16:9 → 1440×900). The app renders at 1× DPR at standard quality, so canvases and images soften under any camera magnification. | `src/core/shots.ts` (`ASPECT_FRAMES`), `src/project/templates.ts`, `src/core/export.ts` (`QUALITY_PRESETS`) |
| P0 | The focus `filter` on a Surface's content leaf flattens all nested 3D. RouteFrame content is an iframe, which CSS 3D can't cross. There is no notion of depth below the Surface. | `src/react/index.tsx` (`leafFilter`), `src/kit/RouteFrame.tsx` |
| P0 | 200 mm is invalid at 4:5 and 9:16 (perspective > 10,000 throws). The focus focal length is `min(300, mm)` in pixels, far shorter than the camera distances, so depth of field is too deep and shots hand-tune it. | `src/core/lens.ts`, `src/core/scene.ts` (`CameraSchema`, `FocusSchema`), `src/core/shots.ts` (`focalLength: 220`) |
| Gap | There is no zoom at a fixed viewpoint, so no lens breathing or compensating zoom. Rack focus is between two points of one plane. | `src/core/scene.ts`, `src/core/shots.ts` (`rack-focus`) |
| Gap | Camera moves are few-key eased tracks: no mass, momentum or banking. The whip is one `expo.out` key. Preview has no motion blur. | `src/core/shots.ts`, `src/core/export.ts` (`shutterSamples`) |
| Gap | Aim and focus targets are guessed fractions or pixel regions. Nothing measures elements inside a Surface or a RouteFrame. | Phase 02 §02.5 (`anchor: [u, v]`), `ShotInputSchema.focusRegion`, `src/react/registry.ts` |

Strengths to build on:
- one presentation cursor (`usePreviewSession`);
- one evaluator (`evaluateMotion`) and one validator (`presentPreview`);
- a live registry of mounted Surfaces with parent hierarchy and measurements (`src/react/registry.ts`);
- world matrices per node (`EvaluatedNode.world`);
- compare-and-swap atomic writes (`atomicWrite(root, target, content, expected)` in `src/project/services.ts`);
- TypeScript-AST text surgery precedent (`src/project/vite.ts`);
- chrome-marked overlays (`StudioOverlays`) and keyboard transport (`useTransportKeys`);
- a certified shot vocabulary (`buildShot`), kinetic presets, beats, transitions, and a composition player;
- one physical lens model (`lensFor`: perspective = frame height × mm / 24) and a signed thin-lens circle of confusion per plane (`sampleFocus`), with tilted-plane focus kernels (`FocusFilter`);
- transform-free layout measurement through the offset chain (`origin()` in `registry.ts`) and RouteFrame's capture-settle hooks;
- true shutter motion blur and linear-light supersampling at export (`shutterSamples`, `src/export/compositor.ts`).

## 3. Decisions

From the request (2026-11-04):
- Build a visual, keyframe-based cinematic editor into the studio, covering:
  - per-element keyframes and easing;
  - groups;
  - full control of React components and Three.js.
- Prefer existing open-source editors where they fit without compromising Velora's aim.

From the cinematic-track request (2026-11-04):
- Laptop-true stage, automatic DOM depth and light, real optics and rack focus, physical rigs, live DOM targets.
- Skills must make coding agents default to a laptop stage at 2× and to telephoto, depth, rack-focus and rig vocabulary.
- Preserve CLI contracts, deterministic frame sampling and back-compat.

**Proposed. Confirm with the maintainer before the phase noted:**

| # | Decision | Recommendation | Needed before |
|---|---|---|---|
| D1 | How the editor saves | A **CLI-owned loopback edit bridge** (`velora edit`), started explicitly by the developer. It is never a browser filesystem API, a host-config plugin, or a hosted service. This reverses v2's "studio writes no files" for Edit mode only. The Scenes, Templates and Compositions tabs stay read-only. | 03 |
| D2 | Source of truth | The recipe JSON stays the **only** motion document. There is no editor-only state format, and editor metadata (labels, lock, colors, markers) lives in an optional `editor` block that the renderer ignores. | 01 |
| D3 | Host source edits | Codemods on host TSX (promote an element to a layer, group layers, expose a prop) are **opt-in**. Each one is previewed as a diff, confirmed per change and compare-and-swap guarded. The CLI requires `--write`. | 08 |
| D4 | Three.js | A new optional entry, `@adityadeokar/velora/three`, on React Three Fiber 9 with optional peers. That entry requires **React 19** (R3F 9 peers `react >=19 <19.4`). The core package keeps React 18.2+. | 09 |
| D5 | Guide and handoff | Guide v4 and `VELORA.md` format 4, with the same in-place upgrade path v3 used. | 11 |
| D6 | Timeline UI | Build the dope sheet, graph editor and composition lanes in-house unless spike S1 (Phase 00) shows that a library meets every gate. | 00 |
| D7 | Version | Ship as **1.1.0**: every schema change is additive within recipe version 1 and scene version 3. | 11 |
| D8 | GSAP | GSAP never enters editor or runtime code (license, see `OPEN-SOURCE-EVALUATION.md`). Velora keeps its own easing math and name mapping only. | 00 |
| D9 | App stage vs output frame | An optional `definition.stage` holds `{width, height, dpr}` as concrete numbers. When it is **absent, today's behavior is kept exactly**. New scaffolds, quick shots and skills write `laptop-14` explicitly, so the new default lives in authoring, not in a schema default. `user-native` is detected once in the studio and stored as numbers, never re-detected at render. | 12 |
| D10 | Stage DPR at export | Capture device scale = `max(quality scale, stage.dpr)`, within the existing 3840 px capture cap, downscaled in linear light to the requested output. Draft stays 0.5. When capped, the manifest records `dprCapped`. No CLI default or output size changes. | 12 |
| D11 | Host DOM policy for depth | Style-only and reversible, through one ledger: `transform`, `transform-style` and `backface-visibility`; in iframes also prepended `box-shadow` and `background-image`; on front-of-focus layers a prepended focus `blur()` (14.4). Velora never inserts, wraps or moves host nodes, never adds classes or attributes, and never overrides host `overflow`/`opacity`/`filter` to force 3D: it diagnoses instead. Light proxies are Velora-owned elements outside host trees. | 13 |
| D12 | Optics truth | Lens mm drives perspective with the existing model, and a **physically scaled** focus focal length (`mm × stage px/mm`). `perspective` (≤ 40,000) and `focus.focalLength` (≤ 4,000) widen additively, and `lensFor` output is unchanged. The brief's "4,000–6,000 px for 200 mm" equals about 90–130 mm at 1080 px; 200 mm is about 9,000 px there. Physics wins, and authors may override. | 14 |
| D13 | Rig physics | Simulated offline at a fixed 240 Hz step and baked into paths, clips and constraints with provenance. No runtime integrator. Banking is an additive roll clip. | 16 |
| D14 | DOM targets | Named anchors (`data-velora-anchor`) first. CSS selectors are allowed only when they match exactly one element. Targets are measured transform-free, inside RouteFrames after scroll. A missing or ambiguous target **refuses capture** (`ERR_TARGET_MISSING`), never a guess. | 15 |

**Decision record (Phase 00.1, 2026-11-14).** The maintainer asked to implement Phases 00 and 01, so D1–D14
are recorded as **accepted at their recommendations** for this work. Explicit per-decision confirmation is
still pending. It must come before the phase each row names, and D1 and D9 must come before any work past
Phase 01 (both are stop conditions in Phase 00.1).

| # | Status | Notes |
|---|---|---|
| D1 | Confirmed 2026-11-14 (instruction to implement Phase 03); implemented | Bridge design unbuilt; the checker already reserves `src/project/services/**` (bridgeServices) and `src/project/edit.ts` (commands). |
| D2 | Accepted and implemented (01) | The recipe `editor` block is optional editor-owned metadata; the renderer and `presentPreview` ignore it. |
| D3 | Confirmed by the Phase 08 implementation request | Every host source write requires explicit confirmation and compares the reviewed revisions. |
| D4 | Confirmed in Phase 09 | The optional `three` layer uses `three` and React Three Fiber 9. The S3 spike passed on React 19.2.0. The core entry retains React 18.2+ support. |
| D5 | Accepted (recommendation), confirm before 11 | Guide stays version 3 through 01. |
| D6 | Resolved 2026-11-16: in-house | Built in-house (SVG per visible row, virtualized, dense rows as paths); measured budgets in `artifacts/phase-05-exit.md`. |
| D7 | Accepted (recommendation) | Phase 01 changes are additive within recipe version 1 and scene version 3. |
| D8 | Accepted and enforced (00) | The architecture rule `gsap-ban` rejects `gsap` and `@gsap/*` in every layer. |
| D9 | Accepted for Phase 12 | Recipes opt in with concrete stage dimensions. |
| D10 | Accepted after S7 | Chromium preserved layout at 2×. The 1080p screenshot mean rose from 92 ms to 366 ms on the reference machine. |
| D11 | Accepted for Phase 13 | Host styles go through the reversible ledger. Chromium confirmed proxy sorting and iframe cleanup. |
| D12–D14 | Accepted (recommendation), confirm before 14–16 | |

## 4. Open-source verdict (summary)

No existing open-source editor can be adopted wholesale without breaking a Velora invariant.
Full matrix and sources: `OPEN-SOURCE-EVALUATION.md`.

| Candidate | Verdict | Why |
|---|---|---|
| Theatre.js (`@theatre/studio`, `@theatre/core`) | **Don't adopt; borrow the model** | The studio is AGPL-3.0, and Velora ships MIT inside one npm package. The last release is 0.7.2 (2024-05-19), and development moved to a private repo. It brings a second state model and clock, so it would fork Velora's one evaluator and one validator. Borrowed ideas: objects with typed props (our *animatables*), the sequence editor and graph editor layout, aggregate keyframe rows. |
| GSAP | **Never in editor or runtime** | Its standard license prohibits use in no-code visual animation builders that compete with Webflow's. Velora already replays GSAP ease names with its own math (`src/core/gsap.ts`). |
| Remotion Studio, Twick | **Reject** | Neither is OSI open source: Remotion is source-available with a company license, and Twick uses the Sustainable Use License. Both are clip editors, not live-DOM keyframe editors. |
| Motion Canvas, Revideo | **Reject as dependency; borrow ideas** | MIT, but canvas and generator based, not live React DOM. Last npm publish was 2024-12. |
| `@xzdarcy/react-timeline-editor`, `animation-timeline-js` | **Spike only (S1)** | MIT row and keyframe timelines. Neither has a graph editor. Adopt only if one passes the Phase 00 gates, and only for composition lanes. |
| `react-moveable`, Tweakpane, Leva | **Reject** | Stale (moveable last published 2023-12) or panel UIs that aren't aware of keyframes. Gizmo math must come from `spatial.ts`, the single projection owner. |
| `three`, `@react-three/fiber`, `@react-three/drei` | **Adopt (optional `/three` entry)** | MIT and actively released (three 0.187.0, 2026-10-30; fiber 9.8.2, 2026-10-14). `frameloop="never"` with `advance()` gives deterministic frames. `TransformControls` provides the 3D gizmo. |
| `code-inspector-plugin` | **Optional integration, no dependency** | MIT; 2.0.9 (2026-09-12). It injects source-location attributes at build time for Vite, webpack and Next/Turbopack, which React 19 no longer provides at runtime (`_debugSource` was removed). When present, a viewport click resolves to source. |
| TypeScript compiler API | **Adopt (already a dependency)** | Used for the JSX outline and codemods. No recast, ts-morph or magicast. |
| 3D tilt/parallax card libraries, spring and spline packages | **Reject (cinematic track)** | Tilt libraries are pointer-driven runtime effects with their own animation loops (a second clock). Velora already owns springs (`easing.ts`), Bézier paths with arc length (02.3) and lens math (`lens.ts`). The rig, depth and optics math stays in zod-only core. |

## 5. v2.1 principles (in addition to v1 §4 and v2 §4)

1. **The editor is another author, not another engine.**
   - Every edit is a typed `EditOp` applied by one pure core reducer, and persisted to the recipe or composition file the agent also edits.
   - There is no second motion model, clock, evaluator or validator. Drafts are ordinary definition inputs to `usePreviewSession`.
2. **Every click has a command.** Each `EditOp` is reachable through `velora edit` with `--json` and dry-run by default. History entries copy as commands, so agents can do everything the hand can, and the reverse.
3. **Writes are local, explicit, scoped and reversible.**
   - The bridge listens on loopback only, uses a per-session token, and checks both Origin and Host.
   - Writes are compare-and-swap, cover only the allowed file kinds, and keep undo history.
   - Without a bridge the editor still works in memory and copies the exact command.
4. **Preview equals export.** Gizmos, paths, onion skins, director view and panels are chrome-marked or capture-refused. An editor frame at time *t* equals `velora shot --time t`.
5. **Additive schemas.** Recipe version 1 and scene version 3 stay. New fields are optional with **no defaults that change parsed output**, so every committed recipe evaluates and serializes byte-identically (goldens).
6. **Data, not behaviors.** Behaviors, presets, camera moves and staggers compile to plain keyframes or clips, with provenance. No hidden runtime engine and no JavaScript expressions (links are declarative).
7. **Restraint by default.** The default easing is cinematic or easy-ease, and behaviors default to `subtle`. Review advisories (camera overshoot, static scene, loop seam, reading time) show inline in the editor.
8. **Lean dependencies.**
   - Core stays zod-only. The editor is plain React plus `useSyncExternalStore`.
   - three and R3F live only in the optional `/three` layer. New external dependencies need a layer decision and a fixture in `scripts/check-architecture.mjs`.
9. **Keyboard-first and accessible.** Every action is in the command registry. The timeline is an ARIA grid, and every keyframe has a spoken label.
10. **Skills move with features.** Each phase updates the skills it affects. No skill documents unbuilt behavior.
11. **The stage is not the frame.** The app lays out and rasterizes at one fixed stage (CSS size and DPR), identical in preview and export. The output frame decides only pixels.
12. **Detect once, store numbers.** Anything read from the user's machine or the live DOM (the native viewport, auto depth classification) is resolved in the studio or CLI and written as concrete values. Rendering never re-detects. Live measurement is allowed only for layout that preview and export share (anchors on the same stage).
13. **Optics from physics.** One lens owner turns mm into perspective, framing distance and circle of confusion. Presets are data. There are no per-shot fudge factors.
14. **Host pages are borrowed, not modified.** Every style Velora puts on host DOM goes through one reversible ledger. It is gone after preview, Edit mode or capture ends, and DOM structure is never changed.
15. **Contracts hold.** No CLI flag, default, envelope or output size changes. The frame clock and shutter sampling are untouched. New behavior arrives only through new optional fields, flags and commands.

## 6. Craft → feature map

| Inspiration | Technique | Velora v2.1 feature (phase) |
|---|---|---|
| After Effects graph editor | Value/speed graphs, bezier handles, Easy Ease (F9), keyframe interpolation types | Per-keyframe `auto` easing (01); graph editor with linear/ease/continuous/auto/hold handles (05) |
| After Effects motion paths | Spatial bezier tangents, roving keyframes, auto-orient | Position path tracks with arc-length timing and orient-to-path (02); path handles in the viewport (06) |
| After Effects precomps and pick whip | Group in time; link one property to another | Clips with speed, trim, loop, ease and additive mode (02, 07); declarative links with delay (02) |
| After Effects text animators, trim paths, shape layers | Range selectors, stroke draw-on | `TextAnimator`, `DrawPath`, `Shape` kit components with animatables (07) |
| Cinema 4D target tag, Unreal Sequencer, ARRI follow focus | Look-at, rack focus, follow focus, rigs | `lookAt` and `focusFollow` constraints, orbit rig (02); focus tool and rack-focus helper (06) |
| Blender NLA, Unity Timeline | Additive animation layers | `mode: "add"` clips: a handheld float layered on a base move (02) |
| Maya and Blender camera views | Look through the camera vs a free director view | Camera view and director view, with camera frustum and focus plane (06) |
| Theatre.js | Objects with typed props, sequence editor | `useAnimatable` typed props (01); inspector stopwatches; dope sheet with aggregate rows (04, 05) |
| Apple Motion behaviors | One-click motion with parameters | Behaviors library compiled to keyframes with provenance (07) |
| Premiere and Resolve | Ripple, roll, slip, razor; markers; J/K/L | Composition lanes and trim tools (10); transport stays `useTransportKeys` |
| React DevTools, code-inspector | Element to source | JSX outline, click-to-source, promote to layer (08) |
| React Three Fiber | Declarative 3D in React | `ThreeSurface`, 3D animatables, unified camera, `TransformControls` gizmo (09) |
| Apple product films | The real UI at native laptop density, never a scaled-down desktop | `laptop-14`/`laptop-13`/`user-native` stages, a DPR capture floor and a resolution-budget advisory (12) |
| Layered UI materials and physical product shots | Hierarchy as height, contact shadows, edges catching light | Depth tiers, extrusion, contact shadows and Blinn–Phong sheen from the evaluated camera (13) |
| Cinema lens kits and the focus puller | 24/50/85/200 mm, telephoto compression, a rack focus that breathes | `LENS_PRESETS`, framing hold, `camera.zoom`, per-layer depth of field, `buildRackFocus` (14) |
| Drone operators, telephoto parallax shots, whip pans | Momentum, banking into turns, a locked subject with the world sliding past, a blur-and-settle | `drone-flyover`, `telephoto-parallax-orbit` and `whip-pan-macro` rigs; velocity blur (16) |
| Camera operators framing a subject | Aim and focus on the actual subject | `data-velora-anchor` targets, a `frame` constraint, `velora anchors` (15) |

## 7. Phase map

| Phase | File | Theme | Headline outcome | Depends on |
|---|---|---|---|---|
| 00 | `PHASE-00-foundations-and-spikes.md` | Foundations | Decisions confirmed, goldens and performance baselines, eight spikes (S6–S8 for the cinematic track), new architecture layers | — |
| 01 | `PHASE-01-motion-model-v3.md` | Motion model v3 | Auto-bezier keyframes, pivot/skew/non-uniform scale, grade, CSS-variable and color tracks, typed animatables, compiled evaluator | 00 |
| 02 | `PHASE-02-clips-paths-constraints.md` | Structure and cinematic constraints | Clips (groups in time), staggers, spatial motion paths, links, look-at, follow focus | 01 |
| 03 | `PHASE-03-edit-ops-and-bridge.md` | Edit operations and bridge | `EditOp` vocabulary, formatting-preserving writer, `velora edit` CLI, secure loopback bridge | 01 (clip/path ops land with 02) |
| 04 | `PHASE-04-editor-shell.md` | Editor shell | Edit mode, layers, inspector with stopwatches, history, save states, command palette | 03 |
| 05 | `PHASE-05-timeline-and-graph-editor.md` | Timeline and graph editor | Dope sheet, clip bars, snapping, graph editor, easing library | 04, 02 |
| 06 | `PHASE-06-viewport-and-camera-tools.md` | Viewport | Picking, gizmos, motion paths, onion skin, camera tools, director view, focus tools | 04, 02 |
| 07 | `PHASE-07-groups-presets-motion-design.md` | Groups and motion design | Group/stagger/sequence tools, behaviors, camera moves, presets, text animator, trim paths, shapes | 05, 06 |
| 08 | `PHASE-08-source-integration.md` | Real components | JSX outline, promote to layer, spatial groups, expose prop, click-to-source | 04 |
| 09 | `PHASE-09-threejs-full-control.md` | Three.js | `/three` entry: deterministic R3F, 3D animatables, GLTF clips, unified camera, 3D gizmos | 04, 06 |
| 10 | `PHASE-10-composition-editing.md` | The cut | Composition lanes, trim tools, transitions, waveforms, beat snapping | 05 |
| 11 | `PHASE-11-agent-parity-quality-release.md` | Parity, quality, release | Parity audit, skills, guide v4, performance/a11y/security gates, 1.1.0 | all |
| 12 | `PHASE-12-laptop-stage-and-hidpi.md` | Cinematic: app stage | `definition.stage` presets (`laptop-14` 1512×982 @2×), user-native detection, DPR capture floor, resolution budget | 00 |
| 13 | `PHASE-13-depth-layers-and-light.md` | Cinematic: depth | Automatic depth tiers, style ledger, volumetric and projected rendering, edges, contact shadows, camera-reactive sheen | 12, 01 |
| 14 | `PHASE-14-cinema-optics-and-rack-focus.md` | Cinematic: optics | Lens presets, physical depth of field, `camera.zoom`, framing hold, per-layer focus, rack focus with breathing | 12, 13 |
| 15 | `PHASE-15-live-dom-target-locking.md` | Cinematic: targets | `data-velora-anchor` targets, transform-free measurement, `frame` constraint, `velora anchors`, capture refusal | 02, 12, 13 |
| 16 | `PHASE-16-physical-camera-rigs.md` | Cinematic: rigs | Fixed-step follower, banking, drone flyover, telephoto parallax orbit, whip-pan macro, velocity blur | 02, 14, 15 |

Phase numbers are stable identifiers, not execution order. The cinematic track (12–16) was added
after 00–11 had been numbered, and it lands **before** 11. Phase 11 releases both tracks.

```
00 ──► 01 ──► 02 ───────────────┬──► 05 ──► 07 ──┐
        │                       │    │           │
        └──► 03 ──► 04 ─────────┼────┤           ├──► 11
                     │          └──► 06 ──► 09 ──┤
                     ├──► 08 ────────────────────┤
                     └──────────────► 10 (after 05)
```

03 can start once 01 lands. It adds clip, path and constraint ops when 02 lands.

Cinematic track (engine work runs in parallel with the editor track 03–10):

```
00 ──► 12 ──► 13 ──┬──► 14 ──┐
                   │         ├──► 16 ──► 11
01 ──► 02 ─────────┴──► 15 ──┘
```

These edges aren't drawn: 12 → 14, 12 → 15, 01 → 13, 02 → 16.

- Each cinematic phase ships its engine, CLI ops and skills on its own.
- Its "Editor surface" task (12.6 chip apart) waits for 04 or 06 and lands in whichever of the two phases finishes later.
- 07's camera-move library lists the rigs once 16 lands.

## 8. Success metrics

| Metric | Target | Measured by |
|---|---|---|
| Time to first keyframe | From `velora edit --scene <id>` to an eased two-keyframe animation saved on disk in ≤ 60 s | Phase 04 Playwright journey (scripted user) |
| Round-trip fidelity | 100% of committed recipes and compositions format byte-identically with no ops; `apply(inverse(apply(x)))` is byte-identical to `x` | Phase 03 golden and property tests |
| Back-compat | Every committed recipe evaluates byte-identically (motion and spatial) | Phase 00 goldens, re-run every phase |
| Preview equals export | The editor frame at *t* matches `velora shot --time t` (same SHA for static frames; v2 tolerance for blended frames) | Phase 04/06 browser tests |
| Agent parity | 100% of `EditOpSchema` variants are reachable through `velora edit` and documented in `velora-editor` | Phase 11 parity test |
| Interactivity | Scrub ≥ 55 fps median with 60 surfaces and 300 tracks; gizmo drag to repaint ≤ 16 ms p95; commit to HMR-visible ≤ 300 ms local | `playwright.performance.config.ts` (device-specific evidence) |
| Safety | The bridge rejects 100% of the security fixture suite (token, origin, host, path, size, symlink) | `tests/project/security.test.ts` |
| Honesty | `velora skills check` clean; no skill or doc describes unbuilt behavior | Every phase |
| Stage parity | A scene with `stage: laptop-14` lays out identically in preview and export (anchor rects equal ±0.5 px); the app reports `innerWidth 1512` and `devicePixelRatio 2` at export | Phase 12 browser tests |
| Close-up sharpness | 4× camera magnification on a chart button at `--quality standard` raises no `stage-undersampled` advisory and matches a DPR-2 reference crop | Phase 12/14 browser tests |
| Host cleanliness | After preview, Edit mode and capture, the host subtree (structure plus every `style` attribute, in-tree and in RouteFrames) is byte-identical to before mount | Phase 13 browser tests |
| Optics | 200 mm with framing hold keeps the subject within ±1% of its 24 mm size, with corner keystone < 0.3°; a rack lands < 0.5 px with breathing equal to the request ±0.1 pt | Phase 14 tests |
| Target lock | An orbit locked on an anchor keeps it at frame center ±0.5 px and sharp (< 0.5 px blur) in every exported frame, including mid-shot scroll | Phase 15 browser tests |
| Rig quality | Rigs bake byte-identically across runs; no velocity discontinuity at waypoints; whip overshoot ≤ 2%; two renders give the same SHAs | Phase 16 tests |

## 9. How to execute

- Work along the dependency graph. Phases 08 and 10 can run in parallel with 05 and 06 once 04 lands.
- Every phase file is self-contained: goal → prerequisites → scope in/out → tasks → contracts → files → tests → validation → anti-patterns → Definition of Done.
- After each phase:
  1. Run its **Validation** section.
  2. Run `npm run verify:ci` (and `verify:release` before any version bump).
  3. Re-run the Phase 00 goldens.
  4. Write `plan/v2.1/artifacts/phase-NN-exit.md` (commands, results, evidence, deviations).
- Keep v1 and v2 gates green throughout. v2.1 extends; it never forks owners or adds a second clock, renderer, evaluator or validator.
- New canonical owners are registered in `scripts/check-architecture.mjs` in the phase that implements them, because the checker requires exactly one implementation per owner.
- Two tracks run side by side after 00: the editor track (01 → 03–10) and the cinematic track (12–16, which needs 01 and 02 for 13, 15 and 16). One person per track avoids conflicts in `src/core/spatial.ts`, the shared owner. Land cinematic changes to it in small, golden-checked commits.
- Cinematic phases also run the cleanliness check (13) and stage parity (12) as part of "re-run the goldens" from 13 onward.

## 10. Final status

Planned 2026-11-04; cinematic track (12–16) added the same day. Phases 00 and 01 were implemented
on 2026-11-14 (decisions recorded in §3, explicit confirmation pending).

| Phase | Status | Headline evidence |
|---|---|---|
| 00 | done except spikes | Goldens (motion, spatial, optics/shot, format corpus, capture) and `scripts/golden.mjs`; baselines; v2.1 checker layers. S3 and S7 passed, S5 partly run, S1–S2 and S4 pending. The Phase 13 depth portions of S6 and S8 passed. Phase 14 optical checks are pending (`artifacts/phase-00-spikes.md`, `artifacts/phase-00-exit.md`). |
| 01 | done | Motion model v3 with goldens unchanged; compiled evaluator about 1,700x faster than the Phase 00 baseline at 300 tracks (`artifacts/phase-01-exit.md`). |
| 02 | done | Clips, staggers, position paths, links, lookAt/focusFollow and the orbit rig; goldens unchanged (`artifacts/phase-02-exit.md`). |
| 03 | done | `EditOpSchema`/`applyEdits` with exact inverses, the formatting-preserving writer, `velora edit`, and the secure loopback bridge and watcher (`artifacts/phase-03-exit.md`). S2 not run. |
| 04 | done | Edit mode shell: store, bridge client, layers, inspector, history, palette; scripted journey byte-exact with undo; time to first keyframe 1.5 s (`artifacts/phase-04-exit.md`). |
| 05 | done (budgets partly) | Dope sheet, snapping, clip bars, graph editor, easing library, `edit paste`; 200×1000 timeline with no long tasks; drag/graph budgets not yet met (`artifacts/phase-05-exit.md`). |
| 06 | implemented, viewport budget open | Picking, gizmos, motion paths, director view, and focus tools ([exit report](artifacts/phase-06-exit.md)). |
| 07 | implemented, CI gate open | Clip grouping and timing, stagger drag, behavior and camera libraries, project presets, and keyframeable text, paths, and shapes ([exit report](artifacts/phase-07-exit.md)). |
| 08 | implemented, dashboard validation open | JSX picking, reviewed source edits, channel exposure, and guarded undo. Vite and Next fixture workflows passed ([exit report](artifacts/phase-08-exit.md)). |
| 09 | done | Optional Three.js entry, deterministic glTF capture, shared camera and studio gizmos. Product-orbit exports and the installed React 18 fixture passed byte comparisons ([exit report](artifacts/phase-09-exit.md)). |
| 10 | implemented | Composition lanes, editing operations, scoped waveforms, beat snapping, scene handoff, and CLI parity. The 30-second recut and crossfade comparison passed ([exit report](artifacts/phase-10-exit.md)). |
| 11 | implementation landed, release gates open | Agent handoff and parity, guide format 4, accessibility and release checks. Hardware timing and the cinematic prerequisites still gate 1.1.0 ([status report](artifacts/phase-11-exit.md)). |
| 12 | implemented | Laptop viewport parity, HiDPI capture, DPR cap, native stage editing, and template certification ([exit report](artifacts/phase-12-exit.md)). |
| 13 | implemented | Volumetric and projected depth, reversible host styles, camera-reactive light, Studio authoring and frozen capture lineage ([exit report](artifacts/phase-13-exit.md)). |
| 14–16 | not started | — |
