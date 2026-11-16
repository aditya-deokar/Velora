---
name: velora-motion-design
description: Layered real-UI and brand motion-graphics scenes from the Wave 2 templates and the kit (device frames, backdrops, cursor, titles, counters, cards). Use when a film needs titles, stats, feature cards, a device showcase, a guided click or an end card.
license: MIT
version: 0.1.2
when-to-use: A launch film needs an opener title, proof numbers, a feature summary, a product-in-device shot, a click demo, a before/after, a lower third or an end card; or a hand-written scene should use kit components.
prerequisites:
- velora init completed
- velora.brand.json (velora-brand), created automatically by the first branded template
commands:
- templates
- new
- shot
- check
related-skills:
- velora
- velora-templates
- velora-brand
- velora-typography
- velora-looks
- velora-editing
- velora-cinematography
- velora-launch
not-for: Pure camera moves on one subject (velora-templates, Wave 1) or timeline editing (velora-composition).
---

# Velora Motion Design — Layered Shots and Brand Graphics

Wave 2 templates compile to ordinary files: a recipe with one node per layer, and a binding with one `Surface` per node, built from `@adityadeokar/velora/kit` components inside `BrandProvider`. Copy comes from `--set` text params; colors, fonts and motion personality come from `velora.brand.json`.

## When to Use This Skill

| Need | Template | Key `--set` params |
|---|---|---|
| Opening title | `title-reveal` | `title` (use `\n` for line breaks), `subtitle` |
| Brand beat | `logo-sting` | `name` |
| Punchy statement | `kinetic-statement` | `words`, `accent` |
| Proof numbers | `stat-counter` | `stats=12k+ teams\|98% uptime\|3x faster` |
| Why it matters | `feature-trio` | `features=Title: description\|…` (three) |
| Speaker or feature label | `lower-third` | `label`, `sublabel`, `side` |
| Testimonial | `quote-card` | `quote`, `name`, `role` |
| Closing call to action | `end-card` | `headline`, `url`, `cta` |
| Teaser | `countdown` | `from` |
| Release notes | `changelog-card` | `version`, `items=A\|B\|C` |
| Product as an object | `device-showcase` | `device` (browser, phone, laptop, tablet, window), `backdrop` |
| Layers of the UI | `exploded-stack` | `separation`, `orbit` |
| Depth and parallax | `parallax-planes` | `truck`, `spacing` |
| Key numbers on the page | `cascade-build` | `pieces=label: value\|…` |
| One message over the product | `floating-focus` | `headline`, `body`, `lift` |
| Demo one interaction | `cursor-demo` | `focusRegion=x,y,w,h` (the target), `pressMs`, `zoom` |
| Redesign or speed-up | `split-compare` | `before=/old-route`, `beforeLabel`, `afterLabel` |
| Breadth of the product | `screen-wall` | `routes=/\|/pricing\|/docs` |

## Commands

- `velora templates ls --category motion-graphics --json` and `velora templates ls --category layered --json` list them.
- `velora templates show --id device-showcase --json` shows params and craft notes.
- `velora new scene --template device-showcase --id showcase --route / --set device=laptop --json` creates a layered scene.
- `velora new scene --template stat-counter --id proof --set "stats=12k+ teams|98% uptime" --json` creates a graphic.
- `velora templates check --json` certifies framing, title-safe placement and reading time.
- `velora check --frames stills --json` runs flash-safety before export.

## Prerequisites

- Layered templates take `--route` or `--component` for their main slot; extra screens use routes in params.
- Motion-graphics templates have no slot.
- Text params have length limits; `velora templates show` lists them.

## Workflow

1. Draft the shot list: hook, problem, reveal, proof, CTA.
2. Map each beat to a template from the table; vary layered shots with graphics.
3. Scaffold each scene; read `warnings` and `next`.
4. Prove a mid frame and an end frame with `velora shot`.
5. Keep copy short: certification wants at least 0.3 s per word plus 1 s on screen.
6. Edit bindings freely: they are plain TSX. Keep the `Surface` ids that match recipe nodes.

## Worked Example

```bash
velora new scene --template title-reveal --id opener --set "title=Your launch,\nmade cinematic" --json
velora new scene --template device-showcase --id product --route / --set device=browser --set backdrop=grid-floor --json
velora new scene --template end-card --id closer --set "headline=Ship something memorable" --set url=acme.dev --set "cta=Start free" --json
velora shot --scene product --time 4000 --out product.png --json
```

Expected: three branded scenes that share fonts, colors and motion personality, with the real page inside a browser frame on a lit grid floor.

## Anti-Patterns

- Paragraphs on cards or titles; split into two scenes.
- Recreating the app's UI in a graphic instead of slotting the real route or component.
- Fast strobing reveals; `velora check` fails above 3 flashes per second (`ERR_FLASH_RISK`).
- Per-component clocks (`setInterval`, `requestAnimationFrame`) in bindings; kit components read scene time only.

## Troubleshooting

- `ERR_TEMPLATE_PARAM` on a text param: it is over its length limit; shorten it.
- `ERR_TEMPLATE_FRAMING` mentioning reading time: raise `durationMs` or cut words.
- A layer is missing in the preview: its `Surface` id must match a node id in the recipe.
- `ERR_FLASH_RISK`: lengthen fast cuts or soften the strobe.

## Validation

- `velora templates check --json` reports every template certified.
- `velora shot` frames show title-safe copy at the end of each graphic.
- `velora check --frames <dir> --json` passes `flash-safety`.

