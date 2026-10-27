# Phase 4 Exit — Master-Quality Render & Delivery Formats

Status: implemented, uncommitted. Date: 2026-10-27.

## Delivered

- **Core** (`src/core/export.ts`):
  - `QualityPresetSchema`/`QUALITY_PRESETS` (draft 0.5x / standard 1x / master 2x + 180° × 8 samples).
  - `VideoCodecSchema`, `CODEC_CONTAINERS`, `ALPHA_CODECS`.
  - `resolveFinishing`: flags win, and supersampling is capped so capture stays ≤ 3840 px.
  - `shutterSamples`: trailing shutter, clamped.
  - Frame rates 24, 25, 30, 50, 60, 120.
  - Output validation per container.
  - Manifest lineage fields: `quality`, `codec`, `container`, `colorimetry`, `motionBlur`, `supersample`, `transparent`, `workers`, `poster`, plus per-frame `subFrames`.
- **`src/core/delivery.ts`:** 13 dated `DELIVERY_PRESETS` and `deliveryWarnings` (duration, size, aspect, fps). Warnings never fail a render.
- **`src/export/compositor.ts`:**
  - The PNG codec moved here from services.
  - `composite` averages and box-downscales in linear light with premultiplied alpha and round-half-even.
  - A single frame passes through unchanged.
- **`finishFrame`:** the single finishing path for render, export and shot.
  - Shutter sub-frames are cached per local time, under a variant key only for non-standard captures.
  - Adaptive skip when every sample is identical.
- **`videoEncodeArgs`:**
  - BT.709 limited-range conversion, plus `setparams` (FFmpeg 7+ frame properties) and stream tags.
  - h264 `high` with faststart; hevc `hvc1`; vp9 (`yuva420p` with alpha); av1 (svt); ProRes 4444 (`yuva444p10le`); GIF two-pass palette with `--gif-fps` and a 960 px cap.
- **Transparent capture:** capture-only CSS plus `omitBackground`. Gap frames are transparent too.
- **CLI:**
  - `export` and `render` gain `--quality --codec --transparent --motion-blur --motion-samples --gif-fps --poster`; `render` also gains `--preset --aspects` and `--parallel` up to 8.
  - `shot` gains `--quality --motion-blur --motion-samples --fps --transparent`.
  - NDJSON progress gains `stage`, `fps` and `etaMs`.
  - Usage text and `CLI_COMMANDS` are updated.
- **Doctor and errors:** `velora doctor` adds a codecs check; `ERR_CODEC_UNAVAILABLE` fails fast before capture.
- **Guide:** `capabilities.finishing` and `capabilities.delivery`.
- **Studio:** the export menu adds Quality and Format pickers (copy only).
- **Defaults** (in CHANGELOG):
  - `defaultParallelism` is cores−1, capped at 8.
  - Standard H.264 is now slow/CRF 18, previously medium/23.
- **Skills:** `velora-export` (finishing table, shutter guidance, troubleshooting), `velora-render` (`shot` finishing preview) and `velora-performance` (don't iterate at master). Lock hashes refreshed.

## Verification

| Gate | Result |
|---|---|
| typecheck, lint:architecture | pass |
| test:architecture | 147 pass |
| test:core | 535 pass (incl. delivery; 24/25/50 grid round-trips) |
| test:react | 51 pass |
| test:launch | 448 pass |
| test:export | 262 pass (new: compositor 11, encode-args incl. real encodes per codec with ffprobe) |
| test:release | 41 pass |
| test:browser | 10 pass |
| test:skills | 17 green |
| test:installed | pass |
| test:agent-demos | pass; recorded pixel hashes unchanged |

## Real renders (smoke app)

Setup: `whip-pan` route scene, 1280×720, 24 fps, 2.5 s, `--no-cache`, Windows, FFmpeg 9.0.2.

| Output | Probe | Size | Wall time |
|---|---|---|---|
| draft.mp4 | h264 yuv420p, bt709/bt709/bt709, 24/1 | 38 KB | 15 s |
| standard.mp4 | h264 yuv420p, bt709 ×3 | 74 KB | 20 s |
| master.mp4 (+ poster) | h264 yuv420p, bt709 ×3 | 126 KB | **295 s** |
| hevc.mp4 | hevc yuv420p, bt709 ×3 | 76 KB | 13 s |
| alpha.webm (`--transparent`) | vp9, `alpha_mode=1`, bt709 ×3 | 65 KB | 16 s |
| alpha.mov (`--transparent`) | prores `yuva444p12le` (decoder reports 4444 as 12-bit), bt709 ×3 | 5.8 MB | ~15 s |
| readme.gif (`--preset github-readme-gif`) | gif 960×540, 15 fps | 133 KB | — |
| multi.mp4 + multi-720x1280.mp4 (`--aspects 9:16`) | h264, bt709 | 74 KB + 70 KB | 19 s |

- **Alpha check.** On a ProRes frame at 2 s, 467,591 pixels are opaque, 445,943 transparent and 8,066 partially transparent (antialiased edges).
- **Master manifest.** It records quality master, codec h264, colorimetry bt709, motion blur 180°/8, supersample 2 and 8 workers. 36 of 60 frames carry `subFrames`; the 24 settled frames skipped averaging.
- **Motion blur.** Comparing frames 2–7 of standard and master: master shows directional blur that follows the whip and resolves to sharp as the move settles. Positions match frame for frame.
- **Live export.** `velora export --url <quick shot> --codec vp9 --quality draft --poster 1000 --fps 24` wrote 192 frames in 26 s, BT.709-tagged, with a poster.
- **Determinism.** standard.mp4 and multi.mp4 (the same render) are byte-identical in size, and test:agent-demos holds frame SHAs.

## Bugs found and fixed during verification

- **Color tags.** FFmpeg 9 ignored `-color_primaries`/`-color_trc` because the PNG frame properties took precedence. Fixed with `setparams` in the filter graph.
- **`--preset github-readme-gif`.** It rejected a `.gif` output because the schema checked the default codec before the preset was applied.
- **Manifest collision.** `alpha.webm` and `alpha.mov` shared `alpha.manifest.json`, and the late failure left a published video behind. Non-MP4 manifests now keep their extension, and every target (video, manifest, poster) is checked before capture.
- **`output-exists` hint.** It said ".mp4" for every container.
- **Doctor.** A cold-start FFmpeg probe timed out while the encoder probe ran beside it. The probes now run in sequence.

## Deviations and open items

- **Master is slow.** 4.9 s per frame at 720p: 2× capture × 8 samples, decoded and composited in JS. Options for later: a native decoder, fewer samples on settled spans, or worker threads. For now the skill teaches iterating at draft and proving finishing with `velora shot`.
- **`--aspects` doesn't reframe template recipes.** It re-captures at each frame size, and the scene cover-fits; it doesn't re-run `buildShot` for template-provenance recipes. Variants are encoded without the audio mix, with a warning.
- **Draft posters** are the half-size captured frame.
- **Not run:**
  - **AV1:** the encoder was probed as available but no real AV1 encode was run.
  - **Manual checks** (no NLE or Safari here): ProRes over footage in an editor; color-bar playback match in Chrome and Safari.
  - **Draft vs master timing** for a 10 s 1080p60 fixture: only the 2.5 s 720p24 numbers above.
- **CLI dead code.** `src/cli/index.ts` contains duplicated, unreachable `shot` and `check` blocks, also present at HEAD. The shot edit was applied to both; consolidating them is a separate cleanup.
- **Library hardware scroll budget.** Still unmet on this machine at HEAD too (see the phase 03 exit report).
