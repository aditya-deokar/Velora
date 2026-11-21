---
name: velora-export
description: Encode full timelines to MP4 with fps, size, cache, and parallel control. Use when validated compositions are ready for video output.
license: MIT
version: 0.1.2
when-to-use: Rendering MP4 video, choosing fps and dimensions, reading progress NDJSON and manifests, or diagnosing encode prerequisites.
prerequisites:
- velora validate --composition <file> --json green
- FFmpeg and Playwright Chromium available
commands:
- deliver
- render
- frames
- export
- check
related-skills:
- velora-render
- velora-audio
- velora-verify
not-for: Single-frame proofs (use velora-render) or artistic approval; this skill owns technical encoding and manifest truth.
---

# Velora Export — Video Encoding and Manifests

Owns `velora render` video mode, `velora export`, `velora frames` manifests, cache and parallel flags, progress NDJSON, and FFmpeg plus Chromium prerequisites.

## When to Use This Skill

Use this skill after frame proofs pass and the request is an MP4. It chooses fps and canvas size, streams progress, and reads the manifest that traces every PNG and MP4 to composition bytes plus seed.

## Commands

- `velora render --composition teaser.composition.json --out teaser.mp4 --json`: full timeline to MP4 with NDJSON progress plus envelope.
- `velora render --composition teaser.composition.json --out teaser.mp4 --no-stream --json`: envelope only.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`: still proof before video.
- `velora frames --composition teaser.composition.json --out stills --json`: sequence plus `manifest.json`.
- `velora export --url http://127.0.0.1:5173/?velora-preview=1 --output clip.mp4 --json`: live-scene capture through the bridge.
- `velora check --frames stills --json`: gates before calling video done.

Flags: `--fps 24|25|30|50|60|120`, `--width` and `--height` even numbers 64 to 3840, `--parallel 1-8`, `--no-cache`, `--cache-dir <dir>`, `--url <origin>`, `--project <dir>`.

## Finishing: quality, formats and delivery

| Need | Flags |
|---|---|
| Fast iteration | `--quality draft` (half-size capture, fast encode) |
| Reviews (default) | `--quality standard` (x264 slow, CRF 18) |
| Final master | `--quality master` (2x supersampled in linear light, CRF 14, 180-degree motion blur) |
| Website background | `--codec vp9 --out hero.webm` (also render an MP4 fallback and `--poster MS`) |
| README or docs | `--codec gif --out demo.gif [--gif-fps 15]`, or `--preset github-readme-gif` |
| Editors compositing over footage | `--codec prores4444 --transparent --out ui.mov`, or `--codec vp9 --transparent --out ui.webm` |
| Apple-friendly smaller files | `--codec hevc` |
| Platform target | `--preset youtube-1080p` (also `youtube-shorts`, `x-landscape`, `x-square`, `linkedin`, `instagram-reel`, `instagram-feed-4x5`, `tiktok`, `website-hero`, `og-image`, `product-hunt-gallery`, `youtube-4k`); explicit flags win, and budget warnings arrive in `data.warnings` |
| Several aspects in one run | `--aspects 9:16,1:1` writes `<out>-<w>x<h>.<ext>` beside the main render |

Motion blur: `--motion-blur 180` is the cinematic default, 90 keeps UI text crisp, 270 to 360 feels dreamy, and whip pans benefit most. Add `--motion-samples N` (2 to 64, default 8). Frames that do not move are byte-identical to no blur. Preview one frame first with `velora shot --scene <id> --time MS --out blur.png --quality master --json`. All video output is BT.709: converted to limited range and tagged, so browsers show the preview's colors.

For a whole launch, `velora deliver --composition launch.composition.json --targets youtube,reels,website-hero --json` runs these presets in one pass, meets each size budget with a deterministic quality ladder, and writes `deliverables.json` (`velora-launch`).

## Prerequisites

