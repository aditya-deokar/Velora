import { describe, expect, it } from "vitest";
import { focalLengthForPerspective, lensFor, perspectiveForFocalLength } from "../../src/core/lens";

describe("lens language", () => {
  it("maps full-frame millimetres to CSS perspective", () => {
    expect(perspectiveForFocalLength(50, 1080)).toBe(2250);
    expect(perspectiveForFocalLength(24, 980)).toBe(980);
    expect(perspectiveForFocalLength(85, 1080)).toBeCloseTo(3825, 9);
    // Field of view check: half the frame height subtends atan(12 / mm) at the projection distance.
    const p = perspectiveForFocalLength(35, 1080);
    expect(Math.atan(540 / p)).toBeCloseTo(Math.atan(12 / 35), 12);
  });
  it("round-trips and pairs field of view with depth-of-field focal length", () => {
    for (const mm of [24, 35, 50, 85, 135]) expect(focalLengthForPerspective(perspectiveForFocalLength(mm, 1080), 1080)).toBeCloseTo(mm, 9);
    expect(lensFor(50, 1080)).toEqual({ perspective: 2250, focus: { focalLength: 50 } });
  });
  it("rejects lenses the camera cannot represent", () => {
    expect(() => perspectiveForFocalLength(400, 1080)).toThrow(/outside/);
    expect(() => perspectiveForFocalLength(1, 1080)).toThrow(/outside/);
    expect(() => perspectiveForFocalLength(0, 1080)).toThrow(RangeError);
    expect(() => perspectiveForFocalLength(50, Number.NaN)).toThrow(RangeError);
  });
});
