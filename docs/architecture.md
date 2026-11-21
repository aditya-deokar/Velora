# Architecture

## Source of truth and linear flow

Morphite owns build order, slice contracts and ticket stages. Source comments identify WHAT each owner does, WHY it exists and WHERE consumers call it. `docs/product.md` owns product intent; this file owns the implementation map. The architecture checker permits only these two regular files in `docs/`.

1. A coding agent reads the installed `velora guide`, owned by `src/core/authoring.ts`. It edits scene source using the host's existing components and data.
2. `SceneSchema`, `MotionSchema` and `PreviewDefinitionSchema` validate the source. TypeScript types derive from these Zod contracts. `RESOURCES` binds `present-preview`, spatial/motion evaluation, authoring and project operations to canonical owners.
3. `src/core/preview.ts:presentPreview` delegates to existing scene/motion/authoring validation. It returns a valid revision or actionable issues; it does not perform I/O or duplicate focus math.
4. `src/preview/session.ts:usePreviewSession` keeps the last valid settings and a single elapsed presentation cursor. Playback, seeking, replay and capture share this cursor. Source changes pause playback, preserve time within the new duration and retain host component identity where React can do so.
5. `src/preview/ScenePreview.tsx` renders the real product chrome and passes validated configuration/time to `Scene`. `theme.ts` owns scoped plain rounded controls, bounded progressive backdrop blur and responsive overlay layout; it never resets host component styles. The viewport stays black. `app/main.tsx` mounts SceneLibrary with an honest empty catalog; selected recipes use this same scene interface.
6. `src/react/index.tsx` registers live surfaces through `registry.ts`, supplies untransformed layout measurements and calls core operations. `src/core/spatial.ts` alone computes camera transforms, camera-depth focus and filter weights. `FocusFilter.tsx` translates those weights into native browser filters.
7. `useSceneCapture` seeks the same session and exposes only its scene viewport. The browser Export menu formats a CLI command; `src/export/commands.ts` validates it and delegates capture/FFmpeg/filesystem effects to scoped services. No browser filesystem endpoint or fake download job is added.

## Installed application and development adapter

`src/preview/index.tsx:ProjectPreview` is the generated entry adapter. Its explicit development guard and initial `velora-preview=1` opt-in wrap an unmodified host through the same product shell. Providers, data and normal routes are preserved. `src/project/vite.ts` statically inspects supported entry/config forms; the trusted project command layer owns idempotency and scoped writes.

New integrations pass the host's `import.meta.hot`. `src/preview/connection.ts` subscribes to existing Vite update/error/connect/disconnect events and cleans up listeners. It creates no server, websocket or polling loop. Legacy generated wrappers without `hot` remain supported; add that optional prop to obtain connection status. Native Vite syntax-error overlays remain available.

The library discovers authored recipe/component pairs and supplies their shared ScenePreview. A custom low-level scene can still use ScenePreview on its own host route without the bootstrap query; shells must not be nested. Source syntax and component failures recover after correction. Invalid metadata retains the last valid settings; React error-boundary failures can remount the failed subtree, and full page reloads reset in-memory state. Recipe source persists as project files; in-memory playback and host state do not persist through reloads.

## Camera depth and live component composition

Scene version 3 owns `focus.distance/fStop/focalLength/maxBlur`. Projection lies at +perspective; point depth is perspective minus camera-space z. `focusForSurface` derives each plane's linear depth field. `sampleFocus` computes a thin-lens circle-of-confusion approximation and converts it to local-plane Gaussian sigma so CSS magnification applies once. Equal-depth points have equal sharpness, independent of screen position. Obsolete radial-focus properties reject explicitly.

The renderer uses two immutable raster alpha ramps (`depth-x.png`, `depth-y.png`) and native transfer tables. Zero-weight kernels are omitted without changing the result. `uniformFocusBlur` is the sole classifier for genuinely uniform/capped fields. No image document is rebuilt per frame, and no UI is cloned. This is a live-DOM Gaussian aperture approximation, not ray-traced aperture bokeh or inter-surface occlusion.

Nested spatial groups must keep `preserve-3d`; filtering a parent would flatten descendants. Each visible text/media region therefore belongs to a visual leaf or `content`. Registry diagnostics catch uncovered group/root text and media; capture rejects invalid scenes. Solid backing paint, pseudo-elements, portals, host clipping, competing transforms and unusual layout need deliberate composition. These checks are not universal CSS reconstruction.

## Boundaries and proof

Core is pure and browser/Node independent. React and preview are browser adapters. Project/export commands own operation policy; services alone perform filesystem, process and network effects. Browser preview may consume core/React, never project/export services. `scripts/check-architecture.mjs` inspects TypeScript AST imports, aliases, globals and named canonical owners. Violating fixtures prove rejection, including competing preview validators/session owners. Static checks do not detect arbitrarily renamed semantically equivalent math.

The default Vite build ships only the product entry. Demo applications, galleries, stored demo videos and their setup/publishing scripts are deleted. Automated fixtures remain exclusively under `tests/` and disposable temporary host directories. `vite.test.config.ts` produces `.test-dist`; these fixtures are absent from the product build and npm package.

