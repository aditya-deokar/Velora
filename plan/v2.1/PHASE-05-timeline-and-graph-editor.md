# Phase 05 — Timeline, dope sheet and graph editor

## Goal
Give Velora the motion designer's main instrument: a dope sheet where keyframes and clips can be
selected, dragged, snapped, copied and retimed, and a graph editor where easing is shaped with
handles. Both are exact views of the recipe; every gesture is an `EditOp`.

## Prerequisites
- Phase 04 (store, intents, command registry), Phase 02 (clips, paths), spike S1 verdict
  (rendering approach).

## Scope IN
- Timeline dock: ruler, timecode, playhead, work area, markers, zoom/scroll, virtualization.
- Rows: layer summaries, property tracks, clip/stagger bars, link/constraint badges.
- Keyframe interactions, snapping, copy/paste, retime tools.
- Graph editor (value + speed), handle modes, spring/steps panels, easing library drawer.
- Accessibility (ARIA grid) and performance budgets.

## Scope OUT
- Group/stagger creation tools and behaviors (07), composition lanes (10).

## Tasks

### 05.1 Timeline dock — `src/editor/timeline/`
- Header: play/restart (session), timecode `HH:MM:SS:FF` at editor fps (scene export fps, default
  60; frames-only toggle), Dope sheet | Graph toggle (`G`), zoom, marker button.
- Ruler with adaptive ticks; playhead drag = `session.seek` (one clock); click on ruler seeks.
- **Work area** (B/N): editor-only loop range for playback while editing (UI state, never
  written). Implemented by the session's existing seek/toggle API from the editor side — no new
  clock: when the cursor passes the work-area end during playback, the editor seeks to its start.
- **Markers**: `editor.markers` (01.7) drawn on the ruler; `M` adds at playhead; drag to move.

### 05.2 Rows
- Row model derived purely from the draft recipe + `useSceneInspector()` (layer order follows the
  Layers panel): layer row (aggregated keyframe summary), property rows, clip rows (bar with
  label, speed badge, loop count, ease badge, add-mode badge), stagger rows (member offsets as
  ticks), link/constraint rows (badges with target names, no keyframes).
- Keyframe glyphs per `EDITOR-UX.md` §6; smooth tracks draw a rail; static (1-keyframe) tracks
  show "static".
- Virtualized rows; keyframes drawn per S1 verdict (SVG per visible row or one canvas per lane),
  hit-testing in timeline coordinates (not DOM per keyframe beyond the visible window).

### 05.3 Keyframe and clip interactions (all via ops)
| Gesture | Ops |
|---|---|
| Click / Shift / Ctrl(⌘) click, marquee | selection only |
| Drag keyframes (snap) | `keys.shift` (transient → commit) |
| Alt-drag selection edge | `keys.scale` around the opposite edge (retime) |
| Alt+←/→ (Shift ×10) | `keys.shift` ± 1 frame |
| Delete | `key.remove` batch |
| Ctrl/⌘+C / V | clipboard (JSON of relative keyframes per property) → `key.set` batch at playhead; cross-layer paste maps by property name; incompatible properties refused with a toast |
| Double-click keyframe / Enter | inline editor: time, value, easing |
| Drag clip bar / edges / Alt-drag | `clip.update {startMs}` / `{inMs,durationMs}` / `{speed}` |
| Right-click | context menu from `EDITOR_COMMANDS` (reverse, distribute, ease presets, hold, delete) |

- Collisions: moving a keyframe onto an occupied time on the same track is refused (schema
  forbids equal times) with snap-to-adjacent-frame suggestion.
- Duration guard: dragging past `durationMs` offers "Extend scene to N s" (adds `motion.set`).

### 05.4 Snapping — `src/editor/timeline/snap.ts` (pure)
- Candidates: frame grid (always quantizes to `timeAtFrame(frameAt(t,fps),fps)` from
  `src/core/timeline.ts`), playhead, other keyframes (visible rows), markers, clip edges, beat
  markers when available (10). Threshold in pixels (8 px) converted per zoom; Shift suspends;
  a snap line shows the winning candidate and its kind.

