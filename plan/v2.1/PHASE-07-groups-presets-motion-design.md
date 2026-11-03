# Phase 07 — Groups, presets and motion-design tools

## Goal
Make the editor fast for real motion design: group animation and ease it as one, stagger a list
of cards with one drag, sequence layers, drop in tasteful behaviors and camera moves, save and
reuse presets across scenes, and animate type, strokes and shapes with the same keyframes. All of
it compiles to plain clips and tracks with provenance — no runtime behavior engine.

## Prerequisites
- Phases 05 (timeline) and 06 (viewport). Phase 02 (clips, staggers, rigs).

## Scope IN
- Group/ungroup into clips, group easing and retime, stagger tool, sequence/align/distribute.
- Behaviors library (enter/exit/emphasis), camera-move library (from `buildShot`).
- Project presets (`*.preset.json`) via editor, bridge and CLI.
- Kit: `TextAnimator`, `DrawPath`, `Shape` (+ animatables).

## Scope OUT
- Spatial groups that require wrapping TSX (08), 3D behaviors (09).

## Tasks

### 07.1 Group into clip (Ctrl/⌘+G) and ungroup
- Selection (keyframes, tracks or whole layers) → `clip.create` with `startMs` = earliest key;
  tracks move into the clip in clip-local time. The clip bar shows in the timeline (05.2).
- **Group easing**: clip `ease` (time remap) and `speed` edited from the clip inspector or by
  Alt-dragging the bar; loop count; add mode toggle ("layer this on top").
- **Ungroup** (`clip.dissolve`): exact when `ease` is absent or linear and speed/trim are
  representable (keyframe times transform exactly); with a non-linear clip ease the editor asks
  to **bake** (`bake: {samplesPerSecond: 30}` default) and shows the max deviation from the
  original curve before confirming.

### 07.2 Stagger tool
- Select N layers + choose a template (the first selected layer's animation, a behavior, or a
  preset) → `stagger.set` clip with `eachMs`, `order` (forward, reverse, center-out, edges-in,
  random seed) and distribution `ease`.
- Direct manipulation: dragging the stagger handle on the clip bar changes `eachMs` live
  (transient ops), ticks show each member's start.

### 07.3 Sequence, align, distribute
- **Sequence layers** (AE): order selected layers' animations end-to-start with optional overlap
  (ms or %), as one `keys.shift` batch.
- Align selected keyframes to the playhead; distribute keyframes evenly in time; reverse
  (`keys.reverse`); time-stretch selection by % (`keys.scale`).

### 07.4 Behaviors library — new core owner `src/core/behaviors.ts`
- Pure builders: `buildBehavior(id, params, target) → Clip` with `source: {behavior, version,
  params}` provenance (02.1). Catalog (`BEHAVIOR_CATALOG`, data like `TEMPLATE_CATALOG`):

| Kind | Behaviors (params) |
|---|---|
| Enter | fade-up (distance), rise (distance, blur), scale-in (from), blur-in (amount), mask-wipe (direction via clip*), iris (clipRadius), slide (direction, distance), pop (spring preset), tracking-in (style var `--tracking`) |
| Exit | the mirrored set (fade-down, fall, scale-out, blur-out, wipe-out, iris-out, slide-out) |
| Emphasis | pulse (scale), float (add-mode noise on y), glow (grade brightness), wiggle (add-mode noise rotateZ), highlight (style var color) |
| Data | counter-up (animatable `value`), typewriter (animatable `chars`), reveal (`<id>.reveal.progress`, 01.8) |

- Every behavior takes `intensity: subtle | standard | dramatic` (default **subtle**,
  principle 7) and `durationMs`; existing kinetic presets in `src/core/typography.ts` and
  `createCascadeClip` are reused, not duplicated.
- Re-apply: selecting a behavior clip shows its params; changing them regenerates the clip
  (one undo step); hand-edited behavior clips drop provenance with a notice.

### 07.5 Camera-move library
- Apply any `SHOT_KINDS` move (push-in, survey, orbit, crane, rise, dolly-zoom, rack-focus,
  scroll-through, macro, float-loop, handheld-push, whip) to the **current** scene: subject = the
  selected layer; `buildShot` output is converted into a camera clip (+ focus tracks / lookAt for
  rigs) with `source: {shot, params}`.
- After applying, run `framingReport` with the subject's measurement and show the certification
  verdict inline (in-frame %, depth margin, focus blur); failing moves show "Adjust" suggestions
  (lens, intensity) rather than silently applying.

