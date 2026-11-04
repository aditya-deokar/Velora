# Phase 13 — Depth layers: automatic Z elevation, extrusion and camera-reactive light

## Goal
A flat UI plane becomes a physical object. The hierarchy rises on Z in tiers:
background → containers and sidebars → cards and tables → charts, buttons and badges → floating
modals, tooltips and cursors. Each lifted layer gets:
- real parallax under a moving camera;
- a thin extruded edge;
- a contact shadow on the plane below it;
- a specular sheen that slides as the camera's angle to the layer changes.

All of it is computed by one pure model from the evaluated camera, so preview equals export. Every
style Velora puts on the host is reversible and gone when preview, Edit mode or capture ends.

## Audit (current state)
- Each Surface is one plane. `leafFilter` puts the focus blur `filter` on the content leaf (`src/react/index.tsx`). A CSS filter is a grouping property, so it flattens every descendant's 3D: nested `translateZ` inside a blurred leaf collapses.
- The Scene header comment already warns that host filters, opacity, overflow, clipping and paint containment flatten 3D. `uncoveredContent` (`src/react/registry.ts`) diagnoses unfiltered content.
- RouteFrame content is an iframe. CSS 3D never crosses an iframe boundary, because the document is composited flat onto the iframe's plane. Elevation inside a route therefore can't be real 3D from outside.
- `LaptopFrame` wraps its content in `filter: drop-shadow(…)` (`src/kit/frames.tsx`), which flattens any 3D inside it.
- Attribute names in use: `data-velora-depth` (Surface world z) and `data-velora-shadow` (kit). New host markup uses `data-velora-tier`.

## Prerequisites
- Phase 12 (stage coordinates and DPR).
- Phase 01 (the motion property conventions).
- Spikes S6 (volumetric depth in Chromium) and S8 (projected parallax in iframes).
- Decision D11 (host DOM policy).
- Editor tasks (13.6) need Phase 06.

## Scope IN
- The depth model (tiers, classification, light).
- The host-style ledger.
- Volumetric rendering for in-tree Surfaces; projected rendering for RouteFrame and any-site mode.
- The `elevation` motion property, recipe `definition.depth`, the `data-velora-tier` markup, freezing ("resolve"), ops, CLI and skills; the LaptopFrame fix.

## Scope OUT
- Per-layer depth of field (14).
  - Until 14 lands, a Surface with **volumetric** depth keeps its whole-leaf focus blur off, because the blur would flatten it, and reports `depth-focus-deferred`.
  - Projected Surfaces keep today's leaf focus: the iframe is one plane anyway.
- Animated lights (follow-up).
- Mesh-level 3D (09).

## Tasks

### 13.1 Depth model — new core owner `src/core/depth.ts` (pure)
- **Tiers** (`DEPTH_TIERS`, px at `standard`; `subtle` ×0.5, `dramatic` ×2):

  | Tier | z | Default extrude | Typical elements |
  |---|---|---|---|
  | `base` | 0 | 0 | page background |
  | `container` | 8 | 2 | `aside`, `nav`, `header`, `[role=navigation\|complementary]`, panels |
  | `card` | 24 | 4 | boxed regions: cards, tables, list groups |
  | `control` | 40 | 2 | buttons, tabs, inputs, badges, charts (`canvas`, chart-sized `svg`) |
  | `floating` | 96 | 3 | `[role=dialog\|tooltip\|menu]`, `[popover]`, `position: fixed` with `z-index > 0` |
  | `cursor` | 120 | 0 | kit `Cursor` |