`verify:reuse` extends `verify:iterate` with recipe discovery, installed multi-scene browser navigation, live file recovery, scrolling frame budgets and MP4 export. `verify:iterate` combines type checks, core/React/project tests, negative architecture fixtures, real browser focus pixels, product empty/loaded/error/mobile journeys, hardware frame budgets, installed package tests, video export and actual Vite source-edit/restart recovery. The installed iteration test modifies only its temporary host and removes it afterward. Capture samples explicit time; live hardware timing is a separate check. Measured FPS is evidence for the tested device/scene, not a universal performance promise.

## Current scope

Velora 1.0 covers React hosts, the starter, any-site mode, agent handoff, templates, kit, brand and looks, editorial tools, studio, master rendering, and launch delivery. v2.1 adds motion model v3, constraints, typed edit operations, a local edit bridge, and studio tools for editing the timeline, graph, and viewport. Motion design tools compile behavior and camera presets into the same clips and tracks used for preview and capture. The optional `/three` entry uses the same frame clock and registers typed Object3D channels and camera anchors. The editor consumes the registry and invokes its picking and gizmo interface without importing Three.js. The edit bridge and CLI share the project preset file policy. Previous demo and trial evidence remains in Morphite history.

### Motion model v3

`src/core/motion.ts` compiles validated tracks once per source revision and evaluates them by elapsed presentation time. Numeric tracks include monotone auto easing, smooth interpolation and seeded noise. Surface style tracks write explicit CSS variables. Color tracks use premultiplied OKLab. Typed animatables register their channels with the live scene registry.

### Clips, paths and constraints

Clips evaluate in their own timing windows. Trim, speed, easing and stagger map the same clock into those windows, and layers resolve through replace or additive composition. Cubic position paths use arc-length tables. Links resolve in dependency order. Spatial constraints derive aim or focal depth from evaluated points supplied by the scene registry.

### Edit operations and the bridge

`src/core/edit.ts` owns `EditOpSchema` and `applyEdits`. A validated batch produces sparse source JSON, a label and an inverse. Project commands use `formatJsonDocument` to preserve the existing layout, then call scoped filesystem services with the expected revision. The edit bridge accepts a bearer on loopback from the verified dev origin, checks the Host header and bounds requests. Read-only sessions can inspect sources and compute peaks. Bearers stay in the editor tab after the URL fragment is removed.

### Editor

`src/preview/EditMode.tsx` is the dynamic boundary into the scene and composition editors. The preview session owns the cursor and rendering. The editor owns selection, drag drafts, keyboard commands and history. Pointer-up commits one batch. A file change can rebase pending work or open a conflict state. Guide format 4 describes the same commands that **Ask agent** uses to hand off a focused edit.

### Source codemods

JSX outline and edits live in `src/project/source.ts` and `source-edit.ts`. They parse source with TypeScript, resolve the selected JSX node, and show the source and recipe diff before applying a guarded transaction. The journal recovers interrupted writes. Editor links can open source locations in the host's editor. The bridge declines the source-open endpoint.

### Three entry

`src/three/` targets React 19 with R3F 9 and Three.js as optional peers. `ThreeSurface` uses an absolute frame clock and can share the DOM camera. Meshes, lights, materials, camera and glTF animation expose typed channels. Picks and gizmos cross an imperative registry interface. Production React 18 hosts keep the base toolkit without the `/three` entry.

### Composition editing

`src/core/composition-edit.ts` reduces V1, overlay, audio, caption, transition and marker batches. It validates timeline windows through `src/core/timeline.ts`. The composition editor uses `CompositionPlayer` slots and the existing seek, shuttle and boundary transport. Waveform requests resolve declared audio assets in the command layer and cache bounded peaks from FFmpeg. The renderer samples each segment at its source offset. Studio previews an sRGB transition blend, with linear-light compositing in export.

## Source recipe catalog and library

`src/core/recipes.ts` owns `SceneRecipeSchema` (recipe version 1, containing scene version 3), fixed local naming and `loadSceneRecipes`, registered as `RESOURCES['resolve-recipes']`. The `list-scenes`, `load-scene` and `open-scene` request schemas also live in core/recipes and bind once in RESOURCES. It validates each recipe with the existing preview contract, excludes conflicting IDs, checks binding paths and produces the same ordered catalog/selection diagnostics for every caller. `src/project/recipes.ts` loads through scoped services; it never executes TSX. CLI `scenes`, `load --scene` and `open --scene` call this command boundary. Open delegates existing project identity/dev-server verification before forming the selected URL.

The generated local preview adapter supplies a DEV-only **lazy** module glob for `src/velora/scenes/*.{scene.json,tsx}`. `src/preview/modules.tsx` loads these trusted host modules only after preview opt-in. `SceneLibrary` supplies their JSON and binding paths to the same canonical operation; each selected default component reuses the application's real provider and Surface subtrees. Providers inside the original normal-app render are not implicitly available to a replacement scene: compose the original provider explicitly in the bound component, or place the preview under that provider. Helpers live outside the discovery directory. JSON is data; only the host bundler executes the host's explicitly authored TSX.

