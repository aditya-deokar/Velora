# Phase 01 exit report: motion model v3

Date: 2026-11-14. Branch `feat/v2.1-motion-graphics-suite-plan` (uncommitted working tree on `88d8b7a`).
Machine: Windows 11 (win32-x64), Node 24.12.0.

## What shipped
| Task | Implementation |
|---|---|
| 01.1 Auto-bezier | `KeyframeEasingSchema = EasingSchema \| "auto"` (keyframes only; `EasingSchema` and `applyEasing` unchanged). `"auto"` segments are cubic Hermite with whole-track Fritsch–Carlson tangents from the new shared owner `monotoneTangents`, which smooth tracks now use too. `easingOvershoots("auto") === false`. Color keyframes reject `"auto"`. |
| 01.2 Transforms | Optional, default-less `scaleX/Y/Z`, `skewX/Y` and `originX/Y` on `TransformSchema`. `transformToCss` appends `scale3d()` then `skew()` only when present; `matrixFor` mirrors the order; `evaluateScene` pivots as `T(o)·M·T(−o)`; `Surface` sets `transformOrigin` (`transformOriginCss`). |
| 01.3 Grade | `brightness`, `contrast`, `saturate`, `hueRotate` and `grayscale` in `SURFACE_VISUAL_PROPERTIES`, applied to the content leaf after focus and artistic blur, in a fixed order. With no grade the filter string is unchanged. |
| 01.4 Style and color | New owner `src/core/color.ts` (`parseCssColor`, `mixColors`, plus `formatCssColor` and `colorDifference`): hex, rgb/rgba, hsl/hsla, oklab, oklch and transparent; named colors rejected with a hex hint; OKLab premultiplied interpolation; canonical `rgb(R G B / A)` with three decimals. Style tracks (`{kind:"style",id}`, `--name`, numeric with `unit` or color keyframes) and color channel keyframes. `MotionState.styles` and `colorChannels` appear **only** when such tracks exist, so existing outputs are byte-identical. Surfaces write custom properties on their outer element. Unregistered style targets are diagnosed, and `reviewAuthoring` flags `unknown-surface` for them. |
| 01.5 Animatables | New owner `src/core/animatable.ts` (`AnimatableSpecSchema`, `coerceAnimatable`, `ANIMATABLE_ID_PATTERN`). `src/react/animatable.ts`: `useAnimatable` and `useAnimatableState` (values plus which props have tracks), channel aliases. The registry's read-only `animatables` map holds `{id, spec, owner}`, and conflicting specs become a Scene issue. `useColorChannel` was added for color channels. |
| 01.6 Compiled evaluator | `WeakMap` cache of the parse plus compiled tracks (sorted keyframes, tangents, parsed colors). `evaluateMotion`, `motionDuration`, `motionTime` and `loopSeam` keep their signatures. Per-keyframe validation schemas are hoisted (they were rebuilt on every parse). |
| 01.7 Editor block | Optional strict `SceneRecipeSchema.editor` (`labels`, `colors`, `locked`, `markers` ≤ 512). `presentPreview` never reads it. |
| 01.8 Kit | `Cursor`, `ScrollFrame`, `RouteFrame` and `LightSweep` declare animatables aliased to their v2 channel ids (ScrollFrame and RouteFrame share one `scroll` spec, so a single channel cannot conflict). `Title`, `Counter`, `Typewriter` and `Callout` take `id`: an `<id>.reveal` track (0..1) scrubs the component's own reveal span. |
| 01.9 Schemas, guide, skills | `schemas/scene-recipe.schema.json` regenerated. Guide capabilities gained `easings.auto`, `grade`, `transformAdditions`, `styleTracks`, `animatables` and `recipeEditor` (guide version stays 3). Skills `velora-motion-design`, `velora-scenes` and `velora-typography` were updated; `check-skills` passes. Checker owners: `parseCssColor`, `mixColors`, `AnimatableSpecSchema`, `useAnimatable` and `monotoneTangents` (`z.record` roots now count as schema implementations). |

