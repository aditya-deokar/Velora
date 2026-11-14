# Velora Reference — Flags, Envelopes, Schemas, Math, Budgets

Version-pinned to CLI `0.1.2`. Run `velora guide --json` for the canonical `commands[]` index; this file mirrors it for offline reading and never replaces `--help`.

## Flag matrix

| Command | Flags | Example |
|---|---|---|
| `guide` | `--json` | `velora guide --json` |
| `init` | `--adapter`, `--project`, `--package`, `--url`, `--no-open`, `--json` | `velora init --json` |
| `open` | `--scene`, `--project`, `--url`, `--no-open`, `--json` | `velora open --no-open --json` |
| `sync` | `--project`, `--json` | `velora sync --json` |
| `scenes` | `--project`, `--json` | `velora scenes --json` |
| `load` | `--scene`, `--project`, `--json` | `velora load --scene <id> --json` |
| `validate` | `--project`, `--composition`, `--json` | `velora validate --composition teaser.composition.json --json` |
| `inspect` | `--project`, `--scene`, `--composition`, `--json` | `velora inspect --scene <id> --json` |
| `assets` | `--as`, `--id`, `--yes`, `--project`, `--json` | `velora assets ls --json` |
| `snapshot` | `--scene`, `--url`, `--time`, `--project`, `--json` | `velora snapshot --scene <id> --url <origin> --json` |
| `export` | `--url`, `--output`, `--fps`, `--width`, `--height`, `--audio`, `--captions`, `--quality`, `--codec`, `--transparent`, `--motion-blur`, `--motion-samples`, `--gif-fps`, `--poster`, `--project`, `--json` | `velora export --url <scene-url> --output clip.mp4 --quality master --json` |
| `doctor` | `--project`, `--url`, `--json` | `velora doctor --json` |
| `render` | `--composition`, `--frame`, `--time`, `--out`, `--parallel`, `--no-cache`, `--cache-dir`, `--fps`, `--width`, `--height`, `--url`, `--project`, `--json`, `--no-stream`, `--quality`, `--codec`, `--transparent`, `--motion-blur`, `--motion-samples`, `--gif-fps`, `--poster`, `--preset`, `--aspects` | `velora render --composition teaser.composition.json --out teaser.mp4 --quality master --json` |
| `frames` | `--composition`, `--out`, `--every`, `--at`, `--contact-sheet`, `--columns`, `--no-cache`, `--cache-dir`, `--url`, `--project`, `--json` | `velora frames --composition teaser.composition.json --out stills --every 30 --json` |
| `shot` | `--scene`, `--time`, `--out`, `--url`, `--quality`, `--motion-blur`, `--motion-samples`, `--fps`, `--transparent`, `--finish`, `--project`, `--json` | `velora shot --scene demo --time 500 --out shot.png --json` |
| `check` | `--frames`, `--video`, `--manifest`, `--budget-ms`, `--project`, `--json` | `velora check --frames stills --json` |
| `audio` | `--composition`, `--file`, `--write-markers`, `--project`, `--json` | `velora audio check --composition teaser.composition.json --json` |
| `captions` | `--file`, `--composition`, `--project`, `--json` | `velora captions validate --file subs.srt --json` |
| `compose` | `--composition`, `--to`, `--tolerance`, `--write`, `--project`, `--json` | `velora compose snap --composition launch.composition.json --to beats --json` |
| `review` | `--composition`, `--platform`, `--project`, `--json` | `velora review --composition launch.composition.json --platform youtube-1080p --json` |
| `brand` | `--from-css`, `--name`, `--project`, `--json` | `velora brand init --from-css src/index.css --json` |
| `templates` | `--category`, `--tag`, `--aspect`, `--id`, `--json` | `velora templates ls --json` |
| `new` | `--template`, `--blueprint`, `--id`, `--component`, `--route`, `--set`, `--aspect`, `--duration`, `--title`, `--project`, `--json` | `velora new scene --template hero-push --id home-hero --route / --json` |
| `transitions` | `--type`, `--json` | `velora transitions ls --json` |
| `deliver` | `--composition`, `--targets`, `--out`, `--quality`, `--parallel`, `--no-cache`, `--no-stream`, `--url`, `--project`, `--json` | `velora deliver --composition launch.composition.json --targets youtube,reels,website-hero --json` |
| `studio` | `--site`, `--port`, `--check`, `--edit`, `--scene`, `--read-only`, `--project`, `--json` | `velora studio --site http://127.0.0.1:4321 --json` |
| `edit` | `--scene`, `--at`, `--ops`, `--expect-sha`, `--write`, `--track`, `--value`, `--ease`, `--label`, `--port`, `--url`, `--read-only`, `--no-open`, `--project`, `--json` | `velora edit key --scene home-hero --track camera.z --at 1200 --value 400 --json` |
| `create` | `--name`, `--blueprint`, `--json` | `velora create my-launch --name Fieldnote --json` |
| `prompts` | `--id`, `--json` | `velora prompts show --id launch-film --json` |
| `skills` | `--dir`, `--agent`, `--source`, `--json` | `velora skills install --dir <path> --json` |

