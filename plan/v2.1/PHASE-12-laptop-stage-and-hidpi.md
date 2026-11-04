# Phase 12 — Laptop-true app stage: viewport decoupled from the output frame

## Goal
The app should look like it does on a real modern laptop: 16:10, Retina 2×, natural density. It
should not look like a miniature desktop monitor stretched into a video frame. This phase splits
two contracts that are tangled today:
- **App Stage Viewport:** the logical CSS width, height, aspect and `devicePixelRatio` that the host app lays out and rasterizes at inside the 3D world.
- **Video Output Frame:** the pixels of the exported file (`--width/--height`, aspect, quality).

The studio reads the user's own laptop viewport and can store it as the stage. Preview and export
lay the app out identically, so depth layers (13) and DOM targets (15) land in the same place in
both. A 200 mm close-up on one button stays sharp because the app was rasterized at 2×.

## Audit (current state)
- `ASPECT_FRAMES` (`src/core/shots.ts`) couples the stage to the aspect: 16:9 is a 1920×1080 frame with a 1440×900 subject, 1:1 is 1200×900, 9:16 is 900×1600. Scaffolds write those numbers into TSX as literals (`src/project/templates.ts`: `<RouteFrame … width={1440} height={900}>`). So neither an agent nor the editor can change the stage without a TSX edit.
- There is no DPR concept. Capture uses `deviceScaleFactor = QUALITY_PRESETS[q].scale` (draft 0.5, standard 1, master 2; `src/core/export.ts`). At standard quality the app renders at 1×, so canvases (charts) and `srcset` images soften as soon as the camera magnifies.
- There are three unrelated default sizes: `PreviewDefinitionSchema` 1400×980, `velora export` 1440×1000, and `CaptionsScene` 1920×1080.
- In-tree components (anything that isn't a RouteFrame) see the top window's `innerWidth`. Their media queries answer to the studio window or the export viewport, not to the stage.
- Naming: `data-velora-stage` is already the camera-stage `<div>` inside `Scene`. The app stage uses `data-velora-app-stage`.

## Prerequisites
- Phase 00: decisions D9 and D10, spike S7 (DPR capture cost and iframe DPR).
- The `stage.set` op lands with Phase 03. The studio chip (12.6) needs only the v2 studio; its bridge write needs Phase 04.

## Scope IN
- Stage presets and schema, plus `definition.stage`.
- `AppStage` and `useAppStage`, and RouteFrame stage sizing.
- A capture DPR floor and manifest lineage; a resolution-budget advisory.
- User-native detection in the studio.
- Scaffold, quick-shot and template defaults; the `stage.set` op and CLI.

## Scope OUT
- Depth layers (13), optics (14), anchors (15).
- Faking `window.innerWidth` for in-tree components. It is not possible without a frame; the skills route viewport-responsive pages to RouteFrame.

## Tasks

### 12.1 Stage presets — new core owner `src/core/stage.ts`
`STAGE_PRESETS` (data):

| id | CSS viewport | DPR | Physical width (mm, for 14) | Matches | Use |
|---|---|---|---|---|---|
| `laptop-14` | 1512×982 | 2 | 302 | 14″ Retina laptop, default scaled mode | **Default for every new scene** |
| `laptop-13` | 1440×900 | 2 | 286 | 13″ Retina laptop | Compact UIs |
| `laptop-16` | 1728×1117 | 2 | 346 | 16″ Retina laptop | Dense dashboards |
| `desktop-1080` | 1920×1080 | 1 | 531 | 24″ 1080p monitor | Explicit legacy look only |
| `user-native` | detected | detected | detected or `laptop-14` | The user's own machine (12.6) | |
| `custom` | any | any | optional | | |

- `StageSchema` (strict): `{ preset?, width: int [320, 3840], height: int [320, 3840], dpr: 1 | 1.25 | 1.5 | 1.75 | 2 | 3, physicalWidthMm?: (50, 2000], detected?: { innerWidth, innerHeight, screenWidth, screenHeight, devicePixelRatio, basis: "window" | "screen", atIso } }`. The DPR set covers Retina (2) and common Windows scaling (125%, 150%, 175%, 200%).
  - Concrete numbers are always present. `preset` is provenance; the renderer reads only the numbers (principle 12).
  - Named presets must match the table exactly, so hand-edited drift fails with a hint to use `custom`.
- `stageFromViewport(metrics, { basis })` is pure. It rounds to integers, clamps, and snaps DPR to the nearest allowed value (1.33 → 1.25, 2.2 → 2). A user-native stage keeps the user's own aspect (for example a 16:9 Windows laptop at 1536×730 @1.25); it is not forced to 16:10. The default basis is `window` (`innerWidth × innerHeight`, which is what the user sees of the app). `screen` is offered for full-display framing.
- `fitStage(stage, frame, fill)` gives the stage-in-frame placement for scaffolds and replaces `ASPECT_FRAMES[a].subject` **only for recipes that declare a stage**. `ASPECT_FRAMES` keeps its exact values (goldens and certification).

### 12.2 Definition contract — `src/core/preview.ts`, `src/core/recipes.ts`
- `PreviewDefinitionSchema.stage?: StageSchema` is optional with **no default**. `width/height` keep their meaning: the output frame in CSS px.
- A recipe without `stage` renders exactly as today (Phase 00 goldens).
- `template` provenance gains an optional `stage` id.
- Regenerate the JSON Schemas. The guide gains a `stages` capability (the preset table).

### 12.3 Rendering the stage — new `src/react/stage.tsx` (owners `AppStage`, `useAppStage`)
- `Scene` accepts an optional `stage` prop, and `ScenePreview` passes `definition.stage`.
- `<AppStage>` renders a box of exactly `width × height` CSS px with:
  - `container-type: size` and `container-name: velora-app-stage`;
  - `data-velora-app-stage`;
  - size taken from Scene context, so it needs no props.
- `useAppStage()` returns `{ width, height, dpr, aspect, physicalWidthMm }`.
- **RouteFrame** with no `width/height` inside an `AppStage` fills it. The hosted page then gets `innerWidth/innerHeight` and media queries equal to the laptop's in both preview and export. Its `devicePixelRatio` is the page's device scale (an iframe inherits it), so 12.4 delivers DPR. Explicit `width/height` props keep working unchanged.
- **In-tree components** get container queries (`@container velora-app-stage (…)`) and `useAppStage()`. The skill tells agents to prefer RouteFrame for pages whose layout depends on `@media` (12.7).
- Scaffolds read the stage through `AppStage` instead of literal numbers. Changing the stage in the recipe (CLI, editor, agent) then resizes the app with no TSX edit.

### 12.4 Capture: DPR floor and output decoupling — `src/core/export.ts`, `src/export/{commands,services}.ts`, `src/react/capture.ts`
- `CaptureManifestSchema` gains an optional `stage: { width, height, dpr }`, which the capture bridge reports.
- `resolveFinishing(input, frame, stage?)`:
  - `supersample = max(preset.scale, stage.dpr)` for standard and master. Draft keeps 0.5, because draft is an explicit opt-out.
  - The existing cap still holds: no capture side above 3840 px (`floor(3840 / largest)`).
  - When the cap stops the stage DPR, the manifest records `stage.dprCapped: true` and a `stage-dpr` check entry with the effective DPR (for example, 4K output at 1×).
- Downscaling reuses the master supersample path (linear-light averaging in `src/export/compositor.ts`). The output frame stays exactly `--width × --height`.
- `RenderManifestSchema` gains optional `stage` lineage `{ preset?, width, height, dpr, effectiveDpr }`.
- CLI: `velora export`, `render`, `shot` and `deliver` gain an optional `--stage-dpr <1–3>` override. **No existing flag, default or output size changes.** `velora export` still defaults to 1440×1000. Scaffolds, quick shots and the studio Export menu already print explicit sizes, and keep doing so.

### 12.5 Resolution-budget advisory — `src/core/stage.ts` (`resolutionBudget`)
- For sampled times, compute `k(t)`: output pixels per stage CSS pixel at the focus target (or subject center). It comes from the camera projection (`projectPoints` today, `projectWorld` after 06.1), times the preview cover scale, times `zoom` (14.2).
- When `k(t) > effectiveDpr × 1.1`, raster content (canvas, `img`, video) is upsampled. Report `stage-undersampled` with the peak time and the fixes: `stage.dpr` 3, `--quality master`, a longer lens from farther away, or a lower fill.
- Vector text and SVG re-rasterize in Chromium at the composited scale. S7 confirms this, so the advisory names raster content only.
- Surfaced in `reviewAuthoring`, `velora inspect --scene <id> --json` (a `stage` block) and the editor advisories (04.7).

### 12.6 User-native detection — `src/preview/` (studio)
- On open, the studio reads `innerWidth`, `innerHeight`, `devicePixelRatio`, `screen.width/height` and `screen.availWidth/availHeight`, and again on `resize` (debounced 250 ms). It runs `stageFromViewport` and compares the result with the recipe's stage.
- The scene header shows a chrome-marked chip: **"Your laptop: 1512 × 982 @2× · Use as stage"**.
  - With a bridge (03/04), it applies `stage.set { preset: "user-native", … , detected }` as one undo step.
  - Without one, it copies `velora edit stage --scene <id> --preset user-native --size 1512x982@2 --write`, with the exact numbers baked in.
- The CLI never "detects": a headless browser has no user screen. `velora new scene --stage user-native` fails with a hint: pass the numbers (`--stage 1512x982@2`) or use the studio chip.
- Privacy: only viewport numbers and a timestamp are stored. No user agent, display names or IDs.
- Never shown on capture pages (`velora-capture`).

### 12.7 Defaults for agents, scaffolds, quick shots and templates
- `velora new scene` gains `--stage <preset | WxH@dpr>`, default `laptop-14`. It writes `definition.stage` and sizes the subject with `fitStage`. `--aspect` still chooses only the output frame.
- Quick shots (`src/core/quickshot.ts`) gain a `stage` param (default `laptop-14`), and their copied commands include it.
- Composite blueprints (`src/core/composites.ts`) size RouteFrames from the stage aspect.
- `velora templates check` certifies every template × aspect × intensity × {`laptop-13`, `laptop-14`, `desktop-1080`}. Stage-less certification outputs stay byte-identical.
- Ops: `stage.set { preset?, width, height, dpr, physicalWidthMm?, detected? }` with an exact inverse. CLI shorthand `velora edit stage --scene <id> (--preset <id> | --size WxH@dpr) [--write]`.
- Skills (this phase): `velora-scenes` and `velora-templates` state the rule: **app UI always renders inside a laptop stage: `laptop-14` (1512×982 @2×), or `laptop-13`, or the user's detected stage. Never a 1920×1080 @1× app stage unless asked.** `velora-export` explains `effectiveDpr` and the capture cost.

## Contracts (additive)
| Field / API | Type | Default | Notes |
|---|---|---|---|
| `definition.stage` | `StageSchema` | — (absent = today's behavior) | Concrete numbers; `preset` is provenance |
| `STAGE_PRESETS`, `stageFromViewport`, `fitStage`, `resolutionBudget` | core | — | `src/core/stage.ts` |
| React `AppStage`, `useAppStage`, `Scene stage` prop | react | — | `data-velora-app-stage` |
| Capture manifest `stage` | `{width,height,dpr}` | — | Reported by the bridge |
| Render manifest `stage` | lineage incl. `effectiveDpr`, `dprCapped` | — | |
| CLI `--stage` (`new`), `--stage-dpr` (`export`, `render`, `shot`, `deliver`), `velora edit stage` | flags | — | All optional |
| Op `stage.set` | EditOp | — | Exact inverse |

## Files
- New: `src/core/stage.ts`, `src/react/stage.tsx`
- Modified:
  - core: `src/core/{preview,recipes,export,quickshot,composites,templates,authoring,cli-schema,schemas,index}.ts`, `src/core/edit.ts` (op);
  - react and kit: `src/react/{index.tsx,capture.ts}`, `src/kit/RouteFrame.tsx`;
  - preview: `src/preview/{ScenePreview,QuickShot}.tsx` (chip, Export menu);
  - export: `src/export/{commands,services}.ts`;
  - project: `src/project/{templates,edit}.ts`;
  - `scripts/check-architecture.mjs` (owners `StageSchema`, `STAGE_PRESETS`, `AppStage`, `resolutionBudget`), `schemas/*`.
- Skills: `velora-scenes`, `velora-templates`, `velora-export`

## Tests
- `tests/core/stage.test.ts`:
  - preset table exactness; drift rejection;
  - `stageFromViewport` cases (1512×982@2, 1470×956@2, 1366×768@1, 1280×800@1.5, 1536×730@1.25, 1.33 → 1.25, 2.2 → 2);
  - `fitStage`; `resolutionBudget` thresholds.
- Goldens (Phase 00) and stage-less template certification unchanged.
- `tests/core/export.test.ts`: `supersample = max(scale, dpr)`, the cap at 4K, manifest lineage, `--stage-dpr` override, draft unchanged.
- `tests/react/stage.test.tsx`: `useAppStage` values; `AppStage` container size; RouteFrame fills the stage; explicit sizes win.
- `tests/browser/stage.spec.ts`:
  - a RouteFrame fixture page writes `innerWidth`, `innerHeight`, `devicePixelRatio` and `matchMedia('(min-width: 1500px)')` into data attributes. Preview reports 1512 / 982 / true. `velora export --quality standard --width 1920 --height 1080` reports DPR 2, the output video is 1920×1080, and a canvas chart is rasterized at 2×;
  - 3840×2160 output records `dprCapped` and effective DPR 1.
- `tests/browser/stage-native.spec.ts`: a Playwright context at viewport 1512×982 with `deviceScaleFactor` 2 opens the studio. The chip reads "1512 × 982 @2×". With a bridge, the recipe gains the stage block; without one, the copied command is exact.
- Performance: capture ms/frame at DPR 1 and 2 (1080p output) recorded in the exit report (S7 baseline).

## Validation criteria
- [ ] `velora new scene --template hero-push --id home-hero --route / --stage laptop-14 --json` → the app lays out at 1512×982 in preview and in export, and probe rects are equal ±0.5 px.
- [ ] A 4× camera magnification onto a chart button at `--quality standard` raises no `stage-undersampled` advisory, and the exported crop matches a DPR-2 reference.
- [ ] Every Phase 00 golden and every existing CLI envelope is unchanged.

## Anti-patterns
- Re-detecting the viewport at render time: output would depend on the machine.
- Using the output frame size as the app's layout width.
- Faking DPR by laying the app out larger and scaling it down: that changes its breakpoints.
- Keeping the stage only as TSX literals, where agents and the editor can't change it.
- Giving `stage` a schema default: that would change every existing recipe.

## Definition of Done
Tests, validation and goldens green; schemas, guide and skills updated; `velora skills check`
clean; `plan/v2.1/artifacts/phase-12-exit.md` written with the S7 capture-cost evidence.
