# Phase 15 — Live DOM target locking: never guess coordinates

## Goal
Camera aim, focus and rigs lock onto **real elements** rather than guessed numbers. A target is a
named anchor (`data-velora-anchor="pricing-cta"`) or a unique selector inside a Surface or a
RouteFrame. It is measured from live layout at every sampled frame, plus its Z elevation from
depth layers (13). The camera frames the exact center of the component, and focus keeps hero text
in the sharp plane, however the page scrolls or the layout reflows. Agents get the same
measurements from the CLI, so they never write pixel coordinates blind either.

## Audit (current state)
- 02.5 constraints target `{ surface, anchor?: [u, v] }` or a point. `u, v` are fractions of the Surface box, so an agent must guess where a button sits.
- Shot builders take `focusRegion` in subject pixels (`ShotInputSchema.focusRegion`), and templates ship fixed regions: rack focus uses 40% / 15% in `src/core/templates.ts`. Both are guesses about the host layout.
- The registry measures Surfaces through the offset chain (`origin()` in `src/react/registry.ts`, transform-free). Nothing measures elements *inside* a Surface, and nothing reaches into a RouteFrame document.
- `getBoundingClientRect` on in-tree elements includes the 3D camera transform, so it changes every frame and is wrong for this purpose. Inside a same-origin iframe document it is transform-free (relative to the iframe viewport).

## Prerequisites
- Phase 02 (constraints), Phase 12 (identical stage layout in preview and export), Phase 13 (elevation).
- Decision D14.
- Editor tasks (15.5) need Phase 06; "add anchor to source" needs Phase 08.

## Scope IN
- `ElementTarget` and its resolution.
- Anchor measurement in-tree and in RouteFrames.
- Element targets for `lookAt`, `focusFollow`, the new `frame` constraint, racks and shots.
- `velora anchors`; capture refusal on missing targets; ops, CLI, editor and skills.

## Scope OUT
- Cross-origin frames (already refused by RouteFrame).
- Tracking elements inside WebGL (09 registers 3D anchors through its own registry).

## Tasks

### 15.1 Target contract — new core owner `src/core/targets.ts` (`ElementTargetSchema`, `resolveTarget`)
- `ElementTarget = { surface: id, anchor: name } | { surface: id, selector: css }`, plus:
  - `at?: [u, v]`: a point inside the element (0–1, default center);
  - `plane?: "face" | "base"`: the lifted face (default) or the plane it rests on.
- Anchor names match `^[a-z0-9][a-z0-9-]{0,63}$`. Selectors are ≤ 256 characters and must match **exactly one** visible element at every sampled time.
- Accepted wherever a target is:
  - `lookAt.target` and `focusFollow.target` (the 02.5 union gains this member);
  - the new `frame` constraint (15.3);
  - `buildRackFocus` from/to (14.5) and rigs (16);
  - shot input `focusTarget`, an alternative to `focusRegion` (exactly one of the two).
- `resolveTarget(target, anchors, evaluation)` is pure: world point = `surfaceWorld × (anchorLocal + [0, 0, elevation])`. It goes through the spatial owner.
- Shorthand used by CLI and ops: `<surface>:<anchor>`, `<surface>:css(<selector>)`, optionally `@u,v`.

### 15.2 Anchor measurement — `src/react/anchors.ts` (owner `measureAnchors`, registry extension)
- **In-tree Surfaces:** the offset chain relative to the Surface element (the same algorithm as `origin()`, including borders and scroll), so camera transforms never contaminate a measurement.
- **RouteFrame:** `getBoundingClientRect` inside the iframe document **after** RouteFrame's `apply()` sets the frame's scroll. A scroll channel therefore moves anchors exactly, and `position: sticky/fixed` elements are measured where they actually are. Rects map into the Surface's local frame through the iframe's offset.
- **Elevation:** the anchor's nearest lifted ancestor (13) supplies `z`, and `plane` chooses face or base.
- **When:**
  - on layout change (ResizeObserver, MutationObserver);
  - on every capture seek, after the settle hooks (fonts, decoded images, RouteFrame load and scroll).

  Measurements are an input to that frame's evaluation, beside Surface measurements. Preview equals export because the stage (12) is the same CSS viewport in both.
- **Missing or ambiguous:** Scene issues `target-missing` / `target-ambiguous` with the closest anchor names. Capture refuses with **`ERR_TARGET_MISSING`** (catalog entry with a hint and next commands: `velora anchors --scene <id>`). Velora never falls back to the Surface center silently.
- Measurements stay in memory. Recipes only ever contain the anchor name or selector the author chose.

### 15.3 Constraint resolution with element targets — `src/core/spatial.ts`
- **`lookAt`** with an element target derives camera `rotateX/rotateY` so the element point lands at frame center, or at `compose?: [x%, y%]` (for example thirds), blended by `weight`.
- **`focusFollow`** sets `focus.distance` to the camera-space depth of the element face, including elevation, plus `offset`. The hero text stays in the sharp plane.
- **New `frame` constraint:** `{ kind: "frame", target, fill: (0, 1], axis?: "width" | "height" | "fit", weight? }`. It solves camera distance along the view ray so the element occupies `fill` of the frame with the current lens and zoom. Rigs (16) use it to arrive framed on a component instead of guessing a distance.
- At most one `frame` constraint is active per time. Constraints resolve in a fixed order (`frame` → `lookAt` → `focusFollow`), so each sees the previous result.
- Advisories (extending the 02.5 framing review): target outside the frame; target blur > 0.5 px at a sampled time; target smaller than 4% of the frame at a 200 mm close-up (probably the wrong anchor).

