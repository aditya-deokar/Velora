---
name: velora-threejs
description: Author time-disciplined WebGL canvases that replay deterministically under the frame clock. Use when adding Three.js scenes as Surface leaves.
license: MIT
version: 0.1.2
when-to-use: Creating a WebGLSurface leaf, enforcing update from timeMs plus seed, or fixing WEBGL time and context failures.
prerequisites:
- velora-scenes loaded for Surface leaf rules
- Installed threejs-* skills for deep Three.js API
commands:
- validate
- render
- frames
- check
related-skills:
- velora-scenes
- velora-render
- velora-verify
not-for: Wall-clock animation loops, ticker clocks, or context-free assumptions; WebGL must be time-driven with fallback content.
---

# Velora Three.js — Time-Disciplined WebGL

Owns `WebGLSurface` time discipline: `update` from `timeMs` plus `seed`, capture safety, and budgets. Deep Three.js API lives in the installed `threejs-*` skills.

## When to Use This Skill

Use this skill when a scene needs true 3D objects, shaders, or loaders inside a `Surface` leaf. Every frame must be a pure function of video time; no `requestAnimationFrame` ownership, no ticker, no wall clock.

## Commands

- `velora validate --json`: runs static time-discipline scans plus composition gates.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`: proves the canvas replays at an exact frame.
- `velora frames --composition teaser.composition.json --out stills --every 30 --json`: proves determinism across seeks.
- `velora check --frames stills --json`: technical gates over the WebGL evidence.

## Prerequisites

- `WebGLSceneSchema` bounds: canvas 64 to 3840 per side, `pixelRatioCap` 1 to 2, explicit `seed`.
- Fallback content for `ERR_WEBGL_CONTEXT` devices that cannot create a context.
- Installed `threejs-fundamentals`, `threejs-geometry`, `threejs-materials`, and `threejs-shaders` for deep API.

## Workflow

1. Place the canvas inside one `Surface` leaf; keep siblings as ordinary leaves for focus and coverage.
2. Drive the scene from the `timeMs` prop plus composition `seed`; derive rotations, positions, and uniforms from those two inputs only.
3. Cap `pixelRatio` at 1.5 by default and honor the surface and draw budgets from `velora-performance`.
4. Run `velora validate --json` and fix `ERR_WEBGL_TIMELOOP` reports.
5. Prove with `velora render --composition teaser.composition.json --frame 0 --out proof.png --json`, then `velora frames --composition teaser.composition.json --out stills --every 30 --json`.

## Worked Example

Time-disciplined canvas stub:

```tsx
export function Stage({ timeMs, seed }: { timeMs: number; seed: number }) {
  const angle = (timeMs / 1000) * 0.6 + seed * 0.0001;
  return <canvas data-webgl-stage={angle.toFixed(4)} width={640} height={480} />;
}
```

Anti-example that fails validation:

```tsx
// Do not do this: owns a competing clock.
requestAnimationFrame(tick);
```

Verify:

```bash
velora validate --json
velora render --composition teaser.composition.json --frame 0 --out proof.png --json
velora check --frames stills --json
```

## Anti-Patterns

- Owning `requestAnimationFrame` or ticker clocks inside the scene.
- Reading wall-clock time or scroll position for motion.
- Skipping fallback content; capture fails closed on missing contexts.
- Copying `threejs-*` material or loader bodies here; link to them.

## Troubleshooting

- `ERR_WEBGL_TIMELOOP`: replace the loop with `timeMs` derivation.
- `ERR_WEBGL_CONTEXT`: supply fallback content; this device cannot create a context.
- `ERR_ANIMATION_CLOCK`: same fix as `velora-gsap`; remove the competing clock.
- Non-deterministic frames: confirm `seed` flows into every random call.

## Validation

- `velora validate --json` passes with no timeloop issues.
- Two renders of the same frame produce identical SHAs.
- `velora check --frames stills --json` passes dimensions and blank gates.

## Related Skills

- `velora-scenes`: leaf ownership and focus invariants.
- `velora-render`: frame and sequence proofs.
- `velora-verify`: technical gates.
- Installed `threejs-fundamentals`, `threejs-loaders`, `threejs-textures`: deep API, linked not copied.

## When NOT to Use This Skill

- Do not use this skill for DOM-only motion; load `velora-scenes` or `velora-gsap`.
- Do not use this skill to promise universal FPS; budgets are device evidence per `velora-performance`.
- Do not use this skill without fallback content on unknown devices.
