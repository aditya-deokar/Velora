# Phase 5 Exit — Visual Kit, Brand, Looks and Wave 2 Templates

Status: implemented, uncommitted. Dates: 2026-10-27 to 2026-11-02.

## Delivered

- **Kit** (`src/kit/`, exported from `@adityadeokar/velora/kit`). Every component reads only scene time, channels, seeds and brand tokens: no rAF, timers or wall clock.
  - Framing: `BrowserFrame`, `WindowFrame`, `PhoneFrame`, `TabletFrame`, `LaptopFrame`.
  - Atmosphere: `Backdrop` (6 variants), `Glow`, `ContactShadow`, `LightSweep`, `Dust`.
  - Interaction: `Cursor`, `Typewriter`, `Spotlight`, `Callout`.
  - Type: `Title` (Intl.Segmenter masks, punctuation kept with its word, accent word), `Counter`, `Countdown`, `Panel`, `Marquee`, `GradientText`, `CaptionTrack`.
  - Media: `VideoClip` (seek and settle per frame), `ImageLayer`.
  - Brand: `BrandProvider` (context plus CSS variables on a `display: contents` wrapper), `BrandMark`, `useBrand`, `useReveal`, `useRevealer`.
  - `LookLayer`; `tint()` for alpha on any CSS color syntax.
- **Brand** (`src/core/brand.ts`):
  - `BrandSchema` (JSON Schema shipped as `schemas/brand.schema.json`) and `MOTION_PERSONALITIES`.
  - `brandTokensFromCss`: a tokenizer with no code execution; heading tokens are preferred for `primary`.
  - `completeBrandColors`: a light or dark palette from the background's lightness.
  - `contrastRatio`.
  - CLI `velora brand init [--from-css] [--name]` and `velora brand check` (`ERR_BRAND_INVALID`, `WARN_BRAND_CONTRAST`, `WARN_BRAND_LOGO`).
  - Branded templates create a default brand file, create-only.
- **Looks** (`src/core/looks.ts`):
  - `LookSchema` with 7 presets. Partial overrides keep preset values (grade fields carry no defaults in files).
  - Browser layer: SVG `feColorMatrix` plus `feComponentTransfer`, vignette, letterbox, grain seeded per 24 fps grain frame.
  - Export finishing (`export/compositor.ts:finishLook`): bloom, halation, radial chromatic aberration, unsharp mask, trilinear `.cube` LUT (`parseCube`).
  - A scene's look wins over its composition's; an inherited look travels as `velora-look` and keys the frame cache.
  - The capture bridge publishes the look, so live export applies finishing.
  - `velora shot --finish` previews finishing.
  - The studio notes when finishing is export-only.
- **Safety** (`src/core/safety.ts`, wired into `velora check`):
  - `flash-safety`, a WCAG 2.3.1 approximation over an 8×8 grid: general and red flashes, more than 3 per second over at least 10% of the frame fails with `ERR_FLASH_RISK`. It runs over consecutive frames, or every frame of a video (FFmpeg area-scaled grid).
  - `banding`, advisory only (`ADV_BANDING`).
- **Wave 2 templates** (`src/core/composites.ts`, 18 builders):
  - 8 layered and 10 motion-graphics, compiled to nodes, motion and a kit layout as data.
  - Text params (`--set`) carry copy.
  - The scaffolder serializes plain TSX (`layoutJsx`); the studio renders the same layout (`preview/TemplateLayout.tsx`, which reads `/velora.brand.json` from the dev server).
  - Certification covers primary-node framing, title-safe placement (90%) for motion graphics, and reading time (0.3 s per word + 1 s).
- **Skills:**
  - new: `velora-brand`, `velora-looks`, `velora-motion-design` (20 skills total);
  - updated: root `velora` routing and `velora-typography`.
- **Docs:** `docs/architecture.md` section and CHANGELOG.

## Verification

