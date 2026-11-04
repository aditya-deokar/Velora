# Open-source evaluation for the v2.1 editor

Question from the brief: *"If any open-source editor or something like that is already built and
useful for our project without compromising our aim, then use it."*

Evaluated 2026-11-04. Version, date and license columns come from the npm registry (`registry.npmjs.org`) on that
date. License terms come from each project's own pages (sources at the end). Re-check before
adopting anything, because licenses and maintenance change.

## 1. What "without compromising our aim" means

A candidate must pass every gate:

| Gate | Why it matters for Velora |
|---|---|
| G1 License | Velora is MIT and ships editor code inside one npm package (`@adityadeokar/velora`). Copyleft (AGPL) or non-OSI terms (source-available, Sustainable Use, Webflow-restricted) cannot be bundled or required. |
| G2 One model | Recipes are the only motion document, `evaluateMotion` is the only evaluator, and `usePreviewSession` is the only clock. A tool that brings its own state model or ticker would fork them. |
| G3 Live React DOM | Velora films the real, mounted React tree with its providers and data. Canvas-only or clip-only editors can't animate those elements. |
| G4 Determinism | Every frame must be a pure function of scene time, so export reproduces the preview. |
| G5 Maintenance | An active release history, plus React 18/19 compatibility for anything in the core path. |
| G6 Footprint | Package budget of 6 MB unpacked (`scripts/release.mjs`). The architecture checker allows a new external dependency only with an explicit layer decision. |

## 2. Editors and editor frameworks

| Candidate | What it offers | License | Latest (registry) | Gates failed | Verdict |
|---|---|---|---|---|---|
| **Theatre.js** `@theatre/studio` + `@theatre/core` | The closest match: sheet objects with typed props, a sequence editor, a graph editor, keyframes, and an R3F extension | Studio **AGPL-3.0-only**; core Apache-2.0 | 0.7.2, 2024-05-19 (both). The README says development "temporarily moved to a private repo" for 1.0, with no public release since. | G1 (studio), G2 (own project state and sequence clock), G5 | **Don't adopt.** Borrow the model: typed objects become `useAnimatable` (01); the sequence editor with aggregate rows and graph editor becomes 05. |
| **Remotion Studio** | Composition preview, props editing, render queue | Source-available; company license required above the free tier | n/a | G1, G2, and it's a competitor | **Reject.** |
| **Twick** `@twick/video-editor` | React timeline and canvas video editor SDK | Sustainable Use License 1.0 (no redistribution as an SDK) | 0.15.31, 2026-05-07 | G1, G3 (clip editor, no DOM keyframes) | **Reject.** |
| **Motion Canvas** / **Revideo** | Code-defined animations with an editor UI (timeline, inspector) | MIT | `@motion-canvas/core` 3.17.2, 2024-12-14 | G3 (canvas plus generators), G2, G5 | **Reject as dependency.** Borrow: inspector over a code-defined scene; time events as named markers. |
| **Scena / Scene.js** (daybrush) | A web animation editor with a keyframe timeline | MIT | Inactive | G5 | **Reject.** |

## 3. Components and libraries

| Candidate | Use in v2.1 | License | Latest (registry) | Verdict |
|---|---|---|---|---|
| `@xzdarcy/react-timeline-editor` | Row and action timeline (clip blocks) | MIT | 1.0.0, 2026-01-25 (peers React ≥18) | **Spike S1** for composition lanes only (10). It has no keyframe graph editor, and a second interaction model would fight the dope sheet. Adopt only if it passes S1. |
| `animation-timeline-js` | Canvas keyframe timeline (snap, zoom, multi-select) | MIT | 2.3.5, 2024-07-21 | **Spike S1** for dense dope-sheet rendering. Risks: an imperative API, no graph editor, slow releases. The default is in-house rendering informed by its canvas approach. |
| `three` + `three/addons` `TransformControls` | 3D content and 3D gizmos | MIT | 0.187.0, 2026-10-30 | **Adopt** (optional peer) in the `/three` layer (09). |
| `@react-three/fiber` | Declarative Three.js in React; `frameloop="never"` with `advance(t)` for deterministic frames | MIT | 9.8.2, 2026-10-14 (peers `react >=19 <19.4`, `three >=0.156`) | **Adopt** (optional peer) for `ThreeSurface` (09). React 19 only for that entry (decision D4). Pin and test the `advance` signature, because an upstream proposal would change it to take a delta. |
| `@react-three/drei` | Helpers (loaders, controls) | MIT | 10.7.9, 2026-09-25 | **Optional.** Not required by Velora code; users may use it in their 3D scenes. |
| `code-inspector-plugin` | Build-time source-location attributes for Vite, webpack and Next/Turbopack | MIT | 2.0.9, 2026-09-12 | **Optional detected integration, no dependency** (08). React 19 removed `_debugSource`, so runtime element-to-source mapping now needs build-time injection. Spike S4 confirms the attribute format and capture neutrality. |
| TypeScript compiler API | JSX outline and codemods | Apache-2.0 | Already a runtime dependency | **Adopt.** It follows the `src/project/vite.ts` text-surgery precedent. No recast, ts-morph or magicast. |
| `react-moveable` | 2D/3D CSS transform handles | MIT | 0.56.0, 2023-12-03 | **Reject.** Stale, and it doesn't know Velora's camera. Gizmo math must use `spatial.ts`, the one projection owner. |
| Tweakpane + `@tweakpane/plugin-essentials` | Parameter panel with a cubic-bezier pad | MIT | 4.0.5 (2024-11-03) / 0.2.1 (2023-12-17) | **Reject dependency.** Borrow the bezier-pad interaction for the curve editor (05). |
| Leva | React parameter panel | MIT | 0.10.1, 2025-10-31 | **Reject for the inspector.** It isn't keyframe-aware and brings its own styling. |
| `culori` | Color spaces and OKLab interpolation | MIT | 4.0.2, 2025-06-27 | **Reject.** OKLab conversion is short and belongs in pure core, which stays zod-only. |
| `zustand`, `immer`, `zundo` | Editor store and undo | MIT | Current | **Reject.** `useSyncExternalStore` plus inverse `EditOp`s cover it, and undo must be expressed as ops anyway. |
| `@dnd-kit/react` | Drag and drop | MIT | 0.5.3, 2026-10-31 | **Defer.** Pointer events cover the timeline and gizmos, and layer order comes from source. |
| `axe-core` (dev only) | Accessibility checks in browser tests | MPL-2.0 (dev dependency, not shipped) | Current | **Adopt as devDependency** (11), if license review agrees; it is never packed. |

