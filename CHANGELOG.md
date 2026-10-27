# Changelog

All notable changes to `@adityadeokar/velora` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — Motion Engine v2
- **Easing library:** sine, quad, cubic, quart, quint, expo, circ, back, elastic and bounce families
  (`.in`, `.out`, `.inOut`), CSS-parity `{ cubicBezier: [x1, y1, x2, y2] }`, damped `{ spring: { stiffness, damping, mass } }`,
  `{ steps: n }` and `hold`. Legacy `linear`, `easeInOut` and `cinematic` are unchanged.
- **Smooth camera paths:** `interpolation: "smooth"` passes through every waypoint with continuous velocity;
  a track-level `ease` accelerates and settles the whole rail once.
- **Lens language:** animatable camera `perspective` (dolly zoom) and `lensFor` / `perspectiveForFocalLength`
  for 24–135 mm full-frame lenses.
- **Handheld texture:** seeded, replayable `noise` on position, rotation and channel tracks.
- **Channels:** `{ kind: "channel", id }` tracks drive component state through `useChannel(id)`.
- **True masks and blur:** surface `clipTop/Right/Bottom/Left`, `clipRadius` and `blur` on content leaves.
  `wipe-mask`, `iris-mask` and the `mask-reveal` kinetic preset are now true masks instead of travel/fade approximations.
- **Seamless loops:** `motion.loop` wraps preview playback; `loopSeam` and the `loop-seam` advice catch jumps.
- **Advice:** `camera-overshoot` and `smooth-easing-ignored` checks in `reviewAuthoring`.
- **Editor autocomplete:** JSON Schemas ship in `schemas/`; recipes and compositions accept `$schema`.

### Added — Shot library and templates
- **12 certified camera templates:** `hero-push`, `monumental-survey`, `orbit-reveal`, `crane-down`, `tilt-up-reveal`,
  `dolly-zoom`, `rack-focus`, `scroll-through`, `macro-detail`, `float-loop`, `handheld-push`, `whip-pan`. Each is certified
  in 16:9, 21:9, 1:1, 4:5 and 9:16 at subtle, standard and dramatic intensity (subject framed, clear of the camera
  plane, focus region sharp at the end).
- **Blueprints:** `product-reel-20s` and `website-hero-loop-8s`.
- `velora templates ls|show|check` and `velora new scene|video`. `--route /path` frames a page of the running app
  with zero code; `--component path#Export` slots a real component; `--set` repeats. Create-only.
- `@adityadeokar/velora/kit`: `RouteFrame`, `ScrollFrame`, `SlotPlaceholder`.
- `useCaptureSettle` for components that paint asynchronously before capture.
- Recipes record optional `template` provenance.
- `velora frames --contact-sheet [--columns N]` writes one storyboard PNG.
- `velora skills install --agent claude|generic` installs into `.claude/skills` / `.agents/skills` without `--dir`.
- New skills: `velora-templates`, `velora-cinematography`.

### Added — Master-quality render and delivery formats
- `--quality draft|standard|master` on `export` and `render`:
  - **draft:** half-size capture, fast encode.
  - **standard:** x264 slow, CRF 18 (the new default).
  - **master:** 2x supersampled capture, downscaled in linear light, CRF 14 and 180-degree motion blur.
- **Motion blur:** `--motion-blur DEG [--motion-samples N]` uses a trailing shutter averaged in linear light. Frames without movement stay byte-identical to an unblurred render. `velora shot --quality master --motion-blur 180` previews it on one frame.
- **Codecs:** `--codec h264|hevc|vp9|av1|prores4444|gif` writes `.mp4`, `.webm`, `.mov` or `.gif`.
- **Alpha:** `--transparent` writes VP9 (`yuva420p`) or ProRes 4444, so editors can composite UI over footage. The preview's black background is unchanged.
- **Frame rates:** 24, 25 and 50 fps join 30, 60 and 120.
- **Delivery presets:** `--preset` targets YouTube, Shorts, X, LinkedIn, Instagram, TikTok, website hero, README GIF, OG image and Product Hunt. Each preset is dated and reports budget warnings.
- **Aspect variants:** `--aspects 9:16,1:1` renders them in the same run.
- **Posters:** `--poster MS` writes `<name>.poster.png`.
- NDJSON progress lines add `fps`, `etaMs` and `stage`.
- Manifests record quality, codec, container, colorimetry, motion blur, supersampling, transparency, worker count and sub-frame SHAs.
- `velora doctor` lists available video codecs, and a missing encoder fails fast with `ERR_CODEC_UNAVAILABLE`.
- The studio export menu adds quality and format pickers. It still copies a command and writes nothing.

