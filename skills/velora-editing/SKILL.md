---
name: velora-editing
description: Edit like an editor — launch-film blueprints, true A/B transitions (crossfade, dips, wipe, iris, push, zoom, whip, light leak), title overlays over real UI, beat-snapped cuts, procedural sound on cuts, broadcast loudness, styled captions, and an advisory editorial review. Use when assembling or polishing a multi-shot film.
license: MIT
version: 0.1.2
when-to-use: Building a launch film, feature drop, social teaser, changelog or app preview; tightening a cut to music; adding transitions, overlays, sound or captions; or reviewing pacing and continuity before export.
prerequisites:
- velora init completed and scenes available (velora-templates, velora-motion-design)
- Licensed music in assets/ if the film has a bed (none is bundled)
commands:
- new
- audio
- compose
- review
- transitions
- render
- frames
- check
related-skills:
- velora
- velora-composition
- velora-transitions
- velora-audio
- velora-motion-design
- velora-export
- velora-cinematography
- velora-launch
- velora-looks
not-for: Single-shot camera work (velora-cinematography) or recipe authoring (velora-scenes).
---

# Velora Editing — From Shots to a Film

Emotion and story come first, then rhythm and eye trace (Murch, *Rule of Six*). Velora measures rhythm and eye trace; a human judges the rest.

## When to Use This Skill

| Goal | Start |
|---|---|
| 30 s launch film | `velora new video --blueprint launch-film-30s --id launch --route / --json` |
| 15 s feature drop (16:9 or 1:1) | `--blueprint feature-drop-15s` |
| 10 s vertical teaser | `--blueprint social-teaser-9x16 --aspect 9:16` |
| Release notes video | `--blueprint changelog-20s` |
| Product Hunt film, stills and GIF | `--blueprint product-hunt-kit` |
| Portrait app preview | `--blueprint app-preview-25s --aspect 9:16` |

Each blueprint writes:
- the shot scenes;
- V2 overlay scenes;
- a composition with transitions, transition sound, section and music-cue markers;
- a karaoke caption skeleton (`<id>.captions.srt`);
- a story brief (`<id>.brief.md`: Hook, Problem, Reveal, Proof, CTA, with a shot list).

## Commands

- `velora transitions ls --json` lists entering and overlap transitions with their mode.
- `velora audio beats --file assets/music.mp3 --json` reports tempo, beats and 4/4 downbeats.
- `velora audio beats --composition launch.composition.json --write-markers --json` stores beat and downbeat markers.
- `velora compose snap --composition launch.composition.json --to beats --json` previews moving each cut onto the nearest beat; `--write` applies it. Use `--to downbeats` for bigger moments and `--tolerance MS` (default 120).
- `velora review --composition launch.composition.json --platform youtube-1080p --json` gives advisory editorial review.
- `velora frames --composition launch.composition.json --out board --every 30 --contact-sheet --json` makes the storyboard.
- `velora render --composition launch.composition.json --out launch.mp4 --quality draft --json` renders a draft; the master follows.

## Prerequisites

- Scenes validate (`velora validate --composition <file> --json`).
- Captions and word files are served by the dev server (project root files in Vite).
- Music is the creator's licensed file; reference it with `"kind": "music"`.

## Workflow

1. **Story first.** Read the brief, rewrite the copy (template params, captions) and choose the shots.
2. **Transitions.** Overlap transitions blend two finished frames. Segment B starts exactly `durationMs` before A ends; any other overlap is `ERR_TIMELINE_OVERLAP`.

| Transition | Use |
|---|---|
| `crossfade` | time passing, a soft change of idea |
| `dip-to-black` | a chapter break; `dip-to-white` for a flash cut |
| `wipe` (`direction`) | moving along the story |
| `iris` | opening onto a reveal |
| `push` (`direction`) | the next thing in a sequence |
| `zoom` | diving in |
| `whip` (`direction`) | energy; pairs with `--motion-blur` |
| `light-leak` (`seed`) | warmth, nostalgia |

   Cuts stay the default: most edits should be cuts.
