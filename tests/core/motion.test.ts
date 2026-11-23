import { describe, expect, it } from "vitest";
import {
  evaluateMotion,
  MotionSchema,
  MotionTrackSchema,
  type MotionInput,
} from "../../src/core/motion";
import { UPDATING, committedFiles, diffRecords, golden, motionRecord, recipeSources, sameTemplateSamples, scaffoldSources } from "./v21-golden";

const surface = { kind: "surface", id: "panel" } as const;
function track(target: unknown = surface, property = "x", from = 0, to = 100) {
  return {
    target,
    property,
    keyframes: [
      { timeMs: 100, value: from, easing: "linear" },
      { timeMs: 900, value: to },
    ],
  };
}
function motion(tracks: unknown[] = [track()]) {
  return { durationMs: 1000, speed: 1, tracks };
}
function expectInvalid(input: unknown, time = 500) {
  const state = evaluateMotion(input, time);
  expect(state.issues.length).toBeGreaterThan(0);
  expect(state.surfaces).toEqual({});
  expect(state.camera).toEqual({});
  expect(state.focus).toEqual({});
  return state.issues;
}

describe("explicit scene time motion", () => {
  it("interpolates every surface property, preserving partial overrides and independent IDs", () => {
    const tracks = ["x", "y", "z", "rotateX", "rotateY", "rotateZ"].map(
      (property) => track(surface, property),
    );
    tracks.push(
      track(surface, "scale", 1, 3),
      track(surface, "opacity", 0, 1),
      track({ kind: "surface", id: "other" }, "x", -20, 20),
    );
    expect(evaluateMotion(motion(tracks), 500)).toEqual({
      surfaces: {
        panel: {
          x: 50,
          y: 50,
          z: 50,
          rotateX: 50,
          rotateY: 50,
          rotateZ: 50,
          scale: 2,
          opacity: 0.5,
        },
        other: { x: 0 },
      },
      camera: {},
      focus: {},
      channels: {},
      issues: [],
    });
  });

  it("evaluates camera and spatial focus position/width independently", () => {
    const tracks = ["x", "y", "z", "rotateX", "rotateY", "rotateZ"].map(
      (property) => track({ kind: "camera" }, property, -100, 100),
    );
    tracks.push(
      track({kind:"focus"},"distance",1000,1400),
      track({kind:"focus"},"fStop",4,12),
      track({kind:"focus"},"focalLength",40,60),
      track({ kind: "focus" }, "maxBlur", 0, 32),
    );
    expect(evaluateMotion(motion(tracks), 500)).toEqual({
      surfaces: {},
      camera: { x: 0, y: 0, z: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
      focus: { distance:1200, fStop:8, focalLength:50, maxBlur:16 },
      channels: {},
      issues: [],
    });
  });

  it("uses outgoing smoothstep easing and a separate linear next segment", () => {
    const input: MotionInput = {
      durationMs: 2000, speed: 1,
      tracks: [
        {
          target: surface,
          property: "x",
          keyframes: [
            { timeMs: 0, value: 0, easing: "easeInOut" },
            { timeMs: 1000, value: 100, easing: "linear" },
            { timeMs: 2000, value: 200 },
          ],
        },
      ],
    };
    expect(evaluateMotion(input, 250).surfaces.panel.x).toBe(15.625);
    expect(evaluateMotion(input, 500).surfaces.panel.x).toBe(50);
    expect(evaluateMotion(input, 750).surfaces.panel.x).toBe(84.375);
    expect(evaluateMotion(input, 1000).surfaces.panel.x).toBe(100);
    expect(evaluateMotion(input, 1250).surfaces.panel.x).toBe(125);
  });

  it.each([
    [-100, 0],
    [0, 0],
    [50, 0],
    [100, 0],
    [900, 100],
    [950, 100],
    [1000, 100],
    [2000, 100],
  ])("clamps scene time and holds endpoints at %s ms", (time, value) => {
    expect(evaluateMotion(motion(), time).surfaces.panel).toEqual({ x: value });
  });

  it("supports empty tracks, static keyframes and zero duration", () => {
    expect(evaluateMotion({ durationMs: 0, speed: 1, tracks: [] }, 20)).toEqual({
      surfaces: {},
      camera: {},
      focus: {},
      channels: {},
      issues: [],
    });
    const input = {
      durationMs: 0, speed: 1,
      tracks: [
        {
          target: surface,
          property: "x",
          keyframes: [{ timeMs: 0, value: 12 }],
        },
      ],
    };
    for (const time of [-10, 0, 10])
      expect(evaluateMotion(input, time).surfaces.panel.x).toBe(12);
  });

  it("is deterministic across scrubbing, leaves frozen input intact, and returns fresh state", () => {
    const input = motion();
    const snapshot = JSON.stringify(input);
    function freeze(value: unknown) {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(input);
    const first = evaluateMotion(input, 500);
    evaluateMotion(input, 900);
    evaluateMotion(input, 0);
    expect(evaluateMotion(input, 500)).toEqual(first);
    first.surfaces.panel.x = 999;
    first.issues.push({ path: "test", message: "changed" });
    expect(evaluateMotion(input, 500).surfaces.panel.x).toBe(50);
    expect(evaluateMotion(input, 500).issues).toEqual([]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("handles prototype-like surface IDs as ordinary scoped data", () => {
    const state = evaluateMotion(
      motion([
        track({ kind: "surface", id: "__proto__" }),
        track({ kind: "surface", id: "constructor" }),
      ]),
      500,
    );
    expect(Object.hasOwn(state.surfaces, "__proto__")).toBe(true);
    expect(state.surfaces.__proto__).toEqual({ x: 50 });
    expect(state.surfaces.constructor).toEqual({ x: 50 });
    expect(Object.getPrototypeOf(state.surfaces)).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, "x")).toBe(false);
  });

  it("interpolates opposite finite extremes without overflowing", () => {
    const input = motion([
      track(surface, "x", -Number.MAX_VALUE, Number.MAX_VALUE),
    ]);
    expect(evaluateMotion(input, 500).surfaces.panel.x).toBe(0);
    expect(Number.isFinite(evaluateMotion(input, 700).surfaces.panel.x)).toBe(
      true,
    );
  });

  it("preserves strictly positive bounds even for the smallest finite value", () => {
    const state = evaluateMotion(
      motion([
        track(surface, "scale", Number.MIN_VALUE, Number.MIN_VALUE),
        track({ kind: "focus" }, "distance", Number.MIN_VALUE, Number.MIN_VALUE),
      ]),
      500,
    );
    expect(state.surfaces.panel.scale).toBe(Number.MIN_VALUE);
    expect(state.focus.distance).toBe(Number.MIN_VALUE);
  });
});

describe("motion validation boundary", () => {
  it.each([NaN, Infinity, -Infinity, "500", null, undefined])(
    "rejects invalid explicit time %s",
    (time) => {
      expect(evaluateMotion(motion(), time as number)).toEqual({
        surfaces: {},
        camera: {},
        focus: {},
        channels: {},
        issues: [
          { path: "timeMs", message: "Scene time must be a finite number." },
        ],
      });
    },
  );

  it.each([
    null,
    {},
    { durationMs: -1, tracks: [] },
    { durationMs: Infinity, tracks: [] },
    { durationMs: NaN, tracks: [] },
    { durationMs: "1000", tracks: [] },
    { durationMs: 1000, speed: 1, tracks: [], extra: true },
  ])("rejects malformed config %#", (input) => {
    expectInvalid(input);
  });

  it.each([
    [surface, "scale", 0],
    [surface, "scale", -1],
    [surface, "scale", 101],
    [surface, "opacity", -0.01],
    [surface, "opacity", 1.01],
    [{ kind: "focus" }, "radius", -1],
    [{ kind: "focus" }, "distance", 0],
    [{ kind: "focus" }, "distance", -1],
    [{ kind: "focus" }, "maxBlur", -1],
    [{ kind: "focus" }, "maxBlur", 33],
    [surface, "x", NaN],
    [{ kind: "camera" }, "z", Infinity],
    [{ kind: "focus" }, "x", -Infinity],
  ])(
    "rejects invalid values %# in schema and operation",
    (target, property, value) => {
      const invalid = track(
        target,
        property as string,
        value as number,
        value as number,
      );
      expect(MotionTrackSchema.safeParse(invalid).success).toBe(false);
      expectInvalid(motion([track(), invalid]));
    },
  );

  it.each([
    [{ kind: "camera" }, "opacity"],
    [{ kind: "camera" }, "radius"],
    [{ kind: "focus" }, "rotateX"],
    [{ kind: "focus" }, "depth"],
    [surface, "radius"],
    [surface, "unknown"],
    [{ kind: "surface", id: "" }, "x"],
    [{ kind: "element", id: "panel" }, "x"],
    [{ kind: "focus", id: "panel" }, "x"],
  ])("rejects incompatible target/property %#", (target, property) => {
    expectInvalid(motion([track(target, property as string)]));
  });

  it.each(
    [
      [],
      [{ timeMs: -1, value: 0 }],
      [{ timeMs: Infinity, value: 0 }],
      [{ timeMs: 1001, value: 0 }],
      [{ timeMs: 0, value: 0, easing: "bounce" }],
      [
        { timeMs: 0, value: 0 },
        { timeMs: 0, value: 1 },
      ],
      [
        { timeMs: 500, value: 0 },
        { timeMs: 100, value: 1 },
      ],
      [{ timeMs: 0, value: 0, unknown: true }],
    ].map((keyframes) => ({ keyframes })),
  )("rejects invalid keyframe sequences %#", ({ keyframes }) => {
    expectInvalid(motion([{ target: surface, property: "x", keyframes }]));
  });

  it.each([surface, { kind: "camera" }, { kind: "focus" }])(
    "rejects duplicate target/property tracks %#",
    (target) => {
      const duplicate = track(target);
      expectInvalid(motion([duplicate, duplicate]));
      expect(
        MotionSchema.safeParse(motion([duplicate, duplicate])).success,
      ).toBe(false);
    },
  );

  it("reports actionable validation paths and can recover on the next evaluation", () => {
    const issues = expectInvalid(
      motion([
        {
          target: surface,
          property: "scale",
          keyframes: [{ timeMs: 0, value: 0 }],
        },
      ]),
    );
    expect(
      issues.some((issue) => issue.path === "tracks.0.keyframes.0.value"),
    ).toBe(true);
    expect(evaluateMotion(motion(), 500).issues).toEqual([]);
  });
});

// v2.1 Phase 00 golden: every committed recipe and one scaffold per template x aspect x intensity,
// at 25 sample times plus loopSeam. Regenerate only with `node scripts/golden.mjs --update`.
describe("v2.1 motion golden", () => {
  type Record_ = Record<string, unknown>;
  const recorded = UPDATING ? undefined : golden<{ recipes: Record_; scaffolds: Record_ }>("motion.json", { recipes: {}, scaffolds: {} });
  const files = recorded ? Object.keys(recorded.recipes) : committedFiles(/\.scene\.json$/);
  const actual = {
    recipes: Object.fromEntries(recipeSources(files).map(source => [source.key, motionRecord(source.definition)])),
    scaffolds: Object.fromEntries(scaffoldSources().map(source => [source.key, motionRecord(source.definition)])),
  };
  const expected = recorded ?? golden("motion.json", actual);
  it("covers every committed recipe and every template scaffold", () => {
    expect(Object.keys(expected.recipes).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(expected.scaffolds).length).toBeGreaterThanOrEqual(100);
  });
  it("evaluates committed recipes byte-identically", () => expect(diffRecords(expected.recipes, actual.recipes)).toEqual([]));
  it("matches template scaffold samples across supported Node math implementations", () => expect(diffRecords(expected.scaffolds, actual.scaffolds, sameTemplateSamples)).toEqual([]));
  it("rejects numeric drift and shape changes outside the scaffold rounding tolerance", () => {
    expect(sameTemplateSamples({ x: [1, 2] }, { x: [1 + 1e-13, 2] })).toBe(true);
    expect(sameTemplateSamples({ x: [1, 2] }, { x: [1 + 1e-10, 2] })).toBe(false);
    expect(sameTemplateSamples({ x: [1, 2] }, { x: { 0: 1, 1: 2 } })).toBe(false);
  });
});

describe("v2.1 auto-bezier keyframes", () => {
  const values: [number, number][] = [[0, 0], [1000, 100], [2000, 140], [3000, 400], [4000, 380]];
  const auto = (easings: (string | undefined)[] = []) => ({ durationMs: 4000, speed: 1, tracks: [{ target: { kind: "camera" }, property: "x",
    keyframes: values.map(([timeMs, value], i) => ({ timeMs, value, easing: easings[i] ?? "auto" })) }] });
  const at = (input: unknown, t: number) => evaluateMotion(input, t).camera.x!;
  it("passes through every keyframe", () => {
    for (const [timeMs, value] of values) expect(at(auto(), timeMs)).toBeCloseTo(value, 9);
  });
  it("is C1 at interior keyframes (no velocity jump)", () => {
    const h = 1e-3;
    for (const [timeMs] of values.slice(1, -1)) {
      const left = (at(auto(), timeMs) - at(auto(), timeMs - h)) / h, right = (at(auto(), timeMs + h) - at(auto(), timeMs)) / h;
      expect(Math.abs(left - right)).toBeLessThan(1e-3);
    }
  });
  it("never overshoots between keyframes", () => {
    for (let i = 0; i < values.length - 1; i++)
      for (let k = 1; k < 50; k++) {
        const t = values[i][0] + (k / 50) * 1000, v = at(auto(), t);
        expect(v).toBeGreaterThanOrEqual(Math.min(values[i][1], values[i + 1][1]) - 1e-9);
        expect(v).toBeLessThanOrEqual(Math.max(values[i][1], values[i + 1][1]) + 1e-9);
      }
  });
  it("matches a smooth track on all-auto segments and leaves eased neighbors unchanged", () => {
    const smooth = { durationMs: 4000, speed: 1, tracks: [{ target: { kind: "camera" }, property: "x", interpolation: "smooth", keyframes: values.map(([timeMs, value]) => ({ timeMs, value })) }] };
    for (let t = 0; t <= 4000; t += 125) expect(at(auto(), t)).toBe(at(smooth, t));
    const mixed = auto(["auto", "linear", "auto", "cinematic"]);
    expect(at(mixed, 1500)).toBe(120); // the linear segment keeps its own easing
    expect(at(mixed, 3500)).toBe(at({ durationMs: 4000, speed: 1, tracks: [{ target: { kind: "camera" }, property: "x", keyframes: values.map(([timeMs, value]) => ({ timeMs, value })) }] }, 3500));
  });
  it("is valid only on keyframes", () => {
    expect(MotionTrackSchema.safeParse({ target: { kind: "camera" }, property: "x", interpolation: "smooth", ease: "auto", keyframes: [{ timeMs: 0, value: 0 }] }).success).toBe(false);
  });
});

describe("v2.1 compiled evaluator", () => {
  it("returns identical results with the cache hit and with a fresh object", () => {
    const input = motion([track(), track({ kind: "channel", id: "c" }, "value", 0, 5)]);
    for (const t of [0, 250, 500, 900, 1000]) expect(evaluateMotion(input, t)).toEqual(evaluateMotion(structuredClone(input), t));
  });
  it("recompiles a cached object whose structure was mutated", () => {
    const input = motion([track()]) as { tracks: unknown[] };
    expect(evaluateMotion(input, 500).surfaces.panel.x).toBe(50);
    input.tracks.push(track(surface, "y", 0, 10));
    expect(evaluateMotion(input, 500).surfaces.panel.y).toBe(5);
  });
  it("returns fresh issue arrays for cached invalid input", () => {
    const bad = motion([track(surface, "nope")]);
    const first = evaluateMotion(bad, 0);
    first.issues.length = 0;
    expect(evaluateMotion(bad, 0).issues.length).toBeGreaterThan(0);
  });
});

describe("v2.1 style and color tracks", () => {
  const style = (property: string, keyframes: unknown[], extra: object = {}) => ({ target: { kind: "style", id: "card" }, property, keyframes, ...extra });
  it("writes numeric CSS variables with units and color variables as canonical rgb()", () => {
    const state = evaluateMotion(motion([
      style("--radius", [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 1000, value: 24 }], { unit: "px" }),
      style("--accent", [{ timeMs: 0, value: "#ff0000", easing: "linear" }, { timeMs: 1000, value: "#0000ff" }]),
    ]), 500);
    expect(state.styles).toEqual({ card: { "--radius": "12px", "--accent": expect.stringMatching(/^rgb\([\d.]+ [\d.]+ [\d.]+ \/ 1\)$/) } });
    expect(evaluateMotion(motion([style("--accent", [{ timeMs: 0, value: "#ff0000" }])]), 0).styles!.card["--accent"]).toBe("rgb(255 0 0 / 1)");
  });
  it("evaluates color channel tracks into colorChannels and keeps numeric channels separate", () => {
    const state = evaluateMotion(motion([
      { target: { kind: "channel", id: "badge.fill" }, property: "value", keyframes: [{ timeMs: 0, value: "#000000" }, { timeMs: 1000, value: "#ffffff" }] },
      track({ kind: "channel", id: "n" }, "value", 0, 10),
    ]), 1000);
    expect(state.colorChannels).toEqual({ "badge.fill": "rgb(255 255 255 / 1)" });
    expect(state.channels).toEqual({ n: 10 });
  });
  it("omits styles and colorChannels when no such tracks exist (output unchanged)", () => {
    const state = evaluateMotion(motion(), 500);
    expect("styles" in state).toBe(false);
    expect("colorChannels" in state).toBe(false);
  });
  it("rejects invalid names, named colors, smooth color tracks, units on colors and color noise", () => {
    for (const bad of [
      style("accent", [{ timeMs: 0, value: 1 }]),
      style("--accent", [{ timeMs: 0, value: "red" }]),
      style("--accent", [{ timeMs: 0, value: "#ff0000" }, { timeMs: 1000, value: "#00ff00" }], { interpolation: "smooth" }),
      style("--accent", [{ timeMs: 0, value: "#ff0000" }], { unit: "px" }),
      style("--accent", [{ timeMs: 0, value: "#ff0000" }], { noise: { amplitude: 1 } }),
      style("--accent", [{ timeMs: 0, value: "#ff0000", easing: "auto" }, { timeMs: 1000, value: "#00ff00" }]),
    ]) expect(MotionSchema.safeParse(motion([bad])).success, JSON.stringify(bad)).toBe(false);
    expect(MotionSchema.safeParse(motion([style("--size", [{ timeMs: 0, value: 1 }, { timeMs: 1000, value: 2 }], { interpolation: "smooth", unit: "rem" })])).success).toBe(true);
  });
  it("rejects a duplicate style property on one surface and measures color loop seams", async () => {
    expect(MotionSchema.safeParse(motion([style("--a", [{ timeMs: 0, value: 1 }]), style("--a", [{ timeMs: 0, value: 2 }])])).success).toBe(false);
    const { loopSeam } = await import("../../src/core/motion");
    expect(loopSeam(motion([style("--a", [{ timeMs: 0, value: "#000" }, { timeMs: 1000, value: "#000" }])]))).toBe(0);
    expect(loopSeam(motion([style("--a", [{ timeMs: 0, value: "#000" }, { timeMs: 1000, value: "#fff" }])]))).toBeCloseTo(255, 6);
  });
  it("validates grade properties on surfaces", () => {
    expect(MotionTrackSchema.safeParse(track(surface, "brightness", 0, 2)).success).toBe(true);
    expect(MotionTrackSchema.safeParse(track(surface, "grayscale", 0, 2)).success).toBe(false);
    expect(MotionTrackSchema.safeParse(track(surface, "hueRotate", -360, 360)).success).toBe(true);
    expect(MotionTrackSchema.safeParse(track(surface, "skewX", 0, 90)).success).toBe(false);
    expect(MotionTrackSchema.safeParse(track(surface, "originX", 0, 100)).success).toBe(true);
  });
});
