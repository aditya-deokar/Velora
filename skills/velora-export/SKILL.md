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
- `velora export --url http://127.0.0.1:5173/?flute-preview=1 --output clip.mp4 --json`: live-scene capture through the bridge.
- `velora check --frames stills --json`: gates before calling video done.

Flags: `--fps 30|60|120`, `--width` and `--height` even numbers 64 to 3840, `--parallel 1-4`, `--no-cache`, `--cache-dir <dir>`, `--url <origin>`, `--project <dir>`.

## Prerequisites

- Validated composition with butt-joined segments and resolved assets.
- Project-relative `.mp4` output without traversal; fresh filename.
- FFmpeg on `PATH`; Chromium via Playwright; dev server running for non-gap timelines.

## Workflow

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

FPS and size choice: 30 for review, 60 for smooth camera travel, 120 only when requested; keep the composition canvas unless the request names another size.

## Anti-Patterns

- Encoding before `velora validate --json` passes.
- Judging equality on container bytes; compare frame SHAs.
- Reusing a stale output path; use a fresh relative filename.
- Starting the app server from the CLI; it never starts one.

## Troubleshooting

- `ERR_FFMPEG_MISSING`: install FFmpeg and ensure `ffmpeg` is on `PATH`.
- `ERR_CHROMIUM_MISSING`: run `npm install playwright` plus browser install.
- `ERR_FPS_UNSUPPORTED`: use `--fps 30`, `60`, or `120`.
- `ERR_OUTPUT_UNWRITABLE`: choose another project-relative `.mp4` path.
- `ERR_SERVER_UNREACHABLE` or `ERR_CAPTURE_NO_BRIDGE`: start the dev server and open a capture-enabled scene.

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
