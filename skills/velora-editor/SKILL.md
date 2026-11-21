---
name: velora-editor
description: Edit scene recipes surgically with velora edit — keyframes, easing, tracks, clips, staggers, links, constraints and editor metadata through one typed EditOp vocabulary, dry-run diffs, compare-and-swap writes and exact undo. Use for small, reviewable changes to an existing scene, especially while a human has the studio editor open.
license: MIT
version: 0.1.2
when-to-use: Changing an existing recipe (move a keyframe, set an easing, add or remove a track, group tracks into a clip, stagger layers, link a property, add a constraint) where a minimal diff and an exact undo matter more than rewriting JSON by hand.
prerequisites:
- An existing scene recipe in src/velora/scenes (velora-scenes, velora-templates)
- velora init completed for the edit bridge (velora-init)
commands:
- edit
- compose
- scenes
- load
- validate
related-skills:
- velora
- velora-scenes
- velora-motion-design
- velora-cinematography
- velora-templates
- velora-debug
not-for: Creating a new scene from scratch (velora-templates or velora-scenes) or choosing an editorial approach (velora-editing).
---

# Velora Editor — Surgical Edits With Exact Undo

Every edit the studio editor makes is an `EditOp`, and `velora edit` applies the same ops headlessly.
Agents and humans co-author one recipe file: changes are small, validated by the same schema the
renderer uses, written only when you ask, and always reversible.

## When to Use This Skill

- Retiming, re-easing or nudging an existing animation without touching the rest of the file.
- Grouping tracks into a clip, staggering layers, linking properties or adding look-at or follow focus.
- Editing while a person has Edit mode open in the studio: use `--expect-sha` so you never overwrite their save.
- Undoing a change exactly (every result prints its `inverse` batch).

## Commands

| Command | Purpose |
|---|---|
| `velora edit ls --scene <id> --json` | Tracks, clips, links, constraints and keyframe times; `--at <ms>` adds evaluated values |
| `velora edit key --scene <id> --track camera.z --at 1200 --value 400 --ease cubic.out --json` | Upsert one keyframe (dry run) |
| `velora edit ease --scene <id> --track headline.x --at 0 --ease '{"cubicBezier":[0.33,0,0.67,1]}' --json` | Set the easing of the segment that starts at a keyframe |
| `velora edit apply --scene <id> --ops ops.json --expect-sha <sha> --write --json` | Any `EditOp[]` batch (use `--ops -` for stdin) |
| `velora edit paste --scene <id> --from copied.json --at 3000 --onto caption --json` | Apply a keyframe clipboard copied in the studio editor |
| `velora edit --scene <id> --no-open --json` | Start the loopback edit bridge for the studio editor |

## Prerequisites

- The scene exists (`velora scenes --json`).
- For the bridge: `velora init` is done and the app's dev server is running (`--url` or APP_PORT / PORT).

## Workflow

1. Read first: `velora edit ls --scene <id> --json` records `sha`, track refs and keyframe times.
2. Dry run: `velora edit key …` or `velora edit apply …` without `--write`, and check `diff`, `labels` and validation issues.
3. Write: repeat with `--write --expect-sha <sha from step 1>`. `ERR_EDIT_CONFLICT` means someone saved in between: re-read, then re-apply. Never retry blindly.
4. Undo: save the printed `inverse` to a file and run `velora edit apply --ops inverse.json --write`. Applying the inverse restores the recipe exactly.

Track refs: `camera.z`, `focus.distance`, `<surface>.<prop>` (for example `headline.opacity`), `style:<surface>.--accent`, `channel:<id>`, each with an optional `@<clip>` for tracks inside a clip.

Op table (`{"op": …}`):

| Group | Ops |
|---|---|
| Keyframes | `key.set {track, atMs, value, easing?}` (upsert), `key.remove`, `key.move {track, fromMs, toMs}`, `key.ease`, `keys.shift {refs, deltaMs}`, `keys.scale {refs, pivotMs, factor}`, `keys.reverse {refs}`, `keys.retime {refs}` (`toMs` per reference) |
| Tracks | `track.add {track, keyframes, …options}`, `track.remove`, `track.options` (null clears an option) |
| Scene | `camera.set` and `focus.set {property, value or null}`, `node.ensure {id}`, `node.parent {id, parentId}`, `node.remove`, `motion.set {durationMs?, speed?, loop?}`, `look.set` |
| Structure | `clip.create {id, refs or tracks, startMs?}`, `clip.update`, `clip.set {clip}`, `clip.dissolve {id, bake?}`, `stagger.set`, `link.set`, `link.remove`, `constraint.set`, `constraint.remove`, `path.fromAxes`, `path.tangent` |
| Metadata | `editor.set {labels?, colors?, locked?, markers?}` |
| Undo | `restore {at, value, index?}` (what inverses use) |