- **Nesting is relative.** A layer's local `translateZ` is its tier z minus its nearest lifted ancestor's tier z (never negative). World elevation therefore accumulates, and a child can never sink below its parent.
- **`classifyDepth(snapshot, config) → DepthLayer[]`** runs on a serializable DOM snapshot. Each snapshot node holds:
  - tag, role, `aria-*`, `data-velora-tier`, `data-velora-anchor`;
  - a computed-style subset (position, z-index, display, background alpha, box-shadow, border, radius, overflow, opacity, filter, clip-path, mask, isolation, mix-blend-mode, contain);
  - a layout rect in stage CSS px, and document order.

  Rules apply in this order:
  1. `data-velora-tier="<tier|px|flat|none>"` on host elements;
  2. recipe rules (`match: {anchor} | {selector} | {tier}` → `tier` or `z`);
  3. `auto` heuristics (the table above). Boxed regions need a visible box (non-transparent background, a shadow or a border, and radius > 0) and an area between 1% and 40% of the stage.

  At most `maxLayers` (default 48, cap 128) are kept, ranked by tier then area. Ties break by document order. Same snapshot means same output.
- **`evaluateDepthLayers(surfaceWorld, layers, camera, light, intensity)`** returns per layer:
  - `world`, `localZ`;
  - `shadow`: offset on the **parent plane** = `h · (Lx/Lz, Ly/Lz)` in the parent's local frame, penumbra `0.6 h`, opacity falling with `h`;
  - `edge`: wall thickness, with each wall's shade from `N_wall · L`;
  - `sheen`: Blinn–Phong half vector `H = normalize(L + V)` with `V` from the layer center toward the camera. Highlight position is the reflection point in layer `u, v` (%); opacity `= light.sheen · max(0, N·H)^shininess`, ≤ 0.18 by default (restraint).

  Every output is a pure function of the evaluated camera, the light and layout, so the light reacts to the camera with no clock.
- **Light** (static per scene): `{ azimuthDeg = −35, elevationDeg = 55, intensity = 1, sheen = 0.12 }`. These are values written by scaffolds, not schema defaults (principle 5).

### 13.2 Host-style ledger — `src/react/depth/ledger.ts` (owner `createStyleLedger`)
- The only code that writes styles onto host elements, in either the scene document or a RouteFrame document. The architecture checker forbids `.style.` writes to non-Velora elements anywhere else in `src/react/depth` and `src/kit`.
- `apply(element, props)`:
  - snapshots each property's prior inline value **and priority** before writing;
  - composes `transform` with the host's own (`translateZ(z) <existing>`), so host transforms survive;
  - keeps its state in a `WeakMap`. **No attributes or classes are added to host elements.**
- `revert()` restores every snapshot exactly. It runs on Scene unmount, depth disabled, Edit-mode exit, capture teardown (`useSceneCapture`), RouteFrame unmount or navigation, HMR dispose, and `pagehide`.
- A `MutationObserver` re-applies on the next frame when host React overwrites a property it owns, and reports `depth-contested { element, property }` if the host keeps owning it. Capture settle waits for re-application.
- `audit()` compares a serialized `style`-attribute snapshot of every touched element with the original. Tests and a DEV-only assertion at revert use it.
- Allowed writes: `transform`, `transform-style`, `backface-visibility`. Projected mode (13.4) adds `box-shadow` and `background-image`, both prepended to the host's own lists. Phase 14.4 adds `filter` (a focus `blur()` placed before the host's own filter list) on front layers only. Nothing else.

### 13.3 Volumetric rendering (in-tree Surfaces) — `src/react/depth/Volumetric.tsx`
- **Unflatten the chain.** Every ancestor between the Surface leaf and a lifted layer gets `transform-style: preserve-3d` through the ledger.
- **Never force 3D.** If an ancestor has a grouping property (`overflow` other than `visible`/`clip`, `opacity < 1`, `filter`, `clip-path`, `mask*`, `isolation: isolate`, `mix-blend-mode` other than `normal`, `contain` with paint), its descendants stay in that ancestor's plane. Velora reports `depth-flattened { layer, ancestor, property }` with the hint "move clipping or opacity to a content leaf, or mark the ancestor `data-velora-tier="flat"`". The host's own overflow, opacity and filter are **never** overridden (D11).
- **Proxies.** Light effects are Velora-owned elements, rendered in a `data-velora-depth-proxies` container inside the Surface's 3D context, **outside the host tree**. They are positioned from layout rects measured through the registry's offset chain (`origin()` in `registry.ts`), so camera transforms never touch the measurements:
  - a contact-shadow plane on the parent plane;
  - four side walls of height `extrude`, rotated 90° under the face;
  - a sheen plane at `z + 0.5` px with a radial gradient at `(u, v)`.
