# Phase 14 — Cinema optics: lens presets, telephoto compression, per-layer depth of field, rack focus with breathing

## Goal
Shoot the laptop like a cinema camera does:
- **A real lens kit:** 24 mm drone, 50 mm prime, 85 mm portrait and 200 mm telephoto, each driving perspective, framing distance and depth of field from one physical model.
- **Telephoto compression:** at 200 mm, the camera stands far back with zero edge warping, and layers slide across each other as flat cards.
- **Per-layer focus:** every depth layer blurs by its signed distance from the focal plane and the aperture (f/1.4 to f/16).
- **Rack focus:** a pull between two depths melts one layer into bokeh while the other comes tack-sharp, with 1.5–2% lens breathing during the pull.

## Audit (current state)
- `src/core/lens.ts`: `perspective = frameHeight · mm / 24`, clamped to 100–10,000 (and `CameraSchema.perspective ≤ 10,000`).
  - At 1080 px, 200 mm is 9,000.
  - At 4:5 (1350 px) and 9:16 (1920 px), `lensFor(200, …)` **throws** (11,250 and 16,000). `ShotInputSchema.lens` already allows 200.
- `lensFor` sets the focus focal length to `min(300, mm)` *in scene pixels*, while camera distances are thousands of pixels. Depth of field is therefore far deeper than a real lens of that focal length at that framing. The shot builders compensate by hand (`focalLength: 220` for rack focus, `180` for macro in `src/core/shots.ts`). `FocusSchema.focalLength ≤ 300`.
- `sampleFocus` (`src/core/spatial.ts`) already computes a signed thin-lens circle of confusion per plane: `σ = f / (4 N (D − f)) · |depth − D|`. `FocusFilter` already handles tilted planes with depth textures. What is missing is focus per **nested** depth layer, because the leaf filter flattens (Phase 13 audit).
- The `rack-focus` shot pulls between two points of one tilted plane. There is no breathing and no notion of "this component to that one".
- There is no zoom at a fixed viewpoint. Changing `perspective` in the CSS model also moves the eye, so breathing and "compensating scale zoom" have no primitive.

## Prerequisites
- Phase 12 (stage physical width gives px/mm), Phase 13 (depth layers), Phase 01 (compiled evaluator).
- Spike S6's verdict on the volumetric focus strategy. Decision D12.
- Element targets for racks arrive with Phase 15. Until then, racks target depth layers, surface `[u, v]` anchors (02.5) or explicit depths.
- Editor tasks (14.7) need Phase 06.

## Scope IN
- `LENS_PRESETS`, `lensPreset`, widened ranges, framing hold.
- `camera.zoom`.
- Per-layer depth of field in volumetric and projected rendering.
- `buildRackFocus` with breathing; backdrop cover helper; ops, CLI, editor and skills.

## Scope OUT
- Anamorphic squeeze, bokeh shapes and chromatic aberration (follow-ups).
- Rigs (16).

## Tasks

### 14.1 Lens presets — `src/core/lens.ts` (extends the owner)
| id | mm | Default fStop | maxBlur | Breathing | Character |
|---|---|---|---|---|---|
| `24mm-drone` | 24 | 5.6 | 6 | 0.010 | Wide, strong perspective, deep focus: fly-throughs, establishing |
| `50mm-prime` | 50 | 2.8 | 8 | 0.012 | Natural: reveals, pushes |
| `85mm-portrait` | 85 | 2 | 10 | 0.015 | Compression and separation: hero framing |
| `200mm-telephoto` | 200 | 2.8 | 14 | 0.018 | Flat perspective, no edge warping, parallax as pure sliding |

- `lensPreset(id, { frameHeight, stage })` returns `{ perspective, focus: { focalLength, fStop, maxBlur }, breathing }`:
  - `perspective = frameHeight · mm / 24`, the same model as `lensFor`;
  - **physical focus focal length** `= mm · pxPerMm`, where `pxPerMm = stage.width / stage.physicalWidthMm`. For `laptop-14` that is 1512 / 302 ≈ 5.0 px/mm, so 200 mm is about 1,001 px. Stages without a physical width use the `laptop-14` ratio.
  - The results are written into the recipe as numbers.
- `lensFor` is **unchanged** (legacy output and goldens). New code paths call `lensPreset`.
- Additive range widening: `CameraSchema.perspective` max 10,000 → 40,000 (and `PERSPECTIVE_MAX`), `FocusSchema.focalLength` max 300 → 4,000. Every existing value parses identically, and 200 mm becomes valid at every aspect.
- **What the numbers mean** (D12). The physical model gives 200 mm about 9,000 px of perspective at a 1080 px frame. The brief's "4,000–6,000 px" corresponds to roughly 90–130 mm there. The presets keep the physics, and authors can still override `perspective`.
- Expected depth of field: at a 1080 px frame with `laptop-14` at 78% fill, 200 mm at f/1.4, a `floating` layer (96 px) above a focused base blurs to **σ ≈ 1.8 px**. `dramatic` depth doubles that. If certification shows a pull too subtle to read, the remedy is depth intensity or aperture, never a fudge factor in the circle of confusion.

