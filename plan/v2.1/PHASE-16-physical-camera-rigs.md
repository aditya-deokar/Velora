# Phase 16 — Physical camera rigs: mass, banking and inertia

## Goal
Replace robotic linear and Bézier camera moves with rigs that feel operated:
- **`drone-flyover`:** a smooth 3D spline flight over and through elevated UI, with spring-damped momentum and natural horizon banking.
- **`telephoto-parallax-orbit`:** a 200 mm lens locked dead-center on a hero component while the camera orbits, so foreground layers and deep backdrops separate dramatically.
- **`whip-pan-macro`:** a fast spring transition between two components, with directional velocity blur and an organic settle on arrival.

Physics runs **once, offline, at a fixed step**, and bakes into ordinary data: position paths
(02.3), clips (02.1) and constraints (02.5, 15.3), with provenance. The evaluator never integrates
anything, so every frame is still a pure function of time.

## Audit (current state)
- `buildShot` moves (`src/core/shots.ts`) are two-key or few-key eased tracks (`smooth(…)`, `cinematic`).
  - `whip` is a single `expo.out` key on `x`.
  - `handheld-push` is noise.
  - Nothing has mass, banking or spline flight. Spatial paths arrive in 02.3; orbit rigs in 02.6.
- `easing.ts` has a damped spring as a *segment easing* (`spring: { stiffness, damping, mass }`). Nothing *follows* a moving target with lag.
- Export has true shutter motion blur (`shutterSamples`, `--motion-blur`, 180° at master). Preview has none, and `standard` quality has none.

## Prerequisites
- Phase 02 (paths, clips, `lookAt`, orbit rig), Phase 14 (lens presets, `zoom`, framing hold), Phase 15 (element targets, the `frame` constraint), Phase 13 (layer elevations for clearance).
- Decision D13.
- Editor tasks (16.6) need Phases 06 and 07.

## Scope IN
- The rig physics core: follower, banking, bake and simplify, smoothness metrics.
- The three rigs; velocity blur in the look.
- Shot-kind additions; ops, CLI, editor, advisories and skills.

## Scope OUT
- Physics engines and collision solvers. Clearance is a check, not a solver.
- Runtime simulation of any kind.
- Radial (zoom) motion blur (follow-up).

## Tasks

### 16.1 Rig physics core — new owner `src/core/rigs.ts` (pure, zod-only)
- **Follower.** `simulateFollower(targetPath, { frequencyHz, dampingRatio }, { stepHz: 240 })` integrates `x″ = ω²(target(t) − x) − 2ζω x′` with semi-implicit Euler at a **fixed 240 Hz** step from t = 0.
  - It uses no adaptive steps and no wall clock.
  - The result is rounded to 1e-3 before baking, so the same input gives the same bytes on every machine.
- **Mass vocabulary:** `light` (1.6 Hz, ζ 0.9), `medium` (1.0 Hz, ζ 0.95), `heavy` (0.6 Hz, ζ 1.0). Authors may pass Hz and ζ directly.
- **Banking.** Roll `φ = clamp(bankGain · a_lat, ±maxBankDeg)`, where `a_lat` is the camera's acceleration along its own right vector. It passes through the same follower, so the horizon leans into a turn, lags naturally, and returns to level on straight runs.
  - `maxBankDeg`: subtle 6, standard 9, dramatic 12.
  - Roll is emitted in an **add clip** (02.1), so it layers over any authored `rotateZ`.
- **Bake.** The simulated pose is sampled at 60 Hz into a camera `position` path (02.3, explicit tangents) plus rotation or `lookAt` weight tracks. A deterministic Ramer–Douglas–Peucker pass (tolerance 0.25 px / 0.05°) then keeps files small.
- **Provenance.** Each rig is a clip with `source: { rig, version, params }`. Re-applying with new params regenerates it in one undo step; hand-edited rig clips drop provenance with a notice (07.4 rule).
- **Metrics.**
  - `rigSmoothness(definition)`: peak jerk and velocity discontinuities at bake joins.
  - `rigClearance(definition, layers)`: the minimum distance from the camera to any lifted layer plane (13) and to the camera plane, the same check `framingReport`'s `depthMargin` makes.

