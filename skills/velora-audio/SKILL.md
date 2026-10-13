---
name: velora-audio
description: Wire audio tracks and caption files to the timeline with frame-snapped placement and drift budgets. Use when video needs sound or readable captions.
license: MIT
version: 0.1.2
when-to-use: Declaring audio tracks, validating codecs and fades, checking caption files, or diagnosing A/V drift.
prerequisites:
- Composition file with fps and duration known
- Audio assets discovered and probed (FFmpeg present)
commands:
- audio
- captions
- render
- check
related-skills:
- velora-composition
- velora-export
- velora-verify
not-for: Text-to-speech synthesis, transcription, orTimed artistic mixing; this skill owns technical sync and file validity only.
---

# Velora Audio — Tracks, Captions, Drift

Owns the audio track schema, frame snapping, mix flags, caption validation, and the 40ms drift budget. No TTS or transcription claims.

## When to Use This Skill

Use this skill when the timeline declares `audio` tracks or a `captions` file. It proves placement, codec support, fade fit, and caption timing before export bakes them with FFmpeg.

## Commands

- `velora audio ls --composition teaser.composition.json --json`: tracks with frame-snapped placement.
- `velora audio check --composition teaser.composition.json --json`: asset existence, type, size, codec, fades, and ducking refs.
- `velora captions validate --file subs.srt --json`: file syntax with block-accurate paths.
- `velora captions check --composition teaser.composition.json --json`: cues against the timeline span.
- `velora render --composition teaser.composition.json --out teaser.mp4 --json`: bakes the mix plus caption burn when requested.
- `velora check --frames stills --json`: caption coverage gates over frame evidence.

Track fields: `id`, `assetId`, `startMs`, `offsetMs`, `gain` 0 to 2, `fadeInMs`, `fadeOutMs`, optional `duckUnder`. Placement snaps `startMs` to the frame grid; manifests state what FFmpeg used. Only one ducking relationship is supported.

## Prerequisites

- Audio assets as MP3, WAV, OGG, or discovered audio types under 50MB.
- Codecs AAC, MP3, Opus, Vorbis, FLAC, or WAV; others fail with `ERR_AUDIO_CODEC`.
- Caption files as `.srt` or `.vtt` with cues inside the timeline at 20 chars per second or less.

## Workflow

1. Declare tracks and an optional `captions: { file, burnIn }` in the composition.
2. Run `velora audio ls --composition teaser.composition.json --json` to review snapped starts.
3. Run `velora audio check --composition teaser.composition.json --json` and fix asset, codec, fade, or ducking issues.
4. Run `velora captions validate --file subs.srt --json`, then `velora captions check --composition teaser.composition.json --json`.
5. Render and check: `velora render --composition teaser.composition.json --out teaser.mp4 --json`, then `velora check --frames stills --json`.

## Worked Example

```bash
velora audio ls --composition teaser.composition.json --json
velora audio check --composition teaser.composition.json --json
velora captions validate --file subs.srt --json
velora captions check --composition teaser.composition.json --json
```

Caption file `subs.srt`:

```
1
00:00:00,000 --> 00:00:02,000
Hello world
```

Preview never plays the mixed audio; FFmpeg owns the mix at export. Drift is measured at export and enforced by `velora check`.

## Anti-Patterns

- Claiming transcription or TTS generation; supply real files.
- Letting fades exceed the audio length.
- Ducking under unknown tracks or declaring two ducking relationships.
- Burning captions without proving coverage with frames.

## Troubleshooting

- `ERR_ASSET_NOT_FOUND`: run `velora assets ls --json` and correct `assetId`.
- `ERR_AUDIO_CODEC`: re-encode to a supported codec.
- `ERR_AUDIO_INVALID` fades: shorten fades to fit the probed duration.
- `ERR_AUDIO_DRIFT`: trim audio to the video span within 40ms.
- `ERR_CAPTION_INVALID`, `ERR_CAPTION_OVERLAP`, or `ERR_CAPTION_TIMING`: fix blocks, shift overlaps, or split long cues.

## Validation

- `velora audio check --composition teaser.composition.json --json` passes with placement error within budget.
- `velora captions check --composition teaser.composition.json --json` passes for the timeline span.
- Export manifest records placed starts, drift, and caption windows.

## Related Skills

- `velora-composition`: asset and composition structure.
- `velora-export`: mix and burn at render time.
- `velora-verify`: drift and coverage gates.

## When NOT to Use This Skill

- Do not use this skill for kinetic text styling; load `velora-typography`.
- Do not promise broadcast loudness or artistic mix taste.
- Do not skip `velora audio check --composition <file> --json` before export.