### 14.2 Camera zoom (field of view at a fixed viewpoint) — `src/core/scene.ts`, `spatial.ts`, `shots.ts`, `src/react/index.tsx`
- `CameraSchema.zoom?`: [0.25, 8], optional, **no default**, animatable as a camera property.
- Applied as a post-projection scale about the frame center on the Scene root, outside the 3D context. `cameraToCss` strings are unchanged when it is absent.
- Projection includes it: `projectPoints` now, and `projectWorld` once 06.1 lands; 06.1 must keep it. So do `framingReport`, `resolutionBudget` (12.5) and focus kernels (blur in output px scales by `zoom`).
- Uses: lens breathing; "long perspective plus compensating zoom" when an author wants the camera to stay put; punch-ins.

### 14.3 Framing hold on lens change — `src/core/lens.ts` (`applyLens`)
- `applyLens(definition, presetId, { hold: "framing" | "position" })` returns ops:
  - **`framing`** (default) keeps the subject's projected size. Subject scale is `s = p / (p + d)`, so the camera offset `d` and every camera `z` keyframe scale by `p′ / p`. Lateral moves keep their on-screen size. This is the classic compression: layers and backdrops change relation while the subject holds.
  - **`position`** keeps the camera and sets `zoom` so the subject keeps its size.
- Extracted helper `framingDistance(perspective, frame, subjectRect, fill)` replaces the private `distanceFor` in `shots.ts`, with identical outputs (template certification golden).
- Advisory `lens-compression`: a backdrop deeper than −1,000 px grows more than 1.5× after a lens change, so its cover scale needs a check (14.6).

### 14.4 Per-layer depth of field — `src/core/spatial.ts`, `src/react/depth/`
- Every depth layer (13) gets its own `FocusField` from its world matrix. Its blur is `sampleFocus(field)` with the **signed** plane distance `layerDepth − focusDistance`. The sign says front or back; the magnitude and aperture say how much.
- **Volumetric rendering** (in-tree Surfaces), S6's preferred strategy, "veils behind, filters in front":
  - Layers **in front of** the focal plane get a CSS `filter` on the outermost front layer of each front subtree. Flattening its own descendants is acceptable: they are all in front and blurred. σ uses the subtree's depth-weighted mean.
  - Layers **behind** the focal plane are blurred by Velora-owned **focus veils**: proxy planes just above each behind band, clipped to their Surface's rect, carrying `backdrop-filter: blur(σ_band)`. S6 also checks the double-blur case of a Surface with a transparent base over another blurred Surface. Gaussian blurs compose in quadrature, so `σ_band` values are solved so that the cumulative blur at each behind layer equals its target. A solution always exists, because behind σ grows monotonically with distance.
  - The in-focus band gets nothing, so it stays tack-sharp.
  - **S6 fallback** (if `backdrop-filter` fails in a 3D context or in headless capture): band-quantized filters on terminal layers only. Containers holding lifted descendants stay in focus, with a `dof-approximate` advisory. This is recorded honestly in the exit report and the skills.
- **Projected rendering** (RouteFrame, any-site): a per-surface **depth-map focus filter**.
  - Velora rasterizes a stage-sized depth map from the displaced layer rects (13.4), quantized to `FOCUS_BANDS`, and feeds it to an SVG filter on the iframe element (`feImage`) that blends the band blurs.
  - This extends `FocusFilter`'s existing band blending, which today uses the linear depth textures `depth-x.png`/`depth-y.png`. It is correct for any nesting, in front and behind, because the iframe is one plane anyway.
- Surfaces without depth keep today's leaf focus byte-identically.
- `data-velora-blur` is reported per depth layer (on proxies), so focus peaking (`StudioOverlays`) and tests read real values.

### 14.5 Rack focus with breathing — `src/core/shots.ts` (owner `buildRackFocus`)
- `buildRackFocus({ from, to, atMs, durationMs, ease = "cinematic", hold?, breathing?: { amount, direction: "in" | "out" }, fStopDip? })` returns a focus clip (02.1) with `source: { rack, version, params }`. The clip contains:
  - `focus.distance` keyframes from the depth of `from` to the depth of `to`;
  - `camera.zoom` keyframes **at the same times with the same ease**, so breathing can never drift from the pull. Unit-focusing primes magnify as focus comes closer (`in`); many internal-focus zooms do the opposite (`out`). Breathing is a magnitude in [0, 0.03] (presets 0.010–0.018) and is placed in an add clip, so it layers over any authored zoom.
  - optional `fStop` keyframes (a slight open-up during the pull), off by default.
- Targets are `{ layer: <depth layer> } | { surface, anchor: [u, v] } | { depth: px }`, plus element targets once Phase 15 lands.
- Certification (`rackReport`):
  - at landing, `to` blur < 0.5 px;
  - at the start, `from` blur < 0.5 px;
  - at each end, the other target reaches the expected bokeh for its depth gap and aperture;
  - breathing amplitude equals the requested value ±0.1 percentage points.
- The existing `rack-focus` shot kind keeps its exact output. New templates may adopt `buildRackFocus` and are re-certified.