### 07.6 Project presets — `src/core/presets.ts` (owner `PresetSchema`)
- File `src/velora/presets/<id>.preset.json`: `{ $schema?, version: 1, id, title, kind:
  "motion" | "easing" | "behavior", params?, body }`.
  - motion: tracks/clips with `$target` placeholders and `values: "absolute" | "relative"`
    (relative = offsets from the target's value at apply time);
  - easing: named curves (feeds the 05.6 library);
  - behavior: a parameterized behavior configuration.
- Editor: "Save selection as preset", preset browser with thumbnails (curve or schematic), apply
  to selection (one undo step).
- Bridge `/v1/presets` (list/read/create/update with CAS); CLI `velora edit preset
  ls|show|save|apply --scene <id> --preset <id> --to <layer> [--write]`; JSON Schema
  `schemas/preset.schema.json`; discovery in `src/project/discovery.ts` (presets are data, never
  executed).

### 07.7 Motion-graphics kit additions (`src/kit/`, pure functions of time + animatables)
- **`TextAnimator`** (After Effects text animators): splits text with `Intl.Segmenter` (chars,
  words, lines) into leaves; a **range selector** (`start`, `end`, `offset` 0–100 %, `shape`:
  square | ramp-up | ramp-down | triangle | round | smooth, `ease`) weights per-unit properties
  (`opacity`, `x`, `y`, `z`, `rotate`, `scale`, `blur`, `tracking`, `color`). Math lives in core
  `src/core/typography.ts:textAnimatorAt(units, selector, props)` (pure); all selector and
  amount values are animatables (`<id>.selector.start`, …), so the timeline keys them.
  Certification: reading-time rule (0.3 s/word + 1 s) checked by the review advisories.
- **`DrawPath`** (trim paths): SVG path with normalized `pathLength`; animatables `start`, `end`,
  `offset` (0–1), `strokeWidth`, `color`.
- **`Shape`**: rect / ellipse / line / polygon with animatables `width`, `height`, `radius`,
  `sides`, `fill`, `stroke`, `strokeWidth`.
- Each renders inside a Surface leaf; templates in `src/core/composites.ts` may adopt them later
  (re-certification required).

## Contracts
- `BEHAVIOR_CATALOG`, `buildBehavior`, clip `source` provenance.
- `PresetSchema` + `schemas/preset.schema.json`; bridge `/v1/presets`; `velora edit preset`.
- Kit `TextAnimator`, `DrawPath`, `Shape` props and animatable ids.

## Files
- New: `src/core/{behaviors,presets}.ts`, `src/kit/{text-animator,draw-path,shape}.tsx`,
  `src/editor/{ClipInspector,StaggerTool,Behaviors,CameraMoves,Presets}.tsx`
- Modified: `src/core/{typography,shots,schemas}.ts`, `src/kit/index.ts`,
  `src/project/{edit,discovery}.ts`, `src/project/services/bridge.ts`,
  `scripts/{check-architecture,build-schemas}.mjs` (owners `buildBehavior`, `BEHAVIOR_CATALOG`,
  `PresetSchema`, `textAnimatorAt`), skills `velora-motion-design`, `velora-typography`,
  `velora-cinematography`, `velora-editor`

## Tests
- `tests/core/behaviors.test.ts`: every behavior × intensity produces a valid clip; subtle is the
  default; provenance round-trip; golden snapshots of generated keyframes.
- `tests/core/presets.test.ts`: schema, relative vs absolute apply, `$target` substitution,
  refusal on incompatible targets.
- `tests/core/text-animator.test.ts`: selector shapes, ease, offset wrap; endpoints exact.
- `tests/editor/group.test.ts`: group/ungroup exactness; bake deviation reporting.
- `tests/browser/motion-design.spec.ts`: stagger five cards with a drag → file has a stagger clip
  with expected `eachMs`; apply `orbit` camera move to the portrait → framing verdict shown and
  export frames match preview; `TextAnimator` reveal and `DrawPath` draw-on pixel endpoints.

## Validation criteria
- [ ] "Group the three headline layers, ease the group with cubic.out, make it 1.5× faster" takes
  ≤ 4 gestures and is one undo step each.
- [ ] A preset saved in scene A applies to a different layer in scene B with identical relative
  motion.
- [ ] Behaviors never produce camera-overshoot advisories at `subtle`.

## Anti-patterns
- Runtime behavior components that animate on their own clock (behaviors must compile to data).
- Duplicating kinetic preset math instead of reusing `typography.ts`.
- Silent baking that changes motion without showing the deviation.

## Definition of Done
Tests and validation green; schemas and skills updated; `plan/v2.1/artifacts/phase-07-exit.md`
written.
