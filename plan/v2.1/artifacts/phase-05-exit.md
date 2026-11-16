# Phase 05 exit report: timeline, dope sheet and graph editor

Date: 2026-11-16. Branch `feat/v2.1-motion-graphics-suite-plan` (with Phase 04).
Machine: Windows 11 (win32-x64), Node 24.12.0, Playwright Chromium 1208.

**Spike S1 / decision D6:** resolved by building the timeline **in-house** (SVG per visible row, rows
virtualized, time-windowed, dense rows drawn as one path per glyph kind). No library was evaluated against
the S1 gates; the in-house budgets below are the evidence.

## What shipped
| Task | Implementation |
|---|---|
| 05.1 Dock | Play/restart on the one session, timecode `HH:MM:SS:FF` at the editor fps (frames-only toggle), Dope sheet / Graph toggle (G), zoom −/+/fit (`=`, `-`, `\`; Ctrl/⌘+wheel around the cursor), Marker button (M). Ruler with adaptive ticks; click or drag on the ruler seeks (one clock). Markers come from `editor.markers` and drag to move. The work area (B/N) is UI-only, and the editor loops it by seeking the same session cursor (no new clock). |
| 05.2 Rows | Pure row model (`timeline/Rows.ts`) from the draft recipe and the Scene snapshot: layer rows with aggregated keyframe summaries, property rows (static and smooth flags; clip tracks placed through clip start, trim and speed), clip and stagger bars (speed, loop, ease and add badges; member offsets as ticks), link and constraint badge rows. Glyphs per EDITOR-UX §6 (◆ linear, ⧗ ease, ● auto, ■ hold, ✱ spring/steps, hollow circles on a rail for smooth tracks). Virtualized: only visible rows render, memoized inside one scrolled group; keys outside the time window are skipped; dense rows draw one path per glyph kind and keep focusable cells for selected and entry keys. |
| 05.3 Interactions | Click, Shift and Ctrl/⌘ click, and marquee selection. Drag → `keys.shift` (transient previews, one commit on release, per clip time scale). Alt-drag → `keys.scale` around the opposite edge. Alt+←/→ (Shift ×10) nudges by frames. Delete → `key.remove`/`track.remove`. Copy/cut/paste/duplicate (clipboard below). Double-click or Enter opens the inline time/value/easing editor. Clip bars: drag body → `clip.update {startMs}`; edges trim (`inMs`, `durationMs`); Alt-drag → `speed`. Right-click menu from `EDITOR_COMMANDS` (Easy Ease, ease in/out, linear, auto, hold, reverse, copy, paste, delete). Collisions are refused with a "move one more frame" toast; dragging past the scene end offers **Extend scene to N s** (adds `motion.set`). |
| 05.4 Snapping | `timeline/snap.ts` (pure): results always quantize through the core `frameAt`/`timeAtFrame`; candidates are the playhead, other visible keyframes, markers and clip edges, within 8 px converted per zoom, with priority on ties; Shift suspends; a snap line shows the winner. Beat markers arrive with Phase 10. |
| 05.5 Graph editor | Value and speed graphs sampled from the canonical evaluator (each track evaluated alone through `evaluateMotion`, one cached sampler per track; curves memoized off the playhead), per-curve or shared y-scale. `graph/handles.ts` is the exact handle ↔ `cubicBezier` mapping (clamps x to [0, 1] and y to [−5, 5]; flat segments keep y), continuous mode (velocities equal across a keyframe), and spring stats. Handles drag (named curves convert to `cubicBezier` with a notice) and are keyboard-adjustable sliders. Handle modes: linear, ease, continuous, auto, hold. A spring/steps panel shows a live curve, settle time and overshoot. Smooth tracks are view-only with a track-ease selector. |
| 05.6 Easing library | Drawer (E) with Velora, After Effects (Easy Ease `[0.333,0,0.667,1]`, in, out), CSS, Penner, spring (gentle/snappy/bouncy/heavy), `steps(4)`, hold and linear presets, curve thumbnails and spacing dots; applies to the selected keys. F9 / Shift+F9 / Ctrl+Shift+F9 / Ctrl/⌘+Alt+H commands. |
| 05.7 Accessibility | `role="grid"`: rows are properties and cells are keyframes, labeled "caption opacity, keyframe at 1.00 s, value 1, easing cinematic (eased)". ←/→ moves between keys, ↑/↓ between rows, Enter edits, Delete removes, Alt+arrows nudge. Graph handles are focusable sliders with announced values. |
| Clipboard contract | `application/x-velora-keyframes+json` v1 (relative offsets per property; cross-layer paste maps by property name; incompatible targets refused; one paste is one undo step) in `src/core/clipboard.ts`, shared with the new **`velora edit paste --scene --from FILE --at MS [--onto SURFACE]`**. |

## Evidence
- **Browser** (`tests/browser/timeline.spec.ts`, 5/5, real bridge): a dragged keyframe lands on the exact frame grid in the file; Alt-drag retime around the opposite edge (frame-exact); F9 writes `[0.333,0,0.667,1]` and a graph handle drag writes the expected `cubicBezier` (x1 > 0.333, y1 > 0, the in-handle unchanged); Ctrl+G groups a track into `group-1` and dragging the bar writes a frame-exact `clip.update {startMs}`; a keyboard-only edit (arrows between cells, Enter, value, Alt+→) writes the value and a one-frame nudge.
- **Unit:** `tests/editor/handles.test.ts` (round trip exact to 1e-12; clamps; continuous slopes equal to 1e-6 relative analytically and to 1e-3 by Richardson finite differences on the evaluator; spring stats), `snap.test.ts` (core frame math, priority, per-zoom threshold, Shift), `clipboard.test.ts` (relative timing, cross-layer, refusal), plus `velora edit paste` in `tests/cli/edit.test.ts`.
- **Budgets** (`tests/performance/timeline.spec.ts`, `playwright.performance.config.ts`, reference machine):

| Budget | Target | Measured |
|---|---|---|
| 200 rows × 1,000 keyframes: scroll, zoom, drag, long tasks > 50 ms | none | **0 long tasks** (scroll, zoom, drag) |
| Single-track drag to repaint, 60-Surface scene, p95 | ≤ 16 ms | **25.5 ms** (not met) |
| Graph redraw with 5 visible curves, p95 | ≤ 8 ms | **34.8 ms** per playhead step for the whole editor (not met) |

  Profiling found the dominant per-frame cost: the Scene registry's transform-free layout measurement of all 60 Surfaces on every commit (about 8 ms here). That is the pre-existing engine policy that keeps time-driven host layout correct. The editor-side causes the profile exposed were fixed: whole-motion schema parses in `motionSpeed`, full-recipe validation on every preview step, advisories recomputed per frame, and graph re-sampling per playhead move. The performance spec guards today's numbers (drag ≤ 34 ms, graph ≤ 50 ms); meeting the plan budgets needs a Phase 11 change to measure only after DOM or resize changes.

## Not verified / deviations
- Drag-latency and graph budgets not met (above). The graph number measures a full editor frame per playhead step, not the graph component alone.
- **Clip track placement** applies clip start, trim and speed; a clip's group ease, loops and nested easing are shown as badges, not re-timed per keyframe in the dope sheet.
- **Position paths** in the graph editor are skipped (only numeric scalar tracks are graphed); spatial tangents belong to the viewport tools (06).
- **Brand easing first** and **saved user curves** are not in the easing library (see the Phase 04 report).
