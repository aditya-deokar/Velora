# Phase 04 — Master-Quality Render & Delivery Formats

## Goal
Make exports look shot, not screen-recorded:
- supersampled edges and text;
- correct broadcast color (bt709 conversion + tags);
- cinema cadences (24/25/50 fps);
- physically motivated motion blur;
- the formats launches actually need (WebM for websites, GIF for READMEs, ProRes 4444 / VP9 alpha for editors compositing over footage).

All of it stays deterministic.

## Prerequisites
- Phase 00 (bounded-memory frame pipeline). Can run in parallel with Phases 02/03.

## Scope IN
- Quality presets, colorimetry, frame rates, codecs and containers, transparent capture.
- Motion blur by temporal supersampling; supersampled capture.
- Platform presets and a multi-aspect render.
- Posters, progress ETA, throughput.
- Doctor encoder probes.

## Scope OUT
- Look/grade finishing (05), A/B transitions and overlays (06), `velora deliver` orchestration (08).

## Tasks

### 04.1 Quality presets — `src/core/export.ts` (`QualityPresetSchema`)

| Preset | Capture scale | Encoder | Motion blur | Use |
|---|---|---|---|---|
| `draft` | 0.5× | x264 `veryfast`, CRF 26 | off | iteration |
| `standard` (default) | 1× | x264 `slow`, CRF 18 | off | reviews |
| `master` | 2× DPR, downscaled in linear light | x264 `slower`, CRF 14 | 180°, 8 samples | final |

- The supersampling factor is reduced automatically so the capture stays ≤ 3840 px per side; no supersampling at 4K output.
- **Downscaling happens in Node** (2×2 box filter in linear light, in `src/export/compositor.ts`), so still frames and video frames are identical.

### 04.2 Colorimetry (`videoEncodeArgs`, `src/export/services.ts:312`)
- RGB → YUV conversion uses `scale=in_range=pc:out_range=tv:out_color_matrix=bt709`.
- Streams are tagged `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`.
- Fixes the FFmpeg default bt601 matrix that shifts colors in browsers.
- Banding mitigation guidance (grain/10-bit) comes in 05.

### 04.3 Frame rates
- `SUPPORTED_EXPORT_FPS` becomes `[24, 25, 30, 50, 60, 120]` (`src/core/export.ts:9`).
- `timeAtFrame` already handles non-integer milliseconds; add tests for 24/25/50.
- Audio drift and caption checks are unchanged (40 ms budget).

### 04.4 Codecs and containers — `--codec`

| Codec | Container | Notes |
|---|---|---|
| `h264` (default) | `.mp4` | `high` profile, `+faststart` |
| `hevc` | `.mp4` | `-tag:v hvc1` for Apple |
| `vp9` | `.webm` | `-b:v 0 -crf`, row-mt; `yuva420p` with `--transparent` |
| `av1` | `.mp4`/`.webm` | `libsvtav1` if probed, else `ERR_CODEC_UNAVAILABLE` |
| `prores4444` | `.mov` | `prores_ks -profile:v 4444 -pix_fmt yuva444p10le` (alpha for editors) |
| `gif` | `.gif` | two-pass `palettegen=stats_mode=diff` / `paletteuse=dither=sierra2_4a`, `--gif-fps` (default 20), width cap |

- Output path validation accepts the container per codec. `ExportVideoSchema.output` and `VideoRenderSchema.out` are extended.

### 04.5 Transparent capture — `--transparent`
- Capture-only: export services inject `[data-velora-scene],[data-velora-preview],html,body{background:transparent!important}` and screenshot with `omitBackground: true`.
- The black-void preview contract is untouched.
- Only codecs with alpha accept it (`vp9`, `prores4444`, PNG frames).

### 04.6 Motion blur — `--motion-blur <shutterDegrees>` `[--motion-samples N]`
- For output frame *k* at `t = k/fps`, sample N sub-frame times `t + (i + 0.5)/N · (θ/360)/fps` (trailing shutter, as on a film camera). Samples clamp at the scene end.
- Average in **linear light** (sRGB LUT → float accumulate → sRGB, round-half-even) in `src/export/compositor.ts`. The PNG codec helpers are extracted from `src/export/services.ts:219-260`.
- Sub-frames are cached by local time through the existing frame cache. **Adaptive skip:** when every sub-frame SHA is equal, reuse the single frame (byte-identical to no blur).
- `velora shot --motion-blur 180` previews a still.
- Shutter guidance for the skill:
  - 180° is the cinematic default;
  - 90° gives crisp UI and text;
  - 270–360° is dreamy;
  - whip pans benefit most.

