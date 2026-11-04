# Phase 00 — Foundations, decisions and spikes

## Goal
Lock the decisions and safety nets before any editor code exists:
- confirmed decisions (README §3);
- byte-level goldens of today's behavior;
- performance baselines;
- eight time-boxed spikes that settle the risky unknowns (S1–S5 for the editor, S6–S8 for the cinematic track);
- the new architecture layers, with fixtures.

Later phases then add features without reopening architecture.

## Prerequisites
- v2 complete (`plan/v2/README.md` §9). `npm run verify:ci` green on the starting commit.

## Scope IN
- Decision record (D1–D14), goldens, baselines, spikes S1–S8, architecture-checker layers and fixtures, a GSAP import ban.

## Scope OUT
- Any user-visible editor feature or schema change (01+).

## Tasks

### 00.1 Decision record
- Confirm D1–D14 with the maintainer, and record the answers and date in README §3.
- If D1 (the edit bridge) is declined, stop: Phases 03–10 need a different persistence design. Re-plan before continuing.
- If D9 (stage absent = legacy behavior) is declined in favor of changing the default for existing recipes, stop. That is a breaking change: it needs a recipe version bump and a migration, which v2.1 (1.1.0, additive) does not allow.
- D11 is the host-DOM safety boundary. Any later request to insert nodes into host trees or override host `overflow`/`opacity`/`filter` must reopen D11, not quietly widen the ledger.
- Do **not** edit `docs/product.md` or `docs/architecture.md` yet. Their "studio writes no files" and "no visual builder" statements stay true until Phase 04 ships Edit mode. Phase 04 updates both in the same change.

### 00.2 Goldens (the safety net for "additive only")
- **Motion golden:** extend the v2 back-compat golden (`tests/core/motion.test.ts`). Cover:
  - every committed recipe under `tests/`, `local-project/src/velora/scenes/` and `skills/velora/templates/`;
  - one scaffold per template id × aspect × intensity (generated in-test with `src/project/templates.ts`).

  Record `evaluateMotion` at 25 sample times and `loopSeam`.
- **Spatial golden:** for the same recipes, run `evaluateScene` with fixed synthetic measurements (each node 1400×980, plus nested nodes 400×300). Record node `world` matrices, `blur` and `focusDepth` at 5 times, and the `cameraToCss`/`transformToCss` strings.
- **Formatting corpus:** list every committed `*.scene.json` and `*.composition.json`, and store their exact bytes as fixtures (including CRLF and BOM variants generated in-test). Phase 03's formatter must round-trip all of them byte-identically.
- **Optics and shot golden** (for the cinematic track):
  - `lensFor` at every mm in the guide's lens table × frame heights 1080, 1350 and 1920, with today's throws recorded separately;
  - `buildShot` output for every `SHOT_KINDS` kind × aspect × intensity;
  - `framingReport` summaries for the same inputs.

  Phases 14 and 16 must keep every recorded *value* byte-identical. The only allowed change is Phase 14 turning a recorded throw (for example 200 mm at 1920 px) into a value. The golden script reports each such conversion explicitly.
- **Capture golden:** frame SHAs of the existing browser fixtures at standard quality. These are the "no `stage`, no `depth`" reference for Phases 12–14.
- Goldens live in `tests/core/fixtures/v21-golden/` and are regenerated only by an explicit script (`node scripts/golden.mjs --update`). An accidental diff therefore fails CI.

### 00.3 Performance baselines (record only, no targets yet)
Measure on the reference machine and write the numbers into the exit report:
- `evaluateMotion` time per call for 10, 100 and 300 tracks;
- `Scene` render plus evaluation time during scrubbing with 60 Surfaces;
- the existing preview frame budget from `playwright.performance.config.ts`.

These become the denominators of the Phase 01 compiled-evaluator target and the Phase 11 budgets.

### 00.4 Spikes (time-boxed; each ends with a written verdict in `artifacts/phase-00-spikes.md`)

