# Velora v2.1 — Studio Editor: keyframes, easing, groups and full scene control

Source brief: the maintainer's request (2026-11-04). It asks to take the Velora studio to the
next level as a cinematic animation builder:
- keyframes and easing for every element on screen (real React elements);
- groups whose animation can be eased and retimed as a unit;
- full control of React components and Three.js scenes;
- everything else a cinematic video editor needs, configurable through the real codebase.

Where an existing open-source editor helps without compromising that aim, it should be used.

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

Strengths to build on:
- one presentation cursor (`usePreviewSession`);
- one evaluator (`evaluateMotion`) and one validator (`presentPreview`);
- a live registry of mounted Surfaces with parent hierarchy and measurements (`src/react/registry.ts`);
- world matrices per node (`EvaluatedNode.world`);
- compare-and-swap atomic writes (`atomicWrite(root, target, content, expected)` in `src/project/services.ts`);
- TypeScript-AST text surgery precedent (`src/project/vite.ts`);
- chrome-marked overlays (`StudioOverlays`) and keyboard transport (`useTransportKeys`);
- a certified shot vocabulary (`buildShot`), kinetic presets, beats, transitions, and a composition player.

## 3. Decisions

From the request (2026-11-04):
- Build a visual, keyframe-based cinematic editor into the studio, covering:
  - per-element keyframes and easing;
  - groups;
  - full control of React components and Three.js.
- Prefer existing open-source editors where they fit without compromising Velora's aim.

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

## 7. Phase map

| Phase | File | Theme | Headline outcome | Depends on |
|---|---|---|---|---|
| 00 | `PHASE-00-foundations-and-spikes.md` | Foundations | Decisions confirmed, goldens and performance baselines, five spikes, new architecture layers | — |
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

```
00 ──► 01 ──► 02 ───────────────┬──► 05 ──► 07 ──┐
        │                       │    │           │
        └──► 03 ──► 04 ─────────┼────┤           ├──► 11
                     │          └──► 06 ──► 09 ──┤
                     ├──► 08 ────────────────────┤
                     └──────────────► 10 (after 05)
```

03 can start once 01 lands. It adds clip, path and constraint ops when 02 lands.

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

## 10. Final status

Planned 2026-11-04. No phase started. Phase 00 begins after decisions D1–D8 are confirmed.

| Phase | Status | Headline evidence |
|---|---|---|
| 00–11 | not started | — |