### 04.7 Platform presets and multi-aspect — `src/core/delivery.ts` (owner `DeliveryPresetSchema`, `DELIVERY_PRESETS`)
- Initial table: `youtube-1080p`, `youtube-4k`, `x-landscape`, `x-square`, `linkedin`, `instagram-reel`, `tiktok`, `youtube-shorts`, `instagram-feed-4x5`, `website-hero`, `github-readme-gif`, `og-image`, `product-hunt-gallery`.
- Each entry has: size, fps options, codec, max duration and size budget, audio loudness target (used in 06) and `lastVerified`.
- Platform limits change, so values are re-verified at implementation time and every release.
- `--preset NAME` sets defaults (explicit flags win). Validation warnings cover over-budget duration, size or aspect mismatch.
- `--aspects 16:9,9:16,1:1` renders variants in one run:
  - recipes with template provenance re-run `buildShot` with the target frame (true reframing);
  - bespoke recipes cover-crop, with a safe-area warning.

### 04.8 Posters, progress, throughput
- `--poster MS` writes a PNG/JPEG poster next to the output.
- NDJSON progress lines (already streamed with `--json`) gain `fps`, `etaMs` and `stage` (capture | blur | encode).
- `defaultParallelism` (`src/export/services.ts:366`) becomes `min(8, max(1, cores − 1))` with `--parallel` up to 8. The manifest records the worker count.

### 04.9 Manifest and doctor
- `RenderManifestSchema` records `quality`, `codec`, `container`, `colorimetry`, `motionBlur {shutter, samples}`, `supersample` and `transparent`.
- Sub-frame SHAs are recorded per output frame when blur is on.
- `velora doctor` probes `ffmpeg -encoders` and reports available codecs (`ERR_CODEC_UNAVAILABLE` hints).

## Contracts
| Flag (render/export) | Values | Default |
|---|---|---|
| `--quality` | draft \| standard \| master | standard |
| `--codec` | h264 \| hevc \| vp9 \| av1 \| prores4444 \| gif | h264 |
| `--fps` | 24 \| 25 \| 30 \| 50 \| 60 \| 120 | composition |
| `--motion-blur` / `--motion-samples` | 0–360 / 2–64 | preset |
| `--transparent` | flag | off |
| `--preset` | delivery preset id | — |
| `--aspects` | comma list | — |
| `--poster` | ms | — |

## Files
- New: `src/core/delivery.ts`, `src/export/compositor.ts`
- Modified: `src/core/{export,cli-schema,resources,authoring}.ts`, `src/export/{commands,services}.ts`, `src/cli/index.ts`, `src/preview/ScenePreview.tsx` (export menu pickers: copy command only)
- Skills: `velora-export`, `velora-render`, `velora-performance`

## Tests
- `tests/export/encode-args.test.ts`: per codec/preset args, bt709 conversion and tags, container validation.
- `tests/export/compositor.test.ts`: linear-light averaging on synthetic frames (exact expected bytes), box downscale, adaptive skip.
- `tests/core/timeline.test.ts`: 24/25/50 fps frame math round-trips.
- Browser tier:
  - master render twice → identical frame SHAs;
  - ffprobe confirms `yuva444p10le` for ProRes alpha and `yuva420p` for VP9 alpha;
  - GIF under its size budget;
  - bt709 tags present.
- Performance evidence: draft vs master wall time for a 10 s 1080p60 fixture (device-specific, recorded, not promised).

## Validation criteria
- [ ] Side-by-side still: master vs standard shows visibly cleaner edges and text (recorded in the exit report).
- [ ] Colors match the preview in Chrome/Safari playback (bt709 conversion verified with a color-bar fixture).
- [ ] `--motion-blur 180` on `whip-pan` shows directional blur; static frames are byte-identical to no-blur.
- [ ] A ProRes 4444 export drops over footage in an NLE with a clean alpha edge (manual).

## Anti-patterns
- Averaging in sRGB (darkens edges); relying on FFmpeg `tmix` for blur (frames and stills would diverge).
- Changing the black preview background to get alpha; alpha is capture-only.
- Hard-coding platform limits without `lastVerified`.

## Definition of Done
All tests and validation green. Skills updated. `plan/v2/artifacts/phase-04-exit.md` includes
comparison stills, ffprobe output and timing evidence.
