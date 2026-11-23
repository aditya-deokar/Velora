import { describe, expect, it } from "vitest";
import { evaluateMotion, staggerOffsets, type MotionInput } from "../../src/core/motion";
import { createCascadeClip, createCascadeTracks } from "../../src/core/choreography";

const members = ["a", "b", "c", "d", "e"];
describe("stagger clips", () => {
  const offsets = (order: unknown, ease?: string) => staggerOffsets({ members, stagger: { eachMs: 100, order: order as never, ...(ease ? { ease: ease as never } : {}) } });
  it("orders forward, reverse, center-out and edges-in", () => {
    expect(offsets("forward")).toEqual([0, 100, 200, 300, 400]);
    expect(offsets("reverse")).toEqual([400, 300, 200, 100, 0]);
    expect(offsets("center-out")).toEqual([400, 200, 0, 200, 400]);
    expect(offsets("edges-in")).toEqual([0, 200, 400, 200, 0]);
  });
  it("shuffles deterministically for a random seed", () => {
    const first = offsets({ random: 42 });
    expect(offsets({ random: 42 })).toEqual(first);
    expect([...first].sort((a, b) => a - b)).toEqual([0, 100, 200, 300, 400]);
    expect(offsets({ random: 7 })).not.toEqual(first);
  });
  it("eases the distribution", () => {
    const eased = offsets("forward", "quad.in");
    expect(eased).toEqual([0, 25, 100, 225, 400]);
  });
  it("offsets each member's copy of the $member tracks in time", () => {
    const input = { durationMs: 2000, speed: 1, tracks: [], clips: [{ id: "s", startMs: 0, members: ["a", "b"], stagger: { eachMs: 300 },
      tracks: [{ target: { kind: "surface", id: "$member" }, property: "opacity", keyframes: [{ timeMs: 0, value: 0, easing: "linear" }, { timeMs: 600, value: 1 }] }] }] } as MotionInput;
    const state = evaluateMotion(input, 450);
    expect(state.surfaces.a.opacity).toBeCloseTo(0.75, 12);
    expect(state.surfaces.b.opacity).toBeCloseTo(0.25, 12);
  });
  it("createCascadeClip evaluates equal to createCascadeTracks", () => {
    for (const cascade of [
      { items: members.map(id => ({ id })), depthStep: 0 },
      { items: members.map(id => ({ id })) },
      { items: [{ id: "a", atMs: 50 }, { id: "b" }] },
      { items: members.map(id => ({ id })), cascade: false },
    ]) {
      const tracks = { durationMs: 4000, speed: 1, tracks: createCascadeTracks(cascade) } as MotionInput;
      const clip = { durationMs: 4000, speed: 1, tracks: [], clips: [createCascadeClip(cascade)] } as MotionInput;
      for (let t = 0; t <= 4000; t += 37) {
        const a = evaluateMotion(tracks, t), b = evaluateMotion(clip, t);
        expect(b.issues).toEqual([]);
        for (const id of Object.keys(a.surfaces)) expect(b.surfaces[id].z).toBeCloseTo(a.surfaces[id].z!, 9);
      }
    }
    expect(createCascadeClip({ items: members.map(id => ({ id })), depthStep: 0 }).members).toEqual(members);
  });
});
