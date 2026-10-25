# Template Catalog

Every template is a **starting point the creator owns**. Scaffolding writes plain recipe JSON +
TSX; nothing at runtime depends on the template. Template IDs name techniques. Craft lineage
appears only as descriptive technique references, never as endorsements or impersonation.

**Wave 1** ships in Phase 02 (camera templates + starter blueprints). **Wave 2** ships in Phase 05
(layered real-UI + motion graphics). **Wave 3** ships in Phase 06 (launch blueprints).

## Choosing a template (intent → template)

| You want… | Start with | Then consider |
|---|---|---|
| A strong opening shot of the product | `hero-push` | `tilt-up-reveal`, `crane-down` |
| Scale and drama from an ordinary page | `monumental-survey` | `dolly-zoom` |
| A turntable "product reveal" | `orbit-reveal` | `device-showcase` (W2) |
| To show a whole landing page | `scroll-through` | `screen-wall` (W2) |
| To spotlight one control or metric | `macro-detail` | `rack-focus`, `feature-spotlight` via `Spotlight` (W2) |
| A looping website hero background | `float-loop` | `website-hero-loop-8s` blueprint |
| Energetic social cuts | `handheld-push` | `whip-pan`, `social-teaser-9x16` (W3) |
| To demo an interaction | `cursor-demo` (W2) | `floating-focus` (W2) |
| Titles, numbers, CTA | `title-reveal`, `stat-counter`, `end-card` (W2) | `kinetic-statement`, `lower-third` (W2) |
| A complete launch film | `launch-film-30s` (W3) | `feature-drop-15s`, `product-hunt-kit` (W3) |

## Conventions for starting values

- Coordinates: pixels and degrees, with +x right, +y down and +z toward the viewer.
  - Camera xyz subtracts from scene positions (camera `z > 0` recedes the subject).
  - Positive camera `rotateX` makes the top recede.
  - Negative camera `rotateY` brings the right side near.
- Lens: `perspective = frameHeight · mm / 24` (Phase 01 `lensFor`). For a 1080 px frame: 35 mm ≈ 1575, 50 mm = 2250, 85 mm ≈ 3825.
- Values below are **initial** numbers for a 1920×1080 frame and a 1440×900 subject. They are tuned during certification; every tunable is a declared param with a range.
- Defaults are `intensity: subtle`. `standard` and `dramatic` scale the travel, angle and aperture ranges.

---

## Wave 1 — Camera templates (single subject; quick-shot compatible)

### `hero-push` — The precise push-in
- **Technique:** a slow dolly-in on a three-quarter-angled product plane. Focus starts slightly soft and settles on the hero region as the camera arrives. One move, no change in angle.
- **Motivation:** opens a launch with gravity; "here is the product".
- **Lineage:** the patient, locked-on push-ins of modern thriller cinematography; product-film openers.
- **Starting values:**
  - 50 mm; `rotateY` −16°, `rotateX` 10° (dramatic: −22°/14°);
  - camera z +260 → +60 (dramatic +420 → +40);
  - fStop 4 (dramatic 2.8), maxBlur 8;
  - 6000 ms, smooth path + `cinematic` track ease.
- **Slots:** `subject` (component | route). **Params:** intensity, lens (35–85), angle (−30…30), durationMs (4000–10000), focusRegion.
- **Certification:** subject ≥ 0.55; focus region ≥ 0.95 visible and sharp at t = 1.0; projection margin ≥ 0.15.
- **Pitfalls:** pushing into the projection plane; adding rotation (two ideas in one shot).
- **Pairs with:** `macro-detail`, `title-reveal` (overlay), `end-card`.

### `monumental-survey` — The monumental surface
- **Technique:** a close oblique camera glides along the page as if it were a vast monolith. The near edge looms and the far edge recedes into the void.
- **Lineage:** monumental-scale framing in contemporary science-fiction cinematography; Velora's `surface-travel` concept.
- **Starting values:**
  - 35 mm; `rotateY` −34°, `rotateX` 18°;
  - camera close (z −200);
  - travel along the page tangent (derived with `matrixFor`) of 0.35 × subject width (dramatic 0.6);
  - fStop 2.8, maxBlur 10;
  - 8000 ms, smooth + `cinematic`.
