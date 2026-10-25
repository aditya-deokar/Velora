# Phase 03 — Studio v2: Gallery, Quick Shots, Param Panel, Composition Player

## Goal
Make the first five minutes magical without writing code. Open the studio, browse templates
applied to **your own live app**, tweak them, and copy the exact export or scaffold command.
Then watch a whole composition (cuts, audio, captions) the way an editor reviews a cut.
There is still **no drag-and-drop editor and no browser file writes**: the studio produces
commands and prompts, and the CLI and agents own the source.

## Prerequisites
- Phase 02: shot builders, template manifests, `RouteFrame`, URL-safe template params.

## Scope IN
- Library tabs (Scenes | Templates | Compositions).
- Template gallery, quick shots, param panel, composition player.
- Studio overlays (thirds, safe areas, platform zones, focus peaking, aspect preview).
- Keyboard shuttle controls.
- DEV-only composition/asset discovery in the generated adapters.

## Scope OUT
- Editing timelines in the browser, saving files from the browser, A/B transition compositing (06; the player approximates), quality presets (04; the export menu adds them when they land).

## Tasks

### 03.1 Library shell
- `src/preview/SceneLibrary.tsx` gains tabs **Scenes | Templates | Compositions**, keeping the canonical Scene/Surface credits-plane aesthetic for Scenes.
- The tab state lives in the URL (`velora-tab=templates`), so back, forward and reload work.

### 03.2 Template gallery — `src/preview/TemplateGallery.tsx`
- Cards come from shipped manifests. Each card has a **schematic storyboard**: pure SVG of the camera path at start, middle and end, derived from `buildShot` output with no live render.
- Only the focused/hovered card runs **one** live mini preview. Idle cost is zero live scenes.
- Filters: category, tags, aspect.

### 03.3 Quick shots — `src/preview/QuickShot.tsx`
- Renders `ScenePreview` with `buildShot(params)` and the subject slot filled by:
  - **Vite/portable hosts:** the live app. `ProjectPreview` passes `children` into the library (today they are dropped at `src/preview/index.tsx:36` when `sceneModules` exist).
  - **Next.js:** `RouteFrame` with a route picker (default `/`), because `src/velora/Studio.jsx` has no children (`src/project/portable.ts:28`).
- Exportable URL contract: `?velora-preview=1&velora-quick=<template>&velora-route=/path&velora-params=<base64url JSON>`.
  - The URL deep-links and reloads.
  - The existing capture bridge works unchanged, so `velora export --url '<that url>' --output shot.mp4` exports the quick shot with zero source files.

### 03.4 Param panel — `src/preview/ParamPanel.tsx`
- Schema-driven controls from `TemplateManifest.params`, plus aspect, duration, intensity and lens: sliders, selects, toggles, color.
- Live update, debounced to animation frames, with no remounts of the host subtree.
- Actions:
  - **Copy scaffold command** (`velora new scene --template … --set …`);
  - **Copy export command** (the quick-shot URL);
  - **Copy agent prompt** (Phase 07 prompt library; until then a fixed, honest prompt).
- Chrome-marked (`data-velora-preview-chrome`) so it is never captured.

### 03.5 Composition discovery (DEV-only)
- Generated Vite adapter (`src/project/vite.ts` `generatedPreview`) adds:
  - `compositionModules = import.meta.glob("/*.composition.json")`;
  - `assetUrls = import.meta.glob("/assets/**/*", {query: "?url", import: "default"})`.
- `portableCatalog` (Next/react) adds static imports of compositions and asset URLs via `velora sync`.
- New generator bytes are a **legacy upgrade** handled by `init` (same mechanism as Phase 00).

### 03.6 Composition player — `src/preview/CompositionPlayer.tsx`
- Resolves the composition with core `CompositionSchema` + `resolveCompositionSpec` against the recipe catalog, and builds the timeline with `timelineFromComposition`.
- One cursor: `usePreviewSession(input, revision, timeline)`, whose timeline mode already exists (`src/preview/session.ts:12`).
  - The active segment renders its bound component in a `Scene` with `timeMs = localTime(segment, t)`.
  - The next segment is preloaded; gaps are black void.
  - No second clock, and no capture bridge (export remains `velora render`).
