---
name: velora-brand
description: One brand file (velora.brand.json) — colors, gradients, fonts, radius, voice and a motion personality — that re-skins every kit component and motion-graphics template. Use when a film should look and move like the user's product.
license: MIT
version: 0.1.2
when-to-use: Before the first motion-graphics scene, when a user names brand colors or fonts, when titles or cards look generic, or when the film's motion should feel calmer, crisper, more playful or bolder.
prerequisites:
- velora init completed
- The app's stylesheet path, if tokens should be seeded from CSS custom properties
commands:
- brand
- new
- shot
related-skills:
- velora
- velora-templates
- velora-motion-design
- velora-looks
- velora-typography
- velora-launch
- velora-editing
not-for: Color grading the finished frame (use velora-looks) or editing the host app's own theme.
---

# Velora Brand — One File, Every Scene On-Brand

`velora.brand.json` sits at the project root. Kit components (`Title`, `Counter`, `Panel`, `Backdrop`, `BrandMark`, and the rest) read it at render time through `BrandProvider`. Editing it re-skins every branded scene with no recipe or binding edits.

## When to Use This Skill

- Before scaffolding motion-graphics templates (`title-reveal`, `stat-counter`, `end-card`, and the others).
- When the user gives brand colors or fonts, or points at their CSS.
- When motion feels off-brand: choose the personality instead of retiming every scene.

## Commands

- `velora brand init --json` writes a default brand file named after the package.
- `velora brand init --from-css src/index.css --json` seeds colors, fonts and radius from the stylesheet's CSS custom properties. Nothing is executed or fetched.
  Recognized properties include primary, accent, background, foreground, color-*, font-sans and radius (shadcn-style bare HSL works too).
- `velora brand check --json` validates the file and warns when the logo is not a project file.
- `velora new scene --template end-card --id closer --json` creates the brand file if it is missing, and never overwrites one.

## Prerequisites

- An initialized project; `velora brand init` never overwrites (`output-exists`).
- Colors are CSS colors (`#hex`, `rgb()`, `hsl()`, `oklch()`, names); fonts are CSS font-family stacks the app already loads.

## Workflow

1. Seed: `velora brand init --from-css <stylesheet> --json`, then read `data.fromCss` to see which tokens were found.
2. Fill the gaps by hand: `accent` drives highlights, the accent word, the cursor ripple and callouts; `surface` drives cards; `muted` drives secondary text.
3. Pick `motion`:

| Personality | Feel | Easing | Pacing |
|---|---|---|---|
| `calm` (default) | premium, considered | cinematic | 1.35x durations, wide stagger |
| `crisp` | precise, technical | expo.out | 0.8x, tight stagger |
| `playful` | friendly, consumer | under-damped spring | 1x |
| `bold` | loud, launch-day | back.out | 0.7x, fastest stagger |

4. Set `voice.tagline`, `voice.url` and `voice.cta` so end cards have real copy.
5. Validate with `velora brand check --json`, then prove one frame with `velora shot`.

## Worked Example

```bash
velora brand init --from-css src/index.css --json
velora brand check --json
velora new scene --template stat-counter --id proof --set "stats=12k+ teams|98% uptime|3x faster" --json
velora shot --scene proof --time 3000 --out proof.png --json
```

Expected: the counters use the brand's display font and text color, and the backdrop uses its background and accent. Changing `colors.accent` and re-running `velora shot` changes the accent with no source edit.

## Anti-Patterns

- Hard-coding colors in bindings instead of `var(--velora-accent)` or the brand tokens.
- Bundling third-party logos. `logo` is the user's own file (a public path or URL renders; otherwise `BrandMark` shows the name).
- Mixing personalities across scenes of one film.

## Troubleshooting

- `ERR_BRAND_INVALID`: the issue path names the field (for example `velora.brand.json#motion`). Fix that value.
- `WARN_BRAND_LOGO`: the logo is not a project file. Use a public path such as `/logo.svg`.
- Brand changes are not visible in the studio: the studio reads `/velora.brand.json` from the dev server, so make sure it is at the project root and reload.
- `output-exists` from `brand init`: edit the existing file instead.

## Validation

- `velora brand check --json` succeeds.
- Each motion-graphics scene shows brand colors and fonts in `velora shot` output.
- Body and muted text keep at least 4.5:1 contrast against the background (check the hex values).

## Craft Notes

- **Design tokens.** Product teams keep colors, type and radius as named tokens so every surface agrees; `velora.brand.json` is the same idea applied to video, seeded from the app's own CSS.
- **Motion as part of the brand.** Design-system motion guidelines give a product a consistent feel: calm brands ease slowly, playful ones overshoot. The four motion personalities encode that choice once for the whole film.
- **Contrast first.** Accessible contrast (WCAG ratios) applies to video text as much as to interfaces; `velora brand check` reports low-contrast pairs.

## Related Skills

- `velora-motion-design`: choosing and timing motion-graphics templates.
- `velora-looks`: grading and finishing the frame.
- `velora-templates`: scaffolding scenes.
- `velora-typography`: kinetic type details.
- `velora-launch`: the brief that chooses the motion personality.
- `velora-editing`: brand-consistent overlays and captions in the cut.

## When NOT to Use This Skill

- Do not use it to restyle the host app's real UI. Brand tokens style kit-authored elements only.
- Do not use it for per-scene color grades; those are looks (`velora-looks`).