### 14.6 Backdrops at depth — `src/core/spatial.ts` (`coverScaleAt`), `src/kit/atmosphere.tsx`
- `coverScaleAt(z, camera, frame)` is the scale a backdrop plane at depth `z` needs to cover the frame through the whole move, with every sampled camera pose considered.
- Atmosphere backdrops accept an optional `z`. When given, the kit applies `coverScaleAt`, so a 200 mm lens can make a deep backdrop (−2,000 to −6,000 px) loom and slide (compression) without exposing its edges. Without `z`, rendering is unchanged.

### 14.7 Editor and agent surface
- CLI:
  - `velora edit lens --scene <id> --preset 200mm-telephoto [--hold framing|position] [--write]`;
  - `velora edit rack --scene <id> --from <target> --to <target> --at <ms> --duration <ms> [--breathing 0.018] [--write]`.

  Target shorthand: `layer:<id>`, `<surface>@u,v`, `depth:<px>`, and `<surface>:<anchor>` (15).
- Ops: `lens.apply` (compiles to `camera.set`, `focus.set` and key ops), `rack.add` (compiles to a clip with provenance; re-applying regenerates it).
- Guide capability `lensPresets`. `velora inspect --scene <id> --json` reports the signed focus distance and blur per depth layer at `--at`.
- Editor (after 06):
  - the Lens inspector row gains preset chips (24 drone · 50 · 85 · 200) and a hold-framing toggle;
  - the Focus tool's rack helper (06.7) uses `buildRackFocus`, with breathing on for presets, and can pick depth layers;
  - the inspector shows each layer's signed focus distance (front or back) and blur.

## Contracts (additive)
| Field / API | Type | Default | Notes |
|---|---|---|---|
| `LENS_PRESETS`, `lensPreset`, `applyLens`, `framingDistance` | core | — | `lensFor` unchanged |
| `CameraSchema.perspective` max | 40,000 | (unchanged default 1400) | Widened range only |
| `FocusSchema.focalLength` max | 4,000 | (unchanged default 50) | Widened range only |
| `camera.zoom` | [0.25, 8] | — | Post-projection, animatable |
| `buildRackFocus`, `rackReport` | core | — | Clip with provenance |
| `coverScaleAt`; atmosphere `z` | core, kit | — | |
| Ops `lens.apply`, `rack.add`; CLI `velora edit lens`, `velora edit rack` | | — | Dry run by default |

## Files
- Modified:
  - core: `src/core/{lens,scene,spatial,shots,motion,authoring,edit,cli-schema,schemas,index}.ts`;
  - react and kit: `src/react/{index.tsx,FocusFilter.tsx}`, `src/react/depth/*`, `src/kit/atmosphere.tsx`;
  - preview: `src/preview/overlays.tsx` (per-layer peaking);
  - project: `src/project/edit.ts`;
  - `scripts/check-architecture.mjs` (owners `LENS_PRESETS`, `lensPreset`, `applyLens`, `buildRackFocus`, `coverScaleAt`), `schemas/*`.
- Skills: `velora-cinematography`, `velora-scenes`, `velora-templates`

## Tests
- `tests/core/lens.test.ts`: preset numbers per stage; 200 mm valid at every aspect; `lensFor` golden unchanged; `framingDistance` equals the old `distanceFor` on the certification corpus.
- `tests/core/zoom.test.ts`: projection and framing with zoom; absent zoom gives identical CSS strings and projections.
- `tests/core/rack.test.ts`: landing sharpness; breathing equal to the request and keyframe-aligned with focus; add-clip layering over authored zoom; determinism.
- `tests/core/depth-focus.test.ts`: the veil σ solver (cumulative quadrature equals the per-layer target within 1e-6); front and back split by sign; band quantization for the projected map.
- `tests/browser/optics.spec.ts`:
  - **compression:** 200 mm with framing hold against 24 mm keeps the subject's projected width within ±1%; base-plane corner angles deviate < 0.3° from parallel at 200 mm and > 3° at 24 mm (keystone);
  - **rack:** a pull from a foreground modal to a background chart flips the measured blur (`data-velora-blur` and pixel variance); preview and export SHAs equal;
  - **projected:** the RouteFrame depth-map filter matches its band expectations;
  - **S6 fallback path** (forced): advisory present; no crash.

## Validation criteria
- [ ] A 200 mm rack focus from a floating modal to a background chart on a `laptop-14` stage:
  - the chart lands < 0.5 px;
  - the modal blurs to the computed σ;
  - breathing of 1.8% is visible as a subject scale change;
  - preview and export match.
- [ ] Every 4:5 and 9:16 template accepts `--set lens=200` and certifies.
- [ ] Goldens and existing template certification unchanged.

## Anti-patterns
- A second circle-of-confusion formula, or a per-shot fudge factor (use `sampleFocus` with physical focal length).
- Breathing animated separately from the focus curve.
- Magic perspective numbers in skills or templates instead of `lensPreset`.
- Applying the root zoom inside the 3D context, which would scale the world instead of the image.

## Definition of Done
Tests and validation green; S6 strategy recorded; schemas, guide and skills updated;
`plan/v2.1/artifacts/phase-14-exit.md` written.