### Added — Studio v2
- **Library tabs:** Scenes | Templates | Compositions, kept in the URL (`velora-tab`) so back, forward and reload work.
- **Template gallery:** schematic storyboards for every template (no live render), one live mini preview on hover or focus,
  filters by tag and aspect, and blueprint cards with their `velora new video` command.
- **Quick shots:** try any template on the live app with zero source files. The URL (`velora-quick`, `velora-route`,
  `velora-params`) carries the whole shot, so `velora export --url '<quick-shot url>' --output shot.mp4` exports it directly.
  Hosts without children (Next.js studio route) frame a route through `RouteFrame` with a route field.
- **Param panel:** controls generated from each template's typed params plus aspect and route. Copy the exact
  scaffold command, export command or an agent prompt. The studio never writes files.
- **Composition player:** one cursor plays a whole composition, with hard cuts, black gaps, the next segment preloaded,
  audio synced within 50 ms, captions, and a segment strip with thumbnails and transition markers.
  Keyboard: Space, J/K/L shuttle (1x/2x/4x), ←/→ frame, Shift+←/→ second, `[`/`]` segment, Home/End.
- **Guides:** rule of thirds, title/action safe, approximate 9:16 platform zones, focus peaking and an aspect-crop preview.
  They are preview-only and never appear in exported frames.
- Generated Vite adapters add DEV-only composition and asset-URL globs; `velora init` upgrades earlier adapters in place.
  `velora sync` registers root `*.composition.json` files for Next.js and generic React hosts.

### Changed
- **Video colorimetry.** Video output now converts to limited-range BT.709 and is tagged as such. FFmpeg's untagged BT.601 default shifted colors in browsers.
- **Default encode.** H.264 now encodes at x264 `slow` with CRF 18 (previously `medium` with CRF 23). Files are sharper and encoding is slower; use `--quality draft` while iterating.
- **Render workers.** The render worker default is now cores minus one, capped at 8, and `--parallel` accepts up to 8.
- `mapGsapEasing` is lossless for every pure GSAP ease: `power1.out` now maps to `quad.out` and `expo.out`
  to `expo.out` (previously approximated as `cinematic`). `back`, `elastic`, `bounce` and `steps(n)` now convert.
  Only parameterized and plugin eases are rejected.
- `MotionState` (from `evaluateMotion`) gains a `channels` record.
- Recipes using the new fields need this Velora version or later; older versions reject unknown fields.

### Fixed
- Recipes, compositions and asset manifests saved with a UTF-8 byte-order mark (Notepad, Windows PowerShell 5.1)
  are no longer rejected as invalid JSON.
- **Installing the published package works end to end.** `velora init`, `doctor` and every generator
  now resolve `@adityadeokar/velora` through one canonical identity (`VELORA_PACKAGE` in
  `src/core/branding.ts`). Generated adapters import `@adityadeokar/velora/preview`, and the guide
  example, `VELORA.md`, skills and templates teach the scoped import. Previously a fresh
  `npm install @adityadeokar/velora && npx velora init` reported "Velora is not installed".
- Re-running `velora init` upgrades the preview adapter, Next/portable connection and `VELORA.md` written
  by earlier installers under the unscoped `velora` name. User-edited files are still refused.
  An installation under only the earlier name is reported with the exact install command.
- Frame-cache keys include a host source fingerprint, so editing an imported component, stylesheet,
  source image or the lockfile re-renders instead of serving stale frames. Render outputs,
  compositions, audio and captions do not invalidate cached scene frames.
- Composition video renders spill frames to a temporary PNG sequence and stream them into FFmpeg,
  keeping memory bounded for long renders. Encoder settings and output are unchanged.
- The `product-survey` template renders a real placeholder instead of an unpassed prop. The
  `webgl-stage` template is now a default-export `WebGLSurface` driven by scene time.
- USER_GUIDE: a schema-valid composition example (`*.composition.json`, `audio[]` tracks), correct
  scene export URLs, the sync step for non-Vite hosts, and an accurate description of PNG-frame capture.

### Added
- `.github/workflows/ci.yml`: fast gates on Linux, Windows and macOS with Node 22.12 and 24, plus a
  Linux browser, export and installed-app tier.
- Regression tests for package identity, legacy upgrades, cache invalidation, bounded video memory,
  shipped template validity and documentation examples.
- `plan/v2/`: the "Cinematic by Default" roadmap (phases 00–09) and the template catalog.

## [0.1.2]

- Agent-first CLI, composition timeline, audio and captions, transitions, procedural nodes,
  the WebGL leaf and the Velora skills library (see `plan/artifacts/` for phase exit reports).
