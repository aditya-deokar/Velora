# Phase 09 exit report · Three.js full control

Date 2026-11-21

## Implementation

- The optional `@adityadeokar/velora/three` entry supplies `ThreeSurface`, `useSceneClock`, `Animated`, `useAnimatable3D`, and `useGLTFClips`. The React 19 entry uses R3F's manual render loop, preserves the drawing buffer, and sizes the canvas from the unscaled Surface and page DPR. The base package retains its React 18 peer range.
- Three.js objects, materials, lights and perspective cameras expose typed channel properties. glTF clips have independent absolute time and weight channels. Unified camera mode uses the spatial owner's camera pose. The registry supplies world anchors for `lookAt` and `focusFollow`.
- Studio Layers, Inspector and Timeline use the same animatable declarations. The canvas handles nearest-object raycasting and its own gizmo rendering. The editor converts drag values to transient and committed edit operations. Capture removes the controls before seeking and waits for Suspense content and its committed frame.
- `product-orbit` is a local-project scene with an original, procedurally generated GLB, keyframed materials, an orbiting shared camera, and follow focus on a live DOM caption. `doctor` reports the Three.js peers. Validation reports independent clocks and accumulated delta as authoring advice.

## Verification

- S3 passed with React 19.2.0, R3F 9.8.2, Three.js 0.187.0, and Chromium 1208 with SwiftShader. [Spike evidence](phase-00-spikes.md#s3-deterministic-r3f)
- The Chromium suite passed all 50 journeys. Its Phase 09 tests pin absolute seconds and one advance per ordinary seek, measure a shared DOM and 3D point within one pixel, persist a mesh transform through the real edit bridge, and compare the exported canvas with the editor's capture without a gizmo. A delayed GLB test seeks to 2.1 seconds, backward to 0.4 seconds, and back to 2.1 seconds. The two 2.1-second capture PNGs and the studio frame at the same time had SHA-256 `92abba4b0729508e8e971e7333f703f644026d83a3620c4bad0fc0b825326312`. A failed model load reports its URL through Scene diagnostics and rejects capture.
- The installed local project passed `velora doctor` with Three.js 0.187.0, R3F 9.8.2, and React 19.2.0. Two complete draft CLI exports of `product-orbit` produced identical MP4 files, with 72 frames at 24 fps and 640 × 360 resolution. Both files had SHA-256 `44dc05bca798f78a3d50a4e82feb097db90896907e4e1c4257d7f2140bb9a0b5`.
- The packed package opened the studio in a React 18.3.1 Vite host without Three.js or R3F installed. Its production JavaScript was byte-for-byte identical to the same host built against the Phase 08 archive, with SHA-256 `a41a490e539d08d3b60bd86c8afe207243cb2127de5e25940c84779404c22763`.
- All 1,019 core, React and editor tests passed, as did 220 architecture and release tests. Type checking, generated schemas, skills, and the packed artifact budget passed.

## Scope

Unified camera mode is a full-frame, top-level Surface. DOM and WebGL share a camera but composite by layer order. Velora's depth of field treats the canvas as one Surface plane. Anchors resolve registered object transforms at scene time. Internal glTF deformation and arbitrary frame-callback mutations do not drive constraint targets.