- **Certification:** subject ≥ 0.35 (an intentional crop); focus region ≥ 0.8.
- **Pitfalls:** leveling the tilt at the end; fitting the whole page (it loses scale).
- **Pairs with:** `dolly-zoom`, `title-reveal`.

### `orbit-reveal` — The hero arc
- **Technique:** the camera arcs around a fixed target point and lands on a hero three-quarter view. The orbit pivot is held by compensating translation.
- **Lineage:** product turntables; automotive commercial arcs.
- **Starting values:**
  - 50 mm; `rotateY` +14° → −16° (subtle 30°, dramatic 60° arc), `rotateX` 12°;
  - fStop 5.6;
  - 7000 ms, smooth + `cinematic`.
- **Certification:** target point drift < 2% of frame diagonal; subject ≥ 0.6.
- **Pitfalls:** arcs past ±60° expose edges or backs; a tiny subject in empty void.
- **Pairs with:** `hero-push`, `end-card`.

### `crane-down` — Crane to hero
- **Technique:** starts in an overhead "god's-eye" view, then cranes down while tilting up to the hero angle.
- **Lineage:** jib and crane establishing shots.
- **Starting values:**
  - 35 mm; `rotateX` 58° → 12°;
  - camera y −240 → 0 and z +300 → +80;
  - fStop 5.6;
  - 7000 ms.
- **Certification:** subject ≥ 0.5 throughout; readable at the end.
- **Pitfalls:** an overhead start that reads as a blank texture; keep a recognizable shape in frame.

### `tilt-up-reveal` — The rise
- **Technique:** the plane starts nearly edge-on (an unreadable sliver) and rises to face the viewer, settling at a gentle angle.
- **Lineage:** keynote-style product rises.
- **Starting values:**
  - 50 mm; `rotateX` 72° → 8° (dramatic 80° → 4°);
  - track ease `expo.out` or `cinematic`;
  - focus follows;
  - 5000 ms.
- **Certification:** start angle < 82° (projection safety); subject ≥ 0.7 at the end.
- **Pitfalls:** starting at 90° (invisible) or holding edge-on too long.

### `dolly-zoom` — Vertigo
- **Technique:** the camera dollies back while the perspective widens. The subject holds its size while the depth behind it stretches.
- **Lineage:** the dolly zoom made famous in *Vertigo* and *Jaws*.
- **Starting values:**
  - perspective 3825 (85 mm) → 1350 (30 mm), with camera z compensating so `p/(p − z′)` holds the subject scale;
  - `rotateX` 20°, `rotateY` −20° (a tilted plane is needed for visible depth);
  - 5000 ms.
- **Certification:** subject projected width within ±2%; visible depth change on the receding edge.
- **Pitfalls:** a flat face-on plane shows nothing; overuse (once per film, at most).

### `rack-focus` — The focus pull
- **Technique:** the camera is locked on a steeply tilted plane, and focus pulls from one region to another. Attention moves without camera movement.
- **Lineage:** the focus puller's craft in narrative cinema.
- **Starting values:**
  - 85 mm; `rotateX` 32°, `rotateY` −12°;
  - fStop 2 (dramatic 1.4), maxBlur 12;
  - focus distance from region A depth → region B depth, holding 600 ms at each end;
  - 5000 ms.
- **Certification:** region A sharp at t = 0.1; region B sharp at t = 0.9.
- **Pitfalls:** both regions at equal depth (nothing pulls); blurring text past readability.

### `scroll-through` — The website showcase
- **Technique:** the real page scrolls on a tilted plane while the camera drifts gently. This is the classic landing-page showcase.
- **Starting values:**
  - viewport 1440×900 (desktop) or 390×844 (mobile);
  - scroll 0 → 0.8 × (pageHeight − viewport), via the RouteFrame scroll channel or a tall-component pedestal;
  - `rotateY` −18°, `rotateX` 14°; 50 mm;
  - 9000 ms, smooth + `cinematic`.
- **Slots:** `subject` as a route (preferred) or a tall component.
- **Certification:** subject ≥ 0.6; no blank frames from lazy media (async settle).
- **Pitfalls:** sticky headers covering content; scrolling too fast to read (keep ≤ 400 px/s at output).

