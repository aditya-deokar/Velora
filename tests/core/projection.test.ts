import { describe, expect, it } from "vitest";
import {
  CameraSchema, cameraMatrix, evaluateScene, intersectPlane, invertAffine, matrixFor, multiply, projectPoints,
  projectWorld, screenRay, surfaceQuad, TransformSchema, type Matrix,
} from "../../src/core";

// Deterministic pseudo-random sequence (no Math.random in property tests).
function rng(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 2 ** 32);
}
const frame = { width: 1920, height: 1080 };
const apply = (m: Matrix, [x, y, z]: number[]) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];

describe("projection owner", () => {
  it("round-trips projectWorld → screenRay → intersectPlane to the original point (< 1e-6)", () => {
    const random = rng(42);
    let checked = 0;
    for (let i = 0; i < 500; i++) {
      const camera = CameraSchema.parse({
        x: (random() - 0.5) * 800, y: (random() - 0.5) * 600, z: (random() - 0.5) * 900,
        rotateX: (random() - 0.5) * 50, rotateY: (random() - 0.5) * 70, rotateZ: (random() - 0.5) * 30,
        perspective: 600 + random() * 3000,
      });
      const local = matrixFor(TransformSchema.parse({
        x: (random() - 0.5) * 900, y: (random() - 0.5) * 700, z: -random() * 1500,
        rotateX: (random() - 0.5) * 80, rotateY: (random() - 0.5) * 80, rotateZ: random() * 360,
        scale: 0.3 + random() * 2, scaleX: 0.5 + random(), skewX: (random() - 0.5) * 30,
      }));
      const world = multiply(cameraMatrix(camera), local);
      const [u, v] = [(random() - 0.5) * 600, (random() - 0.5) * 400];
      const point = apply(world, [u, v, 0]);
      const projected = projectWorld(camera, frame, point, "view");
      if (!projected || projected.depth < 50) continue;
      const hit = intersectPlane(screenRay(camera, frame, projected), world);
      expect(hit).not.toBeNull();
      const recovered = apply(world, [hit!.u, hit!.v, 0]);
      const scale = Math.max(1, Math.hypot(...point));
      for (let k = 0; k < 3; k++) expect(Math.abs(recovered[k] - point[k]) / scale).toBeLessThan(1e-6);
      expect(Math.abs(hit!.u - u) / Math.max(1, Math.abs(u))).toBeLessThan(1e-6);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("stage and view spaces agree, and stage rays intersect stage planes", () => {
    const camera = CameraSchema.parse({ x: 120, y: -40, z: 300, rotateY: 18, rotateX: -7, perspective: 1400 });
    const point = [200, -100, -250];
    const stage = projectWorld(camera, frame, point)!;
    const view = projectWorld(camera, frame, apply(cameraMatrix(camera), point), "view")!;
    expect(stage).toEqual(view);
    const plane = matrixFor(TransformSchema.parse({ z: -250 }));
    const hit = intersectPlane(screenRay(camera, frame, stage, "stage"), plane)!;
    expect(hit.u).toBeCloseTo(200, 6);
    expect(hit.v).toBeCloseTo(-100, 6);
  });

  it("rejects points behind the eye and rays parallel to or behind a plane", () => {
    const camera = CameraSchema.parse({ perspective: 1000 });
    expect(projectWorld(camera, frame, [0, 0, 1000], "view")).toBeNull();
    expect(projectWorld(camera, frame, [0, 0, 1200], "view")).toBeNull();
    const edgeOn = matrixFor(TransformSchema.parse({ rotateY: 90 }));
    expect(intersectPlane({ origin: [0, 0, 1000], direction: [0, 0, -1] }, edgeOn)).toBeNull();
    expect(intersectPlane({ origin: [0, 0, 1000], direction: [0, 0, 1] }, matrixFor(TransformSchema.parse({})))).toBeNull();
  });

  it("orders depth nearest first and frame center maps to the stage center", () => {
    const camera = CameraSchema.parse({ perspective: 1400 });
    const near = projectWorld(camera, frame, [0, 0, 200], "view")!, far = projectWorld(camera, frame, [0, 0, -400], "view")!;
    expect(near.depth).toBeLessThan(far.depth);
    expect(near).toMatchObject({ x: 960, y: 540, depth: 1200 });
  });

  it("surfaceQuad projects the evaluated corners of a Surface", () => {
    const evaluation = evaluateScene({ camera: { perspective: 1400 }, nodes: [{ id: "card", transform: { x: 100, z: -200 } }] }, { card: { width: 400, height: 200 } });
    const node = evaluation.nodes[0];
    const quad = surfaceQuad(node, evaluation.camera!, frame);
    const k = 1400 / 1600;
    expect(quad[0]!.x).toBeCloseTo(960 + (100 - 200) * k, 9);
    expect(quad[2]!.y).toBeCloseTo(540 + 100 * k, 9);
    expect(quad.every(corner => corner && Math.abs(corner.depth - 1600) < 1e-9)).toBe(true);
  });

  it("invertAffine inverts transforms with scale and skew", () => {
    const m = matrixFor(TransformSchema.parse({ x: 4, y: -9, z: 12, rotateX: 20, rotateZ: 70, scale: 1.7, scaleY: 0.4, skewX: 12 }));
    const product = multiply(m, invertAffine(m)!);
    product.forEach((value, index) => expect(value).toBeCloseTo([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][index], 9));
    expect(invertAffine([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])).toBeNull();
  });

  it("projectPoints is the projectWorld forward projection", () => {
    const definition = { width: 1080, height: 1920, scene: { camera: { x: 30, z: 200, rotateY: 10 }, nodes: [] }, motion: { durationMs: 1000, tracks: [] } };
    const [point] = projectPoints(definition as never, [[50, 60, -10]], 0);
    const expected = projectWorld(CameraSchema.parse(definition.scene.camera), definition, [50, 60, -10])!;
    expect(point).toEqual({ x: expected.x, y: expected.y });
  });
});