Subcommands: `audio ls|check|beats`, `captions validate|check`, `transitions ls|describe`, `prompts ls|show`, `studio init`, `templates ls|show|check`, `new scene|video`, `brand init|check`, `compose snap`, `skills install|ls|check`, `assets ls|check|add|rm`, `edit ls|apply|key|ease` (bare `velora edit` starts the edit bridge). Every command supports `--help`; exit `0` ok, `1` operational failure, `2` usage error.

## Envelope and ERR_* catalog

Success: `{ success: true, command, data, warnings?, next? }`. Failure: `{ success: false, command?, issues: [{ code, message, path?, hint }], next }`. `check` failures may carry `data.checks` doctor-style.

| Code | When | Next |
|---|---|---|
| `ERR_UNKNOWN_COMMAND`, `ERR_UNKNOWN_OPTION`, `ERR_MISSING_VALUE`, `ERR_DUPLICATE_OPTION`, `ERR_INVALID_FLAG_COMBINATION` | Usage errors, exit 2 | `velora <command> --help` |
| `ERR_INVALID_PROJECT`, `ERR_SCENE_NOT_FOUND`, `ERR_SCENE_INVALID`, `ERR_BINDING_MISSING` | Catalog and binding | `velora validate --json`, `velora scenes --json`, `velora sync` |
| `ERR_FOCUS_INVALID`, `ERR_DURATION_INVALID`, `ERR_FPS_UNSUPPORTED` | Scene and export shape | `velora guide --json`, `velora <command> --help` |
| `ERR_SERVER_UNREACHABLE`, `ERR_CAPTURE_NO_BRIDGE`, `ERR_FFMPEG_MISSING`, `ERR_CHROMIUM_MISSING` | Environment and bridge | `velora doctor --json` |
| `ERR_COMPOSITION_INVALID`, `ERR_TIMELINE_INVALID`, `ERR_TIMELINE_OVERLAP`, `ERR_FRAME_OUT_OF_RANGE` | Composition and timeline | `velora inspect --composition <file> --json` |
| `ERR_ASSET_NOT_FOUND`, `ERR_ASSET_UNSUPPORTED`, `ERR_ASSET_TOO_LARGE` | Assets | `velora assets ls --json`, `velora assets check --json` |
| `ERR_AUDIO_INVALID`, `ERR_AUDIO_CODEC`, `ERR_AUDIO_DRIFT` | Audio | `velora audio check --composition <file> --json` |
| `ERR_CAPTION_INVALID`, `ERR_CAPTION_OVERLAP`, `ERR_CAPTION_TIMING` | Captions | `velora captions validate --file <file> --json` |
| `ERR_TRANSITION_INVALID` | Transitions | `velora transitions ls --json` |
| `ERR_TEMPLATE_NOT_FOUND`, `ERR_TEMPLATE_PARAM`, `ERR_TEMPLATE_ASPECT`, `ERR_TEMPLATE_FRAMING` | Templates and blueprints | `velora templates ls --json`, `velora templates show --id <id> --json` |
| `ERR_COMPONENT_EXPORT_MISSING`, `ERR_ROUTE_INVALID`, `ERR_ROUTE_FRAME_BLOCKED`, `ERR_SCENE_EXISTS` | Scaffolding (`velora new`) | `velora new --help` |
| `ERR_MARKERS_MISSING` | Beat snapping before beat detection | `velora audio beats --composition <file> --write-markers --json` |
| `ERR_PROMPT_NOT_FOUND` | Prompt library | `velora prompts ls --json` |
| `ERR_DELIVER_TARGET` | Unknown deliver target | `velora deliver --composition <file> --targets youtube --json` |
| `ERR_SITE_NOT_LOOPBACK`, `ERR_SITE_UNREACHABLE`, `ERR_SITE_REDIRECT_EXTERNAL`, `ERR_STUDIO_FAILED` | Any-site studio | `velora studio --site <url> --check --json` |
| `ERR_EDIT_INVALID`, `ERR_EDIT_TARGET`, `ERR_EDIT_UNSUPPORTED` | Edit op failed (path names the op) | `velora edit ls --scene <id> --json` |
| `ERR_EDIT_CONFLICT` | The file changed since it was read | Re-read with `velora edit ls --scene <id> --json`, then apply again |
| `ERR_BRIDGE_PORT`, `ERR_BRIDGE_HOST` | Edit bridge could not bind (port in use, non-loopback) | `velora edit --port <n>` |
| `ERR_BRAND_INVALID`, `ERR_LOOK_INVALID` | Brand file and looks | `velora brand check --json` |
| `ERR_CODEC_UNAVAILABLE`, `ERR_FFMPEG_FILTER`, `ERR_OUTPUT_UNWRITABLE` | Encoding and output paths | `velora doctor --json`, `velora render --help` |
| `ERR_FLASH_RISK` | Photosensitivity (WCAG 2.3.1) | `velora check --video <file> --json` |
| `ERR_SNAPSHOT_STALE` | Scene changed during a snapshot | `velora snapshot --help` |
| `ERR_NODE_UNSUPPORTED`, `ERR_REACT_UNSUPPORTED`, `ERR_TOOLKIT_MISSING` | Host prerequisites | `velora doctor --json` |
| `ERR_PROCEDURAL_BUDGET`, `ERR_ANIMATION_CLOCK` | Procedural and clocks | `velora validate --json` |
| `ERR_WEBGL_CONTEXT`, `ERR_WEBGL_TIMELOOP` | WebGL | `velora validate --json`, `velora doctor --json` |
| `ERR_VISUAL_MANIFEST`, `ERR_VISUAL_BLANK`, `ERR_VISUAL_DIMENSIONS`, `ERR_VISUAL_COVERAGE`, `ERR_VISUAL_DRIFT`, `ERR_VISUAL_BUDGET` | Visual gates | `velora frames --help`, `velora render --help`, `velora check --help` |
| `ERR_SKILL_MISSING`, `ERR_SKILL_VERSION`, `ERR_SKILL_INVALID`, `ERR_SKILL_CONFLICT` | Skills library | `velora skills ls`, `velora skills check`, `velora skills install --help` |
| `WARN_BEATS_UNCERTAIN`, `WARN_BRAND_CONTRAST`, `WARN_BRAND_LOGO`, `WARN_TEMPLATE_PLACEHOLDER`, `WARN_SITE_FRAME_HEADERS`, `ADV_BANDING` | Warnings and advisories (exit 0) | `velora audio beats --help`, `velora brand check --json`, `velora validate --json`, `velora check --help` |
| `ERR_INTERNAL` plus legacy `conflict`, `missing-dev-server`, `denied-path`, `not-initialized` and others | Fallback and compat | `velora doctor --json` |

