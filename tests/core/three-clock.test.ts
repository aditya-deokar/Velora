import { expect, it } from "vitest";
import { detectForbiddenClock } from "../../src/core/gsap";
import { validateWebGLSource } from "../../src/core/three";

it("warns about independent clocks and frame accumulation with actionable source locations", () => {
  const code = [
    "useFrame((state) => set(state.clock.elapsedTime));",
    "const t = clock.getElapsedTime();",
    "const step = clock.getDelta();",
    "useFrame((_, frameDelta) => {",
    "  mesh.rotation.y += frameDelta * 2;",
    "});",
    "useFrame((_, delta) => {",
    "  mesh.position.x = sample(seconds);",
    "});",
  ].join("\n");
  expect(detectForbiddenClock(code)).toEqual([
    { kind: "three-clock", line: 1 }, { kind: "three-clock", line: 2 },
    { kind: "three-clock", line: 3 }, { kind: "three-delta", line: 5 },
  ]);
  expect(validateWebGLSource(code, "scene.tsx").map(issue => issue.path)).toEqual(["scene.tsx:1", "scene.tsx:2", "scene.tsx:3", "scene.tsx:5"]);
  expect(validateWebGLSource(code, "scene.tsx")[3].message).toContain("useSceneClock");
});