- Proxies are scene content (they render in export), carry `pointer-events: none`, and are excluded from picking (06.2).
- **Sorting.** Chromium depth-sorts planes within one 3D rendering context. S6 confirms that proxies interleave correctly with host layers. A proxy that would intersect a host plane is nudged by ≤ 0.5 px.
- **Cost.** Classification reruns only on structural mutations (registry `MutationObserver`). Geometry per frame comes from cached layout, because layout doesn't change with the camera.

### 13.4 Projected rendering (RouteFrame, any-site mode, flattened hosts) — `src/react/depth/Projected.tsx`, `src/kit/RouteFrame.tsx`
- In a same-origin iframe, `evaluateDepthLayers` also returns each layer's **in-plane displacement and scale**. These come from intersecting the camera ray through the lifted center with the parent plane: first-order exact, and the error is bounded by the S8 gate. At 200 mm the projection is nearly orthographic, so the error approaches zero.
- RouteFrame applies them inside the iframe document through a ledger bound to that document:
  - 2D `transform` composed with the host's;
  - `box-shadow` prepended: the contact shadow plus a stepped extrusion in the view-dependent direction;
  - `background-image` prepended: the sheen gradient, which paints under text and above the element's background color. The matching `background-size/position/repeat` lists are prepended in step.
- The RouteFrame freeze stylesheet (`<style id="velora-route-frame">` in `<head>`) is the precedent for document-level injection. It stays the only injected node, and it is removed on revert.
- `render: "auto"` picks volumetric for in-tree Surfaces and projected for RouteFrames, any-site mode and fully flattened chains.

### 13.5 Authoring contract — `src/core/preview.ts`, `src/core/motion.ts`, `src/react/index.tsx`
- `definition.depth?: Record<surfaceId, DepthConfig>` (≤ 32 entries). `DepthConfig`:
  - `mode: "auto" | "rules" | "off"`, `render?: "auto" | "volumetric" | "projected"`, `intensity?: "subtle" | "standard" | "dramatic"`;
  - `tiers?` (overrides), `rules?: DepthRule[]` (≤ 256), `maxLayers?`, `light?`;
  - `resolved?: { hash, layers: [{ match, tier, z }] }`.
- **The recipe is authoritative** (D2). `<Surface depth="auto">` supplies a default used only when the recipe has no entry, as `<Surface transform>` does for base transforms.
- The motion property **`elevation`** (multiplier [0, 4]) on surface targets lets a UI assemble as the camera arrives (0 → 1). It joins `SurfaceMotionSchema` as an optional, default-less field. `Scene` strips it from node transforms in the same way as visual keys (`visualKeys`), because `TransformSchema` is strict, and feeds it to `evaluateDepthLayers`.
- **Freezing** (principle 12): `velora depth resolve --scene <id> [--write]` opens the capture page headlessly, settles, classifies, and writes `resolved` (anchor or unique selector, tier, z). Live `auto` is for iteration; `resolved` is for final renders. The render manifest records the classified layer hash, so drift between renders is visible.
- Ops: `depth.set { surface, config }`, `depth.rule.add`, `depth.rule.remove`, `depth.resolve` (bake), each with an exact inverse.
- CLI: `velora edit depth --scene <id> --surface <id> --mode auto --intensity standard [--write]`, plus `velora depth resolve`.

### 13.6 Editor surface (after Phase 06)
- Viewport **Depth view** (editor-only, chrome-marked): layers tinted by tier. In director view (06.6), an "explode" slider multiplies elevation for inspection only. Capture refusal in director view already covers it.
- Layers panel: depth layers listed under their Surface (anchor name or selector, tier), read-only apart from tier override.
- Inspector: a Depth section with mode, intensity, light azimuth and elevation dials, sheen, and the `elevation` stopwatch.