Home is the discovered list. URL `velora-scene` selects a recipe; back/forward and refresh use the same source identity. The list uses canonical Scene/Surface focus and a fixed camera. Native scrolling translates a common parent along its local plane; rows are mounted for the projected viewport plus an offscreen buffer using the canonical camera matrix. The heading stays mounted. Leading/trailing scroll space aligns the first and last row with the lens center; keyboard focus uses that same alignment. A mask outside the 3D scene fades the final composition at the top edge; rows are never culled merely for leaving the untransformed layout viewport. It creates no independent animation loop or permanent offscreen scene renders. Positive camera X tilt makes the top recede and the bottom approach. The fixed lens focuses at the viewport center with gentle near/far defocus and roughly three readable center rows; no screen-space blur math is duplicated. The selected scene uses the existing shared preview session, never duplicated playback controls.

ScenePreview owns one aspect-preserving cover frame: the capture box fills the viewport, the authored scene scales uniformly to cover it and excess edges are cropped. Preview and export share this framing. Scene controls occupy a bottom overlay with a few bounded, static backdrop-filter/mask layers. These interface layers are separate from the camera-depth renderer. Export hides the semantic `data-velora-preview-chrome` markers only in its private browser page before sampling. The user preview remains unchanged. `local-project/` is the newly authorized, separate installed-package host for visual review; it is excluded from production and package builds. Its ten recipes reuse the Orbit dashboard's own components/data; they are test fixtures, not cinematic templates or the product’s visual standard. The managed host rebuilds Vite’s dependency cache on startup so repacked local releases cannot show stale UI. Previous demo directories remain retired.

`SceneSnapshotSchema` and `SnapshotSceneSchema` in core/recipes own bounded embedded PNG metadata and snapshot requests, registered as `snapshot-scene`. `executeSceneSnapshot` in export/commands reuses verified `open-scene`, the existing browser capture bridge and scoped compare-before-write services. It seeks one frame, excludes chrome, and saves it in the recipe only if the source has not changed. Static scenes expose the same zero-duration bridge; video export still requires positive duration. SceneLibrary renders inert image tiles with a number fallback; it never mounts a scene per thumbnail. Cached images contain the host pixels captured at that moment and are regenerated through `velora snapshot` after scene edits. No remote image service, continuous thumbnail rendering or new browser filesystem endpoint is introduced.

## Open-source installation and agent handoff

`src/core/branding.ts:VELORA_BRAND` owns product attribution and the verified creator link. CLI, installed guide and studio consume it; the architecture checker rejects competing named owners. `getAuthoringGuide` includes a schema-validated executable file-pair example, alongside concepts that permit different compositions. The example illustrates API wiring, not a fixed artistic template.

`init-project` creates a short root `VELORA.md` pointing to the installed guide and returns handoff metadata plus a copyable prompt. Its existing trusted command owns policy; services perform exclusive scoped writes. Repeated initialization preserves the same bytes. Unrelated/edited documents and symlinks fail before mutation; no AGENTS.md, CLAUDE.md or provider configuration is overwritten. One installed app has one catalog.

The source is MIT licensed. `release:local` creates an npm tarball after `prepack` builds/checks the actual source. Package allowlists exclude product test hosts and fixtures. No registry publication or hosted service is required to install the tarball. `verify:agent` extends the existing complete integration gate with the exact installed guide example and an independently authored coding-agent revision in a disposable host. Trial source/evidence lives under tests/agent, excluded from the package; claims apply to the tested agent and host, not every LLM/framework.

The installed entry delegates to generated `src/velora/ProjectPreview.tsx` (JSX for a JSX host entry). This component-only React refresh boundary owns its own Vite hot context and lazy scene glob. Recipe metadata updates therefore refresh the adapter instead of reexecuting the app root. The project command owns create-only adapter installation, legacy wrapper migration and interruption recovery; it refuses unrelated generated-path contents. It delegates rendering to the existing package ProjectPreview, with no copied scene or playback logic. Full browser reloads still reset in-memory host state.

## Public distribution

`scripts/release.mjs` owns public package identity, packed-file validation and publication of the checked artifact. The manifest owns version, exports, bin, license and registry visibility; the lockfile must agree. Builds clean library output and finalize the CLI executable bit. Negative release tests reject missing entries, unexpected files, private access, consumer install hooks, and mismatched repository/tag metadata. Distribution consumes the existing installer and installed guide; it introduces no alternate application operations.

`verify:release` runs the complete hardware/behavior gate plus release checks locally. `verify:ci` remains a local alternative without hardware timing qualification. No GitHub workflow invokes either command. The iteration fixture detaches the old page before replacing modules, saves complete source atomically, and waits for rendered app readiness; HMR identity and negative recovery checks remain live afterward. Gate logs live in `.release/logs/` so Playwright cleanup cannot delete earlier results. Installation tests allow registry downloads and do not require the maintainer's prepopulated npm cache.

