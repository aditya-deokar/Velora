---
name: velora-threejs
description: Author deterministic React Three Fiber scenes, keyframe 3D objects, and capture them with Velora.
license: MIT
version: 0.1.2
when-to-use: Adding a ThreeSurface, keyframing a mesh or glTF clip, sharing the DOM camera, or diagnosing a 3D capture.
prerequisites:
- React and React DOM 19 with React Three Fiber 9 and Three.js 0.160 or newer
- velora-scenes loaded for Surface and camera conventions
commands:
- doctor
- validate
- render
- frames
- check
related-skills:
- velora-scenes
- velora-render
- velora-performance
not-for: Independent clocks, physics, or post-processing inside the Velora Three.js renderer.
---

# Velora Three.js

## When to Use This Skill

Use `@adityadeokar/velora/three` for scenes that combine a React Three Fiber model with Velora's DOM, timeline, and export. The entry requires optional Three.js and R3F peers. Ordinary Surface hosts can use React 18.

## Commands

- `velora doctor --json` reports the installed Three.js, React Three Fiber, and React renderer for projects using the optional entry.
- `velora validate --json` reports independent Three.js clocks and accumulated frame deltas as authoring advice.
- `velora render --composition teaser.composition.json --frame 0 --out proof.png --json` captures one exact frame.
- `velora frames --composition teaser.composition.json --out stills --every 30 --json` captures a sequence.
- `velora check --frames stills --json` checks the frame sequence.

## Prerequisites

Install `three` and `@react-three/fiber@^9` alongside compatible React and React DOM 19 versions. R3F 9.8.2 supports React 19.0 through 19.3. Author inside a Velora `Scene` with WebGL 2 available.

## Workflow

1. Place a `ThreeSurface` in the scene and list its id among the recipe's Surface nodes. Velora advances its canvas at absolute scene seconds. Use `useSceneClock()` for `t` in milliseconds, `seconds`, and the surface's `seed`.
2. Wrap an Object3D with `<Animated id="hero-mesh">` or call `useAnimatable3D(ref, "hero-mesh")`. Position, rotation in degrees, scale and visibility are available. Standard or physical materials expose opacity, color, emissive, emissive intensity, roughness and metalness on the mesh's first matching material. Lights expose intensity and color. Perspective cameras expose field of view and a world-space look-at target.
3. Use recipe channels such as `three:hero-mesh.position.x`, `three:hero-mesh.color`, and `three:hero-mesh.visible`. A boolean channel switches at 0.5. The studio shows the object beneath its Surface and records gizmo edits through those same channels. Give controlled meshes their own material instances.
4. Load models and textures with Suspense-enabled loaders under the surface's boundary. Pass the mounted glTF instance to `useGLTFClips(gltf, "product")`. Its return value lists each clip's `time` and `weight` channel id. Clip times are in seconds and default to 0. Weights default to 0. Clone a cached model before mounting it more than once.
5. For a shared camera, set `camera="velora"` on a top-level ThreeSurface. Its origin is frame center. One unit equals one stage pixel at the base plane, and Three.js uses Y up. Target a registered object in a constraint with `{ "three": "hero-mesh" }`. Registered, recipe-driven transforms participate in anchor evaluation. Procedural frame callbacks and internal glTF skinning do not supply constraint anchor positions.
6. Render a frame twice with a backward seek between samples. Compare the results on the same device.

## Worked Example

```tsx
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";
import { Animated, ThreeSurface, useSceneClock } from "@adityadeokar/velora/three";

function Product() {
  const mesh = useRef<Mesh>(null);
  const { seconds } = useSceneClock();
  useFrame(() => {
    if (mesh.current) mesh.current.rotation.y = seconds * 0.6;
  });
  return (
    <Animated id="hero-mesh">
      <mesh ref={mesh}>
        <boxGeometry args={[96, 96, 96]} />
        <meshStandardMaterial color="#2b9dbe" />
      </mesh>
    </Animated>
  );
}

export default function ProductScene() {
  return <ThreeSurface id="product-world" camera="velora" pixelRatioCap={1}>
    <ambientLight intensity={2} />
    <Product />
  </ThreeSurface>;
}
```

Assign each property from either a recipe channel or a frame callback. For example, the callback above owns rotation Y, while the inspector can keyframe position and material color.

## Anti-Patterns

- Owning `requestAnimationFrame`, a ticker, or the R3F render loop.
- Using `state.clock`, `clock.getElapsedTime()`, `clock.getDelta()`, or accumulated frame deltas.
- Hiding an asset load behind a nested Suspense fallback when capture needs the loaded asset.
- Expecting meshes and DOM surfaces to occlude one another. Canvas and DOM paint together in layer order. Velora's depth of field filters the canvas as a Surface plane.

## Troubleshooting

- A loader failure appears in Scene diagnostics and rejects capture. Verify the URL, asset format, and the browser's WebGL 2 support.
- If a canvas is empty on capture, give its Surface a size and confirm model and texture loaders suspend until ready.
- For raw WebGL, keep using `WebGLSurface` with its explicit `timeMs` and `seed` inputs.

## Validation

- `velora doctor --json` reports the installed optional peers.
- `velora validate --json` contains no Three.js clock advice.
- Forward and backward seeks reproduce the same frame SHA.
- `velora check --frames stills --json` passes dimensions and blank gates.

## Related Skills

- `velora-scenes` covers Surface and camera conventions.
- `velora-render` covers frame and sequence capture.
- `velora-performance` covers pixel ratio caps and draw counts.

## When NOT to Use This Skill

Use `velora-scenes` for DOM-only motion. Use the raw WebGL adapter for an existing low-level render callback.
