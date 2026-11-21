---
name: velora-cinematography
description: Camera language for Velora shots — shot size, angle, movement, lens, focus and composition mapped to real camera, perspective and focus values. Use when choosing or refining how a shot looks and moves.
license: MIT
version: 0.1.2
when-to-use: Planning a shot, refining a scaffolded template, diagnosing a shot that feels flat or busy, or translating a director's note ("tighter", "longer lens", "rack to the button") into recipe values.
prerequisites:
- velora guide --json read for this CLI version
- A scene recipe to refine (authored or from velora-templates)
commands:
- guide
- templates
- shot
related-skills:
- velora
- velora-templates
- velora-scenes
- velora-render
- velora-editing
- velora-looks
- velora-launch
not-for: File wiring, composition timing, audio or export settings; use velora-scenes, velora-composition, velora-audio or velora-export.
---

# Velora Cinematography — Camera Language for Live UI

This skill turns film grammar into recipe values. Velora's camera is a CSS 3D camera: pixels and degrees, with +x right, +y down and +z toward the viewer.
- Camera `x/y/z` subtract from scene positions, so `camera.z > 0` pushes the subject away.
- Positive `rotateX` makes the top of the page recede; negative `rotateY` brings the right side near.
- `perspective` is field of view; `focus` is the lens's depth of field.

## When to Use This Skill

Use it whenever a shot must be designed or corrected:
- choosing shot size, angle and move;
- picking a lens;
- deciding what is sharp;
- reading a note such as "make it feel more expensive".

For the starting point itself, load `velora-templates` first.

## Commands

- `velora guide --json`: `capabilities.lenses` (mm → perspective), `capabilities.easings`, `capabilities.trackOptions`.
- `velora templates show --id hero-push --json`: each template's technique, motivation and pitfalls, as worked examples of this grammar.
- `velora shot --scene <id> --time <ms> --out <png> --json`: judge every change on real pixels at output size.

## Prerequisites

- Know the one thing the shot must say: hero, detail, scale, transition, ambience.
- Know the destination aspect; framing that works at 16:9 may crop at 9:16.

## Workflow

1. **Intent first.** One shot, one idea. Decide what the viewer must notice and when.
2. **Shot size.** Size comes from camera distance against subject size:
   - wide establishes (subject fills about 60% of the frame);
   - medium presents (about 80%);
   - close isolates (the subject overflows the frame);
   - macro makes a detail the subject (a region fills the frame).
3. **Angle.** Pick one:
   - eye level is neutral;
   - high (`rotateX` 30–60) surveys;
   - low or steep oblique adds monumentality;
   - Dutch (`rotateZ` 3–8) adds unease or energy, sparingly;
   - symmetric, face-on framing reads as calm and precise.
4. **Lens.** `lensFor(mm, frameHeight)` sets `perspective` and the matching focus focal length.
   - 24–35 mm exaggerates depth and suits surveys.
   - 50 mm is natural.
   - 85–135 mm compresses depth, flatters, and gives shallow focus for racks and macro.
5. **Move.** Choose one motivated move:
   - push in (`camera.z` decreases): attention;
   - pull out: context;
   - truck (`x`) or pedestal (`y`): survey;
   - arc (`rotateY` about the subject): reveal;
   - crane (`y` plus `rotateX`): establish then settle;
   - dolly zoom (animate `perspective`, subject held on the projection plane): unease or emphasis;
   - rack focus (animate `focus.distance`): attention without motion;
   - whip (fast `x` with `expo.out`): rhythm between beats;
   - handheld (`noise`): urgency.
6. **Path and timing.**
   - Multi-waypoint camera rails use `"interpolation": "smooth"` with a track `"ease": "cinematic"`, so they never stop at waypoints.
   - Keep overshoot (`back`, `elastic`, bouncy springs) off camera tracks.
   - Give the shot a settle: the last 15–20% of motion should decelerate into a readable hold.
7. **Focus.** Focus the plane that carries the idea.
   - Track `focus.distance` with the subject's depth during pushes so the payoff is sharp.
   - Lower `fStop` (or a longer focus focal length) to make a pull read on screen.
   - Raise `maxBlur` only after aperture.