The GitHub publish workflow accepts version/packaging changes on `main` or a manual retry on `main`, using the `npm` environment and OIDC. `publicationStatus` in `scripts/release.mjs` validates package/repository identity and registry responses before deciding to skip an existing version or publish a newer one. Registry outages, malformed data and version regressions fail closed. A skip avoids dependency installation and build; a new version runs only `build:package` and artifact validation/publication, with lifecycle tests suppressed. Publishing installs no browser or FFmpeg and uploads no artifacts. A separate `ci.yml` workflow runs the fast gates on Linux, Windows and macOS plus a Linux browser/export tier on every push and pull request; hardware timing and `verify:release` remain local maintainer gates. `test:published` reuses the installed-host/agent/revision/browser/export proof against the exact registry version in a fresh cache. The public repository is `aditya-deokar/Velora`, and the package is `@adityadeokar/velora`. `src/core/branding.ts:VELORA_PACKAGE` owns that identity: generated adapters, installation checks, the guide example and VELORA.md consume it, and `init` upgrades adapter/handoff bytes written under the earlier unscoped name. An installation under only the earlier name is reported, never served with imports it cannot resolve. The old unpublished namespace is retired. The original independent agent-trial hash remains unchanged: its verifier normalizes only the public-package import rename before comparing the original binding. Public readiness requires registry installation evidence. Morphite ticket e9b3412e-51bf-4837-9c59-0c4e77d3fd47 owns this additional release slice; the six completed local MVP slices remain completed. Version 0.1.0 was published on 2026-09-15 after npm 2FA approval. Its public tarball integrity matches the checked artifact; the fresh-registry `test:published` passed installation, guide, studio, metadata revision, host identity, snapshots, 30 FPS MP4 and production exclusion. GitHub Node 22.12/24 and the full local release gate passed. The initial registry-listing delay resolved before acceptance. The npm trusted-publisher connection and direct `npm publish` permission were subsequently confirmed in the account UI; first publication used the verified manual command. Publication now follows `main` version bumps rather than tags.

The generated adapter returns original children at compile time in production. Package side-effect metadata permits tree-shaking browser modules while retaining the CLI executable. The installed artifact check inspects the real production assets to ensure unused studio/capture code is absent.


## Motion engine v2

`src/core/easing.ts:applyEasing` is the single easing evaluator: the legacy linear/easeInOut/cinematic curves keep their exact math, joined by the sine through bounce families, CSS-parity cubic-bezier, a closed-form damped spring normalized to its segment, steps and hold. `src/core/motion.ts` owns tracks: optional `interpolation: "smooth"` evaluates a monotone cubic Hermite (Fritsch-Carlson) through every keyframe with a track-level `ease`, so camera rails never stop at waypoints; seeded `noise` (`src/core/noise.ts`) adds replayable texture to position, rotation and channel tracks; camera `perspective` is animatable; channel tracks feed `useChannel`; and surface `blur`/`clip*` properties style only the content leaf, so masks and artistic blur never flatten spatial groups. `motion.loop` wraps preview playback only, and `loopSeam` reports discontinuities. Every new field is optional without defaults, so existing recipes parse and evaluate byte-identically (a golden of every committed recipe enforces this). `src/core/lens.ts` maps full-frame millimetres to perspective (frameHeight × mm / 24). `src/core/schemas.ts:jsonSchemas` derives the shipped editor schemas in `schemas/`; `src/core/json.ts:parseJsonDocument` accepts BOM-prefixed hand-edited JSON.

## Shot library, templates and kit

`src/core/shots.ts:buildShot` compiles the camera-move vocabulary (push-in, survey, orbit, crane, rise, dolly zoom, rack focus, scroll-through, macro, float loop, handheld push, whip) into plain scene + motion data for one centered `subject` Surface, choosing lenses through `lensFor` and smooth rails with a track ease. `framingReport` projects a grid over the subject through the same `matrixFor` camera matrix and thin-lens `sampleFocus` the renderer uses, reporting in-frame fraction, camera-plane margin and focus blur. `src/core/templates.ts` owns the template catalog as data (`TEMPLATE_CATALOG`, `BLUEPRINT_CATALOG`): typed params with CLI coercion, craft notes, supported aspects and certification thresholds; `certifyTemplate` gates every template x aspect x intensity in tests and in `velora templates check`. There is no runtime template engine: `src/project/templates.ts` generates ordinary recipe JSON (with optional `template` provenance) and a binding, and `executeTemplateCommand` (project/commands) validates every input before create-only writes, then re-validates the pair through `discoverRecipes`. `src/kit/` is a browser layer over core and react (registered in the architecture checker, exported as `@adityadeokar/velora/kit`): `RouteFrame` frames a same-origin route with channel-driven scroll and paused page animations, `ScrollFrame` scrolls a component from a channel, and `SlotPlaceholder` marks unfilled slots. `useCaptureSettle` lets such components finish asynchronous work after each capture seek; the bridge returns a promise only when settlers exist, and export services already await it. `velora frames --contact-sheet` composes the extracted frames into one storyboard PNG in export services.

## Studio v2: gallery, quick shots and composition player

