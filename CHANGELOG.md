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

### Changed
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