## Craft Notes

- **Kinetic type.** Title-sequence design made type itself the performer: words that enter on rhythm and resolve into a still layout (`title-reveal`, `kinetic-statement`).
- **The grid.** Swiss (International Typographic Style) layouts keep stats and feature cards aligned to a strong grid with generous margins (`feature-trio`, `stat-counter`).
- **Numbers as proof.** Keynote-style stat slides show one number, large, with a short label; counting up gives it weight (`Counter`).
- **The guided cursor.** Screen-recording tools popularized a smooth cursor with an automatic zoom on each click (`cursor-demo`, `Cursor`).
- **Springs.** Interface motion in modern design systems favors spring physics over fixed curves; the motion personalities map to spring and easing tables.

## Motion Model v3 (Velora 1.1)

- **Auto-bezier keyframes.** Set a keyframe's `easing` to `"auto"` and its outgoing segment becomes a monotone cubic Hermite through the neighboring keyframes: continuous velocity, never an overshoot. Use it for multi-point moves that should flow through waypoints while other segments keep their own curves. `"auto"` is valid only on numeric keyframes, not on a track `ease`.
- **Color in OKLab.** Style tracks (`{ kind: "style", id }` with a `--name` property) and channel tracks accept color keyframes (`#rrggbb`, `rgb()`, `hsl()`, `oklab()`, `oklch()`, `transparent`). They blend in OKLab with premultiplied alpha and print canonical `rgb(R G B / A)`, so midpoints never go muddy and frames are deterministic. Named colors are rejected; use hex. Color tracks are segments only (no smooth, unit or noise).
- **Animatables.** A component declares typed props with `useAnimatable(id, spec)` (number, color, boolean, enum). Each prop reads the channel `<id>.<prop>`: numbers clamp to min/max, booleans switch at 0.5, enums hold the rounded option index, and colors take color keyframes. Without a track the prop shows its spec default.
- Restraint still applies: animate a color or a grade to support the story (an accent that warms on the reveal), not as decoration on every layer.

## Clips, Staggers, Additive Layers and Links (Velora 1.1)

- **Clips (groups in time).** `motion.clips: [{ "id": "intro", "startMs": 400, "speed": 1, "ease": "cubic.out", "tracks": [...] }]` moves, retimes and eases a group of tracks as one unit (track times are clip-local). `inMs`/`durationMs` trim, `loop` is a play count, and clips nest up to 4 deep. Each property has one replace owner across root tracks and replace clips; validation names both owners when two collide.
- **Additive layers.** `"mode": "add"` sums a clip's values onto the owner (or onto the static base without one). Keyframe offsets around 0, for example a handheld `noise` on camera x over a push-in, or a bank on camera rotateZ.
- **Staggers.** A clip with `"members": ["card-1", "card-2", "card-3"]` and `"stagger": { "eachMs": 120, "order": "center-out", "ease": "quad.out" }` repeats its `{ "kind": "surface", "id": "$member" }` tracks per member, offset by `ease(position) × eachMs × (n − 1)`. Orders: forward, reverse, center-out, edges-in, or `{ "random": seed }`. `createCascadeClip` builds the depth cascade as a clip.
- **Paths.** A `"property": "position"` track with `[x, y, z]` keyframes moves along a curve (automatic handles, or `inTangent`/`outTangent` offsets); easing maps time to distance along each segment. `rove: true` gives constant speed, and `orient` turns the layer along the path. A path replaces x/y/z tracks on that target.
- **Links (no expressions).** `motion.links: [{ "to": { "target": { "kind": "surface", "id": "bg" }, "property": "x" }, "from": { "target": { "kind": "camera" }, "property": "x" }, "scale": -0.2 }]` creates parallax; `delayMs` makes echoes and trails; `{ "channel": "scroll" }` drives counters. Links are acyclic, at most 8 deep.

## Shaping Easing in the Graph Editor (Velora 1.1)

In the studio's Edit mode (`velora edit --scene <id>`), press G for the graph editor: value and speed graphs
drawn by the real evaluator. Dragging a segment's handles writes `{ "cubicBezier": [x1, y1, x2, y2] }` on the
segment's start keyframe (out-handle = x1, y1; in-handle = x2, y2, in segment-normalized space; x stays in 0..1,
y in −5..5). Handle modes: linear, ease (Easy Ease `[0.333, 0, 0.667, 1]`), continuous (matches velocity on both
sides of a keyframe), auto (`"auto"`) and hold. Springs and steps get a parameter panel with settle time and
overshoot. The easing library (E) offers Velora, After Effects, CSS, Penner, spring and steps presets. Prefer an
ease-out with a little overshoot for UI arrivals, and keep overshoot off camera tracks (the camera-overshoot
advisory flags it).

## Related Skills

- `velora-brand`: tokens and motion personality.
- `velora-typography`: kinetic type details and `KineticText`.
- `velora-looks`: finishing the frame.
- `velora-templates`: Wave 1 camera templates and the studio gallery.
- `velora-editing`: graphics as overlays (lower thirds, titles) and their timing in the cut.
- `velora-cinematography`: when a real-UI shot says more than a graphic.
- `velora-launch`: which graphics a launch needs (hook, proof, CTA).

## When NOT to Use This Skill

- Do not use graphics where the real product can speak; prefer a layered real-UI shot.
- Do not use it for timeline or audio work (`velora-composition`, `velora-audio`).