## Evidence
- **Goldens:** all Phase 00 goldens (motion, spatial, optics/shot, format corpus) are unchanged (`node scripts/golden.mjs`). The capture golden (7 frames) and the existing browser suite pass.
- **Unit suites:** `test:core` passed within `verify:ci`. `test:react` 84/84. Architecture 172/172. `typecheck` is clean.
- **New tests:** `tests/core/{color,animatable,spatial,perf}.test.ts`; additions to `motion.test.ts` (auto-bezier: through keyframes, C1 with finite-difference velocity jump < 1e-3, no overshoot, all-auto equals smooth, mixed segments keep their easing; cache hit equals cold compile; mutation recompile; style/color tracks; grade ranges), `recipes.test.ts` (editor block), `schemas.test.ts` (v3 vocabulary); `tests/react/animatable.test.tsx`; additions to `scene.test.tsx`; `tests/browser/motion-v3.spec.ts` (5/5).
- **Validation criteria:**
  - [x] All Phase 00 goldens unchanged.
  - [~] Animated `--accent` drives a host component's background through `var(--accent)` in **preview** (browser pixels: 255,0,0 at t = 1 s; midpoint within 1 of `mixColors`). **Export** frame-SHA equality was not run in this pass.
  - [x] `useAnimatable("hero-counter", {value:{type:"number",default:0,max:1280}})` animates a counter from a channel track with only the hook (React test; clamps at 1280).
  - [x] Evaluator ≥ 5× faster at 300 tracks with identical outputs: see the next table.

| `evaluateMotion` (µs/call) | Phase 00 baseline | Phase 01 cached | Phase 01 cold compile |
|---|---|---|---|
| 10 tracks | 13,213 | 9.9 | — |
| 100 tracks | 155,376 | 92.8 | — |
| 300 tracks | 381,114 | 222 (about 1,700×) | 9,476 (about 40×) |
| Scene scrub, 60 Surfaces / 300 tracks (jsdom, ms/step) | 1,816 | 17.1 | — |

The in-run gate (`tests/core/perf.test.ts`) asserts a cache hit is ≥ 5× faster than a cold compile, measured at 39×, and that outputs are identical.

## `npm run verify:ci`
The gate ran twice. In the second run the build, `release:local`, `typecheck`, `test:architecture`, `test:recipes`,
`test:core` and `test:export` passed. The gate then failed in its parallel group: vitest workers timed out at startup,
and `tests/project/commands.test.ts` hit 5 s timeouts under load. Run alone, `tests/project/commands.test.ts` passes
(87/87). Every remaining leaf was then run sequentially with the gate's environment (`VELORA_VERIFY_HARDWARE=0`,
`VELORA_VERIFY_PREBUILT=1`):

| Check | Result |
|---|---|
| test:react, test:browser, test:launch, test:installed, test:library, test:agent, test:agent-demos, test:release, `release.mjs check` | passed |
| test:iterate | All assertions passed (both pass lines printed). The process then exited 13 ("unsettled top-level await") while tearing down child processes on Windows. The script is untouched by this phase. |
| test:portable:app, test:portable:pages | All assertions passed (pass lines printed), then temp-directory cleanup failed with `EBUSY` on Windows. |
| test:portable:react | Failed before testing: the script spawns `node_modules/.bin/esbuild` without `.cmd`, so it fails with `ENOENT` on Windows. |

These look like Windows-environment issues in scripts this phase did not modify, but they were **not** re-run on the
starting commit to prove it. Re-run `npm run verify:ci` on Linux CI before merging.

## Deviations and findings
- **Pre-existing CSS/matrix divergence (not changed):** CSS `scale(s)` is 2D, but `matrixFor` also multiplies z by
  `scale`. Uniformly scaled nested nodes therefore have world z/depth that differs from the browser's. Fixing it would
  move the spatial goldens, so it is left as is. The parity test pins `scale` to 1 and checks the new fields exactly
  (browser `DOMMatrix` of the CSS string within 1e-6; `getComputedStyle` within 1e-5, because it serializes about six
  significant digits). It needs a decision before Phase 13/14 depth work.
- **Fingerprint check runs always, the warning only in DEV:** core cannot use `console` (architecture rule), so core
  recompiles a structurally mutated cached object (duration, speed, track and keyframe counts), and the React `Scene`
  warns once in DEV (`import.meta.env.DEV`). A mutation that keeps those counts still returns stale frames; that is
  the documented immutability contract.
- **Reveal override semantics:** `<id>.reveal` maps 0..1 onto the component's whole reveal span (stagger, personality
  scale and easing preserved). Typewriter's caret blink stays on scene time.
- **`useColorChannel`** is a small addition beyond the plan, the color counterpart of `useChannel`.
- `docs/product.md` and `docs/architecture.md` are untouched, as the plan requires until Phase 04.
