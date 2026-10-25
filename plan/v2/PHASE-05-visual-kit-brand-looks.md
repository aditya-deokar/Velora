# Phase 05 — Visual Kit, Brand & Looks + Wave 2 Templates

## Goal
Give every scene the production value of a launch film:
- device and window framing, atmosphere and light;
- a cursor that demos the product;
- typography that reveals;
- counters that count;
- one brand system that makes every template look like *your* product;
- a cinematographer's finishing pass (grade, grain, vignette, letterbox, bloom).

With those in place, ship the layered real-UI and motion-graphics templates (Wave 2).

## Prerequisites
- Phase 01 (channels, blur/clip, easings), Phase 02 (kit layer, async capture settle, template system), Phase 04 (compositor for export-time finishing).

## Scope IN
- Kit components, `BrandSchema` and commands, `LookSchema` (browser layer + export finishing).
- Flash-safety and banding checks.
- Wave 2 templates (8 layered + 10 motion graphics).
- Skills `velora-brand`, `velora-looks`, `velora-motion-design`; `velora-typography` update.

## Scope OUT
- Overlay tracks, A/B transitions, SFX, captions as overlays, launch blueprints (06).

## Tasks

### 05.1 Kit components — `src/kit/` (exported from `@adityadeokar/velora/kit`)
Every component follows these rules:
- deterministic, reading only `useSceneTime` / `useChannel`;
- no rAF, timers or wall clock;
- renders inside Surface leaves (coverage invariant);
- brand-token aware through `BrandProvider`;
- documented props with ranges;
- unit-tested with SSR plus a browser pixel test.

| Group | Components | Notes |
|---|---|---|
| Framing | `BrowserFrame`, `WindowFrame`, `PhoneFrame`, `LaptopFrame`, `TabletFrame` | CSS-only (no bitmaps, no trademarked shapes); light/dark; padding/inset/shadow (Screen Studio-style "window on wallpaper") |
| Atmosphere | `Backdrop` (`gradient`, `mesh`, `aurora`, `grid-floor`, `spotlight`, `solid`), `Glow`, `ContactShadow`, `LightSweep`, `Dust` | Backdrops are oversized **deep Surfaces** sized from camera range, so they gain parallax and depth-of-field softness; the core black-void contract is unchanged. `LightSweep` is channel-driven specular travel across a leaf. |
| Interaction | `Cursor` (arrow/pointer/hand skins, smooth path from channels, press ripple), `Typewriter`, `Spotlight` (feathered dim-around-region), `Callout` (label + leader line) | Camera "follow the click" lives in the `cursor-demo` shot builder |
| Type | `Title` (masked line reveal via clip, `Intl.Segmenter` for words/graphemes incl. CJK/RTL), `Counter` (tabular numerals, prefix/suffix, locale format), `Marquee`, `GradientText`, `CaptionTrack` (06 uses it as an overlay) | Supersedes hand-rolled `KineticText` spans for new work; `KineticText` stays supported |
| Media | `VideoClip` (asset video seeked per frame via async settle: `currentTime` → `seeked`), `ImageLayer` | Drop a real screen recording onto a 3D plane (screen replacement) |
| Brand | `BrandProvider`, `useBrand()` | Reads `velora.brand.json` tokens |

### 05.2 Brand system — `src/core/brand.ts` (owner `BrandSchema`)
- File `velora.brand.json` holds:
  - `name`, `logo` (asset id), `colors {background, surface, primary, accent, text, muted}`;
  - `gradients[]`, `fonts {display, body, mono}` (asset ids or system families);
  - `radius`, `voice {tagline, url, cta}`;
  - `motion: calm | crisp | playful | bold`.
- Motion personalities map to easing and duration tables used by every template:

  | Personality | Easing | Pacing |
  |---|---|---|
  | `calm` | cinematic | long |
  | `crisp` | expo.out | short |
  | `playful` | spring (under-damped) | — |
  | `bold` | back.out | quick |

- Commands:
  - `velora brand init [--from-css PATH]` scaffolds the file; with `--from-css` it extracts CSS custom properties (`--color-*`, `--font-*`) via the TypeScript-free CSS tokenizer in projectAdapter, without executing code.
  - `velora brand check` validates.
- The JSON Schema is shipped.
- Scaffolders wrap motion-graphics bindings in `BrandProvider`.

### 05.3 Looks — `src/core/looks.ts` (owner `LookSchema`)
- `look` sits on the recipe definition and the composition (the scene overrides the composition):
  - `preset`
  - `grade {contrast, saturation, temperature, tint, lift, gamma, gain}`
  - `grain {amount, size}`
  - `vignette {amount, softness}`
  - `letterbox {aspect}`
  - `bloom {threshold, intensity, radius}`
  - `halation`
  - `chromaticAberration`
  - `sharpen`
  - `lut` (asset id of a `.cube`)