Keyframes are addressed by `(track, atMs)`, never by array index. A new surface track adds its scene node
automatically. A keyframe past `motion.durationMs` fails unless the batch also contains `motion.set`.

## Worked Example

Ease the headline entrance and push the camera arrival 200 ms later:

```json
[
  { "op": "key.ease", "track": { "target": { "kind": "surface", "id": "headline" }, "property": "y" }, "atMs": 0, "easing": "expo.out" },
  { "op": "key.move", "track": { "target": { "kind": "camera" }, "property": "z" }, "fromMs": 4000, "toMs": 4200 },
  { "op": "motion.set", "durationMs": 4200 }
]
```

`velora edit apply --scene home-hero --ops ops.json --json` prints the diff (only those lines change),
the labels ("Ease headline y keyframe at 0.00 s: expo.out", "Move camera z keyframe 4.00 s → 4.20 s") and
the inverse. Then add `--write --expect-sha <sha>`.

## Edit Mode (the studio editor)

`velora edit --scene <id>` opens the studio in Edit mode on the running app. The person editing there makes
the same ops you make, through the same bridge:
- The inspector's stopwatch (⏱) animates a property; typing a value keys it at the playhead (Auto-key keys
  the first change too); without animation a change is a static override (camera and focus statics write
  `scene.camera` / `scene.focus`).
- The timeline drags keyframes (snapped to frames, playhead, markers and keys), Alt-drag retimes, clip bars
  move and trim, G opens the graph editor (bezier handles map exactly to `cubicBezier`), E the easing library,
  F9 Easy Ease, Ctrl/⌘+G groups tracks into a clip.
- The viewport is direct manipulation on the same ops: click a layer in the frame to select it (Alt+click
  cycles the stack under the cursor, Shift adds, Ctrl/⌘ toggles, drag on empty space marquees, double-click
  enters a group and Esc leaves it; locked layers are skipped). Tools: **V** move (in the parent's plane, so the
  grabbed point follows the cursor under perspective; axis handles constrain, the depth handle pushes along z,
  Shift snaps to 10 px, thirds/center/safe guides snap), **R** rotate rings (Shift 15°), **S** scale (corners keep
  the opposite corner, Alt about the pivot, side handles write scaleX/scaleY), **P** pivot (writes originX/originY
  and compensates x/y so nothing moves), **C** camera, **F** focus, **Tab** director view. Type a number during a
  drag and press Enter for an exact value; Esc cancels. Motion paths show sampled positions with frame ticks and
  draggable keyframe dots; **Convert to position path** runs `path.fromAxes`; onion skin draws ghost outlines.
- Copying keyframes (Ctrl/⌘+C) produces an `application/x-velora-keyframes+json` clipboard; agents can apply
  one with `velora edit paste --scene <id> --from <file> --at <ms> [--onto <surface>]`.
- While the editor is open, always pass `--expect-sha`: the editor saves after every gesture. If you write, it
  rebases its pending edits or shows **Changed on disk**; it never overwrites yours.
- **Ask agent** in the toolbar or timeline menu copies your intent, selected tracks or cut, playhead, range and recent edit labels. **History → Copy as command** copies the selected batch. In read-only mode, **Copy as command** copies the pending edits for your shell.

## Motion design in Edit mode

- Shift-click layers to build an ordered selection. Ctrl/⌘+G groups their root tracks into a clip at the first key. When keys are selected, the clip takes the tracks those keys belong to.
- Use **Clip ease**, **Clip speed**, **Play count**, and **Layer this on top** in the Inspector. Alt-drag the clip bar to retime it. Ctrl/⌘+Shift+G opens the ungroup dialog. For nonlinear time remapping, check the maximum sampled deviation before choosing **Bake and ungroup**.
- Find **Stagger layers** and **Timing tools** through the command palette. Drag the gold stagger handle to adjust member spacing, or type the delay in the Clip Inspector. The timing tools sequence root layer tracks and align, distribute, reverse, or stretch selected keys.
- **Behaviors**, **Camera moves**, and **Presets** are available on the toolbar. Saving a preset requires an edit bridge. Project easing presets appear under **Project** in the easing library.

## Source integration

