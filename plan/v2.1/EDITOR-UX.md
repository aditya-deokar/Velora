# Editor UX specification (v2.1)

This document owns the editor's layout, interaction rules, keyboard map and accessibility
requirements. Phases 04–10 implement it. When a phase and this file disagree, fix this file
first, in the same change.

## 1. Entry and modes

- **Open:** `velora edit --scene <id>` starts the bridge and opens
  `<dev origin><studio route>?velora-preview=1&velora-scene=<id>&velora-edit=1#velora-bridge=<port>.<token>`.
  - The editor reads the fragment, then removes it with `history.replaceState`, so the token never appears in copied URLs or screenshots.
  - The studio route is `/` for Vite hosts, `/velora` for Next hosts (as in the current studio) and `/__velora/` in any-site mode.
- **From the studio:** a scene's header gets an **Edit** button next to Guides and Export.
  - With no bridge connected, it opens Edit mode **read-only**: edits stay in memory, and the save area offers **Copy as `velora edit apply` command** and **Copy agent prompt**.
  - A banner explains how to start the bridge.
- **Modes:** Preview (the v2 studio, unchanged), **Edit scene**, and **Edit composition** (Phase 10). The mode lives in the URL (`velora-edit=1`, `velora-edit=composition`), so reload and back/forward work.
- **DEV only:** the same guard as the studio applies. The generated adapter returns host children in production, and the editor chunk is lazy-loaded only in Edit mode.