### 16.2 `drone-flyover` — `buildDroneFlyover`
- Params:
  - `waypoints: (ElementTarget | point)[]` (2–12);
  - `altitude` (px above each waypoint's face);
  - `durationMs` or `speed`;
  - `lens = "24mm-drone"`, `mass = "medium"`, `bank = "subtle"`;
  - `through?: boolean`, `lookAhead = 0.35` (fraction of a segment).
- The spline is Catmull–Rom through the waypoints at altitude, converted to Bézier segments (02.3) with `rove: true` (constant speed). The follower adds momentum: the camera eases into the flight and carries through corners.
- Orientation is the path tangent (`orient: yaw-pitch`) blended with a look-ahead `lookAt` toward the next waypoint (weight track).
- `through: true` dips between floating and control tiers. The builder rejects the result when `rigClearance` is under the margin (default 40 px), rather than letting the camera clip a layer.
- Focus: `focusFollow` on the nearest waypoint target for 50 mm and up; deep focus (f/8) for 24 mm.

### 16.3 `telephoto-parallax-orbit` — `buildTelephotoOrbit`
- Params:
  - `target: ElementTarget`, `lens = "200mm-telephoto"`;
  - `arcDeg` (subtle 24, standard 36, dramatic 50);
  - `axis: "horizontal" | "vertical" | { yaw, pitch }`;
  - `durationMs`, `mass = "heavy"`, `fill = 0.55`, `depthBoost?`.
- The builder composes:
  - `buildOrbitRig` (02.6) around the target's world point;
  - `lookAt` and `focusFollow` on the target (15.3), plus a `frame` constraint at `fill`;
  - a framing hold for the lens (14.3);
  - the follower on the orbit angle, for a soft start and a heavy stop.
- **Where the parallax comes from.** With framing held, on-screen parallax between layers is about `elevation · sin(arc) · framing scale`, which is nearly lens-independent. The telephoto removes keystone, so layers slide as flat cards with zero edge warping. The *dramatic* separation comes from deep backdrops (−2,000 to −6,000 px), which 200 mm magnifies through compression. The builder therefore:
  1. uses or places backdrop planes at depth, with `coverScaleAt` (14.6);
  2. optionally ramps `elevation` (13.5) by `depthBoost` during the orbit;
  3. returns the expected peak parallax per layer for review and certification.

### 16.4 `whip-pan-macro` — `buildWhipPan`
- Params:
  - `from: ElementTarget`, `to: ElementTarget`;
  - `lens = "85mm-portrait"` (or `200mm-telephoto`);
  - `durationMs ≤ 900`, `mass = "light"`, `settle: "none" | "organic" = "organic"`;
  - `fill = 0.6`, `blur: "auto" | "off" = "auto"`.
- The aim travels from `from` to `to` on an under-damped follower (ζ ≈ 0.75 with `organic`). Velocity peaks mid-way, and the arrival overshoots ≤ 2% of the angular travel, then settles. With `settle: none`, ζ = 1.
  - At `subtle`, camera-overshoot advisories never fire, because the threshold is respected.
- `focusFollow` switches from `from` to `to` at the velocity peak, inside the blur, so focus lands sharp on arrival. A `frame` constraint arrives framed on `to` at `fill` ("macro").
- **Velocity blur** (directional, in preview and export alike) is a new optional look field, `LookSchema.velocityBlur?: { shutterMs, maxPx }`. `buildWhipPan` writes `{ shutterMs: 20.8, maxPx: 24 }`, which is 180° at 24 fps, stored as milliseconds so every fps renders it the same.
  - `velocityBlurAt(definition, t)` (core, pure) projects the focus target, or the frame center on the focal plane, at `t` and `t − shutterMs`. The screen displacement gives an anisotropic Gaussian (`feGaussianBlur stdDeviation="sx sy"`) that `LookLayer` applies to the frame as a post effect, outside the 3D context. Radial components are ignored; displacement is capped at `maxPx`.
  - When an export uses shutter accumulation (`--motion-blur` or `master`), the export tells the capture page through the capture bridge (an additive `configure({ velocityBlur: false })` call before the first seek), so blur is never doubled. The manifest records which blur was used.

### 16.5 Vocabulary and integration
- `SHOT_KINDS` gains `drone-flyover`, `telephoto-orbit` and `whip-pan-macro`. The enum change is additive, and existing kinds' outputs are unchanged (certification goldens).
- `ShotInputSchema` gains optional `targets` / `focusTarget` (15.1), `lensPreset` and `mass`.
- `buildShot` routes these kinds to the rig builders. `framingReport` adds `rigSmoothness`, `rigClearance` and velocity-blur peaks.
- Templates may adopt the rigs (for example a telephoto hero or a whip to the CTA) and are certified per stage (12.7).
- Ops: `rig.apply { kind, params }` (compiles to a clip plus constraints with provenance) and `rig.update { clipId, params }`.
- CLI: `velora edit rig --scene <id> --kind telephoto-parallax-orbit --target hero:revenue-card [--arc 36] [--mass heavy] [--write]`. Kinds and params come from `velora guide --json` (`capabilities.rigs`).

### 16.6 Editor surface (after Phases 06 and 07)
- The Camera tool (C) gains rig chips with a parameter popover. Rigs join the camera-move library (07.5) with the framing verdict inline.
- The motion-path overlay (06.4) shows the baked path with speed ticks, bank indicators and clearance warnings. Dragging a waypoint re-applies the rig, which is one undo step.

### 16.7 Review advisories — `src/core/authoring.ts`
| Code | Fires when |
|---|---|
| `rig-jerk` | Peak jerk above the threshold for the mass, or a velocity discontinuity at a join |
| `rig-clearance` | The camera passes within the margin of a lifted layer or the camera plane |
| `bank-excess` | Roll beyond `maxBankDeg` (for example after hand edits) |
| `double-motion-blur` | `velocityBlur` is set and a render requests shutter accumulation (informational: velocity blur is disabled) |
| `whip-unreadable` | A whip settles less than 300 ms before a cut in a composition |

## Contracts (additive)
| Field / API | Type | Notes |
|---|---|---|
| `simulateFollower`, `rigSmoothness`, `rigClearance` | core | Fixed-step, pure |
| `buildDroneFlyover`, `buildTelephotoOrbit`, `buildWhipPan` | core | Return clips plus constraints with provenance |
| `SHOT_KINDS` + 3 kinds; `ShotInputSchema` `targets`, `focusTarget`, `lensPreset`, `mass` | core | Existing kinds unchanged |
| `LookSchema.velocityBlur` | `{shutterMs, maxPx}` | Disabled under shutter accumulation |
| Ops `rig.apply`, `rig.update`; CLI `velora edit rig` | | Dry run by default |

## Files
- New: `src/core/rigs.ts`
- Modified:
  - core: `src/core/{shots,looks,spatial,authoring,templates,export,edit,cli-schema,schemas,index}.ts` (`export.ts`: the capture bridge's `configure`);
  - preview and react: `src/preview/ScenePreview.tsx` (`LookLayer` velocity blur), `src/react/capture.ts` (disable under accumulation);
  - export: `src/export/{commands,services}.ts` (manifest);
  - project: `src/project/edit.ts`;
  - `scripts/check-architecture.mjs` (owners `simulateFollower`, `buildDroneFlyover`, `buildTelephotoOrbit`, `buildWhipPan`, `velocityBlurAt`), `schemas/*`.
- Skills: `velora-cinematography`, `velora-motion-design`, `velora-templates`, `velora-export`

## Tests
- `tests/core/rigs.test.ts`:
  - **determinism:** identical bakes, byte for byte, across runs;
  - **step independence:** a 240 Hz bake and a 480 Hz bake agree within 0.5 px / 0.05°;
  - **continuity:** C1 at every bake join;
  - **banking:** sign follows turn direction, level on straight runs, clamp respected, add-clip layering;
  - **whip:** overshoot ≤ 2% with `organic` and 0 with `none`;
  - **simplifier:** stays within tolerance;
  - provenance round-trip; existing `SHOT_KINDS` outputs unchanged.
- `tests/core/velocity-blur.test.ts`: zero for a static camera; proportional to angular velocity; capped; identical at 24, 30 and 60 fps; disabled under accumulation.
- `tests/browser/rigs.spec.ts`:
  - **telephoto orbit** on an anchor: centered ±0.5 px and sharp in every frame;
  - **drone flyover** through a three-tier dashboard: no clearance advisories, two renders with identical SHAs;
  - **whip pan:** mid-move frames show directional blur (horizontal variance ≫ vertical); the arrival frame is sharp on `to`;
  - preview and export match for every rig.

## Validation criteria
- [ ] Each rig, applied by CLI, produces plain recipe data (paths, clips, constraints) that renders identically twice and identically in preview and export.
- [ ] The drone path shows no visible keyframes: no velocity discontinuity at waypoints, and jerk under the threshold.
- [ ] The telephoto orbit's measured peak parallax per layer matches the builder's report within 5%.

## Anti-patterns
- Runtime physics: integrators in React or in evaluation, `requestAnimationFrame` loops, or wall clocks.
- Banking that replaces authored roll instead of adding to it.
- Motion blur faked with per-frame randomness, or computed from the preview frame rate.
- Rigs that guess component positions instead of taking element targets.

## Definition of Done
Tests and validation green; skills updated; `plan/v2.1/artifacts/phase-16-exit.md` written with
determinism evidence.
