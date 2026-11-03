# Phase 01 — Motion model v3: properties, keyframe easing and animatables

## Goal
Everything the editor will let a person animate must first exist in the pure engine, with
schemas, renders and tests. The editor then only edits data the engine already understands.
This phase adds:
- per-keyframe auto-bezier;
- pivot, non-uniform scale and skew;
- per-element grade;
- animated CSS variables and colors;
- typed component props (*animatables*) that any React component can declare;
- a compiled evaluator fast enough for interactive drafts.

Everything is **additive**: no new field has a default that changes parsed output. The
Phase 00 goldens stay byte-identical.

## Prerequisites
- Phase 00 (goldens, baselines, layers).

## Scope IN
- `"auto"` keyframe easing.
- Transform additions: `scaleX/Y/Z`, `skewX/Y`, `originX/Y`.
- Leaf grade: `brightness`, `contrast`, `saturate`, `hueRotate`, `grayscale`.
- Style tracks (CSS custom properties, numeric with unit or color).
- Color channels; `useAnimatable`.
- Compiled evaluator cache.
- Recipe `editor` metadata block.
- Kit adoption, schemas, guide and skills.

## Scope OUT
- Clips, staggers, paths, links and constraints (02).
- Editing operations (03) and UI (04+).

## Tasks

### 01.1 Auto-bezier keyframes — `src/core/motion.ts`
- `MotionKeyframeSchema.easing` becomes `KeyframeEasingSchema = EasingSchema | "auto"`, with the default `"cinematic"` unchanged.
  - `"auto"` is valid **only** on keyframes. `EasingSchema` itself (used by track `ease`, transitions and reveals) does not gain it, and `applyEasing` is unchanged.
- **Semantics:** a segment whose start keyframe is `"auto"` evaluates as a cubic Hermite between its two keyframes. Tangents come from the Fritsch–Carlson monotone rule over the whole track (the same rule `smoothInterpolate` uses), so the curve passes through each keyframe with continuous velocity and no overshoot. Neighboring non-auto segments keep their own easing. This matches After Effects' per-keyframe "auto bezier".
- Refactor: extract `monotoneTangents(frames)` from `smoothInterpolate`, so smooth tracks and auto segments share one tangent implementation. The smooth-track golden must not move.
- `easingOvershoots` treats `"auto"` as non-overshooting. `reviewAuthoring`'s `smooth-easing-ignored` advice also fires for `"auto"` keyframes on smooth tracks.

### 01.2 Transform additions — `src/core/scene.ts`, `src/core/spatial.ts`, `src/react/index.tsx`
- `TransformSchema` gains **optional, default-less** fields:

  | Field | Range | Meaning |
  |---|---|---|
  | `scaleX`, `scaleY`, `scaleZ` | (0, 100] | Multiply the uniform `scale` per axis |
  | `skewX`, `skewY` | [−89, 89] deg | Shear in the surface plane |
  | `originX`, `originY` | [−100, 200] % | Pivot for rotation, scale and skew; the default stays 50/50 (`transformOrigin: "50% 50%"`) |

- `transformToCss` appends `scale3d(...)`, then `skew(...)`, after the current string **only when present**, so today's strings are unchanged.
- `matrixFor` mirrors the CSS order exactly.
- `evaluateScene` applies the pivot as `T(o) · M · T(−o)`, where `o` is the origin offset from the element center computed from the node's measurement.
- `Surface` sets `transformOrigin` from `originX/Y` when present.
- These fields join `SurfaceMotionSchema` automatically (it extends `TransformSchema`), so they are animatable.
- `CameraSchema` is untouched.

### 01.3 Leaf grade — `SurfaceMotionSchema` visual properties
- Add `brightness` [0, 4], `contrast` [0, 4], `saturate` [0, 4], `hueRotate` [−360, 360] deg and `grayscale` [0, 1] to `SURFACE_VISUAL_PROPERTIES`. As with opacity, blur and clip, they style the **content leaf only**, so they can't flatten 3D.
- `leafFilter` composes the filters in a fixed order:
  1. focus kernel (url or uniform blur);
  2. artistic blur;
  3. `brightness() contrast() saturate() hue-rotate() grayscale()`, emitting only the functions present.

  With no grade properties, the filter string is byte-identical to today.
- Scene's exclusion of visual keys from node transforms (`visualKeys`) covers the new keys automatically through `SURFACE_VISUAL_PROPERTIES`.