## 2. Layout (Edit scene)

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ◂ Scenes  Hero, headline to face   [Select V][Rotate R][Scale S][Camera C][Focus F]   │
│                                    [Path P]  Snap ◉  Auto-key ○  ↶ ↷   ● Saved  Export│
├──────────────┬──────────────────────────────────────────────────────┬─────────────────┤
│ LAYERS       │                                                      │ INSPECTOR       │
│ 🎥 Camera    │                                                      │ headline        │
│ ◎ Focus      │              VIEWPORT (camera view)                  │ ▸ Transform     │
│ ▾ stage      │   selection quads · gizmos · motion paths ·          │   x   ⏱ ◀◆▶ -40 │
│   ▸ headline │   onion skin · guides (all chrome-marked)            │   y   ⏱      0  │
│   ▸ portrait │                                                      │   z   ⏱ ◀◆▶ 120 │
│   ▸ caption  │                                                      │ ▸ Visual        │
│ ⬡ three-hero │                [Camera view | Director view (Tab)]   │ ▸ Style vars    │
│ ⚙ props      │                                                      │ ▸ Props (typed) │
│              │                                                      │ ▸ Easing @ ◆    │
├──────────────┴──────────────────────────────────────────────────────┴─────────────────┤
│ ▶ ↺  00:00:03:12 / 00:00:07:00  60 fps   [Dope sheet | Graph (G)]  − zoom +  ⚑ markers  │
│ ───────────────┬─────────────────────────────────────────────────────────────────────── │
│ ▾ headline     │  ◆━━━━━━━━━━◆                 ◆                         (summary)      │
│    x           │  ◆──────────◆                                                          │
│    opacity     │  ⧗          ⧗                                                          │
│ ▾ group: intro │  ▐████████ clip (1.0×, ease cubic.out) ████████▌                      │
│ 🎥 camera z    │  ◆──────────────────────────────◆   (smooth)                           │
└────────────────┴─────────────────────────────────────────────────────────────────────────┘
```

- **Left, Layers:**
  - Camera, Focus and Look.
  - The Surface tree from the live registry, with its parent hierarchy. Recipe nodes that aren't mounted are flagged "not mounted".
  - Animatables, grouped under their owning Surface.
  - Three.js objects (09), and clips and groups.
  - Search filter; row toggles for solo, hide in editor and lock.
- **Center, Viewport:** the existing `ScenePreview` viewport and its single session. Editor layers draw inside the scaled frame like `StudioOverlays`, and every one is chrome-marked.
- **Right, Inspector:** the properties of the selection, grouped. Each row has a stopwatch, a keyframe navigator (◀ ◆ ▶), a value field with drag-scrub, and the easing of the keyframe at the playhead.
- **Bottom, Timeline:** a dope sheet or graph editor, clip bars, playhead, work area and markers. In Edit mode, the transport dock moves into the timeline header.
- **Panels:** resizable and collapsible; sizes persist per project in `localStorage` (wrapped in try/catch). Below 1100 px width the editor stacks into tabs (Viewport | Timeline | Inspector) and stays usable.

## 3. Save states

| State | Indicator | Meaning |
|---|---|---|
| Saved | `● Saved` | The file on disk equals the editor document (same SHA). |
| Saving | `◌ Saving…` | One write is in flight; later commits queue behind it. |
| Unsaved (read-only) | `○ Not saved (no bridge)` | Edits stay in memory; the copy-command and copy-prompt actions are offered. |
| Conflict | `▲ Changed on disk` | The file changed outside the editor (an agent, an IDE or git). If pending ops rebase cleanly, the editor applies them and continues. Otherwise it shows a diff summary with **Keep mine** (re-apply ops on the new base) or **Take disk**. |
| Offline | `✕ Bridge disconnected` | Retry with backoff; edits are kept in memory. |

Saving is automatic: one write per committed gesture (pointer-up, Enter, menu action).
Drags apply transient ops to the draft and are coalesced into one history entry.

## 4. Interaction rules

1. **Changing a property value.** These are After Effects semantics.
   - Property already animated: create or update the keyframe at the playhead.
   - Not animated, with **Auto-key** on: create the track with one keyframe at the playhead.
   - Not animated, with Auto-key off: write a **static override**, which is a one-keyframe track labeled "static" in the timeline. Camera and focus statics write `scene.camera` and `scene.focus`, which the runtime applies.
   - Surface base transforms in TSX are never rewritten. Recipe `scene.nodes[].transform` is not used, because the runtime ignores it (see README §2).
2. **Stopwatch.** On, it creates a track with a keyframe at the playhead holding the current evaluated value. Off removes the track, after a confirm if it has more than one keyframe (undo also works).
3. **New targets.** The first track on a Surface that is missing from `scene.nodes` adds the node in the same op batch, because `reviewAuthoring` requires it.
4. **Selection.** One selection model is shared by viewport, layers, inspector and timeline: layers, properties (tracks), keyframes and clips.
5. **Snapping** (on by default, Shift suspends): frames, playhead, keyframes, markers, clip edges, beats (when the composition has beat markers), and the guides in the viewport.
6. **Frame grid.** Keyframe times snap to `timeAtFrame(frame, fps)` at the editor fps (the scene's export fps, default 60). Times are stored in milliseconds, exactly as today.
7. **Easing defaults.** New keyframes use `cinematic`, the schema default. Easy Ease (F9) writes `cubicBezier [0.333, 0, 0.667, 1]`. Overshoot on camera tracks shows the existing `camera-overshoot` advisory inline.
8. **Advisories.** `reviewAuthoring` advice and Scene diagnostics appear in an Advisories popover in the top bar. Each entry selects its track.
9. **Export.** The export command copied from Edit mode strips `velora-edit` and the fragment. The capture bridge refuses to capture in director view (Phase 06).
10. **Nothing leaks into frames.** Editor panels, gizmos, paths, onion skins and the director camera are chrome-marked or capture-refused. Solo, hide and lock are editor-only and never written to motion.

## 5. Keyboard map

The existing transport (`useTransportKeys` in `src/preview/transport.ts`) keeps its unmodified keys in every mode:
Space, J/K/L (including Shift), ←/→ (Shift: one second), Home/End and `[`/`]`. Editor commands
never rebind them. Transport ignores Ctrl, Meta and Alt chords, so editor chords use those.
Every command is also in the command palette.

| Keys | Command (Edit scene) |
|---|---|
| Ctrl/⌘+K | Command palette |
| Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y | Undo, redo |
| V, R, S | Select/move, rotate, scale tools |
| C, F, P | Camera tool, focus tool, path pen |
| Tab | Toggle camera view / director view |
| G | Toggle dope sheet / graph editor |
| `,` / `.` | Previous / next keyframe (selection, or all visible rows) |
| Alt+K | Add or remove a keyframe at the playhead for the focused property |
| Alt+← / Alt+→ (Shift: ×10) | Nudge selected keyframes by one frame |
| F9 / Shift+F9 / Ctrl+Shift+F9 | Easy Ease / ease in / ease out (also in the palette, because Mac F-keys need fn) |
| Ctrl/⌘+Alt+H | Toggle hold on selected keyframes |
| E | Open the easing library for the selection |
| U | Show only animated properties |
| B / N | Set work-area start / end at the playhead (editor-only loop range) |
| M | Add a marker at the playhead |
| Ctrl/⌘+G / Ctrl/⌘+Shift+G | Group selection into a clip / ungroup |
| Ctrl/⌘+C, X, V, D | Copy, cut, paste at the playhead, duplicate (keyframes or clips) |
| Delete / Backspace | Delete selection |
| `=` / `-` / `\` | Timeline zoom in / out / fit |
| Esc | Clear selection, cancel a drag (restores the pre-drag draft), close popovers |

Edit composition (Phase 10) swaps the tool keys for NLE conventions: V select, B ripple,
N roll, Y slip, C razor, M marker. Tool keys apply only to the active mode.

## 6. Panels in detail

### Inspector property kinds
| Kind | Control | Source |
|---|---|---|
| Number | Drag-scrub field (Shift ×10, Alt ×0.1), unit suffix, min/max from schema | Transform, visual and grade properties; camera; focus; numeric animatables |
| Lens | Millimetre field ↔ perspective via `lens.ts`, presets 24/35/50/85/135 | Camera perspective |
| Color | Native picker plus OKLCH sliders; interpolation is shown in OKLab | Color style vars, color animatables |
| Boolean / enum | Toggle / select; animated as hold steps | Animatables |
| Easing | Curve thumbnail; opens the library or graph editor | The keyframe at the playhead |
| Constraint | Target picker (click a layer) plus weight | `lookAt`, `focusFollow` (02) |

Values that are animated and interpolated at the playhead appear in italics. A keyframe exactly at the playhead
shows a filled diamond.

### Keyframe glyphs (dope sheet)
| Glyph | Meaning |
|---|---|
| ◆ | Linear or named easing |
| ⧗ | Ease (cubicBezier, a Penner family, cinematic) |
| ● | Auto (`"auto"` easing) |
| ■ | Hold |
| ✱ | Spring or steps |

Smooth-interpolation tracks draw a continuous rail, and their keyframes appear as hollow circles.

### Graph editor
- **Value graph:** absolute values per property, normalized across properties with different units.
- **Speed graph:** the derivative.
- **Handles:** a segment's handles map exactly to the start keyframe's `cubicBezier`:
  - the out-handle of keyframe *k* is `[x1, y1]`;
  - the in-handle of keyframe *k+1* is `[x2, y2]`;
  - both are in segment-normalized space.
- **Clamps:** `x` stays in [0, 1] and `y` in [−5, 5], as the schema already requires.
- **Handle modes per keyframe:** linear, ease (independent), continuous (velocity matched across the keyframe), auto, hold.
- **Converting a named curve:** dragging a handle on a named curve converts it to `cubicBezier`, showing a one-line "converted to custom curve" note.
- **Spring segments:** these show a parameter panel (stiffness, damping, mass) with a live curve and settle time instead of handles.

## 7. Accessibility

- Landmarks: banner (top bar), navigation (layers), main (viewport), complementary (inspector), region "Timeline".
- Layers use `role="tree"` with roving tabindex. The timeline uses `role="grid"`, and each keyframe is a gridcell labeled, for example, "headline x, keyframe at 1.20 s, value −40, easing cubic out".
- Every gizmo action has a keyboard path. Select a layer, then use the inspector fields, or press Enter on a keyframe to edit its time and value.
- The save state and conflicts are announced through a polite live region.
- `prefers-reduced-motion` pauses auto-play on open. It never changes scene rendering.
- Contrast: the editor chrome meets 4.5:1 for text. The viewport stays black, as before.
- Phase 11 adds axe checks on every panel to the browser suite.

## 8. Things the editor never does

- Write files without the bridge, or write outside the allowed file kinds.
- Bundle or drive GSAP, or add a ticker, `requestAnimationFrame` clock or wall clock to scene evaluation.
- Rewrite host TSX without a diff preview and explicit confirmation (Phase 08).
- Store editor-only state (panel sizes, solo/hide) in project files.
- Change how any existing recipe renders.
