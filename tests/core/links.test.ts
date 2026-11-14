import { describe, expect, it } from "vitest";
import { evaluateMotion, MotionSchema, type MotionInput } from "../../src/core/motion";

const camX = { target: { kind: "camera" }, property: "x", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 1000, value: 100 }] };
const ref = (id: string, property = "x") => ({ target: { kind: "surface", id }, property });
const motion = (links: unknown[], tracks: unknown[] = [camX]) => ({ durationMs: 1000, speed: 1, tracks, links }) as MotionInput;
describe("links", () => {
  it("drives a background from the camera for parallax", () => {
    const state = evaluateMotion(motion([{ to: ref("bg"), from: { target: { kind: "camera" }, property: "x" }, scale: -0.2, offset: 5 }]), 500);
    expect(state.surfaces.bg.x).toBe(-5);
  });
  it("delays a copy (echoes) and reads channels", () => {
    const echo = motion([{ to: ref("echo"), from: { target: { kind: "camera" }, property: "x" }, delayMs: 200 }]);
    expect(evaluateMotion(echo, 500).surfaces.echo.x).toBe(30);
    const counter = motion([{ to: { target: { kind: "channel", id: "count" }, property: "value" }, from: { channel: "scroll" }, scale: 0.5 }],
      [{ target: { kind: "channel", id: "scroll" }, property: "value", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 1000, value: 800 }] }]);
    expect(evaluateMotion(counter, 500).channels.count).toBe(200);
  });
  it("chains links in order and adds in add mode", () => {
    const chain = motion([
      { to: ref("b"), from: ref("a") , offset: 1 },
      { to: ref("a"), from: { target: { kind: "camera" }, property: "x" }, scale: 2 },
    ]);
    const state = evaluateMotion(chain, 500);
    expect(state.surfaces.a.x).toBe(100);
    expect(state.surfaces.b.x).toBe(101);
    const added = motion([{ to: { target: { kind: "camera" }, property: "x" }, from: { channel: "nudge" }, mode: "add", offset: 7 }]);
    expect(evaluateMotion(added, 500).camera.x).toBe(57);
  });
  it("rejects cycles (naming them), replace conflicts, duplicate targets and deep chains", () => {
    const cycle = MotionSchema.safeParse(motion([{ to: ref("a"), from: ref("b") }, { to: ref("b"), from: ref("a") }]));
    expect(cycle.success).toBe(false);
    expect(JSON.stringify(cycle.error!.issues)).toMatch(/cycle: surface a\.x -> surface b\.x -> surface a\.x/);
    expect(MotionSchema.safeParse(motion([{ to: { target: { kind: "camera" }, property: "x" }, from: { channel: "c" } }])).success).toBe(false);
    expect(MotionSchema.safeParse(motion([{ to: ref("a"), from: { channel: "c" } }, { to: ref("a"), from: { channel: "d" } }])).success).toBe(false);
    const deep = Array.from({ length: 9 }, (_, i) => ({ to: ref(`n${i}`), from: i === 0 ? { channel: "c" } : ref(`n${i - 1}`) }));
    expect(MotionSchema.safeParse(motion(deep, [])).success).toBe(false);
    expect(MotionSchema.safeParse(motion(deep.slice(0, 8), [])).success).toBe(true);
  });
});
