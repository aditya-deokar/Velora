import { describe, expect, it } from "vitest";
import { evaluateMotion, MotionSchema, clipTiming, loopSeam, withAdditive, type MotionInput } from "../../src/core/motion";
import { reviewAuthoring } from "../../src/core/authoring";

const surface = (id: string, property: string, keys: [number, number, string?][]) =>
  ({ target: { kind: "surface", id }, property, keyframes: keys.map(([timeMs, value, easing]) => ({ timeMs, value, ...(easing ? { easing } : {}) })) });
const motion = (extra: Record<string, unknown>, durationMs = 4000) => ({ durationMs, speed: 1, tracks: [], ...extra }) as unknown as MotionInput;
const x = (input: MotionInput, t: number, id = "a") => evaluateMotion(input, t).surfaces[id]?.x;

describe("clip local time", () => {
  const clip = (extra: object) => motion({ clips: [{ id: "c", startMs: 1000, tracks: [surface("a", "x", [[0, 0, "linear"], [1000, 100]])], ...extra }] });
  it("offsets by startMs and holds outside the clip", () => {
    const input = clip({});
    expect(x(input, 0)).toBe(0);
    expect(x(input, 1000)).toBe(0);
    expect(x(input, 1500)).toBe(50);
    expect(x(input, 2000)).toBe(100);
    expect(x(input, 3900)).toBe(100);
  });
  it("applies speed, trim and loops", () => {
    expect(x(clip({ speed: 2 }), 1250)).toBe(50);
    expect(clipTiming(clip({ speed: 2 }).clips![0] as never).endMs).toBe(1500);
    const trimmed = clip({ inMs: 200, durationMs: 600 });
    expect(x(trimmed, 1000)).toBe(20);
    expect(x(trimmed, 1300)).toBe(50);
    expect(x(trimmed, 1600)).toBe(80);
    expect(x(trimmed, 3000)).toBe(80);
    const looped = clip({ loop: 3 });
    expect(x(looped, 1250)).toBe(25);
    expect(x(looped, 2250)).toBe(25);
    expect(x(looped, 3250)).toBe(25);
    expect(x(looped, 4000)).toBe(100);
  });
  it("eases the whole group in time (group easing)", () => {
    const eased = clip({ ease: "cubic.out" });
    const t = 0.5, expected = 100 * (1 - (1 - t) ** 3);
    expect(x(eased, 1500)).toBeCloseTo(expected, 9);
  });
  it("nests clips and composes their time maps", () => {
    const nested = motion({ clips: [{ id: "outer", startMs: 1000, speed: 2, clips: [{ id: "inner", startMs: 500, tracks: [surface("a", "x", [[0, 0, "linear"], [1000, 100]])] }] }] });
    // outer local = (t - 1000) * 2; inner local = outer local - 500.
    expect(x(nested, 1250)).toBe(0);
    expect(x(nested, 1500)).toBe(50);
    expect(x(nested, 1750)).toBe(100);
  });
  it("renders identically to the equivalent flattened tracks (five layers retimed as a unit)", () => {
    const layers = ["a", "b", "c", "d", "e"];
    const local = layers.map((id, i) => surface(id, "y", [[i * 100, 40, "cubic.out"], [i * 100 + 600, 0]]));
    const grouped = motion({ clips: [{ id: "intro", startMs: 400, tracks: local }] });
    const flat = motion({ tracks: layers.map((id, i) => surface(id, "y", [[400 + i * 100, 40, "cubic.out"], [400 + i * 100 + 600, 0]])) });
    for (let t = 0; t <= 2000; t += 50) {
      const a = evaluateMotion(grouped, t).surfaces, b = evaluateMotion(flat, t).surfaces;
      for (const id of layers) expect(a[id].y).toBeCloseTo(b[id].y!, 9);
    }
  });
});
describe("ownership and additive mode", () => {
  it("rejects two replace owners and names both", () => {
    const parsed = MotionSchema.safeParse(motion({ tracks: [surface("a", "x", [[0, 0]])], clips: [{ id: "c", startMs: 0, tracks: [surface("a", "x", [[0, 1]])] }] }));
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error!.issues)).toMatch(/two replace owners: tracks\.0 and clips\.0\.tracks\.0/);
  });
  it("sums add clips onto the owner's value", () => {
    const input = motion({ tracks: [surface("a", "x", [[0, 100]])], clips: [{ id: "float", startMs: 0, mode: "add", tracks: [surface("a", "x", [[0, 0, "linear"], [1000, 10]])] }] });
    expect(x(input, 500)).toBe(105);
  });
  it("puts add offsets without an owner into additive so they add to the static base", () => {
    const state = evaluateMotion(motion({ clips: [{ id: "shake", startMs: 0, mode: "add", tracks: [
      { target: { kind: "camera" }, property: "rotateZ", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 1000, value: 2 }] },
      surface("a", "z", [[0, 10]]),
    ] }] }), 500);
    expect(state.camera).toEqual({});
    expect(state.additive).toEqual({ camera: { rotateZ: 1 }, surfaces: { a: { z: 10 } } });
    expect(withAdditive({ rotateZ: 3 }, state.additive!.camera)).toEqual({ rotateZ: 4 });
    expect(withAdditive({}, state.additive!.camera, { rotateZ: 0 })).toEqual({ rotateZ: 1 });
  });
  it("renders a handheld add clip over a push-in deterministically", () => {
    const input = motion({
      tracks: [{ target: { kind: "camera" }, property: "z", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 4000, value: 300 }] }],
      clips: [{ id: "handheld", startMs: 0, mode: "add", tracks: [{ target: { kind: "camera" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }], noise: { amplitude: 6, seed: 3 } }] }],
    });
    const run = () => Array.from({ length: 40 }, (_, k) => evaluateMotion(input, k * 100));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    expect(run()[10].additive?.camera?.x).not.toBe(0);
  });
  it("validates clip ids, depth, end time, stagger shape and $member", () => {
    const bad = [
      motion({ clips: [{ id: "c", startMs: 0 }, { id: "c", startMs: 0 }] }),
      motion({ clips: [{ id: "a", startMs: 0, clips: [{ id: "b", startMs: 0, clips: [{ id: "c", startMs: 0, clips: [{ id: "d", startMs: 0, clips: [{ id: "e", startMs: 0 }] }] }] }] }] }),
      motion({ clips: [{ id: "late", startMs: 3500, tracks: [surface("a", "x", [[0, 0], [1000, 1]])] }] }),
      motion({ clips: [{ id: "s", startMs: 0, members: ["a"] }] }),
      motion({ clips: [{ id: "m", startMs: 0, tracks: [surface("$member", "x", [[0, 0]])] }] }),
      motion({ clips: [{ id: "colors", startMs: 0, mode: "add", tracks: [{ target: { kind: "style", id: "a" }, property: "--c", keyframes: [{ timeMs: 0, value: "#000" }] }] }] }),
    ];
    for (const input of bad) expect(MotionSchema.safeParse(input).success, JSON.stringify(input).slice(0, 120)).toBe(false);
    expect(MotionSchema.safeParse(motion({ clips: [{ id: "ok", startMs: 0, label: "Intro", tracks: [surface("a", "x", [[0, 0], [1000, 1]])], source: { behavior: "fade-up", version: 1, params: {} } }] })).success).toBe(true);
  });
  it("measures loop seams across clips and reviews unknown surfaces inside clips", () => {
    expect(loopSeam(motion({ clips: [{ id: "c", startMs: 0, tracks: [surface("a", "x", [[0, 0], [4000, 0]])] }] }))).toBe(0);
    const review = reviewAuthoring({ scene: { nodes: [{ id: "a" }] }, motion: motion({ clips: [{ id: "c", startMs: 0, tracks: [surface("ghost", "x", [[0, 0]])] }] }) });
    expect(review.issues.some(issue => issue.code === "unknown-surface" && issue.path.includes("clips.0"))).toBe(true);
  });
});