### 05.5 Graph editor — `src/editor/graph/`
- **Value graph** for selected properties (each property's own y-scale, or normalized toggle);
  **speed graph** (numeric derivative, unit/s).
- **Handles ↔ easing** mapping (exact, pure, `src/editor/graph/handles.ts`):
  - segment k→k+1 with `cubicBezier [x1,y1,x2,y2]` on keyframe k: out-handle of k at
    `(t_k + x1·Δt, v_k + y1·Δv)`, in-handle of k+1 at `(t_k + x2·Δt, v_k + y2·Δv)`;
  - drags clamp x to [0,1] (schema) and y to [−5,5]; Δv = 0 segments edit in speed-graph mode;
  - **continuous** mode at keyframe k: set the in-handle of segment k−1 and out-handle of segment
    k so their slopes (value/time) match → velocities equal across k;
  - **auto** writes `"auto"` (01.1); **hold** writes `"hold"`; **linear** writes `"linear"`.
- Named curves (`sine.inOut`, `cinematic`, …) draw exactly (sampled `applyEasing`); dragging a
  handle converts to `cubicBezier` with a one-line "converted to custom curve" notice.
- **Spring** segments: panel with stiffness/damping/mass, live curve (`applyEasing`), settle time
  and overshoot %; **steps**: count + jump.
- Smooth tracks: Hermite curve drawn; handles disabled; track `ease` edited as a time-remap curve.
- Position paths (02.3): graph shows speed along path; spatial tangents are edited in the
  viewport (06).

### 05.6 Easing library drawer (`E`)
- Built-in presets with curve thumbnails and a tiny motion preview (a dot travelling):
  Velora `cinematic`, `easeInOut`; Easy Ease `[0.333,0,0.667,1]`, Ease In `[0.333,0,1,1]`, Ease
  Out `[0,0,0.667,1]`; CSS `ease`, `ease-in`, `ease-out`, `ease-in-out`; Penner families; springs
  *gentle* (170/26/1), *snappy* (300/30/1), *bouncy* (200/12/1), *heavy* (120/30/3); `steps(4)`;
  `hold`.
- Brand: the `velora.brand.json` motion personality easing appears first ("Brand: crisp").
- Saved user curves: `src/velora/presets/easings.preset.json` via bridge `/v1/presets` (07
  schema; until 07 lands, saving is disabled).
- Commands: F9 Easy Ease, Shift+F9 ease in, Ctrl+Shift+F9 ease out, Ctrl/⌘+Alt+H hold.

### 05.7 Accessibility
- `role="grid"`: rows = properties, cells = keyframes (labels per `EDITOR-UX.md` §7); arrow keys
  move between keyframes, Enter edits, Delete removes, Alt+arrows nudge; graph editor handles are
  focusable with arrow-key adjustment (Shift for coarse) and announced values.

### 05.8 Performance
- Budgets (performance config): 200 rows × 1,000 keyframes — scroll/zoom/drag without long tasks
  > 50 ms; drag-to-preview latency ≤ 16 ms p95 for a single-track drag in a 60-surface scene
  (uses the 01.6 compiled evaluator); graph editor redraw ≤ 8 ms for 5 visible curves.

## Contracts
- Clipboard payload `application/x-velora-keyframes+json` (versioned) — also readable by `velora
  edit apply` after conversion with `velora edit paste --from <file>` (thin wrapper) so agents
  and humans exchange keyframes.
- Handle mapping is the documented, tested bridge between visual handles and `cubicBezier`.

## Files
- New: `src/editor/timeline/{Timeline,Ruler,Rows,Keyframes,ClipBar,snap,clipboard}.ts(x)`,
  `src/editor/graph/{GraphEditor,handles,SpringPanel}.ts(x)`, `src/editor/EasingLibrary.tsx`
- Modified: `src/editor/{commands,store,Editor}.ts(x)`, `src/project/edit.ts` (`paste`
  subcommand), skills `velora-editor`, `velora-motion-design`

## Tests
- `tests/editor/handles.test.ts`: handle↔bezier round-trip exact; continuous mode makes
  finite-difference velocities equal (< 1e-6 relative) across the keyframe; clamps.
- `tests/editor/snap.test.ts`: candidate priority, frame quantization uses core frame math,
  threshold per zoom.
- `tests/editor/clipboard.test.ts`: copy/paste relative timing, cross-layer mapping, refusal.
- `tests/browser/timeline.spec.ts`: drag keyframe with snapping → file has exact frame time;
  Alt-drag retime; clip bar move → `clip.update`; graph handle drag → expected `cubicBezier` in
  file; F9 on selection; keyboard-only keyframe edit.
- `tests/performance/timeline.spec.ts`: budgets above (device-specific evidence).

## Validation criteria
- [ ] A designer can take a linear two-keyframe move to a custom ease-out with overshoot in the
  graph editor and the export matches the editor preview frame-for-frame.
- [ ] Copying keyframes from `headline` and pasting on `caption` at a later time works and is
  one undo step.
- [ ] Budgets met on the reference machine.

## Anti-patterns
- Separate graph math from `applyEasing` (curves must be drawn by the evaluator, not re-derived).
- Floating keyframe times off the frame grid when snapping is on.
- DOM nodes per keyframe for the whole document (virtualize).

## Definition of Done
Tests, journeys and budgets green; skills updated; `plan/v2.1/artifacts/phase-05-exit.md`
written.