The development library (`SceneLibrary`) has three URL-addressed tabs: Scenes, Templates and Compositions (`velora-tab`). `TemplateGallery` draws every template as a schematic storyboard: `projectSubject` (core/shots) projects the subject plane at the start, middle and end of the shot, with no render. Only the hovered or focused card runs one live mini preview. `QuickShot` applies a template to the live app with zero source files. Its subject slot holds the host's own children, which `ProjectPreview` now passes through, or a same-origin `RouteFrame` when the host has no children (the Next studio route). The URL carries the whole shot: `velora-quick`, `velora-route` and `velora-params` (base64url JSON). It is decoded by core `readQuickShot`, so reload, deep links and `velora export --url` reproduce exactly what the panel shows. `ParamPanel` edits a draft immediately and replaces the URL once per animation frame. It copies exact commands from `quickShotCommands` and never writes files. `CompositionPlayer` drives one `usePreviewSession` cursor in timeline mode, with a motionless carrier definition and a signed shuttle `rate`. The active segment renders at its local time and the next segment is preloaded hidden. Gaps are void, transitions are strip markers only, captions come from core `parseCaptions`, and audio elements follow the cursor through `syncMedia`, resyncing past 50 ms. It has no capture bridge; export stays `velora render`. `useTransportKeys` maps Space, J/K/L, arrows (frame/second), `[`/`]` and Home/End onto the session. `StudioOverlays` draws thirds, title/action safe, approximate 9:16 platform zones, an aspect-crop mask and focus peaking. Each layer is chrome-marked, and its toggles live in memory, so exported frames never include them. The generated Vite adapter adds DEV-only `compositionModules` (root `*.composition.json`) and eager `assetUrls` (audio and caption URLs). Framework catalogs written by `velora sync` register root compositions in the same `sceneModules` registry. `init` recognizes and upgrades the pre-studio adapter bytes.

## Render cache and memory

Frame-cache keys include the recipe, binding and a host source fingerprint (`hostFingerprint` in `src/export/services.ts`: sorted path, size and mtime of project source and asset files plus the lockfile, excluding dependency, build and cache directories). Editing an imported host component or stylesheet therefore invalidates cached frames; above the file cap that command renders without the cache rather than serving stale pixels. Composition video renders spill each frame to a temporary PNG sequence and encode it through FFmpeg's image2 demuxer, so memory stays bounded by one frame per worker regardless of length.

## Master-quality finishing and delivery formats

`src/core/export.ts` owns the finishing vocabulary:

- `QualityPresetSchema` and `QUALITY_PRESETS`:
  - **draft:** 0.5x capture, x264 veryfast, CRF 26;
  - **standard:** 1x, slow, CRF 18;
  - **master:** 2x supersampling, slower, CRF 14, 180° blur with 8 samples.
- `VideoCodecSchema` with `CODEC_CONTAINERS` and `ALPHA_CODECS`.
- `resolveFinishing`: explicit flags win over the preset, and supersampling never exceeds a 3840 px capture side.
- `shutterSamples`: a trailing shutter, clamped at the scene end.
- Frame rates 24, 25, 30, 50, 60 and 120.

`src/export/compositor.ts` holds the PNG codec, which moved out of services, and `composite`:

- It averages motion-blur sub-frames and box-downscales supersampled captures in linear light, with premultiplied alpha.
- It rounds half to even back to sRGB.
- A single frame at factor 1 is returned unchanged.

`finishFrame` in `export/commands` is the one path render, export and shot share:

- It captures the shutter samples. In render they are cached per local time under a capture-variant key, so standard cache keys are unchanged.
- It skips averaging when every sample is identical, so static frames stay byte-identical to an unblurred render.
- Then it composites.

`videoEncodeArgs` is pure and builds per-codec FFmpeg arguments:

- Every codec except GIF converts full-range sRGB to limited-range BT.709. `setparams` stamps frame properties, which FFmpeg 7+ prefers over output flags, and the output flags tag the stream.
- VP9 (`yuva420p`) and ProRes 4444 (`yuva444p10le`) keep alpha.
- GIF builds its palette and dithers in one filter graph.

Transparent capture is capture-only: export services inject a transparent-background stylesheet and screenshot with `omitBackground`, so the preview's black void is untouched.

`src/core/delivery.ts` holds the platform presets (`DELIVERY_PRESETS`, each with `lastVerified`). `deliveryWarnings` reports budget and fit warnings and never fails a render.

Render publication refuses an existing video, manifest or poster before capturing anything. Non-MP4 manifests keep their container extension. `velora doctor` lists the available encoders, and a missing one fails fast with `ERR_CODEC_UNAVAILABLE`.

## Visual kit, brand, looks and Wave 2 templates

**Kit (`src/kit/`).** Every component is a pure function of scene time, channels, seeds and brand tokens: no rAF, timers or wall clock.

| Group | Components |
|---|---|
| Framing | `BrowserFrame`, `WindowFrame`, `PhoneFrame`, `TabletFrame`, `LaptopFrame` (CSS-only) |
| Atmosphere | `Backdrop` (gradient, mesh, aurora, grid-floor, spotlight, solid), `Glow`, `ContactShadow`, `LightSweep`, `Dust` (seeded) |
| Interaction | `Cursor` (channels `<id>-x`/`-y`/`-press`), `Typewriter`, `Spotlight`, `Callout` |
| Type | `Title` (masked `Intl.Segmenter` reveals, accent word), `Counter`, `Countdown`, `Panel`, `Marquee`, `GradientText`, `CaptionTrack` |
| Media | `VideoClip` (seeked per frame, settled before capture), `ImageLayer` |

**Brand (`src/core/brand.ts`).** `velora.brand.json` (`BrandSchema`, JSON Schema shipped) holds colors, gradients, fonts, radius, voice and a motion personality. `MOTION_PERSONALITIES` maps calm, crisp, playful and bold to easing, duration scale and stagger.