- Validated composition with butt-joined segments and resolved assets.
- Project-relative `.mp4`, `.webm`, `.mov` or `.gif` output matching `--codec`, without traversal; a fresh filename (Velora never overwrites the video, manifest or poster).
- Optional codecs depend on the FFmpeg build: `velora doctor --json` lists them (`ERR_CODEC_UNAVAILABLE` otherwise).
- FFmpeg on `PATH`; Chromium via Playwright; dev server running for non-gap timelines.

## Workflow

The app stage fixes the UI's logical width and height. Export dimensions set the video size. Standard and master capture honor the recipe's stage DPR, subject to a 3840-pixel capture-side limit. Draft captures at 0.5×. Use `velora shot --scene home-hero --time 1200 --stage-dpr 1.5 --out close.png --json` to compare a raster close-up. Read `effectiveDpr` and `dprCapped` in the stage lineage. A 2× capture has four times as many pixels as 1× before the linear-light downscale.

1. Run `velora validate --composition teaser.composition.json --json`.
2. Prove one frame: `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`.
3. Encode: `velora render --composition teaser.composition.json --out teaser.mp4 --json` with `--fps`, `--width`, `--height`, and `--parallel` as needed.
4. Read the manifest: `seed`, `fps`, dimensions, `durationMs`, per-frame SHAs, audio drift, caption windows, `ffmpegArgs`.
5. Run `velora check --frames stills --json` or `velora check --video teaser.mp4 --manifest stills/manifest.json --json`.

## Worked Example

```bash
velora validate --composition teaser.composition.json --json
velora render --composition teaser.composition.json --out teaser.mp4 --json
velora frames --composition teaser.composition.json --out stills --json
velora check --video teaser.mp4 --manifest stills/manifest.json --json
```

FPS and size choice: 24 for a cinematic cadence, 25/50 for PAL deliverables, 30 for review, 60 for smooth camera travel, 120 only when requested. Keep the composition canvas unless the request names another size or a `--preset`.

## Anti-Patterns

- Encoding before `velora validate --json` passes.
- Judging equality on container bytes; compare frame SHAs.
- Reusing a stale output path; use a fresh relative filename.
- Starting the app server from the CLI; it never starts one.

## Troubleshooting

- `ERR_FFMPEG_MISSING`: install FFmpeg and ensure `ffmpeg` is on `PATH`.
- `ERR_CHROMIUM_MISSING`: run `npm install playwright` plus browser install.
- `ERR_FPS_UNSUPPORTED`: use `--fps 24`, `25`, `30`, `50`, `60` or `120`.
- `ERR_CODEC_UNAVAILABLE`: this FFmpeg build lacks the encoder; install a full build or use `--codec h264`.
- `invalid-input` naming the container: rename the output to the codec's extension (`vp9` writes `.webm`, `prores4444` writes `.mov`, `gif` writes `.gif`).
- `--transparent` refused: only `vp9` and `prores4444` carry alpha, and audio or captions need an opaque codec.
- `ERR_OUTPUT_UNWRITABLE`: choose another project-relative `.mp4` path.
- `ERR_SERVER_UNREACHABLE` or `ERR_CAPTURE_NO_BRIDGE`: start the dev server and open a capture-enabled scene.
- `ERR_FFMPEG_FILTER`: this FFmpeg build has no `subtitles` filter (libass), so captions cannot be burned in. Install a full build (Homebrew: `brew install ffmpeg-full`) or keep captions as a styled overlay.

## Validation

- MP4 plus manifest exist; manifest validates and lists per-frame SHAs.
- `serial` versus `parallel` renders share frame SHAs.
- `velora check --video <file> --manifest <manifest> --json` passes technical gates.

## Related Skills

- `velora-render`: still and sequence proofs.
- `velora-audio`: mix and caption inputs.
- `velora-verify`: gates before human review.

## When NOT to Use This Skill

- Do not use this skill for composition authoring; load `velora-composition`.
- Do not use this skill for still-only tasks; load `velora-render`.
- Do not claim artistic quality from manifests; they prove reproducibility.