### 13.7 Kit
- `LaptopFrame` (and any kit frame with `filter: drop-shadow`) switches to a non-flattening box shadow **only when depth is active inside it**. Frames without depth keep their exact pixels.
- Kit cards in composite templates declare `data-velora-tier`. Templates that adopt depth are re-certified.

## Contracts (additive)
| Field / API | Type | Default | Notes |
|---|---|---|---|
| `definition.depth` | `Record<id, DepthConfig>` | — | Absent = today's flat planes |
| surface motion `elevation` | number [0, 4] | — | Multiplies tier z |
| host markup `data-velora-tier` | tier, px, `flat`, `none` | — | Read-only for Velora |
| `classifyDepth`, `evaluateDepthLayers`, `DEPTH_TIERS` | core | — | `src/core/depth.ts` |
| `createStyleLedger` | react | — | Only host-style writer |
| Ops `depth.*`; CLI `velora edit depth`, `velora depth resolve` | | — | Dry run by default |
| Scene issues `depth-flattened`, `depth-contested`, `depth-focus-deferred` | | | With hints |

## Files
- New: `src/core/depth.ts`, `src/react/depth/{ledger,Volumetric,Projected,snapshot,index}.ts(x)`
- Modified:
  - core: `src/core/{preview,motion,authoring,edit,cli-schema,schemas,index}.ts`;
  - react and kit: `src/react/{index.tsx,registry.ts,capture.ts}`, `src/kit/{RouteFrame,frames}.tsx`;
  - project: `src/project/{edit,commands}.ts` (`depth resolve`);
  - `scripts/check-architecture.mjs` (owners `classifyDepth`, `evaluateDepthLayers`, `createStyleLedger`; the host-style write rule), `schemas/*`.
- Skills: `velora-scenes`, `velora-cinematography`, `velora-debug`, `velora-performance`

## Tests
- `tests/core/depth.test.ts`:
  - classification table (each heuristic, attribute overrides, rule order, caps);
  - relative nesting;
  - determinism (same snapshot gives deep-equal output, 1,000 random trees);
  - shadow offset formula;
  - sheen highlight moves monotonically with camera `rotateY`;
  - intensity scaling.
- `tests/react/depth-ledger.test.tsx`: exact revert including `!important` priorities and pre-existing host transforms; contested re-apply; `audit()` clean after unmount, StrictMode double mount and HMR dispose.
- `tests/browser/depth.spec.ts`, against a dashboard fixture (sidebar, cards, chart, modal):
  - **volumetric:** orbiting the camera 0 → 20° moves the card relative to the base by the computed parallax ±0.5 px; proxies are present and sorted; two captures give the same SHAs;
  - **flattened ancestor** (`overflow: hidden`): diagnostic emitted, no crash, nothing overridden;
  - **projected:** in a RouteFrame dashboard, per-layer displacement is within the S8 error;
  - **cleanliness:** after preview ends, Edit mode exits and capture finishes, a snapshot of structure plus every `style` attribute of the host subtree (and the RouteFrame document) is byte-identical to the pre-mount snapshot.
- `tests/performance/depth.spec.ts`: 48 volumetric layers scrub at ≥ 55 fps median; classification ≤ 30 ms for 2,000 elements (reference machine).

## Validation criteria
- [ ] A three-tier dashboard orbit reads as physical (parallax, edges, shadows, sheen moving with the camera) and renders identically twice and identically in preview and export.
- [ ] Host cleanliness holds for in-tree Surfaces and RouteFrames.
- [ ] Scenes without `depth` render byte-identically: goldens plus the frame SHAs of the existing browser fixtures.

## Anti-patterns
- Inserting, wrapping or reparenting host nodes, or adding classes or attributes to them.
- Overriding host `overflow`, `opacity` or `filter` to force 3D.
- Baked shadows or sheen that ignore the camera, or light driven by a wall clock.
- A second projection implementation for projected mode: it uses `spatial.ts`.
- Re-running classification every frame.

## Definition of Done
Tests, cleanliness and determinism green; schemas, guide and skills updated; S6/S8 verdicts
honored; `plan/v2.1/artifacts/phase-13-exit.md` written.