- `BrandProvider` exposes the tokens through context and CSS variables on a `display: contents` wrapper, so it adds no box to the 3D tree.
- `useReveal`/`useRevealer` turn scene time into eased progress.
- `velora brand init` seeds tokens from CSS custom properties with a tokenizer, completes the palette for light or dark backgrounds, and never overwrites. `velora brand check` validates and warns on text contrast below 4.5:1.

**Looks (`src/core/looks.ts`).** `look` sits on a recipe definition or a composition; a scene's own look wins. There are two layers:

- **Browser layer** (`LookLayer`, captured with the frame): an SVG grade, vignette, letterbox and grain seeded per 24 fps grain frame.
- **Export finishing** (`finishLook` in `export/compositor.ts`, applied by `finishFrame` after compositing): bloom, halation, chromatic aberration, sharpen and trilinear `.cube` LUTs. Because it's applied in one place, `velora shot --finish`, frame renders and video frames match.

An inherited composition look reaches its scenes through a `velora-look` URL parameter and keys the frame cache.

**Safety (`src/core/safety.ts`).** `velora check` runs two analyses:

- `flash-safety`, a WCAG 2.3.1 approximation over an 8×8 grid: general and red flashes, more than 3 per second over at least 10% of the frame fails. It runs on consecutive frames, or on every decoded video frame.
- `banding`, which is advisory only.

**Wave 2 templates (`src/core/composites.ts`).** Eight layered real-UI and ten motion-graphics templates compile to scene nodes, motion and a layout of kit elements as data. One description serves three consumers:

- the scaffolder (`project/templates.ts:layoutJsx` writes plain TSX with a `Surface` per node, inside `BrandProvider`);
- the studio (`preview/TemplateLayout.tsx` renders the same layout live);
- certification: primary-node framing, title-safe placement for motion graphics, and reading time of at least 0.3 s per word plus 1 s.

Text params (`--set key=value`) carry copy.

## Editorial: layers, A/B transitions, rhythm, sound and review