- Audio:
  - one `<audio>` per track from `assetUrls`;
  - play/seek maps the cursor to `currentTime` with drift correction (|drift| > 50 ms → resync);
  - gain and fades computed deterministically from the cursor.
- Captions: `parseCaptions` (core); the active cue is drawn in a chrome-marked overlay.
- Segment strip: blocks proportional to duration, with recipe titles, snapshot thumbnails, transition markers, cue ticks and markers (06).
- Keyboard:

  | Key | Action |
  |---|---|
  | Space | Play/pause |
  | J / K / L | Shuttle back / pause / forward (rate 1×, 2×, 4× via a session `rate`; still one cursor) |
  | ← / → | Step one frame (`frameAt`/`timeAtFrame`) |
  | Shift+← / Shift+→ | Step one second |
  | [ / ] | Previous/next segment (existing `seekPrev`/`seekNext`) |
  | Home / End | Jump to start/end |

### 03.7 Studio overlays — `src/preview/overlays.tsx`
- All overlays are chrome-marked and live outside capture.
- Rule-of-thirds grid.
- Title-safe (90%) and action-safe (93%) frames.
- 9:16 platform UI zones, labeled "approximate".
- **Focus peaking**: tints leaves whose `data-velora-blur` < 0.5 px, the cinema-camera focus aid.
- **Aspect preview**: shows a 16:9 / 9:16 / 1:1 / 4:5 crop of the current definition with cover framing, revealing what each platform loses.
- Toggles live in memory only, so exports (fresh page) never include them.

## Contracts
| Surface | Contract |
|---|---|
| Quick-shot URL | `velora-quick`, `velora-route`, `velora-params` (base64url JSON validated by `resolveTemplateParams`) |
| `ProjectPreview` | Passes `children` to the library; new optional `compositionModules`, `assetUrls` |
| Generated adapters | New DEV-only globs; production output unchanged (verified by `check-installed`) |
| Session | Optional `rate` for shuttle; single cursor preserved |

## Files
- New: `src/preview/{TemplateGallery,QuickShot,ParamPanel,CompositionPlayer,overlays}.tsx`
- Modified:
  - `src/preview/{SceneLibrary,index,session,ScenePreview,modules,theme,library-theme}.ts(x)`
  - `src/project/{vite,portable,commands}.ts` (adapter generation + legacy upgrade)
  - `scripts/check-architecture.mjs` (`preview → kit` edge)

## Tests
- `tests/preview/gallery.test.tsx`: cards render from manifests; one live preview at a time; filters.
- `tests/preview/quick-shot.test.tsx`: params ↔ URL round trip; invalid params show diagnostics; copied commands are exact.
- `tests/preview/composition-player.test.tsx`:
  - cursor → segment/local-time mapping incl. gaps;
  - audio sync logic with a fake media element;
  - shuttle rates;
  - frame stepping at 24/30/60 fps.
- Browser journeys (`scripts/check-library.mjs` pattern):
  1. Open a quick shot on a fixture host, copy the export command, run it, and assert the MP4.
  2. Composition player plays through a boundary and captions appear.
  3. Keyboard shortcuts.
  4. Overlays never appear in exported frames.
- Performance evidence: gallery idle frame cost; single live preview frame budget.

## Validation criteria
- [ ] New user: `init` → open studio → Templates → pick `hero-push` → copy export → MP4 of their real page in ≤ 5 minutes with zero files written.
- [ ] Next.js App Router fixture: the route picker drives quick shots via RouteFrame.
- [ ] Composition player audio stays within 50 ms of the cursor over 30 s of playback.
- [ ] Production builds still exclude the studio (installed-artifact check).

## Anti-patterns
- Browser file writes or dev-server endpoints for saving.
- Several live previews running concurrently in the gallery.
- A second playback clock for audio or the composition.
- Overlays rendered inside the capture viewport without chrome markers.

## Definition of Done
All tests and validation green. `plan/v2/artifacts/phase-03-exit.md` includes the
time-to-first-MP4 transcript and screenshots of the gallery, quick shot and player.
