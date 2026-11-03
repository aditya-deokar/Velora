# Phase 02 — Structure and cinematic constraints: clips, staggers, paths, links, look-at, follow focus

## Goal
Give motion **structure** and the camera **intent**:
- **Clips:** animation groups that move, retime, ease and loop as one unit (the "group easing" in the brief).
- **Staggers:** one animation applied across many layers.
- **Spatial motion paths:** curved moves with even speed.
- **Links:** declarative property drivers, the pick whip without code.
- **Look-at and follow focus:** the camera aims at a subject and holds focus on it however either moves.

Everything stays pure, deterministic, additive and evaluated by the existing owners.

## Prerequisites
- Phase 01 (compiled evaluator, auto tangents, style and color tracks).

## Scope IN
- `motion.clips` (nesting, speed, trim, loop, ease, additive mode); stagger clips.
- `position` path tracks; `motion.links`; `lookAt` and `focusFollow` constraints; orbit rig builder.
- Advisories, schemas, guide and skills.

## Scope OUT
- UI for any of these (05–07).
- Spatial groups that need TSX wrapping (08).

## Tasks

### 02.1 Clips (groups in time) — `src/core/motion.ts`
```jsonc
"clips": [{
  "id": "intro", "label": "Intro titles",
  "startMs": 400,            // where clip-local 0 lands on the scene timeline
  "speed": 1,                // 0.05–4
  "inMs": 0, "durationMs": 2400,   // optional trim of clip-local time
  "loop": false,             // or a positive integer count
  "ease": "cubic.out",       // optional time remap across the clip span (group easing)
  "mode": "replace",         // or "add"
  "tracks": [ /* MotionTrack with clip-local timeMs */ ],
  "clips": [ /* nested, depth ≤ 4 */ ],
  "source": { "behavior": "fade-up", "version": 1, "params": {} }  // optional provenance (07)
}]
```
- **Local time:** `local = inMs + ease((t − startMs) · speed / span) · span`, where span is the trimmed clip duration. Loops wrap `local` deterministically.
- **Outside the clip:** before `startMs`, the clip holds its local-0 values; after its end, it holds the end values. This is the existing hold-endpoint rule for tracks.
- **Ownership:** at most **one replace owner** per (target, property) across root tracks and every replace clip. A violation is a validation error that names both owners.
- **Additive mode:** `mode: "add"` clips **sum** their track values onto the owner's value. Authors keyframe offsets around 0, for example a float or handheld layer over a base move. An add clip on a property with no owner adds onto the static base.
- **Duration:** a clip's end, after speed, trim and loops, must be ≤ `motion.durationMs`. Times stay in milliseconds.
- `evaluateMotion` flattens the clips once per compiled input (01.6), so the per-frame cost stays linear in the number of tracks.

### 02.2 Stagger clips
- A clip may declare `members: string[]` (surface ids, ≤ 256) and `stagger: { eachMs, order, ease? }`. Its tracks target `{ kind: "surface", id: "$member" }`.
- **Order:** `"forward" | "reverse" | "center-out" | "edges-in" | { random: seed }`. Random uses `createRng` from `src/core/random.ts`.
- **Offsets:** member *i*'s offset is `ease(rank_i / (n−1)) · eachMs · (n−1)`. This matches GSAP-style stagger easing without GSAP.
- Expansion is deterministic and happens at compile time. Each member becomes a virtual sub-clip in diagnostics (`intro[2]`).
- `createCascadeTracks` keeps its exact output for existing callers. A new `createCascadeClip` returns the equivalent stagger clip; the two are tested equal after evaluation.

### 02.3 Spatial position paths
- New track property `"position"` for surface and camera targets, with vector keyframes:
  `{ timeMs, value: [x, y, z], easing, inTangent?: [dx,dy,dz], outTangent?: [dx,dy,dz] }`.
- **Shape:** a cubic Bézier per segment in space. Omitted tangents use Catmull–Rom-style automatic tangents from the neighboring keyframes.
- **Timing:** each segment uses an arc-length table (a fixed 64-sample LUT per segment, so it is deterministic), and keyframe easing maps time to *distance along the segment*.
  - Optional `rove: true` makes speed constant across the whole path. Interior keyframe times are then derived, and they are reported in diagnostics but not written.
- `orient?: { axis: "yaw" | "yaw-pitch", offsetDeg? }` derives `rotateY` (and `rotateX`) from the path tangent. This conflicts with explicit rotate tracks on the same target unless those are in an add clip.
- **Validation:** a `position` track excludes `x`, `y` and `z` tracks on the same target. Smooth interpolation and noise do not apply to path tracks.
- `reviewAuthoring` advice: path speed spikes (segment speed ratio > 4× without hold or ease intent).

### 02.4 Links (declarative drivers) — `motion.links`
- Shape: `{ to: TrackRef, from: TrackRef | { channel: id }, scale = 1, offset = 0, delayMs = 0, mode: "replace" | "add" }`.
  - `TrackRef` is `{ target, property }`, exactly the track key shape.
  - `to(t) = from(t − delayMs) · scale + offset`.
- **Evaluation:** links run after tracks and clips, in topological order. Cycles are a validation error naming the cycle. Chain depth ≤ 8, links ≤ 256.
- **Uses:**
  - parallax: background `x` linked to camera `x` with `scale −0.2`;
  - echoes and trails: a delayed copy of a layer's position;
  - counters following a scroll channel.