### 01.4 Style tracks: CSS variables and colors — new `src/core/color.ts`, `motion.ts`
- New core owner `src/core/color.ts` (`parseCssColor`, `mixColors`), pure:
  - **Parse:** hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklab()`, `oklch()` and `transparent`. Named colors are rejected with a "use hex" hint. Kit `tint` (`color-mix`) stays a kit concern; it is presentation, not interpolation.
  - **Interpolate:** in **OKLab** with premultiplied alpha, then gamut-clamp to sRGB.
  - **Output:** canonical `rgb(R G B / A)` with fixed precision (3 decimals), so frames are deterministic.
- New track target `{ kind: "style", id: <surface id> }`. The property must match `^--[a-zA-Z][a-zA-Z0-9-]{0,63}$`. A track is **either**:
  - numeric: `MotionKeyframeSchema` keyframes, plus an optional track `unit` (`px | % | deg | em | rem | vw | vh | ""`);
  - color: `{ timeMs, value: <css color>, easing }` keyframes, with no `unit` and no `noise`.

  Smooth interpolation is allowed on numeric style tracks. It is rejected on color tracks, which evaluate as segments.
- `MotionState` gains `styles: Record<surfaceId, Record<"--name", string>>`. `Surface` writes these custom properties on its outer element. Custom properties don't create stacking or flattening, and they cascade to descendants like ordinary CSS, so components consume them with `var(--name)`.
- `reviewAuthoring`: the `unknown-surface` check extends to style targets.

### 01.5 Typed animatables (full control of component props)
- New core owner `src/core/animatable.ts`:
  - `AnimatableSpecSchema` is a record of up to 64 props, each one of:
    - `{type:"number", default, min?, max?, step?, unit?, label?}`;
    - `{type:"color", default}`;
    - `{type:"boolean", default}`;
    - `{type:"enum", options:[…≤32], default}`.
  - `coerceAnimatable(spec, prop, channelValue)`:
    - number: clamp;
    - boolean: true when ≥ 0.5;
    - enum: round to an index (hold);
    - color: passthrough of the evaluated color.
  - The animatable id pattern is `^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*$`, and channel ids are `<animatable id>.<prop>`.
- Channel tracks accept color keyframes as well. `MotionState` gains `colorChannels: Record<string, string>`. `useChannel` (numbers) is unchanged.
- React `useAnimatable(id, spec, { channels? })` in `src/react/animatable.ts`:
  - **Returns** typed values at scene time: the channel value when a track exists, otherwise the spec default.
  - **Aliases:** `channels` maps a prop to an existing channel id (`{ x: "cursor-x" }`), so kit components keep today's channel names.
  - **Registers** `{ id, spec, owner }` in the Scene registry, where the owner is the nearest Surface. It stores no React instances or host data.
  - **Diagnoses** the same id declared twice with different specs as a Scene issue.
- `registry.ts` gains an `animatables` map, read-only for consumers. The Phase 04 inspector hook reads it.

### 01.6 Compiled evaluator — `src/core/motion.ts`
- `evaluateMotion`, `motionDuration`, `motionTime` and `loopSeam` keep their signatures. Internally, a `WeakMap<object, Compiled>` caches the parse result plus per-track compiled data (sorted keyframes, precomputed tangents, parsed colors).
- Contract: motion inputs are treated as **immutable**. Callers that mutate in place must pass a new object.
  - The editor store (04) uses structural sharing.
  - Tests deep-freeze inputs.
  - A DEV-only fingerprint check (track count plus keyframe count plus duration) warns once when a cached object was mutated.
- Target: at least **5× faster** than the Phase 00 baseline at 300 tracks, with identical outputs (goldens).

### 01.7 Recipe `editor` block — `src/core/recipes.ts`
- `SceneRecipeSchema` gains an optional strict `editor` block that the renderer ignores:
  - `labels: Record<id, string ≤ 80>`;
  - `colors: Record<id, "red"|"orange"|"yellow"|"green"|"teal"|"blue"|"purple"|"gray">`;
  - `locked: id[]`;
  - `markers: [{ atMs, label ≤ 80 }] ≤ 512`.
- `presentPreview` never reads it. JSON Schema and guide document it as editor-owned metadata that agents may also write.

### 01.8 Kit adoption
- Kit components that read channels (`Cursor`, `ScrollFrame`, `RouteFrame`, atmosphere) declare them through `useAnimatable` with `channels` aliases. Existing channel ids keep working byte-identically.
- Kit components with prop-driven reveals (`Title`, `Counter`, `Typewriter`, `Callout` via `useReveal`) accept an optional animatable `<id>.reveal` (`progress` 0–1). When a track exists, it overrides the prop timing. Otherwise behavior is unchanged.

### 01.9 Schemas, guide and skills
- Regenerate `schemas/scene-recipe.schema.json` (style tracks, color keyframes, the transform and grade additions, `editor` block, `"auto"`).
- Guide capabilities: auto easing, the transform and grade tables, style tracks, animatables. The guide version stays 3; the v4 bump is in Phase 11.
- Skills: `velora-motion-design` (auto-bezier, color in OKLab, animatables), `velora-scenes` (pivot, skew, grade, style vars), `velora-typography` (reveal override).

## Contracts (all additive; old files stay valid)
| Field | Type | Default | Notes |
|---|---|---|---|
| `keyframes[].easing` | `EasingSchema \| "auto"` | `"cinematic"` | `"auto"` only on keyframes |
| `transform.scaleX/Y/Z` | number (0,100] | — | multiplies `scale` |
| `transform.skewX/Y` | deg [−89,89] | — | |
| `transform.originX/Y` | % [−100,200] | — (50/50 behavior) | pivot |
| surface `brightness/contrast/saturate` | [0,4] | — | leaf only |
| surface `hueRotate` / `grayscale` | deg / [0,1] | — | leaf only |
| target `style` | `{kind:"style", id}` + `--name` property | — | numeric (+`unit`) or color keyframes |
| channel color keyframes | css color | — | `colorChannels` |
| `editor` (recipe) | labels, colors, locked, markers | — | renderer ignores |
| React `useAnimatable(id, spec)` | typed values | spec defaults | registers in the Scene registry |

Forward-compatibility note: recipes using any of these need Velora ≥ 1.1. Older CLIs reject the unknown fields because the objects are strict.

## Files
- New: `src/core/color.ts`, `src/core/animatable.ts`, `src/react/animatable.ts`
- Modified: `src/core/{motion,scene,spatial,recipes,authoring,schemas,index}.ts`, `src/react/{index.tsx,registry.ts}`, `src/kit/{interaction,atmosphere,type,brand,RouteFrame,ScrollFrame}.tsx`, `scripts/check-architecture.mjs` (owners: `parseCssColor`, `mixColors`, `AnimatableSpecSchema`, `useAnimatable`), `schemas/*`
- Skills: `velora-motion-design`, `velora-scenes`, `velora-typography`

## Tests
- `tests/core/motion.test.ts`:
  - goldens unchanged;
  - auto segments: C1 at interior keyframes (finite-difference velocity jump < ε), no overshoot, mixed with eased segments;
  - smooth-track output unchanged after the tangent refactor.
- `tests/core/color.test.ts`: parse matrix incl. rejections; OKLab endpoints exact; reference midpoints (red→blue, white→transparent premultiplied); deterministic output strings.
- `tests/core/spatial.test.ts`:
  - `matrixFor`/`transformToCss` parity for skew, scaleXY and origin;
  - a browser test compares `DOMMatrix(getComputedStyle(el).transform)` against `matrixFor` within 1e-6 for random transforms.
- `tests/core/animatable.test.ts`: spec validation, coercion and enum hold.
- `tests/react/animatable.test.tsx`: values at time, aliases, registry entries, conflicting-spec diagnostic.
- `tests/react/scene.test.tsx`:
  - the grade filter order;
  - style vars on the outer element, inherited by a nested Surface;
  - no filter or style change when the fields are absent.
- `tests/core/perf.test.ts` (or the performance config): the compiled evaluator speedup against the recorded baseline; outputs identical with the cache on and off.
- `tests/browser/motion-v3.spec.ts`: pixel checks for a pivot rotation (corner pivot), skew, a color var animating a real component background, and a grade fade.

## Validation criteria
- [ ] All Phase 00 goldens unchanged.
- [ ] An animated `--accent` color drives a host component's background through `var(--accent)` in both preview and export (frame SHAs equal).
- [ ] `useAnimatable("hero-counter", {value:{type:"number",default:0,max:1280}})` animates a counter from a recipe channel track with no component edits beyond the hook.
- [ ] Evaluator ≥ 5× faster at 300 tracks, with outputs identical.

## Anti-patterns
- Giving new fields defaults (changes parsed output and goldens).
- Color interpolation in sRGB (muddy midpoints), or locale and float formatting that varies by machine.
- Grade or style applied to spatial groups through `filter` (flattens 3D). Custom properties are fine; filters are leaf-only.
- A second tangent implementation, or a second evaluator path for "fast mode".
- Storing component instances or host data in the animatable registry.

## Definition of Done
Tests and validation green, goldens untouched, schemas regenerated, guide and skills updated,
`velora skills check` clean, and `plan/v2.1/artifacts/phase-01-exit.md` written.