## JSON schemas (shapes, not copies)

- `CompositionSchema` version 1: `id`, `title`, `width` and `height` even 64 to 3840, `fps` 24, 25, 30 (default), 50, 60 or 120, `scenes` 1 to 256 V1 segments with `id`, `recipe`, `startMs`, `durationMs`, optional `transition` (gaps are black void; overlaps only inside an overlap transition's window), plus `assets`, `audio` to 16 tracks, optional `captions` (`file`, `style`, `wordsFile`, `burnIn`), `overlays` to 64, `markers`, `sfx`, `loudness`, `look`, `seed`. The JSON Schema ships at `schemas/composition.schema.json`.
- `SceneRecipeSchema` version 1: `id` slug, `title`, `definition` with `scene.nodes`, optional `motion`, `width`, `height`, optional `snapshot`.
- `MotionSchema`: `durationMs`, `speed`, `loop`, plus tracks for `surface`, `camera`, `focus` and `channel` with `timeMs` keyframes; easing names, `cubicBezier`, `spring`, `steps` or `hold`; track `interpolation` (`segments` or `smooth`), `ease` and seeded `noise` (`velora guide --json` lists the catalog).
- `AudioTrackSchema`: `id`, `assetId`, optional `kind` (`music`, `voice`, `sfx`), `startMs`, `offsetMs`, `gain`, `fadeInMs`, `fadeOutMs`, optional `duckUnder`.
- `BrandSchema` (`velora.brand.json`, `schemas/brand.schema.json`): colors, gradients, fonts, logo, radius, voice and motion personality.
- `PromptSchema`: `id`, `title`, `intent`, `text` with `<placeholders>`, `templates`, `skills` (at most four).
- `TextStyleSchema`: `family`, `size`, `weight`, `tracking`, `leading`, `color` `#rrggbb`, `align`, optional `kinetic` preset.
- `WebGLSceneSchema`: `seed`, `width`, `height`, `pixelRatioCap` 1 to 2, `antialias`.
- `RenderManifestSchema` version 1: `kind`, `seed`, `fps`, dimensions, `durationMs`, segments, per-frame `sha`, audio drift, caption windows, `ffmpegArgs`.

## Frame math and determinism

- `frame = round(timeMs * fps / 1000)`; `timeMs = frame * 1000 / fps`.
- One elapsed cursor owns presentation time; authored keyframes use authored milliseconds.
- `seed` feeds every random call (`createRng`); same composition bytes plus `seed` produce identical frame SHAs across serial and parallel renders.
- Equality is judged on frame SHAs and decoded pixels, never container bytes or `createdAt`.
- Gap segments synthesize black void without touching the browser.

## Budgets table

| Budget | Limit | On excess |
|---|---|---|
| Procedural nodes | 200 | `ERR_PROCEDURAL_BUDGET`; bake to asset |
| Kinetic text surfaces | 12 per scene | Warning; split or bake |
| Composition scenes | 256 | Schema rejection |
| Composition assets | 256 files | Schema rejection |
| Asset bytes | 50MB each | `ERR_ASSET_TOO_LARGE` |
| Audio tracks | 16 | Schema rejection |
| Render parallel | 1 to 8 (default memory-aware, at most 4) | Usage error |
| Export FPS | 24, 25, 30, 50, 60, 120 | `ERR_FPS_UNSUPPORTED` |
| Overlays | 64 per composition | Schema rejection |
| Canvas | 64 to 3840, even | Schema rejection |
| A/V drift | 40ms | `ERR_AUDIO_DRIFT` or `ERR_VISUAL_DRIFT` |
| Caption speed | 20 chars per second | `ERR_CAPTION_TIMING` |

## Version compatibility

| Velora CLI | React | Skills lock |
|---|---|---|
| `0.1.2` | `18.2+` or `19.x` | `skills-lock.json` version 1 plus `velora-*` entries |

Every `velora-*/SKILL.md` front-matter `version` pins this CLI version as `X.Y.Z`. `velora skills check` reports `ERR_SKILL_VERSION` on drift; re-run `velora skills install --dir <path> --json` to refresh. Deep GSAP and Three.js APIs are linked to installed `gsap-*` and `threejs-*` skills, never copied here.