- There are no expressions and no JavaScript evaluation, ever.

### 02.5 Constraints, resolved with layout — `src/core/spatial.ts`
Constraints need world geometry, so `evaluateScene`, the single spatial owner, resolves them from measurements. Preview and export both pass through `Scene`, so they agree.

- `scene.constraints` (≤ 16), each one of:
  - `{ kind: "lookAt", subject: "camera", target: { surface: id, anchor?: [u, v] } | { point: [x, y, z] }, weight?: TrackRef | number, up?: "y" }`.
    - It derives camera `rotateX` and `rotateY` so the target anchor (u, v in 0–1 of the surface, default center) projects to frame center, using the `cameraToCss` convention (the camera is the inverse stage transform).
    - `weight` blends between the authored rotation and the constrained one (0–1), so a shot can "settle onto" the subject.
  - `{ kind: "focusFollow", target: { surface: id, anchor? }, offset?: number, weight? }`.
    - `focus.distance` becomes the camera-space depth of the target anchor plus the offset, blended by weight with any `focus.distance` track.
- `projectPoints` in `src/core/shots.ts` honors point targets; surface targets need measurements, so `framingReport` passes the subject measurement it already has. Refactor `projectPoints` to call the spatial owner rather than duplicating camera math (golden-checked).
- Advisory: a lookAt target outside the frame at any sampled time (an occluded or behind-camera anchor).

### 02.6 Rigs (sugar that compiles to data) — `src/core/shots.ts`
- `buildOrbitRig({ target, radius, fromDeg, toDeg, height, durationMs, ease })` returns a camera `position` path (02.3) plus a `lookAt` constraint (02.5).
- Existing shot kinds keep their current output (template certification goldens). New shot variants may use rigs; any change in output must be explicit and re-certified.

### 02.7 Schemas, guide and skills
- Regenerate the JSON Schemas. Guide capabilities: clips, staggers, paths, links, constraints, rigs.
- Skills:
  - `velora-cinematography`: look-at, follow focus, orbit rig, when to settle with weight;
  - `velora-motion-design`: clips, staggers, additive layers, links for parallax and trails.

## Contracts (additive)
| Field | Type | Notes |
|---|---|---|
| `motion.clips[]` | clip (above) | replace/add; nesting ≤ 4; stagger members ≤ 256 |
| track `property: "position"` | vector keyframes plus tangents | excludes x/y/z tracks on the same target |
| track `rove`, `orient` | boolean, `{axis, offsetDeg?}` | path tracks only |
| `motion.links[]` | `{to, from, scale, offset, delayMs, mode}` | acyclic, depth ≤ 8 |
| `scene.constraints[]` | `lookAt`, `focusFollow` | resolved in `evaluateScene` |

## Files
- Modified: `src/core/{motion,scene,spatial,shots,choreography,authoring,schemas}.ts`, `src/react/index.tsx` (passes constraint inputs and measurements through the existing evaluation), `scripts/check-architecture.mjs` (new owners: `createCascadeClip`, `buildOrbitRig`, plus constraint resolution inside `evaluateScene`), `schemas/*`
- Skills: `velora-cinematography`, `velora-motion-design`

## Tests
- `tests/core/clips.test.ts`: local-time math across speed, trim, loop, ease and nesting; hold outside the range; replace-ownership errors; add-mode sums; flattening equals hand-written tracks.
- `tests/core/stagger.test.ts`: every order (seeded random is stable); ease distribution; `createCascadeClip` ≡ `createCascadeTracks` after evaluation.
- `tests/core/paths.test.ts`: C1 at joins with auto tangents; `rove` speed variance < 1%; orient angles against finite-difference tangents; conflict validation.
- `tests/core/links.test.ts`: cycle detection, delays, depth limit, add vs replace.
- `tests/core/constraints.test.ts`:
  - lookAt keeps the target anchor at frame center within 0.5 px across a curved camera path (random seeds);
  - focusFollow keeps target blur < 0.5 px at every sample (`sampleFocus`);
  - weight blending endpoints exact.
- Goldens (Phase 00) unchanged. Template certification (`velora templates check`) unchanged.
- `tests/browser/constraints.spec.ts`: a real scene where the camera orbits a portrait Surface. Focus peaking (`data-velora-blur`) stays below threshold on the subject in every captured frame.

## Validation criteria
- [ ] Group easing: one clip containing five layers' entrances retimes and eases as a unit, and the scene renders identically to the equivalent flattened tracks.
- [ ] A handheld add-clip over a push-in renders deterministically (two renders, same SHAs).
- [ ] Orbit rig plus follow focus keeps the subject centered and sharp for the whole move.
- [ ] Goldens and template certification unchanged.

## Anti-patterns
- Evaluating constraints in React or in the editor (they belong in `spatial.ts`).
- Adaptive or time-budgeted sampling for arc length (nondeterministic). Use fixed LUTs.
- Expression strings, or `Function`/`eval` anywhere.
- Silently letting two replace owners fight over a property.

## Definition of Done
Tests and validation green, schemas, guide and skills updated, and
`plan/v2.1/artifacts/phase-02-exit.md` written.