| Spike | Question | Pass gate | Box |
|---|---|---|---|
| **S1 Timeline rendering** | Options: virtualized DOM rows with SVG keyframes; one canvas per lane (informed by `animation-timeline-js`); `@xzdarcy/react-timeline-editor` for clip lanes. | 200 rows × 1,000 keyframes; scroll, zoom and drag with no long task > 50 ms; keyboard and ARIA grid feasible; React 18 and 19; ≤ 60 KB min+gz; custom keyframe glyphs; no global CSS leakage into host apps. | 3 days |
| **S2 Bridge transport** | Can a page at the dev origin (`127.0.0.1:3000` Next, `localhost:5173` Vite, any-site `/__velora/`) call `http://127.0.0.1:<port>` with CORS, an Authorization header and a streaming `fetch` for events? Check Chrome Local Network Access and Private Network Access behavior for loopback-to-loopback calls, plus Firefox and Safari (WebKit via Playwright). | Works in Chromium, Firefox and WebKit with no permission prompt for loopback-to-loopback; a preflight with an explicit origin allowlist succeeds; a foreign origin is rejected. | 2 days |
| **S3 Deterministic R3F** | `@react-three/fiber` 9 with `frameloop="never"` and `advance(seconds)` from scene time. Can a Playwright capture of the canvas reproduce identical pixels at the same time twice? Measure `preserveDrawingBuffer` cost, the Suspense/GLTF settle path, and the React 19 peer constraint. | Two captures at the same time have the same SHA (same machine); seek in either direction is correct; a GLTF scene settles before capture. | 3 days |
| **S4 Click-to-source** | With `code-inspector-plugin` in a Vite host and a Next/Turbopack host: the attribute name and format, whether it reaches elements inside Surfaces, and whether it changes layout or capture. Also test the fallback of picking from a JSX outline built with the TypeScript API. | Attributes resolve to file:line:col for host components; capture bytes are unchanged by the attributes; the outline fallback resolves the binding file's elements. | 2 days |
| **S5 Lazy editor chunk** | Does `vite.lib.config.ts` (ES lib mode, entries `index`, `preview`, `kit`) emit a separate chunk for a dynamic `import()` from `src/preview`? Check how exports, `files` and the package budget treat chunk files, and that installed hosts (Vite, Next, esbuild) load it. | The editor chunk is absent from the production assets of an installed host (extends `scripts/check-installed.mjs`); the dev studio loads it on demand; the budget still passes. | 1 day |
| **S6 Volumetric depth in live DOM** | In Chromium (studio and headless capture), can host subtrees inside a Surface take `translateZ` with `preserve-3d` chains set from outside, and do Velora proxy planes (shadow, walls, sheen) depth-sort correctly against them? For per-layer focus, does `backdrop-filter` on a proxy plane inside a 3D context blur only what is behind it ("veils behind, filters in front", Phase 14.4)? What do 48 layers cost? | Correct sorting on a dashboard fixture at ±30° orbit; two captures at the same time have the same SHA; veils blur behind-layers only, matching a per-layer reference within 1 px σ; scrub ≥ 55 fps with 48 layers. **If veils fail, record the band-quantized fallback** (14.4) as the plan of record. | 3 days |
| **S7 Stage DPR and sharpness** | Capture time and memory at `deviceScaleFactor` 2 against 1 for 1080p output; whether `devicePixelRatio` inside a RouteFrame follows the page; whether CSS `zoom` on an iframe changes the inner DPR (it could decouple app DPR from capture scale); text, SVG and canvas sharpness at 4× camera magnification; behavior at the 3840 px capture cap. | DPR 2 capture ≤ 2.5× the DPR 1 time per frame (reference machine); the iframe reports DPR 2; vector text crisp at 4× with DPR 1 (confirms 12.5's raster-only advisory); measured numbers recorded for D10. | 2 days |
| **S8 Projected parallax in iframes** | For a same-origin RouteFrame and the any-site proxy, compare per-layer 2D displacement and scale inside the iframe document (computed from the outer camera) with a volumetric reference; measure the depth-map focus filter (`feImage` bands) on the iframe element. | Position error ≤ 1 px at elevation ≤ 96 px and \|rotateX/Y\| ≤ 30° at 50 mm, ≤ 0.25 px at 200 mm; ledger revert leaves the iframe document's `style` attributes byte-identical; depth-map filter within 1 band of the reference. | 2 days |

### 00.5 Architecture layers and fixtures (`scripts/check-architecture.mjs`)
Add the layers now, and register owners only in the phases that implement them:

| Layer | Path | Local deps | External deps |
|---|---|---|---|
| `editor` | `src/editor/**` | core, react, kit, preview, editor | react, react-dom |
| `three` | `src/three/**` | core, react, kit, three | react, react-dom, three, @react-three/fiber |
| `bridgeServices` | `src/project/services/**` | as `services` | as `services` (Node built-ins) |
| `sourceAdapter` | `src/project/source.ts` | as `projectAdapter` | typescript |

`src/project/edit.ts` joins the `commands` regex, which today covers only `commands|recipes|discovery`.

Fixtures (negative, so each must fail):
- `editor` imports `project/*` or `export/*`;
- `preview` statically imports `editor`. Only a dynamic `import()` from `src/preview/EditMode.tsx` is allowed;
- `editor` imports `three` or `@react-three/fiber`. The editor reaches 3D only through the registry contract in Phase 09;
- any layer imports `gsap` (decision D8);
- `core` imports anything except zod.

### 00.6 Exit report
- Write `artifacts/phase-00-exit.md`: decisions with dates, golden counts, baseline numbers, spike verdicts, and checker fixture results.

## Contracts
- None user-facing. Golden fixtures and the checker layers are the contract for every later phase.

## Files
- New: `tests/core/fixtures/v21-golden/**`, `scripts/golden.mjs`, `plan/v2.1/artifacts/phase-00-{exit,spikes}.md`
- Spike code lives under `tests/fixtures/spikes/` or a scratch branch. It never enters `src/`.
- Modified: `scripts/check-architecture.mjs` (+ fixtures in `tests/architecture.test.mjs`), `tests/core/motion.test.ts`, a new `tests/core/spatial-golden.test.ts`

## Tests
- `tests/core/motion.test.ts` and `spatial-golden.test.ts`: goldens match current behavior exactly.
- `tests/architecture.test.mjs`: each new negative fixture is rejected with a precise rule id; the positive fixtures (an editor importing preview, three importing R3F) pass.

## Validation criteria
- [ ] D1–D14 answered and recorded.
- [ ] Goldens committed and green (including optics, shot and capture goldens); `scripts/golden.mjs` refuses to update without `--update`.
- [ ] Baselines recorded, including capture ms/frame at DPR 1 and 2 (S7).
- [ ] S1–S8 verdicts recorded; README §3 D6 updated with the S1 outcome, and D10/D11 with the S6/S7 outcomes.
- [ ] `npm run verify:ci` green.

## Anti-patterns
- Starting editor UI before goldens exist ("we'll check compatibility later").
- Spike code merged into `src/`.
- Registering an owner in the checker before its implementation (`canonical-presence` would fail every build).

## Definition of Done
Decisions recorded, goldens and baselines in place, spikes concluded, layers enforced, and
`plan/v2.1/artifacts/phase-00-exit.md` written.
