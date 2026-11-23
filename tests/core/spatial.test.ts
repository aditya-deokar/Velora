import { describe, expect, it } from "vitest";
import { evaluateScene, matrixFor, multiply, transformOriginCss, transformToCss } from "../../src/core/spatial";
import { TransformSchema } from "../../src/core/scene";

// v2.1 Phase 01.2: per-axis scale, skew and pivot mirror CSS exactly and leave old strings untouched.
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x: number, y: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 0, 0, 0, 0, 1];
const close = (a: readonly number[], b: readonly number[]) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], 9));
describe("v2.1 transform additions", () => {
  it("keeps today's CSS string and matrix when the fields are absent", () => {
    expect(transformToCss({ x: 1, rotateZ: 2, scale: 3 })).toBe("translate3d(1px, 0px, 0px) rotateX(0deg) rotateY(0deg) rotateZ(2deg) scale(3)");
    expect(transformOriginCss({})).toBe("50% 50%");
    expect(TransformSchema.parse({})).toEqual({ x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scale: 1 });
  });
  it("appends scale3d then skew in CSS order", () => {
    expect(transformToCss({ scaleX: 2, skewY: 10 })).toBe("translate3d(0px, 0px, 0px) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(1) scale3d(2, 1, 1) skew(0deg, 10deg)");
    expect(transformOriginCss({ originX: 0, originY: 100 })).toBe("0% 100%");
  });
  it("matrixFor mirrors scale3d and skew", () => {
    close(matrixFor(TransformSchema.parse({ scale: 2, scaleX: 3, scaleY: 0.5 })), [6, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
    const t = Math.tan((20 * Math.PI) / 180);
    close(matrixFor(TransformSchema.parse({ skewX: 20 })), [1, t, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    close(matrixFor(TransformSchema.parse({ skewY: 20 })), [1, 0, 0, 0, t, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
  it("rejects out-of-range values", () => {
    for (const bad of [{ scaleX: 0 }, { scaleY: 101 }, { skewX: 90 }, { originX: -101 }, { originY: 201 }]) expect(TransformSchema.safeParse(bad).success).toBe(false);
  });
  it("pivots rotation about the origin: T(o) · M · T(-o)", () => {
    const scene = (transform: object) => evaluateScene({ nodes: [{ id: "card", transform }] }, { card: { width: 400, height: 200 } });
    const pivoted = scene({ rotateZ: 90, originX: 0, originY: 0 }).nodes[0].world;
    const m = matrixFor(TransformSchema.parse({ rotateZ: 90 }));
    close(pivoted, multiply(multiply(translate(-200, -100), m), translate(200, 100)));
    // The pivot corner stays fixed: the top-left (-200,-100) maps to itself.
    const p = [-200, -100];
    expect(pivoted[0] * p[0] + pivoted[1] * p[1] + pivoted[3]).toBeCloseTo(-200, 9);
    expect(pivoted[4] * p[0] + pivoted[5] * p[1] + pivoted[7]).toBeCloseTo(-100, 9);
    close(scene({ rotateZ: 90, originX: 50, originY: 50 }).nodes[0].world, multiply(identity, m));
  });
});