3. **Overlays (V2/V3).** `overlays[]` places titles and lower thirds over real UI. They are captured transparently on their own clock and composited in order, with `opacity` and `blend` (`normal`, `screen` or `multiply`). Graphics scaffolded as overlays use `backdrop=off`.
4. **Rhythm.** Run `audio beats --write-markers`, then `compose snap` (dry run), then `--write`. Cut on downbeats for section changes.
5. **Sound.**
   - Use `transition.sfx` (`whoosh`, `swish`, `click`, `pop`, `tick`, `riser`, `impact`, `shimmer`), placed at the cut, or `sfx[]` entries `{ id, preset, atMs, gainDb, seed }`. They are synthesized, royalty-free and deterministic.
   - J and L cuts: start music or a voice `offsetMs` before or after the picture cut.
   - The mix is normalized to -14 LUFS / -1 dBTP by default (`loudness` on the composition; `false` skips it).
6. **Captions.** `captions.style` is `karaoke`, `bold-pop`, `minimal`, `lower` or `burn` (FFmpeg). Words come from `wordsFile` (`{ "words": [{ "text", "startMs", "endMs" }] }`), or are spread by character count. Captions sit clear of 9:16 platform UI.
7. **Review.** Run `velora review`, then the contact sheet, then a draft render, then `velora check --video` (flash safety), then the master.

## Worked Example

```bash
velora new video --blueprint launch-film-30s --id launch --route / --json
velora audio beats --composition launch.composition.json --write-markers --json
velora compose snap --composition launch.composition.json --to beats --json
velora compose snap --composition launch.composition.json --to beats --write --json
velora review --composition launch.composition.json --platform youtube-1080p --json
velora render --composition launch.composition.json --out launch.mp4 --quality draft --json
velora check --video launch.mp4 --manifest launch.manifest.json --json
```

Expected:
- a 30 s film: whip, crossfade, dip and push between shots, a lower third over the problem shot, and sound on every transition;
- cuts on beats, karaoke captions, and loudness normalized to about -14 LUFS (recorded in the manifest);
- review advisories that you read and either act on or accept.

## Anti-Patterns

- Overlapping shots without an overlap transition, or a transition window that differs from the overlap.
- Transitions on every cut. Most cuts should be cuts; save the whip for one moment.
- Snapping with `--write` before reading the dry-run diff.
- Bundling unlicensed music.
- Captions that cover the product, or that stay up for less than the reading time.

## Troubleshooting

- `ERR_TIMELINE_OVERLAP`: start B exactly `durationMs` before A ends; keep the window shorter than both shots.
- `ERR_MARKERS_MISSING`: run `velora audio beats --composition <file> --write-markers` first.
- `WARN_BEATS_UNCERTAIN`: the bed lacks a steady pulse; place cue markers by hand.
- Loudness `skipped: true` in the manifest: the mix was too short (under 400 ms) or silent to measure.
- Captions missing from a render: the caption file must be served by the dev server (project root).

## Validation

- `velora validate --composition <file> --json` passes.
- `velora review` advisories are read and either fixed or accepted on purpose.
- `velora check --video <file> --manifest <manifest> --json` passes flash safety.
- The manifest records `loudness.result.integrated` near the target, and `layers` on blended or overlaid frames.

## Craft Notes

- **Priorities for a cut.** Walter Murch's book *In the Blink of an Eye* ranks a cut by emotion, story, rhythm, eye trace, then the two- and three-dimensional plane of the screen. `velora review` measures only the last few; the first ones need a person.
- **Rhythmic and match cutting.** Cutting on the beat and matching shapes or positions across a cut are long-standing editorial techniques, visible in music videos and comedy editing alike (`velora compose snap`, the `match` cue marker).
- **J and L cuts.** Sound leading or trailing the picture cut, a standard documentary and dialogue technique (`offsetMs` on audio tracks).
- **The cut is the default.** Classical continuity editing hides most cuts; optical transitions are punctuation. The blueprints use a few on purpose.

## Related Skills

- `velora-composition`: composition fields and timing.
- `velora-transitions`: entering transitions inside a scene.
- `velora-audio`: tracks, ducking and caption files.
- `velora-motion-design`: titles, lower thirds and end cards used as shots or overlays.
- `velora-export`: quality, codecs and delivery presets.
- `velora-cinematography`: the shots being cut together.
- `velora-launch`: story structure, platform pacing and deliverables.
- `velora-looks`: one consistent grade across the cut.

## When NOT to Use This Skill

- Do not use it for one continuous shot; refine it with `velora-cinematography`.
- Do not use review advisories as gates; they are prompts for a human eye.
