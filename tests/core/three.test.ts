import { describe, expect, it } from "vitest";
import { WebGLSceneSchema, validateWebGLSource } from "../../src/core/three";

describe("WebGL contract", () => {
  it("validates scene bounds with deterministic defaults", () => {
    const parsed = WebGLSceneSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("unreachable");
    expect(parsed.data).toMatchObject({ seed: 0, pixelRatioCap: 1.5, antialias: true });
    expect(WebGLSceneSchema.safeParse({ pixelRatioCap: 4 }).success).toBe(false);
    expect(WebGLSceneSchema.safeParse({ width: 127 }).success).toBe(false);
  });
  it("flags competing clocks in scene sources", () => {
    expect(validateWebGLSource("function tick() {\n requestAnimationFrame(tick);\n}", "gl.tsx")).toEqual([
      { code: "ERR_WEBGL_TIMELOOP", path: "gl.tsx:2", message: expect.any(String) },
    ]);
    expect(validateWebGLSource("gsap.ticker.add(draw);", "gl.tsx")[0].code).toBe("ERR_WEBGL_TIMELOOP");
    expect(validateWebGLSource("export function paint(gl, { t }) { gl.clearColor(t, 0, 0, 1); }", "gl.tsx")).toEqual([]);
  });
});