**Transitions.** `SegmentTransitionSchema` has two modes:
- **Entering** (inside the incoming scene's tracks).
- **Overlap** (true A/B): crossfade, dip-to-black/white, wipe, iris, push, zoom, whip and light-leak, with `direction`, `ease`, `seed` and `sfx`.

`validateTimeline` allows exactly one kind of V1 overlap: the declared window of an overlap transition, shorter than both shots, never three-way. `layersAt` resolves the segments at a time and the eased blend progress.

**Rendering in layers.** `renderTimelineFrames` renders capture units, each with explicit local times:
- V1 segments;
- `overlays[]`, captured transparently;
- the styled-captions layer, a captions scene that `ProjectPreview` opens from `velora-captions` URL parameters and that draws kit `CaptionTrack` with word timing.

A frame with a single segment and no overlays keeps its capture bytes, so plain timelines are unchanged. Layered frames are blended (`blendTransition`) and composited (`compositeOverlay`, normal, screen or multiply) in linear light. Video mode spills layer frames to disk. Manifests record layer SHAs.

**Composition player.** It mirrors this with CSS approximations (`blendStyle`); both endpoints match exactly.

**Rhythm (`src/core/rhythm.ts`).**
- STFT spectral flux, onsets refined in the time domain, autocorrelation tempo (60-180 BPM) with an octave check, a least-squares beat grid, and 4/4 downbeats by accent.
- `snapToBeats` plans cut moves that keep segments joined.
- `velora audio beats` writes markers and `velora compose snap` applies the plan only with `--write`.

**Sound (`src/core/sound.ts`).**
- Seeded lavfi graphs for eight SFX presets, rendered to WAVs (bit-exact).
- `transition.sfx` lands at the cut (mid-window for overlap transitions).
- Two-pass `loudnorm` to `loudness` (default -14 LUFS / -1 dBTP). It is skipped when the mix is too short to gate, and recorded in the manifest.

**Review (`src/core/editorial.ts`).** `reviewComposition` reports advisories only: hook, pacing per platform, reading time, end card, eye-trace jump, match-cut drift, direction flip, loop seam and off-beat cut.

**Blueprints.** Wave 3 blueprints scaffold shots, overlap transitions with sound, overlay scenes (`backdrop=off`), section and music-cue markers, a karaoke caption skeleton and a story brief.

## Director skills, guide v3 and the prompt library

**Prompt library (`src/core/prompts.ts`).** `PROMPT_LIBRARY` holds the agent prompts for each launch intent: id, title, intent, text with `<placeholders>`, the templates it starts from, and at most four skills. One library feeds three places:
- `velora prompts ls|show`;
- the featured list in the generated `VELORA.md`;
- the studio's copy buttons (`GettingStarted` goal picker, and `ParamPanel` through `scaffoldPrompt`).

Tests check every named template, skill, command, flag and preset against the catalogs.

**Guide v3.** `AuthoringGuideSchema.version` is 3. It adds concepts for templates, shot vocabulary, lens, editing rhythm, and brand and looks. Capabilities point at commands (prompts, editorial, brand, presets) rather than embedding catalogs. The `VELORA.md` handoff records format 3. `init` still recognizes the format-2 handoff bytes (any package name, Vite and portable hosts) and upgrades them in place; edited files are refused.

**Skills.** The root skill is an intent router: each intent names at most four skills, and tests resolve every row against the registry. `velora-launch` covers the brief, story structures, platform pacing, deliverables and website hero practice. Craft skills carry descriptive Craft Notes and cross-link one another.

**Validation.** `velora validate --composition` runs the same timeline gate as render (overlap windows, three-way overlaps), so a bad cut fails before any capture.

## Launch delivery

`src/core/deliverables.ts` owns the delivery plan. It is pure and depends only on core:
- the target vocabulary (`DELIVER_TARGETS`: short names to `DELIVERY_PRESETS` and a kind: video, website-hero, still, product-hunt);
- `sizeLadder`: per-codec CRF or GIF frame-rate steps, deterministic and monotonic;
- `heroTimeMs`: the middle of the longest shot; `galleryTimesMs`: 25/50/75%;
- the website-hero snippets (`heroEmbedHtml`, `heroVideoTsx`);
- `DeliverablesManifestSchema`.

`executeDeliver` lives in `src/export/commands.ts` because it orchestrates `executeVideoRender` and `executeFrameRender`.
- **Per target:** it renders at the preset's size, codec and quality. The composition's loudness wins; otherwise the preset's target applies.
- **Size budget:** it climbs the ladder until the file fits the preset's byte budget. The internal `crf` render option overrides rate control and has no CLI flag. Captured frames come from the content-hash cache, so retries only re-encode.
- **Publishing:** attempts render into `<out>/.velora-attempts/` and the chosen one is published with a no-overwrite hard link (`promoteFile`).
- **Stills:** cover-cropped by FFmpeg (`encodeStill`).
- **Output:** the directory must be new. `deliverables.json` records files, SHA-256, sizes, attempts, measured loudness, warnings and each preset's `lastVerified` date.

## Starter

`src/project/starter.ts` (pure) plans the `velora create <dir>` file set:
- a Vite React host with a branded landing page;
- `velora.brand.json`, a README and `.gitignore`;
- npm scripts: `velora:setup` runs init, installs the skills and scaffolds the blueprint.

`executeCreateCommand` writes them create-only into a new or empty directory. Product names are stripped of markup before they reach HTML, CSS or TSX.

## Any-site mode

`src/project/studio.ts` (pure) plans a managed studio for non-React sites; `executeStudioCommand` (project commands) runs it through services.

- **Workspace.** It lives at `<user cache>/velora/studio-<version>/` (`VELORA_CACHE_DIR` overrides) and installs pinned `react`, `react-dom`, `vite` and `@vitejs/plugin-react` once. `@adityadeokar/velora`, `/preview` and `/kit` are aliased to the running CLI's own `dist/library`. `resolve.dedupe` gives the studio, the library and the project's bindings one React. The user's project gains only `.velora/project.json` (adapter `site`, the site origin), `VELORA.md`, its scenes, compositions and assets. React, Vite and `package.json` never enter it, and the frame cache defaults to `.velora/cache/frames` there.
- **Proxy.** The studio is served under `base: "/__velora/"`. Every other path, including WebSockets, is proxied to the loopback site (`STUDIO_PROXY_PATTERN` excludes the studio base and Vite internals), so `RouteFrame` routes are same-origin. In this development proxy only, `X-Frame-Options` and CSP `frame-ancestors` are removed.
- **Project loading.** Project files reach the studio through Vite's `/@fs/` server. The studio entry sets `__VELORA_PROJECT_FILES__`, so `projectFileUrl` (captions, brand) never fetches from the proxied site root. `previewBase` gives capture and the captions layer `<origin>/__velora/`.
- **Diagnostics:**
  - `ERR_SITE_NOT_LOOPBACK`, `ERR_SITE_UNREACHABLE`, `ERR_SITE_REDIRECT_EXTERNAL`, `ERR_STUDIO_FAILED`;
  - `WARN_SITE_FRAME_HEADERS` when headers were stripped;
  - `velora studio --check` verifies the studio identity, the proxy and framing, then stops.
- **Limits.** Shots are route-level, the site's animations are frozen, and states must be reachable by route or query.

## 1.0 hardening and compatibility

- **Compatibility.** Schemas evolve additively within a major version (old CLIs reject unknown fields, so minor versions are forward-only). A breaking change bumps the file's `version` (recipe, composition, brand, guide) and ships an upgrade path, as `velora init` does for older adapters and guide-v2 handoffs. Deprecations warn for one minor version before removal.
- **Security review (pinned by `tests/project/security.test.ts`):**
  - capture and export URLs are HTTP loopback without credentials, and the site proxy targets loopback only;
  - `RouteFrame` refuses cross-origin documents;
  - every write is project-scoped and no-overwrite;
  - child processes take argument arrays. The Windows shell is used only for `npm.cmd`, and refuses cmd metacharacters;
  - FFmpeg filter graphs interpolate no user text: subtitle and font paths with quotes or line breaks are refused, and SFX and looks come from schemas.
- **Package budget.** `scripts/release.mjs` (`PACKAGE_BUDGET`): 6 MB unpacked, 2 MB per file. `website/`, tests and demo media can never be packed.
- **CI.** Fast gates and the browser, export and installed-app tier run on Linux, Windows and macOS. Agent-demo replay, any-site mode (`test:site`) and hardware timing need registry access or real hardware, and stay local release gates.
- **Performance evidence** is recorded per release in the exit reports (device-specific, never promised).

## Framework-independent host integration

`ProjectPreview` is the shared React DOM boundary: `projectId`, host-owned `enabled`, optional route-based `active`, lazy `sceneModules`, optional `compositionModules`/`assetUrls`, and children (forwarded to quick shots). It imports no Next/Vite/Electron runtime. Server hydration uses a stable initial URL snapshot. The packaged React entry points retain a client directive for RSC-aware bundlers. Supported peers are React/React DOM 18.2+ and 19; the CLI verifies installed peers rather than requiring React 19.2.

`executeProjectCommand` owns setup, validation and `sync-project` through RESOURCES. Vite's existing AST adapter remains an optional entry connector. `portableIntegration` in `src/project/portable.ts` generates the same shared wrapper for arbitrary React hosts. Its Next connection only adds a development-only /velora route plus an SSR-disabled client loader; layouts, config and host providers are untouched. Custom Vite/Electron entries also fall back to the portable connection before any host entry writes; existing integrations and pending journals retain their established identity. Other React wrappers receive an explicit wiring instruction and host development flag, not a guessed root rewrite. Electron uses its existing renderer, with main/preload untouched. Next client scene imports cannot import server-only components; supply server data through the host boundary.

`discoverRecipes` in `src/project/discovery.ts` owns scoped reads and calls canonical RESOURCES recipe validation. `portableCatalog` generates ordinary static imports for bundlers without a glob. JSX and TSX bindings share the same recipe contract, with ambiguous pairs rejected. `velora sync` updates imports when file pairs are added/removed; metadata edits use native host HMR. All generated files have exact ownership records, path/symlink checks and journaled recovery; unrelated files are never overwritten. There is no second renderer, scene validator or playback clock.

Local installed-package checks exercise Next App Router on React 19, Pages Router on React 18 and a separate esbuild React 18 renderer without Vite/Next. They verify studio interaction, provider context, retry/sync, hot-reload identity and Next production-route exclusion. These checks stay local alongside the original Vite regression suite.

## Terminal onboarding

`src/cli/terminal.ts` owns Amethyst lettering, color capability fallbacks and human setup formatting. It consumes canonical `ProjectResult` and `VELORA_BRAND`; it never discovers hosts or changes installation policy. `cli/main.ts` supplies TTY width/color support and a build-injected version from `package.json`. Interactive init prints a real pending message before the operation, followed by confirmed results; retries say verified rather than added. Unknown React hosts keep their explicit connection step. Pipes and NO_COLOR remain plain, narrow terminals use a compact wordmark, and JSON bypasses all presentation. CLI tests cover these alternate entry points and failed setup/open recovery.

## App stage and output frame

`definition.stage` holds authored CSS dimensions and a DPR. `AppStage` makes a size container inside a Surface. A nested `RouteFrame` can fill that container so its window media queries use the same CSS dimensions in preview and export. In-tree components can use container queries or `useAppStage()`.

Capture uses the recipe or bridge stage DPR as a quality floor. The output frame sets the screenshot viewport and receives the linear-light downscale. A capture cap changes the device scale and is recorded in the stage lineage. When a recipe omits the stage, its existing layout and capture scaling apply.

## Editor and edit bridge

- **One vocabulary.** Every edit is a typed `EditOp` (`src/core/edit.ts`) applied by the pure reducer `applyEdits`, which validates through `SceneRecipeSchema` and `presentPreview` and returns exact inverses. `formatJsonDocument` (`src/core/json.ts`) writes the result while keeping author layout. `velora edit` (`src/project/edit.ts`) applies batches from the CLI; dry runs print diffs, and `--write` is compare-and-swap.
- **The bridge.** `velora edit` (or `velora studio --site … --edit`) starts a loopback HTTP server (`src/project/services/bridge.ts`) after verifying the dev server. It accepts only the verified origin, a bearer token passed in the URL fragment, matching Host headers, bounded JSON bodies and the scene files the policy allows. A watcher streams file changes to the editor.
- **The editor layer.** `src/editor/**` is lazy-loaded by `src/preview/EditMode.tsx` (the only allowed preview → editor edge, a dynamic import; the architecture checker enforces it and the editor never imports project, export or Three.js modules). `createEditorStore` holds the base recipe and SHA, pending and transient ops, the derived draft, history and save state with one write in flight. Drafts are ordinary definitions for the one preview session: no second clock, evaluator or validator. `intentToOps` implements the property-change rules once, and `EDITOR_COMMANDS` is the single registry for shortcuts, the palette and menus.
- **Scene data.** Editor panels read a live Scene through `useSceneInspector` (`src/react/inspector.ts`): plain, frozen snapshots of bindings, measurements, animatables, evaluated nodes and motion state, published through a channel that `ScenePreview` creates in `layout="editor"`.
- **Capture safety.** Every editor element is chrome-marked (`data-velora-preview-chrome`); the copied export URL strips `velora-edit` and the fragment, so captures never load the editor.

