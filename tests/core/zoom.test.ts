import { expect, it } from "vitest";
import { CameraSchema, cameraToCss, coverScaleAt, intersectPlane, matrixFor, projectWorld, resolutionBudget, screenRay, TransformSchema } from "../../src/core";

it("zooms the projected image at a fixed eye and inverts the same screen ray", () => {
  const frame = { width: 1000, height: 600 }, point = [120, -63, -300];
  const camera = CameraSchema.parse({ rotateY: 16, perspective: 3000 });
  const before = projectWorld(camera, frame, point)!;
  const lens = { ...camera, zoom: 1.75 };
  const after = projectWorld(lens, frame, point)!;
  expect(after.depth).toBe(before.depth);
  expect(after.x - 500).toBeCloseTo((before.x - 500) * 1.75, 12);
  expect(after.y - 300).toBeCloseTo((before.y - 300) * 1.75, 12);
  expect(intersectPlane(screenRay(lens, frame, after, "stage"), matrixFor(TransformSchema.parse({ z: -300 })))).toMatchObject({
    u: expect.closeTo(120, 9), v: expect.closeTo(-63, 9),
  });
  expect(cameraToCss(lens)).toBe(cameraToCss(camera));
  expect(resolutionBudget({ frame, effectiveDpr: 1, samples: [{ camera: lens, target: [0, 0, 0], timeMs: 0 }] }).pixelsPerCssPixel).toBe(1.75);
});

it("finds backdrop cover for the most demanding sampled pose", () => {
  const frame = { width: 1920, height: 1080 };
  const camera = CameraSchema.parse({ perspective: 9000, z: 1500 });
  const moved = CameraSchema.parse({ ...camera, x: 280, rotateY: 12, zoom: 0.9 });
  const scale = coverScaleAt(-4000, [camera, moved], frame);
  expect(scale).toBe(Math.max(coverScaleAt(-4000, camera, frame), coverScaleAt(-4000, moved, frame)));
  expect(scale).toBeGreaterThan(1.5);
});
