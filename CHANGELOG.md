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

### Added — Director skills, prompt library and guide v3
- **Prompt library:** `velora prompts ls` and `velora prompts show --id ID` print ready-to-paste agent prompts:
  `launch-film`, `feature-announcement`, `website-hero-loop`, `vertical-teaser`, `dashboard-cinematic`,
  `changelog-video`, `product-hunt-assets` and `first-scene`. The same prompts appear in `VELORA.md` and the
  studio's Getting started goal picker.
- **Guide v3:** new concepts for templates, shot vocabulary, lens language, editing rhythm, and brand and looks;
  capability pointers for prompts, editorial commands, brand and delivery presets. Re-running `velora init`
  upgrades a `VELORA.md` written for guide v2.
- **Skills:**
  - new `velora-launch`: brief, story structures, platform pacing, deliverables and website hero practice;
  - the root `velora` skill routes by intent, to at most four skills per intent, with the director's workflow;
  - Craft Notes and cross-links in the cinematography, editing, motion-design, brand, looks and templates skills;
  - the reference flag matrix now lists every command.
- **Agent demos C, D and E** (launch film, website hero loop, vertical teaser) replay in `test:agent-demos`.

### Fixed
- `velora validate --composition` now reports `ERR_TIMELINE_OVERLAP` (an overlap that differs from its transition,
  or a three-way overlap). Before, only render caught it.
- `social-teaser-9x16` end card holds 3.2 s, long enough to read its copy (review flagged `ADV_READING_TIME`).
- Review pacing: landscape and square feed placements (`x-landscape`, `x-square`, `linkedin`, `instagram-feed-4x5`)
  use a 1-7 s feed window; the 0.8-4 s window is kept for vertical short-form.

### Added — Editorial: transitions, overlays, rhythm, sound and launch blueprints
- **True A/B transitions:** `crossfade`, `dip-to-black`, `dip-to-white`, `wipe`, `iris`, `push`, `zoom`, `whip` and `light-leak`.
  - The incoming shot starts `durationMs` before the outgoing one ends; both render at their own times and are blended in linear light.
  - `velora transitions ls` shows each transition's mode.
- **Overlay tracks:** `overlays[]` places titles, lower thirds and logos over the picture, captured transparently and composited in order with opacity and blend modes.
- **Styled captions:** `captions.style` takes `karaoke`, `bold-pop`, `minimal`, `lower` or `burn`, with optional per-word timing (`wordsFile`). Captions stay clear of vertical platform UI.
- **Rhythm:**
  - `velora audio beats` gives tempo, beats and downbeats, and with `--write-markers` stores them on the composition.
  - `velora compose snap --to beats|downbeats` puts cuts on the beat. It is a dry run by default; `--write` applies it.
- **Sound:**
  - deterministic procedural SFX (`whoosh`, `swish`, `click`, `pop`, `tick`, `riser`, `impact`, `shimmer`) through `sfx[]` and `transition.sfx`;
  - loudness normalization to -14 LUFS / -1 dBTP by default (`loudness`), recorded in the manifest.
- **Review:** `velora review --composition FILE [--platform ID]` gives advisory editorial review (hook, pacing, reading time, end card, eye trace, match cuts, direction, loop seams, off-beat cuts).
- **Launch blueprints:** `launch-film-30s`, `feature-drop-15s`, `social-teaser-9x16`, `changelog-20s`, `product-hunt-kit`, `app-preview-25s`. Each comes with transitions, sound, overlays, section and music-cue markers, a caption skeleton and a `brief.md` story.
- Audio tracks take `kind` (`music`, `voice` or `sfx`). Title, statement and stat graphics take `backdrop=off` for use as overlays.
- New skill: `velora-editing`.

### Added — Visual kit, brand, looks and Wave 2 templates
- **Kit components** in `@adityadeokar/velora/kit`, all driven by the scene clock:
  - framing: `BrowserFrame`, `WindowFrame`, `PhoneFrame`, `TabletFrame`, `LaptopFrame`;
  - atmosphere: `Backdrop`, `Glow`, `ContactShadow`, `LightSweep`, `Dust`;
  - interaction: `Cursor`, `Typewriter`, `Spotlight`, `Callout`;
  - type: `Title`, `Counter`, `Countdown`, `Panel`, `Marquee`, `GradientText`, `CaptionTrack`;
  - media: `VideoClip`, `ImageLayer`;
  - brand: `BrandProvider`, `BrandMark`, `useBrand`, `useReveal`;
  - looks: `LookLayer`.
- **Brand:** `velora.brand.json` with colors, gradients, fonts, radius, voice and a motion personality (calm, crisp, playful, bold).
  - `velora brand init [--from-css FILE]` seeds it from CSS custom properties; `velora brand check` validates it and warns on low contrast.
  - Its JSON Schema ships in `schemas/brand.schema.json`.
- **Looks** on recipes and compositions:
  - presets `clean`, `keynote`, `film`, `teal-orange`, `noir`, `neon`, `pastel`;
  - browser layer (grade, grain, vignette, letterbox): previewed live and captured;
  - export finishing (bloom, halation, chromatic aberration, sharpen, `.cube` LUT): applied per frame; preview it with `velora shot --finish`.
- **`velora check`** adds `flash-safety` (WCAG 2.3.1 approximation, `ERR_FLASH_RISK`) and an advisory `banding` check.
- **18 Wave 2 templates:**
  - layered: `exploded-stack`, `parallax-planes`, `cascade-build`, `floating-focus`, `device-showcase`, `cursor-demo`, `split-compare`, `screen-wall`;
  - motion graphics: `title-reveal`, `logo-sting`, `kinetic-statement`, `stat-counter`, `feature-trio`, `lower-third`, `quote-card`, `end-card`, `countdown`, `changelog-card`.
  - They scaffold to plain TSX, show in the studio gallery and quick shots, and are certified in every aspect (framing, title-safe placement, reading time).
- New skills: `velora-brand`, `velora-looks`, `velora-motion-design`.
- Export failures now name their cause and the segment and scene they came from.

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
- **Render workers.** The default worker count now leaves one core free, budgets about 700 MB of free memory per worker, and is capped at 4. Each worker is a full Chromium running the live app. `--parallel` accepts up to 8.
- **Capture waits.** Capture waits up to 30 s for a loading Velora page's bridge and for network idle (previously 5 s and 10 s), so parallel renders no longer fail while the dev server is busy.
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
