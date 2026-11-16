import { describe, expect, it } from "vitest";
import { applyEdits } from "../../src/core";
import { intentToOps } from "../../src/editor/intents";
import { trackKey } from "../../src/editor/model";

const base = () => ({ version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [{ id: "card" }] }, motion: { durationMs: 4000, speed: 1, tracks: [
  { target: { kind: "surface", id: "card" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 100 }] },
  { target: { kind: "surface", id: "card" }, property: "y", keyframes: [{ timeMs: 0, value: 5 }] }] } } });
const at = (timeMs: number, autoKey = false, armed: string[] = []) => ({ timeMs, fps: 60, autoKey, armed });
const track = (property: string, id = "card") => ({ target: { kind: "surface" as const, id }, property });
describe("intentToOps (EDITOR-UX §4)", () => {
  it("keys an animated property at the playhead, snapped to the frame grid", () => {
    expect(intentToOps({ kind: "set", track: track("x"), value: 40 }, base(), at(2004.9))).toEqual([{ op: "key.set", track: track("x"), atMs: 2000, value: 40 }]);
  });
  it("auto-key creates the track; without it a static override is written", () => {
    expect(intentToOps({ kind: "set", track: track("z"), value: 10 }, base(), at(500, true))).toEqual([{ op: "track.add", track: track("z"), keyframes: [{ timeMs: 500, value: 10 }] }]);
    expect(intentToOps({ kind: "set", track: track("z"), value: 10 }, base(), at(500))).toEqual([{ op: "track.add", track: track("z"), keyframes: [{ timeMs: 0, value: 10 }] }]);
    // An existing static override is updated in place.
    expect(intentToOps({ kind: "set", track: track("y"), value: 8 }, base(), at(900))).toEqual([{ op: "key.set", track: track("y"), atMs: 0, value: 8 }]);
    // Armed (stopwatch on) one-keyframe tracks are animated.
    expect(intentToOps({ kind: "set", track: track("y"), value: 8 }, base(), at(900, false, [trackKey(track("y"))]))).toEqual([{ op: "key.set", track: track("y"), atMs: 900, value: 8 }]);
  });
  it("writes camera and focus statics to the scene base", () => {
    expect(intentToOps({ kind: "set", track: { target: { kind: "camera" }, property: "z" }, value: 300 }, base(), at(0))).toEqual([{ op: "camera.set", property: "z", value: 300 }]);
    expect(intentToOps({ kind: "set", track: { target: { kind: "focus" }, property: "fStop" }, value: 2 }, base(), at(0))).toEqual([{ op: "focus.set", property: "fStop", value: 2 }]);
  });
  it("stopwatch on adds a keyframe with the current value; off freezes the current value", () => {
    expect(intentToOps({ kind: "stopwatch", track: track("z"), on: true, value: 7 }, base(), at(1500))).toEqual([{ op: "track.add", track: track("z"), keyframes: [{ timeMs: 1500, value: 7 }] }]);
    expect(intentToOps({ kind: "stopwatch", track: track("x"), on: false, value: 55 }, base(), at(500))).toEqual([{ op: "track.remove", track: track("x") }, { op: "track.add", track: track("x"), keyframes: [{ timeMs: 0, value: 55 }] }]);
    expect(intentToOps({ kind: "stopwatch", track: { target: { kind: "camera" }, property: "x" }, on: false, value: 1 }, base(), at(0))).toEqual([]);
  });
  it("toggles keyframes and resets tracks", () => {
    expect(intentToOps({ kind: "toggle-key", track: track("x"), value: 1 }, base(), at(1000))).toEqual([{ op: "key.remove", track: track("x"), atMs: 1000 }]);
    expect(intentToOps({ kind: "toggle-key", track: track("x"), value: 1 }, base(), at(2000))).toEqual([{ op: "key.set", track: track("x"), atMs: 2000, value: 1 }]);
    expect(intentToOps({ kind: "toggle-key", track: track("y"), value: 1 }, base(), at(0))).toEqual([{ op: "track.remove", track: track("y") }]);
    expect(intentToOps({ kind: "reset", track: track("x") }, base(), at(0))).toEqual([{ op: "track.remove", track: track("x") }]);
  });
  it("a first track on a missing surface adds its node through applyEdits", () => {
    const ops = intentToOps({ kind: "set", track: track("opacity", "title"), value: 1 }, base(), at(0, true));
    const result = applyEdits(base(), ops);
    expect(result.ok && result.recipe.definition).toMatchObject({ scene: { nodes: [{ id: "card" }, { id: "title" }] } });
  });
});