### 15.4 Agent tooling — `src/project/commands.ts` (new CLI command `anchors`)
- `velora anchors --scene <id> [--time <ms>] [--url <origin>] [--project] --json` opens the scene's capture page headlessly (the same path as `velora shot`), settles, and lists:
  - every `data-velora-anchor` and depth layer per Surface: name or selector, tier, stage rect (CSS px), elevation;
  - at `--time`: projected frame rect, blur and visibility.

  It is read-only, never writes, and is listed in `CLI_COMMANDS` with skill `velora-scenes`.
- `velora edit lock --scene <id> [--look-at <target>] [--focus-follow <target>] [--frame <target> --fill 0.6] [--weight <0–1>] [--write]` compiles to `constraint.set` ops.
- Templates and scaffolds: `velora new scene … --focus <anchor>` writes `focusTarget`. Template certification falls back to its fixed region only when no target is given (existing outputs are unchanged).

### 15.5 Editor surface (after Phase 06)
- **Click to target.** With the Focus tool (F) or a constraint target picker, hovering highlights the element under the cursor inside Surfaces and RouteFrames and shows its anchor name. If it has none, the editor proposes a unique selector. Once Phase 08 has landed, it also offers the opt-in codemod "Add `data-velora-anchor` to source" (diff preview, D3).
- Locked targets draw a reticle and the focus plane outline (chrome-marked).
- The inspector shows each constraint's target, live rect and blur at the playhead.

### 15.6 Skills
- `velora-cinematography`: lock aim and focus to anchors, never to pixel guesses. Run `velora anchors` first, and use `frame` for close-ups.
- `velora-scenes`: how to add `data-velora-anchor` to host components. It's stable across refactors; selectors are a fallback.

## Contracts (additive)
| Field / API | Type | Notes |
|---|---|---|
| `ElementTargetSchema` | `{surface, anchor \| selector, at?, plane?}` | Union member wherever targets exist |
| `scene.constraints[]` `frame` | `{kind:"frame", target, fill, axis?, weight?}` | Solves camera distance |
| Shot input `focusTarget` | ElementTarget | XOR `focusRegion` |
| Host markup `data-velora-anchor` | name | Read-only for Velora |
| CLI `velora anchors`, `velora edit lock`; error `ERR_TARGET_MISSING` | | Additive catalog entries |

## Files
- New: `src/core/targets.ts`, `src/react/anchors.ts`
- Modified:
  - core: `src/core/{spatial,scene,shots,templates,authoring,edit,cli-schema,schemas,index}.ts`;
  - react and kit: `src/react/{index.tsx,registry.ts,capture.ts}`, `src/kit/RouteFrame.tsx`;
  - project and CLI: `src/project/{commands,edit}.ts`, `src/cli/index.ts`;
  - `scripts/check-architecture.mjs` (owners `ElementTargetSchema`, `resolveTarget`, `measureAnchors`), `schemas/*`.
- Skills: `velora-cinematography`, `velora-scenes`, `velora-verify`

## Tests
- `tests/core/targets.test.ts`: union parsing and shorthand; `resolveTarget` math including elevation and `plane`; the `frame` solver hits `fill` within 0.5%; constraint order.
- `tests/react/anchors.test.tsx`: offset-chain measurement equals `getBoundingClientRect` under an identity camera, and **stays unchanged** under a rotated camera; ambiguity and missing-anchor issues.
- `tests/browser/targets.spec.ts`:
  - **orbit lock:** a `lookAt` on `pricing-cta` during an orbit keeps the anchor's center within 0.5 px of frame center in every exported frame (a 1 px marker probe);
  - **scroll:** a RouteFrame scrolled by a channel mid-shot keeps the anchor locked;
  - **focus:** `focusFollow` keeps anchor blur < 0.5 px;
  - **refusal:** removing the anchor makes `velora export` fail with `ERR_TARGET_MISSING`;
  - **parity:** preview and export anchor rects are equal.
- `tests/cli/anchors.test.ts`: the JSON envelope schema; values match the browser probe; read-only (no file changes).

## Validation criteria
- [ ] An agent with only `velora anchors` output writes a 200 mm orbit locked on `revenue-card`. It contains no pixel numbers, and it renders centered and sharp.
- [ ] Page reflow (changed copy that moves the card) needs no recipe edit: the lock follows the element.

## Anti-patterns
- Measuring transformed rects for in-tree elements.
- Caching measurements across stage changes or scroll changes.
- Silently falling back to a Surface center, or to the last known position, when a target is missing.
- Writing measured coordinates into recipes as if the author had chosen them.

## Definition of Done
Tests and validation green; error catalog, guide and skills updated;
`plan/v2.1/artifacts/phase-15-exit.md` written.
