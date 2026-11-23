import { expect, it } from "vitest";
import { CameraSchema, focusBand, FocusSchema, focusVeils, matrixFor, sampleDepthFocus, TransformSchema } from "../../src/core";

it("solves stacked Gaussian variance and preserves the side of the focus plane", () => {
  const targets = [{ sigma: 0.75 }, { sigma: 2.3 }, { sigma: 4.6 }];
  let variance = 0;
  focusVeils(targets).forEach(({ sigma }, i) => { variance += sigma ** 2; expect(Math.sqrt(variance)).toBeCloseTo(targets[i].sigma, 6); });
  const matrix = matrixFor(TransformSchema.parse({})), camera = CameraSchema.parse({ perspective: 9000, zoom: 1.018 });
  const focus = FocusSchema.parse({ focalLength: 1001, fStop: 1.4, distance: 10_000, maxBlur: 14 });
  const near = sampleDepthFocus(matrix, [0, 0, -904], camera, focus);
  const far = sampleDepthFocus(matrix, [0, 0, -1096], camera, focus);
  expect([near.signed, far.signed]).toEqual([-96, 96]);
  expect(near.sigma).toBeCloseTo(far.sigma, 12);
  expect(near.blur).toBeGreaterThan(far.blur);
  expect([0, 1.8, 7, 14].map(blur => focusBand(blur, 14))).toEqual([0, 1, 3, 6]);
});