| Gate | Result |
|---|---|
| typecheck, lint:architecture | pass |
| test:architecture | 147 pass |
| test:core | 678 pass (all 30 templates × aspects × intensities certified; looks, brand, safety, composites) |
| test:react | 71 pass (20 new kit tests: determinism, masks, CJK, counters, cursor channels, LookLayer grain per frame) |
| test:launch | 456 pass (Wave 2 scaffolding, brand commands, CLI dispatch) |
| test:export | 273 pass (export finishing: bloom, halation, aberration, sharpen, LUT, finishFrame parity) |
| test:release | 41 pass |
| test:browser | 10 pass |
| test:skills | 20 green |
| test:installed | pass (one earlier run crashed straight after the browser suite; clean reruns pass) |
| test:agent-demos | pass; pixel hashes unchanged |

## Real run (smoke Vite app, installed build)

- **Brand from CSS.** `velora brand init --from-css src/index.css` gave background `#fff`, primary `#08060d` (from `--text-h`), accent `#aa3bff`, text `#6b6375`, completed with a light palette.
- **Scaffolding.** Six Wave 2 scenes: title-reveal, device-showcase (laptop, keynote look), stat-counter, exploded-stack (neon look), cursor-demo and end-card.
- **Generated TSX** typechecks in the app (`tsc -p tsconfig.app.json`: 0 errors).
- **Shots.**
  - All six scenes shoot, and `velora shot --finish` works.
  - `w2-cursor` gives an identical SHA on two runs.
- **Composition.** `wave2.composition.json` (6 × 3 s, film look):
  - `frames --contact-sheet`: 18 frames in 49 s;
  - draft render: 540 frames;
  - `velora check --video`: flash-safety passes (0 flashes per second over every frame); banding advisory on the large light gradients.
- **Evidence** (session scratchpad): `shots3/wave2-sheet.png`, `shots3/wave2-graphics.png` and `smoke/app/p5/board6/contact-sheet.png`.

## Bugs found and fixed during verification

- **Look merging:** explicit grade fields reset the preset's other grade values (Zod `partial()` still applied defaults).
- **Flash detection:** the detector never counted a transition because the first rise was treated as tracking, not a change.
- **Sharpen:** `boxBlur` wrote into its input plane, corrupting the image.
- **Word reveals:** `Intl.Segmenter` split punctuation into its own unit.
- **Clip tracks:** they are percentages; split-compare and lower-third used pixels.
- **Brand seeding:**
  - Seeding mixed a light background with dark default cards; the palette is now completed by background lightness.
  - Kit alpha used hex suffixes that break for `hsl()`/`oklch()`; it now uses `color-mix`.
  - Display type now uses `primary`, and gradient backdrops darken the brand background instead of fading to black.
- **CLI:** the `brand` command was missing from the CLI's known-command gate.
- **Render failures:**
  - Shot, frames, render and check failures hid their cause; they now include the error and the failing segment and scene.
  - Parallel composition renders failed. Phase 4's default of up to 8 workers launched 8 Chromium instances into 1.4 GB of free memory. The default is now memory-aware (about 700 MB per worker, at most 4).
  - Bridge and network-idle waits allow 30 s while a Velora page is loading; a non-Velora page still fails after 5 s.

## Deviations and open items

- **Slots.** One primary slot per template (the CLI fills one). Extra screens use route text params (`routes`, `before`) or brand panels, instead of the planned multi-slot `layers[]`, `mid[]` and `screens[]`.
- **Export finishing runs in Node** per frame, not as an FFmpeg filter graph. This keeps stills and video identical and allows per-scene looks; LUTs are project-relative paths rather than asset ids.
- **Reading time and title-safe** are certified per default copy. User copy is checked at scaffold time only through text-length limits; longer copy can fail reading time unless `durationMs` is raised. Contrast is checked in `velora brand check`, not in certification.
- **Look quality on light brands.** `exploded-stack` with the `neon` look on a light brand reads blown out, and separated layers fall soft in its shallow depth of field. Brand-aware look presets would help.
- **Not done:**
  - kit tree-shake assertion and package-size budget in `check-installed` (production exclusion still passes);
  - browser pixel tests for device frames, backdrop parallax and `VideoClip` seeking (covered by jsdom tests and the smoke run);
  - a preview vs export pixel-parity measurement for the browser look layer.
- **Studio quick shots** fetch `/velora.brand.json` from the dev server; Next.js hosts serve it only from `public/`, so they fall back to default tokens.
