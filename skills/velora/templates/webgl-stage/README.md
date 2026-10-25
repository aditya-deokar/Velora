# WebGL Stage Template

Time-disciplined WebGL leaf: `stage.tsx` mounts `WebGLSurface` inside `Surface id="gl"` and paints a pure function of `useSceneTime()` plus `seed`, with no `requestAnimationFrame`. Keep the fallback content for devices without WebGL, then run `velora validate --json` and `velora shot --scene stage --time 1000 --out proof.png --json`.
