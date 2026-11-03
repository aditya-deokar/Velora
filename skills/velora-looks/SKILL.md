---
name: velora-looks
description: A cinematographer's finishing pass on a scene or composition — grade, grain, vignette, letterbox (previewed live) plus bloom, halation, chromatic aberration, sharpen and .cube LUTs (applied at export). Use when frames look flat, digital or inconsistent across a film.
license: MIT
version: 0.1.2
when-to-use: A scene reads "screen-recorded", a film needs one consistent mood, a user asks for a film or keynote look, or a LUT must be applied.
prerequisites:
- A scene recipe or composition to edit
- velora shot available for still proofs
commands:
- shot
- render
- check
- validate
related-skills:
- velora
- velora-brand
- velora-export
- velora-cinematography
- velora-motion-design
- velora-editing
- velora-launch
not-for: Brand colors and type (velora-brand) or camera and lens choices (velora-cinematography).
---

# Velora Looks — Finishing the Frame

A `look` lives on a recipe's `definition` or on a composition. A scene's own look wins; scenes without one inherit the composition's. Looks have two layers:

| Layer | Fields | Where it happens |
|---|---|---|
| Browser (captured with the frame, so the preview is the export) | `grade` (contrast, saturation, temperature, tint, lift, gamma, gain), `grain`, `vignette`, `letterbox` | Studio, `velora shot`, render, export |
| Export finishing (per frame, in Node) | `bloom`, `halation`, `chromaticAberration`, `sharpen`, `lut` | render, export, `velora shot --finish` |

## When to Use This Skill

- To give a film one mood (`film`, `keynote`, `noir`, `teal-orange`, `neon`, `pastel`, `clean`).
- To hide gradient banding with grain.
- To apply a colorist's `.cube` LUT.

## Commands

- `velora shot --scene hero --time 3000 --out graded.png --json` proves the browser layer.
- `velora shot --scene hero --time 3000 --out finished.png --finish --json` adds export finishing, exactly as video frames get it.
- `velora render --composition film.composition.json --out film.mp4 --json` renders with each scene's look.
- `velora check --frames stills --json` reports `banding` (advisory) and `flash-safety`.
- `velora validate --json` validates look fields in recipes.

## Prerequisites

- Look fields are validated with the recipe; a LUT is a project-relative `.cube` (3D) file.

## Workflow

1. Start from a preset: `"look": { "preset": "keynote" }` in the recipe definition, or on the composition.
2. Override one field at a time; preset values survive partial overrides (`"grade": { "contrast": 0.2 }` keeps the preset's warmth).
3. Prove the browser layer with `velora shot`, then the full finish with `velora shot --finish`.
4. Add grain (0.05 to 0.15) if `velora check` reports `ADV_BANDING`.
5. Render once the stills read right.

| Preset | Use |
|---|---|
| `keynote` | product films: deep blacks, gentle vignette, subtle sharpen |
| `film` | warm, soft S-curve, fine grain, halation |
| `teal-orange` | split-toned energy |
| `noir` | monochrome drama |
| `neon` | saturated with bloom (dark UIs) |
| `pastel` | soft, lifted, low contrast |

## Worked Example

```json
{ "definition": { "look": { "preset": "film", "letterbox": { "aspect": 2.39 }, "bloom": { "intensity": 0.4, "threshold": 0.85 } } } }
```

```bash
velora shot --scene hero --time 4000 --out film.png --finish --json
```

Expected: warm, slightly lifted blacks, fine grain, a soft vignette, 2.39:1 bars, and a gentle glow around bright UI.

## Anti-Patterns

- Grading every scene differently inside one film; put the look on the composition.
- Strong chromatic aberration (over 4 px) on UI text; it reads as broken, not cinematic.
- Implementing bloom by duplicating UI layers; bloom is export finishing.
- Using `Math.random` grain in bindings; the look's grain is seeded per frame.

## Troubleshooting

- `ERR_LOOK_INVALID`: a field is out of range, or the LUT path is missing or not a 3D `.cube`.
- Bloom is not visible in the studio: it is export finishing; use `velora shot --finish`.
- Grain flickers too fast: grain refreshes at 24 fps by design, regardless of the export frame rate.

## Validation

- `velora shot` and `velora shot --finish` stills read as intended at output size.
- `velora check --frames <dir> --json` shows no `ADV_BANDING` on large gradients, and `flash-safety` passes.

## Craft Notes

- **Lift, gamma, gain.** The three-way color corrector from film and broadcast grading adjusts shadows, midtones and highlights independently; Velora looks use the same controls.
- **The complementary palette.** Pushing shadows toward teal and skin and highlights toward orange is a common feature-film grade (`teal-orange`); use it lightly on UI.
- **Photochemical texture.** Grain, halation and gentle vignettes imitate film stock and lenses (`film`, export finishing). They read on large shapes and hurt small text.
- **LUTs.** A `.cube` lookup table is the interchange format colorists use; finishing applies one exactly.
- **Flash safety.** The WCAG 2.3.1 three-flashes threshold comes from broadcast photosensitivity guidance; `velora check --video` reports it.

## Related Skills

- `velora-brand`: colors and type.
- `velora-export`: quality, codecs and motion blur.
- `velora-cinematography`: camera, lens and focus.
- `velora-motion-design`: graphics that the look must keep legible.
- `velora-editing`: one grade across every shot of the film.
- `velora-launch`: per-platform deliverables of the graded master.

## When NOT to Use This Skill

- Do not use a look to fix a weak shot; reframe the camera first.
- Do not use it to change brand colors; edit `velora.brand.json`.