### `macro-detail` — Detail to context
- **Technique:** an extreme close-up on one meaningful control, metric or icon, then a slow pull back that reveals where it lives.
- **Lineage:** macro inserts in product films; the detail → context progression of editing grammar.
- **Starting values:**
  - 85 mm; fStop 2;
  - camera framing of the `detail` region at ~3.2× → 1.2×;
  - `rotateY` −12°, `rotateX` 8°;
  - 6000 ms.
- **Slots:** `subject`, plus a `detail` region `{x, y, width, height}` in subject pixels.
- **Certification:** detail ≥ 0.95 visible and sharp at t = 0; context ≥ 0.6 at the end.
- **Pitfalls:** a detail that means nothing; zooming until the projection clips.

### `float-loop` — The living hero (seamless)
- **Technique:** a gentle bob plus a slow arc that returns exactly to its start, for website hero backgrounds.
- **Starting values:**
  - `loop: true`;
  - `rotateY` −8° → +8° → −8° (smooth), y ±12 px bob;
  - 50 mm, fStop 5.6;
  - 8000 ms.
- **Certification:** loop seam = 0 (exact); subject ≥ 0.8 throughout.
- **Pitfalls:** motion big enough to distract from page copy layered over the hero; looping noise.
- **Pairs with:** the `website-hero-loop-8s` blueprint; webm + poster delivery.

### `handheld-push` — Documentary energy
- **Technique:** a push-in with seeded handheld micro-motion, for urgency in social cuts.
- **Starting values:** the `hero-push` standard values plus noise on camera x/y (6 px), `rotateZ` (0.4°), 0.6 Hz, 2 octaves, seeded; 4000 ms.
- **Certification:** text-region jitter < 1.5 px peak at output size.
- **Pitfalls:** noise on text-dense UI; on loops; on every shot of a film.

### `whip-pan` — The whip
- **Technique:** a fast lateral whip that lands and settles on the subject. Motion blur sells it, so it works best as a transition-in.
- **Lineage:** whip pans in stylized comedic and symmetrical filmmaking.
- **Starting values:**
  - camera x −1.6 × frame width → 0 in 450 ms with `expo.out`, then hold;
  - `rotateY` −10°;
  - 2500 ms total;
  - render with `--motion-blur 270` (Phase 04).
- **Certification:** lands with the subject ≥ 0.7 by 600 ms.
- **Pitfalls:** without motion blur it strobes (documented until Phase 04); more than one whip per 15 s.

---

## Wave 2 — Layered real-UI templates (Phase 05)

| ID | Technique | Lineage | Slots | Key params |
|---|---|---|---|---|
| `exploded-stack` | UI layers separate along z, the camera orbits, then the layers re-assemble | Exploded-view product diagrams | `layers[]` (2–6) | separation (px), orbit (°), hold |
| `parallax-planes` | 3–5 planes at depth; a lateral truck reveals differential motion | Multiplane animation camera | `background`, `mid[]`, `foreground` | depth spacing, truck distance |
| `cascade-build` | Widgets settle into the page in a staggered assembly | Velora "plating" concept | `page`, `pieces[]` | stagger, depth, easing personality |
| `floating-focus` | A lifted foreground (modal/card) over a soft background page; drift shows parallax | Foreground/background staging | `foreground`, `background` | lift (z), drift |
| `device-showcase` | UI in a CSS browser/phone/laptop frame on a backdrop with contact shadow, slow orbit and light sweep | 3D device-mockup tools | `screen`, `device` | device, backdrop, orbit |
| `cursor-demo` | The cursor glides to a target, presses (ripple), the UI changes state; the camera follows and zooms toward the click | Auto-zoom screen-recording tools | `subject`, `target` region, `state` channel | path, press time, zoom |
| `split-compare` | Before/after planes with a true-mask divider that travels | Before/after reveals | `before`, `after` | divider path, labels |
| `screen-wall` | A grid of routes/screens at angles; the camera flies through | Video-wall establishing shots | `screens[]` (routes/components) | grid, angle, path |

## Wave 2 — Motion-graphics templates (Phase 05; brand-token styled)