8. **Prove.** Shoot the opening, middle and final frames with `velora shot`. Check:
   - near and far size difference;
   - an intentional crop;
   - a readable subject;
   - sharpness where the idea is.

## Worked Example

The director's note: "Longer lens, slower, end sharp on the revenue card." Translated:

```json
{
  "camera": { "perspective": 3825, "rotateX": 10, "rotateY": -16 },
  "focus": { "distance": 3900, "fStop": 2.8, "focalLength": 85, "maxBlur": 8 },
  "tracks": [
    { "target": { "kind": "camera" }, "property": "z", "interpolation": "smooth", "ease": "cinematic",
      "keyframes": [{ "timeMs": 0, "value": 900 }, { "timeMs": 8000, "value": 200 }] },
    { "target": { "kind": "focus" }, "property": "distance", "interpolation": "smooth", "ease": "cinematic",
      "keyframes": [{ "timeMs": 0, "value": 4700 }, { "timeMs": 8000, "value": 4000 }] }
  ]
}
```

What each change does:
- `perspective` 3825 is an 85 mm lens at a 1080-px frame (1080 × 85 / 24).
- The duration is longer.
- Focus distance tracks the card's depth: `perspective + camera.z` for a centered subject.

Verify with `velora shot --scene <id> --time 8000 --out end.png --json`.

## Anti-Patterns

- Moving everything at once (camera and every surface), which leaves no clear idea.
- Rotation sweeps over 60 degrees that show the page's edge.
- Linear camera moves without intent: they start and stop like a machine.
- Fitting the whole page in every shot; scale comes from cropping.
- Blurring the text the viewer must read.
- Copying a reference's exact numbers instead of its relationship (near and far, crop, settle).
- Handheld noise on loops, on text-dense close-ups, or on every shot.

## Troubleshooting

- **Shot feels flat:** add obliqueness (`rotateY` −12 to −24) and depth difference; use a wider lens for surveys.
- **Shot feels busy:** remove all but one move, lengthen the duration and add a settle.
- **Subject leaves frame mid-move:** reduce travel or intensity, or use a template with framing certification.
- **Surface reaches the camera plane** (scene diagnostic): pull `camera.z` back or reduce the push.
- **Rack focus invisible:** lower `fStop`, use a longer focus focal length, and increase the depth difference (a steeper `rotateX`).
- **Seam jump in a loop:** end every track on its first value (`reviewAuthoring` reports `loop-seam`).

## Validation

- One idea per shot is stated before authoring, and the frames show it.
- Opening, middle and final `velora shot` frames show the intended size, angle, crop and sharpness.
- `velora validate --json` passes and `reviewAuthoring` advice is resolved or intentionally kept.

## Craft Notes

These techniques are named after where they are commonly taught and recognized; Velora implements the geometry, not anyone's style.

- **Motivated restraint.** Film cinematography courses teach that a camera moves only when the story gives it a reason; the default single move and `subtle` intensity follow that convention.
- **The slow push-in.** A locked-on, imperceptibly slow push is a thriller staple for building attention on a detail (`hero-push`).
- **The long fluid take.** Continuous, unbroken camera travel through a space (`monumental-survey`, smooth rails with no waypoint stops).
- **Symmetry and the whip pan.** One-point perspective and fast whip pans as punctuation (`whip-pan`, the `whip` transition).
- **Monumental scale.** Low angles and wide lenses that make a surface feel architectural (`crane-down`, wide lenses).
- **The dolly zoom.** Moving the camera while zooming the opposite way, first popularized in 1950s and 1970s suspense films (`dolly-zoom`).
- **Macro inserts and light sweeps.** Product-film close-ups that isolate one detail before showing context (`macro-detail`, `LightSweep`).

## Look-At, Follow Focus and the Orbit Rig (Velora 1.1)

