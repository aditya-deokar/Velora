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
not-for: Creating a new scene from scratch (velora-templates or velora-scenes) or composing a multi-shot film (velora-editing).
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
| Keyframes | `key.set {track, atMs, value, easing?}` (upsert), `key.remove`, `key.move {track, fromMs, toMs}`, `key.ease`, `keys.shift {refs, deltaMs}`, `keys.scale {refs, pivotMs, factor}`, `keys.reverse {refs}` |
| Tracks | `track.add {track, keyframes, …options}`, `track.remove`, `track.options` (null clears an option) |
| Scene | `camera.set` and `focus.set {property, value or null}`, `node.ensure {id}`, `node.remove`, `motion.set {durationMs?, speed?, loop?}`, `look.set` |
| Structure | `clip.create {id, refs or tracks, startMs?}`, `clip.update`, `clip.dissolve {id, bake?}`, `stagger.set`, `link.set`, `link.remove`, `constraint.set`, `constraint.remove`, `path.fromAxes`, `path.tangent` |
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