| ID | Technique | Slots | Key params |
|---|---|---|---|
| `title-reveal` | Masked line reveal + blur-in + tracking settle (+0.08 em → 0) | `title`, `subtitle?` | personality, lines, hold |
| `logo-sting` | Logo scale-settle + light sweep + glow bloom (2.5 s) | `logo` (asset) | sweep angle, glow |
| `kinetic-statement` | 2–6 bold words in a spring cascade, accent on the key word | `words`, `accent` | stagger, spring |
| `stat-counter` | 1–3 counters with `expo.out`, prefix/suffix (×, %, k) | `stats[]` | duration, format |
| `feature-trio` | Three cards with icons and labels, staggered | `features[3]` | layout, stagger |
| `lower-third` | Name/feature bar with a clip reveal | `label`, `sublabel` | side, hold |
| `quote-card` | Testimonial with avatar, quote reveal, slow push | `quote`, `name`, `avatar` | hold |
| `end-card` | Logo + headline + URL + CTA; holds ≥ 2.5 s | `logo`, `headline`, `url`, `cta` | layout, hold |
| `countdown` | 3·2·1 or date countdown for teasers | `target` | style |
| `changelog-card` | Version badge + 3–5 staggered items | `version`, `items[]` | stagger |

Motion-graphics certification adds:
- reading time: on-screen duration ≥ 0.3 s per word + 1 s;
- title-safe placement in every aspect;
- contrast ≥ 4.5:1 against the backdrop (brand colors checked).

---

## Blueprints

| ID | Wave | Aspect | Length | Structure |
|---|---|---|---|---|
| `product-reel-20s` | 1 | 16:9 | 20 s | `hero-push` (0–5) → `macro-detail` (5–10) → `scroll-through` (10–16) → `orbit-reveal` (16–20); entering `focus-pull` / `depth-dolly` |
| `website-hero-loop-8s` | 1 | 16:9 | 8 s | `float-loop`, seamless; webm + mp4 + poster delivery |
| `launch-film-30s` | 3 | 16:9 | 30 s | Hook 0–2 (`kinetic-statement` over `macro-detail`) → Problem 2–6 (`title-reveal`) → Reveal 6–14 (`hero-push` ⟶ crossfade ⟶ `orbit-reveal`) → Proof 14–24 (`cursor-demo` + `feature-trio` overlay + `stat-counter`) → CTA 24–30 (`end-card`, ≥ 3 s hold); music markers; caption skeleton |
| `feature-drop-15s` | 3 | 16:9 + 1:1 | 15 s | `kinetic-statement` → `macro-detail` → `cursor-demo` → `end-card` |
| `social-teaser-9x16` | 3 | 9:16 | 10 s | `handheld-push` → `kinetic-statement` → `whip` → `end-card`; karaoke captions; vertical safe zones |
| `changelog-20s` | 3 | 16:9 | 20 s | `changelog-card` → `split-compare` → `feature-trio` → `end-card` |
| `product-hunt-kit` | 3 | mixed | 30 s + stills | 5 gallery stills (1270×760) from hero times + 30 s film + README GIF |
| `app-preview-25s` | 3 | portrait | 25 s | `device-showcase` (phone) → `scroll-through` (mobile) → tap demo → `end-card` |

Each blueprint ships a `brief.md` that asks for:
- the product;
- the audience;
- the single message;
- the platforms;
- the motion personality;
- the must-show features;
- the CTA.

It then maps the answers to the shot list, with a rationale for every beat.

---

## Certification checklist (every template)

1. **Validity:** every declared aspect × intensity yields a definition accepted by `presentPreview`.
2. **Framing:** `framingReport` meets the template's `minSubjectVisible` / `minFocusVisible` at every sample and at the hero times; projection margin ≥ 0.15.
3. **Focus:** focus-region blur ≤ 0.5 px at the hero times (camera templates).
4. **Determinism:** identical params → identical JSON; two browser renders → identical frame SHAs.
5. **Budget:** filtered-surface count within the kinetic/procedural budgets; per-frame render time recorded (evidence, not a promise).
6. **Craft review (human, recorded in the phase exit report):**
   - one motivated move;
   - readable at output size;
   - settles intentionally (no accidental linear motion);
   - works on light and dark host UIs;
   - looks intentional in every supported aspect;
   - "pairs with" suggestions make sense.
7. **Docs:** craft notes, pitfalls, params with ranges, and a contact sheet in the exit report.