- **Look-at.** `scene.constraints: [{ "kind": "lookAt", "target": { "surface": "hero", "anchor": [0.5, 0.4] } }]` pans and tilts the camera about its eye so the anchor (u, v in 0..1 of the Surface) sits at frame center. Camera x/y/z tracks still move the eye; rotateX/rotateY become derived, and the camera's x/y/z values are adjusted so the eye stays fixed. A `{ "point": [x, y, z] }` target aims at a stage point.
- **Follow focus.** `{ "kind": "focusFollow", "target": { "surface": "hero" }, "offset": 0 }` holds `focus.distance` on the target's camera depth, so a dolly never loses the subject. Pair it with lookAt for subject-locked moves.
- **Settling with weight.** `weight` (0..1, or a channel track `{ "target": { "kind": "channel", "id": "settle" }, "property": "value" }`) blends from the authored rotation to the aimed one. Ramp a `settle` channel from 0 to 1 over the last second for a camera that drifts, then locks on.
- **Orbit rig.** `buildOrbitRig({ radius, fromDeg, toDeg, height, durationMs, ease })` returns `{ clip, constraint }`: a constant-speed camera position path, eased as a group, plus a lookAt. Add the clip to `motion.clips` and the constraint to `scene.constraints`. Keep arcs within about 60 degrees for UI subjects, and pair the rig with focusFollow at long lenses.
- **Studio camera tools.** Select the subject and use Camera moves to preview a dolly zoom against the subject's framing. Use the Focus tool to set the near and far landings for a rack. The director view shows the layout and camera relationship. Review the landing in the camera view before capture.
- Constraints resolve in the spatial owner from live layout, so preview and export agree. A constraint target must be a node in `scene.nodes`.

## Directing in the Studio Viewport (Edit mode)

People editing in the studio (`velora edit --scene <id>`) direct the camera in the frame. Every gesture is an `EditOp` you could also write with `velora edit`:
- **Camera tool (C).** Drag orbits around the selected layer or the focus point; Shift+drag trucks and pedestals (x/y); the wheel or Alt+vertical drag dollies (z); Ctrl/⌘+drag pans and tilts in place (the eye stays fixed); the ring rolls (rotateZ). Alt+wheel changes the lens (focal length to `perspective` through `lens.ts`), and Alt+Shift+wheel is a **dolly-zoom** that keeps the selected subject's projected size while the background warps. A layer at z = 0 projects 1:1 under every lens, so dolly-zoom only moves the camera when the subject has depth.
- **Writes.** Animated camera properties (or Auto-key) key at the playhead; otherwise the change is a `camera.set` static override.
- **Director view (Tab).** An editor-only viewpoint that shows the real camera (eye, frustum to the frame plane and the focus plane) in the set; dragging the camera gizmo moves the real camera. Depth of field is off there, and exports refuse it with "Return to camera view before exporting.".
- **Focus tool (F).** Click a layer to set `focus.distance` to that point's depth for the real camera; Shift+click adds `focusFollow` on it. Focus peaking turns on while the tool is active. The **Rack focus** command (two layers selected) writes two `focus.distance` keyframes with a cinematic ease over the work area (or 1.5 s from the playhead) that land sharp on each layer.

Select one layer and open **Camera moves** to apply a shot as an editable clip. Check the frame coverage, depth margin, and focus blur in the inline verdict. Adjust the intensity or lens when the measured subject misses the framing limits.

## Related Skills

- `velora-templates`: certified starting points that encode these moves.
- `velora-scenes`: recipe mechanics, smooth rails, lens helpers, channels and masks.
- `velora-render`: shots and frames for judging pixels.
- `velora`: root router.
- `velora-editing`: how shots cut together (eye trace, direction, rhythm).
- `velora-looks`: grade and finishing once the shot is framed.
- `velora-launch`: which shots a launch needs and for which platform.

## When NOT to Use This Skill

- Not for wiring files, discovery or providers; use `velora-scenes` or `velora-init`.
- Not for editing several shots into a film; timing between shots belongs to `velora-editing` and `velora-composition`.
- Not for claims about artistic quality from checks. Automated checks are technical; taste needs human review.
