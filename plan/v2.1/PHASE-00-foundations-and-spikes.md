# Phase 00 — Foundations, decisions and spikes

## Goal
Lock the decisions and safety nets before any editor code exists:
- confirmed decisions (README §3);
- byte-level goldens of today's behavior;
- performance baselines;
- five time-boxed spikes that settle the risky unknowns;
- the new architecture layers, with fixtures.

Later phases then add features without reopening architecture.

## Prerequisites
- v2 complete (`plan/v2/README.md` §9). `npm run verify:ci` green on the starting commit.

## Scope IN
- Decision record, goldens, baselines, spikes S1–S5, architecture-checker layers and fixtures, a GSAP import ban.

## Scope OUT
- Any user-visible editor feature or schema change (01+).

## Tasks

### 00.1 Decision record
- Confirm D1–D8 with the maintainer, and record the answers and date in README §3.
- If D1 (the edit bridge) is declined, stop: Phases 03–10 need a different persistence design. Re-plan before continuing.
- Do **not** edit `docs/product.md` or `docs/architecture.md` yet. Their "studio writes no files" and "no visual builder" statements stay true until Phase 04 ships Edit mode. Phase 04 updates both in the same change.

### 00.2 Goldens (the safety net for "additive only")
- **Motion golden:** extend the v2 back-compat golden (`tests/core/motion.test.ts`). Cover:
  - every committed recipe under `tests/`, `local-project/src/velora/scenes/` and `skills/velora/templates/`;
  - one scaffold per template id × aspect × intensity (generated in-test with `src/project/templates.ts`).

  Record `evaluateMotion` at 25 sample times and `loopSeam`.
- **Spatial golden:** for the same recipes, run `evaluateScene` with fixed synthetic measurements (each node 1400×980, plus nested nodes 400×300). Record node `world` matrices, `blur` and `focusDepth` at 5 times, and the `cameraToCss`/`transformToCss` strings.
- **Formatting corpus:** list every committed `*.scene.json` and `*.composition.json`, and store their exact bytes as fixtures (including CRLF and BOM variants generated in-test). Phase 03's formatter must round-trip all of them byte-identically.
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
- [ ] D1–D8 answered and recorded.
- [ ] Goldens committed and green; `scripts/golden.mjs` refuses to update without `--update`.
- [ ] Baselines recorded.
- [ ] S1–S5 verdicts recorded; README §3 D6 updated with the S1 outcome.
- [ ] `npm run verify:ci` green.

## Anti-patterns
- Starting editor UI before goldens exist ("we'll check compatibility later").
- Spike code merged into `src/`.
- Registering an owner in the checker before its implementation (`canonical-presence` would fail every build).

## Definition of Done
Decisions recorded, goldens and baselines in place, spikes concluded, layers enforced, and
`plan/v2.1/artifacts/phase-00-exit.md` written.
