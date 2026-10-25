# Phase 01 — Motion Engine v2 (the cinematographer's toolkit)

## Goal
Give the engine the motion vocabulary that professional camera work and motion design rely
on, so templates (Phase 02) and the kit (Phase 05) can be expressive without hacks:
- graph-editor-grade easing
- continuous camera paths
- real lens language
- handheld/float texture
- one timeline driving component state
- true masks
- editor autocomplete

Everything stays pure, deterministic, frame-clock driven and **backward compatible**:
existing recipes must evaluate byte-identically.

## Prerequisites
- Phase 00 complete.

## Scope IN
- Easing library, smooth multi-waypoint paths, animatable perspective + lens helpers, seeded noise, `loop`, channel tracks, per-surface `blur` and clip masks.
- JSON Schemas and `$schema` support.
- True-mask upgrades of the approximated transitions and kinetic presets.
- Guide capability updates; skills updates.

## Scope OUT
- Shot builders and templates (02), studio (03), motion blur (04), kit components (05).

## Tasks

### 01.1 Easing library — `src/core/easing.ts` (new owner: `EasingSchema`, `applyEasing`)
- `EasingSchema` = union of:
  - legacy names `linear | easeInOut | cinematic` (exact current math: `easeInOut` = smoothstep, `cinematic` = `cinematicProgress`);
  - `hold` (value jumps at segment end);
  - family names `{sine,quad,cubic,quart,quint,expo,circ,back,elastic,bounce}.{in,out,inOut}` (standard Penner forms; GSAP-equivalent shapes);
  - `{cubicBezier:[x1,y1,x2,y2]}` with x1/x2 ∈ [0,1], solved by Newton iteration plus the bisection fallback pattern of `cinematicTimeAtProgress` (`src/core/motion.ts:218`);
  - `{spring:{stiffness,damping,mass}}`: a closed-form damped harmonic oscillator. Time is normalized so the curve reaches the 0.1% settle band at the segment end, and it returns exactly 1 at progress 1. Under-damped springs overshoot by design.
  - `{steps:{count, jump?: "end"|"start"}}`.
- `applyEasing(easing, p)`: pure, total, returns exactly 0 at p=0 and 1 at p=1, and is finite for all inputs.
- `MotionKeyframeSchema.easing` becomes `EasingSchema` with default `"cinematic"` unchanged. `motion.ts` `interpolate` calls `applyEasing`.
- `src/core/gsap.ts`: lossless map. `power1→quad`, `power2→cubic`, `power3→quart`, `power4→quint`; `sine`, `expo`, `circ`, `back`, `elastic`, `bounce`; `steps(n)`. Only `rough`, `slow`, `expoScale` and `CustomEase` remain rejected, with an accurate message. Remove the inaccurate "cannot replay on the frame clock" claim.
- `reviewAuthoring` advice (non-blocking): overshooting easings (`back`, `elastic`, under-damped `spring`) on **camera** tracks read as jitter — "confirm intent".

### 01.2 Smooth paths — track `interpolation: "segments" | "smooth"`
- `"segments"` (default) is the current per-segment behavior.
- `"smooth"` uses monotone cubic Hermite (Fritsch–Carlson) over non-uniform keyframe times. It is C1-continuous through every waypoint with no overshoot between keyframes, and per-keyframe easing is ignored.
- Optional track-level `ease` (an `EasingSchema` value) remaps time across the whole track span, so a five-waypoint camera rail accelerates once and settles once. With `ease` omitted, each value is reached at its keyframe time.
- `reviewAuthoring` advice: a smooth track whose keyframes carry non-default easings ("ignored").

### 01.3 Lens language
- `CameraMotionSchema` (`motion.ts:20`) adds `perspective`, inheriting the 100–10000 bounds. The Scene root already applies the validated, motion-merged perspective (`src/react/index.tsx:194`). Verify focus math stays consistent (point depth = perspective − camera-space z).
- New `src/core/lens.ts`, using the full-frame 24 mm sensor height:
  - `perspectiveForFocalLength(mm, frameHeight) = frameHeight · mm / 24`;
  - its inverse `focalLengthForPerspective`;
  - `lensFor(mm, frameHeight) → {perspective, focus: {focalLength: mm}}`, so one number drives both field of view and depth of field.
- Guide capabilities gain a lens table (24/35/50/85/135 mm → perspective at 1080/980 px heights).

### 01.4 Texture and loops
- Track `noise: {amplitude, frequency, octaves (1–4), seed}`. Seeded 1-D gradient noise (new `src/core/noise.ts`, permutation from `createRng` in `src/core/random.ts`) is added to the evaluated value. Deterministic in time and seed; used for handheld and float motion.
- `MotionSchema.loop: boolean` (default false). Preview playback wraps; export still renders exactly `durationMs`.
- `loopSeam(motion)` returns the max per-track |value(0) − value(duration)|. `reviewAuthoring` advises when `loop` is true and the seam is non-zero.

### 01.5 Channel tracks — one timeline drives component state
- New `MotionTrackSchema` option: `{target:{kind:"channel", id}, property:"value", keyframes, …}`.
- `MotionState` gains `channels: Record<string, number>`.
- `src/react/index.tsx`: Scene provides channels through context, and `useChannel(id, fallback = 0)` returns the evaluated value. It works for both scene timelines and the composition player. Components consuming a channel with no track get an **advisory** diagnostic that does not block capture.
- Use cases: cursor x/y/press, counters, typewriter character count, RouteFrame scroll, light-sweep position, highlight intensity.
- Guide `capabilities.tracks` derivation (`src/core/authoring.ts:137`) must handle the literal `value` property.