## 4. GSAP (special case)

GSAP is free, including for commercial use, since Webflow acquired it. However, its standard
license prohibits use in tools that let users build visual animations without code when that
competes with Webflow's visual animation building. A keyframe editor is exactly that kind of tool.

Rules for v2.1:
- No `gsap` import anywhere in `src/`. Add an architecture fixture that rejects it.
- `src/core/gsap.ts` keeps mapping GSAP ease *names* onto Velora's own `applyEasing` math. That is knowledge, not the library.
- The installed `gsap-*` skills remain reference material for authors. The editor never generates GSAP code.
- Users' own scenes may import GSAP under their own license. `detectForbiddenClock` still rejects tickers and ScrollTrigger in render paths.

This is not legal advice. If any GSAP usage is ever proposed, the maintainer should have the
current license read by counsel.

## 5. Conclusion

No editor in the ecosystem matches Velora's combination of live React DOM, one deterministic
clock, recipes as source and agent parity under MIT. Theatre.js comes closest in concept but fails on
license, state model and maintenance. v2.1 therefore:
- **builds** the editor on Velora's own engine, owners and tests;
- **adopts** three, React Three Fiber and `TransformControls` behind the optional `/three` entry;
- **uses** the TypeScript compiler API it already ships;
- **integrates** `code-inspector-plugin` opportunistically, without depending on it;
- **spikes** two timeline libraries before committing to in-house lanes (S1, Phase 00).

## 6. Cinematic track (Phases 12–16)

The cinematic track adds **no runtime dependencies**. Packages and versions were not re-queried for
this addendum, so the verdicts below rest on category properties, not on any one release.

| Category | Verdict | Why |
|---|---|---|
| 3D tilt/parallax card libraries (pointer-driven) | **Reject** | Their pose comes from the pointer and their own animation loop: a second clock and non-deterministic frames. Velora's depth model (13) derives every pose from the evaluated camera. |
| Spring and physics animation libraries | **Reject** | Velora already owns a damped spring (`easing.ts`). Rigs need offline, fixed-step simulation baked into data (D13), not a runtime spring driver. |
| Spline and Bézier utility packages | **Reject** | Phase 02.3 already defines Bézier paths with fixed arc-length lookup tables. A second curve implementation would break the single-owner rule. |
| Camera and optics math | **Build** | One physical lens owner (`lens.ts`) and one projection owner (`spatial.ts`) already exist. Phase 14 extends them. |

If a later phase proposes a dependency here, it follows the same gates as §1 (license, maintenance,
one clock, one evaluator, layer fixture in `scripts/check-architecture.mjs`).

## Sources

- Theatre.js README (license split, private-repo notice): https://github.com/theatre-js/theatre
- `@theatre/studio` on npm: https://www.npmjs.com/package/@theatre/studio
- GSAP standard license: https://gsap.com/community/standard-license/
- Webflow, "GSAP becomes free": https://webflow.com/updates/gsap-becomes-free
- Remotion license FAQ: https://www.remotion.dev/docs/license/faq
- Twick Studio docs (Sustainable Use License): https://ncounterspecialist.github.io/twick/docs/packages/studio/
- Revideo (fork of Motion Canvas): https://github.com/redotvideo/revideo
- react-timeline-editor: https://github.com/xzdarcy/react-timeline-editor
- animation-timeline-control: https://github.com/ievgennaida/animation-timeline-control
- React Three Fiber hooks (`advance`, `frameloop`): https://r3f.docs.pmnd.rs/api/hooks
- React 19 removal of `_debugSource`: https://github.com/facebook/react/issues/29092
- code-inspector: https://github.com/zh-lx/code-inspector
- Tweakpane: https://github.com/cocopon/tweakpane
- Leva: https://github.com/pmndrs/leva
- npm registry metadata queried 2026-11-04 for every package version and date above.