- Presets (starting values, tuned at implementation):

  | Preset | Feel |
  |---|---|
  | `clean` | none |
  | `keynote` | deep blacks, gentle vignette, subtle sharpen |
  | `film` | soft S-curve, warm highlights, fine grain, vignette |
  | `teal-orange` | complementary split |
  | `noir` | desaturated, high contrast |
  | `neon` | saturation + bloom |
  | `pastel` | lifted blacks, low contrast |

- **Browser layer (preview == export).** Lives inside the capture viewport (`src/preview/ScenePreview.tsx:133`), outside the 3D context (the Scene root is flat):
  - SVG `feColorMatrix` (contrast, saturation, temperature, tint) plus `feComponentTransfer` (lift/gamma/gain);
  - radial-gradient vignette;
  - letterbox bars;
  - a **seeded grain tile** whose offset comes from `createRng(seed ^ frameIndex)`.
- **Export finishing (FFmpeg graph, compositor-ordered):**
  - bloom/halation: threshold → gaussian → screen blend;
  - `rgbashift` chromatic aberration;
  - `unsharp`;
  - `lut3d`.
- `velora shot --finish` previews the finished still. The studio labels finishing as "export-only — preview with velora shot --finish".

### 05.4 Safety and quality checks — `velora check`
- `flash-safety`: approximates WCAG 2.3.1 general and red flash, using per-cell relative-luminance transitions across 1 s windows. Fails with frame references.
- `banding` (advisory): flags large smooth gradients with visible 8-bit steps and suggests grain or `hevc` 10-bit.

### 05.5 Wave 2 templates (details in `TEMPLATE-CATALOG.md`)
- Layered real-UI: `exploded-stack`, `parallax-planes`, `cascade-build`, `floating-focus`, `device-showcase`, `cursor-demo`, `split-compare`, `screen-wall`.
- Motion graphics: `title-reveal`, `logo-sting`, `kinetic-statement`, `stat-counter`, `feature-trio`, `lower-third`, `quote-card`, `end-card`, `countdown`, `changelog-card`.
- Certification as in Phase 02. For motion-graphics templates, "subject" = the text/logo block, with reading-time and safe-area checks added.

### 05.6 Architecture
- `kit` layer local deps {core, react, kit}, external {react, react-dom}. No new runtime dependencies, so the CSS-only constraint keeps the package light.
- Tree-shake check: `scripts/check-installed.mjs` asserts production assets exclude kit code unless a production route imports it.
- Package size budget recorded in the release check.

## Contracts
| Surface | Contract |
|---|---|
| `@adityadeokar/velora/kit` | Components above; typed props; deterministic |
| `velora.brand.json` | `BrandSchema` v1 + JSON Schema |
| `look` (recipe/composition) | `LookSchema` v1; browser vs export layers documented per field |
| `velora brand init/check`, `velora shot --finish`, `velora check` (`flash-safety`, `banding`) | Standard envelope + codes `ERR_BRAND_INVALID`, `ERR_LOOK_INVALID`, `ERR_FLASH_RISK`, `ADV_BANDING` |

## Files
- New:
  - `src/kit/**` components
  - `src/core/{brand,looks}.ts`
  - `src/preview/LookLayer.tsx` (or `src/kit/Look.tsx`)
  - `skills/velora-{brand,looks,motion-design}/SKILL.md`
  - `templates/<wave-2 ids>/**`
- Modified: `src/react/capture.ts`, `src/export/{commands,services,compositor}.ts`, `src/core/{cli-schema,resources,authoring}.ts`, `src/cli/index.ts`, `scripts/{check-architecture,check-installed,release}.mjs`

## Tests
- `tests/kit/*.test.tsx`: each component's SSR markup, channel/time determinism (same t → same markup), brand token application.
- Browser pixel tests: device frames, backdrop parallax under camera motion, cursor path, `Title` mask reveal (incl. a CJK string), `Counter` formatting, `VideoClip` frame-accurate seek.
- `tests/core/looks.test.ts`: grade matrix math; grain determinism per frame index.
- Browser: preview vs capture pixel parity for the browser look layer.
- `tests/export/finishing.test.ts`: filter-graph args; `--finish` still parity with video frames.
- `tests/export/flash-safety.test.ts`: a synthetic 4 Hz strobe fails; a slow fade passes.
- Wave 2 certification and determinism tests.

## Validation criteria
- [ ] `device-showcase` with the user's dashboard on a `grid-floor` backdrop in `keynote` look reads as a product film still at output size.
- [ ] Changing `velora.brand.json` colors/motion re-skins every motion-graphics template without source edits.
- [ ] Browser-layer looks match between preview and export frames (pixel parity within 1 LSB).
- [ ] Flash-safety catches the strobe fixture.

## Anti-patterns
- Bitmap device frames or bundled brand logos; real people's names in template IDs.
- Restyling host UI silently: kit styles apply only to kit-authored elements.
- Per-component clocks; grain with `Math.random`; bloom implemented by cloning UI subtrees (prohibited; export-time only).

## Definition of Done
All tests and validation green. Wave 2 certified. Skills checked.
`plan/v2/artifacts/phase-05-exit.md` includes a contact sheet per template and look.