### 01.6 Surface visual properties (content-leaf only)
- `SurfaceMotionSchema` (`motion.ts:17`) adds:
  - `blur` (0–64 px): an artistic blur composed with the focus kernel. Uniform blur combines in quadrature into one `blur()`; otherwise `url(#focus) blur(n)`.
  - `clipTop | clipRight | clipBottom | clipLeft` (0–100 %): `clip-path: inset(...)`.
  - `clipRadius` (0–150 %): `clip-path: circle(r at 50% 50%)`; takes precedence over inset.
- Scene (`src/react/index.tsx:110-116`) must exclude these keys, like `opacity`, when building node transforms, because `TransformSchema` is strict. Leaf style (`:278`) applies them. Static initial values come from the first keyframe.
- These are true masks on visual leaves, which the architecture permits ("clipping on content leaves"). Upgrade:
  - `wipe-mask` and `iris-mask` in `src/core/transitions.ts` to true masks (drop the "approximated" warnings);
  - `mask-reveal` in `src/core/typography.ts` to a true horizontal reveal.

### 01.7 JSON Schemas and editor autocomplete
- New `scripts/build-schemas.mjs` runs `z.toJSONSchema(schema, {io: "input"})` to produce `schemas/scene-recipe.schema.json` and `schemas/composition.schema.json`. Template and brand schemas are added in 02/05.
- Wired into `build:package`. `schemas/` is added to package.json `files` and the `scripts/release.mjs` allowlist.
- `SceneRecipeSchema` and `CompositionSchema` accept an optional `$schema` string.
- `new-scene.mjs` and later scaffolders write `"$schema": "../../../node_modules/@adityadeokar/velora/schemas/scene-recipe.schema.json"`.

### 01.8 Guide and skills
- Guide `capabilities`: easing catalog, smooth interpolation, lens table, noise, loop, channels, visual properties.
- Update the `motion` concept mechanism text.
- Skills: `velora-gsap` (lossless map), `velora-scenes` (smooth rails, lens), `velora-transitions` (true masks), `velora-typography` (true mask-reveal).

## Contracts (all additive; old files stay valid)
| Field | Type | Default | Notes |
|---|---|---|---|
| `keyframes[].easing` | `EasingSchema` | `"cinematic"` | legacy names unchanged |
| `tracks[].interpolation` | `"segments" \| "smooth"` | `"segments"` | |
| `tracks[].ease` | `EasingSchema` | — | smooth tracks only |
| `tracks[].noise` | `{amplitude,frequency,octaves,seed}` | — | additive to value |
| `motion.loop` | boolean | `false` | preview wraps |
| camera track `perspective` | number 100–10000 | — | dolly-zoom |
| surface `blur`, `clip*` | numbers | — | content leaf only |
| target `channel` | `{kind:"channel",id}` + `"value"` | — | `useChannel` |
| recipe/composition `$schema` | string | — | editor autocomplete |

Forward-compat note: older CLIs reject the new optional fields (strict objects). Document
"recipes authored with v0.2+ require v0.2+".

## Files
- New: `src/core/{easing,lens,noise}.ts`, `scripts/build-schemas.mjs`
- Modified: `src/core/{motion,gsap,transitions,typography,authoring,recipes,composition,index}.ts`, `src/react/index.tsx`, `src/react/FocusFilter.tsx` (filter chaining), `scripts/check-architecture.mjs` (owners), package.json, `scripts/release.mjs`
- Skills: `velora-gsap`, `velora-scenes`, `velora-transitions`, `velora-typography`

## Tests
- `tests/core/easing.test.ts`:
  - endpoint exactness for every easing;
  - monotonicity where defined;
  - CSS cubic-bezier parity (`ease`, `ease-in-out` reference values within 1e-4);
  - spring settle and overshoot shapes;
  - GSAP parity samples.
- `tests/core/motion.test.ts`:
  - **back-compat golden**: `evaluateMotion` output is identical for every recipe under `tests/`, `local-project/` and `skills/velora/templates/` at 25 sample times;
  - smooth-path C1 continuity (finite-difference velocity jump < ε at waypoints);
  - noise determinism;
  - channel evaluation.
- `tests/core/lens.test.ts`: the formula, round-trip, and bounds.
- `tests/react/scene.test.tsx`: blur/clip styles on leaves; transforms exclude visual keys; `useChannel`.
- `tests/browser/*`: pixel tests for animated perspective (subject size constant while background warps), clip reveal and channel-driven text.
- `tests/core/schemas.test.ts`: generated JSON Schemas accept every valid fixture and reject known-invalid ones.

## Validation criteria
- [ ] Every pre-existing recipe evaluates byte-identically.
- [ ] A five-waypoint smooth camera rail shows no velocity zero-crossings between its first and last keyframes.
- [ ] A dolly-zoom fixture keeps subject projected width within ±1% while background perspective changes.
- [ ] GSAP `back.out`, `elastic.out` and `steps(4)` convert and validate.
- [ ] VS Code autocompletes a recipe via `$schema` (manual check, documented in the exit report).

## Anti-patterns
- A second easing evaluator outside `easing.ts`; per-component clocks; reading `Date.now()` or `performance.now()` in evaluation.
- Applying blur or clip to spatial groups (it flattens 3D); these properties are leaf-only.
- Silently changing legacy easing math.

## Definition of Done
All tests and validation green. Guide and skills updated and `velora skills check` clean.
`plan/v2/artifacts/phase-01-exit.md` written.