- In a React project, start the edit bridge and choose **Source** for the JSX outline or **Pick source element** to inspect something rendered in the viewport. A code-inspector location can select the source node directly. Otherwise choose a highlighted candidate. **Open in editor** and **Copy path:line** work from the outline.
- Choose **Promote to layer** to wrap an element, **Group spatial layers** for contiguous Surface siblings, or **Expose prop** for a literal in a function component with a block body. Next App Router edits require an explicit client boundary. A Surface adds a positioned `div`, so check inline, flex, and grid layouts after applying.
- If a promotion turns a leaf into a spatial group, check depth-of-field coverage before capture. With blur enabled, remaining visible content also needs a Surface leaf or `content`.
- Review the diff, the resulting outline, and the Git status. **Apply source edit** confirms the write. **Undo last source edit** restores both files if neither has changed since the write. A refusal includes **Ask agent** with the selected node and reason.
- Run `velora edit source outline --scene <id> --json` to find exact node paths. Use `velora edit source wrap|group|expose` without `--write` for a dry run. Pass `--expect-sha` and `--expect-recipe-sha` to pin the revisions you reviewed.

## Composition edits

`velora edit --composition <file>` opens the Composition Editor with a loopback bridge. `velora compose edit --composition <file> --ops <file|-> --json` accepts the same batches. Use its `sha` with `--expect-sha <sha> --write` after reviewing the diff. On `ERR_EDIT_CONFLICT`, re-read and review the new dry run.

| Group | Ops |
|---|---|
| Shots | `segment.add {recipe, atMs, durationMs, inMs?, id?}`, `segment.move {id, atMs}`, `segment.reorder {id, beforeId}` (`null` moves to the end), `segment.trim {id, edge, deltaMs, mode}`, `segment.roll {leftId, rightId, deltaMs}`, `segment.slip {id, deltaMs}`, `segment.split {id, atMs, newId?}`, `segment.remove {id, ripple?}` |
| Transitions | `transition.set {segmentId, type, durationMs, mode?, direction?, ease?, seed?, sfx?}`, `transition.remove {segmentId}` |
| Overlays | `overlay.add {recipe, atMs, durationMs, inMs?, id?, opacity?, blend?}`, `overlay.move {id, atMs}`, `overlay.trim {id, edge, deltaMs}`, `overlay.set {id, opacity?, blend?}`, `overlay.remove {id}` |
| Audio | `audio.add {id, assetId, startMs, kind?, durationMs?, offsetMs?, gain?, fadeInMs?, fadeOutMs?, duckUnder?}`, `audio.move {id, atMs}`, `audio.trim {id, edge, deltaMs, endMs?}`, `audio.set {id, gain?, fadeInMs?, fadeOutMs?, offsetMs?}`, `audio.remove {id}` |
| Markers | `marker.add {atMs, label?, kind?}`, `marker.move {index, atMs, fromMs?}`, `marker.remove {index, fromMs?}` |
| Appearance | `captions.set {captions}` and `look.set {look}` (use `null` to clear) |
| Undo | `composition.restore {fields}` (generated by the reducer) |

`deltaMs` moves an edge in the direction of increasing time when positive. A positive slip advances the source in-point. A roll keeps the two-shot span and adjusts the right shot's in-point. Reordering keeps the transition and gap at each cut position. Use markers of kind `beat` or `downbeat` for beat snapping.

## Anti-Patterns

- Rewriting the whole recipe to change one keyframe: noisy diffs and lost author formatting.
- Writing without `--expect-sha` while the studio editor is open.
- Addressing keyframes by array position, or guessing times: read `velora edit ls` first.
- Retrying `ERR_EDIT_CONFLICT` without re-reading the file.
- Editing generated catalog files or bindings with these ops (they edit recipes only).

## Troubleshooting

- `ERR_EDIT_TARGET`: the scene, track or keyframe does not exist. Check `velora edit ls --scene <id> --json`.
- `ERR_EDIT_INVALID`: the issue path names the op (`ops.2…`) and the recipe field it broke.
- `ERR_EDIT_UNSUPPORTED`: stage, depth, lens, rack and rig ops arrive with later releases.
- `ERR_BRIDGE_PORT`: pass another `--port`. The bridge binds loopback only and needs the dev server.

## Validation

- `velora validate --json` stays clean after a write.
- Re-run `velora edit ls --scene <id> --json`; the `sha` matches the printed `nextSha`.
- Undo with the inverse and diff the file: it is byte-identical in normal cases.

## Related Skills

- `velora-scenes` for recipe structure and the motion vocabulary.
- `velora-motion-design` for clips, staggers, links and easing choices.
- `velora-cinematography` for constraints, rigs and camera intent.
- `velora-debug` when validation fails.

## When NOT to Use This Skill

- Creating a scene: scaffold it with `velora-templates`, then edit.
- Large structural rewrites where a new recipe is clearer.
- Composition timelines: those edits arrive with a later release.
