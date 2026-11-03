import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blendTransition, compositeOverlay, encodePng, parsePng } from "../../src/export/compositor";
import { measureLoudness, normalizeLoudness, synthesizeSfx } from "../../src/export/services";
import { compositionSfx } from "../../src/export/commands";
import { CompositionSchema } from "../../src/core/composition";
import { SFX_PRESET_NAMES } from "../../src/core/sound";

const W = 40, H = 20;
const solid = (rgba: [number, number, number, number]) => { const pixels = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) pixels.set(rgba, i * 4); return encodePng(W, H, pixels); };
const at = (png: Buffer, x: number, y: number) => { const { pixels, width } = parsePng(png); const o = (y * width + x) * 4; return [...pixels.subarray(o, o + 4)]; };
const black = solid([0, 0, 0, 255]), white = solid([255, 255, 255, 255]), red = solid([255, 0, 0, 255]);

describe("A/B transition blends", () => {
  it("crossfade mixes in linear light and returns exact endpoints", () => {
    expect(blendTransition("crossfade", black, white, 0)).toBe(black);
    expect(blendTransition("crossfade", black, white, 1)).toBe(white);
    expect(at(blendTransition("crossfade", black, white, 0.5), 5, 5)).toEqual([188, 188, 188, 255]);
  });
  it("dips through the color at the midpoint", () => {
    expect(at(blendTransition("dip-to-black", white, red, 0.5), 3, 3)).toEqual([0, 0, 0, 255]);
    expect(at(blendTransition("dip-to-white", black, red, 0.5), 3, 3)).toEqual([255, 255, 255, 255]);
    expect(at(blendTransition("dip-to-black", white, red, 0.25), 3, 3)).toEqual([188, 188, 188, 255]);
  });
  it("wipes in the direction of travel with a feathered edge", () => {
    const right = blendTransition("wipe", black, white, 0.5, { direction: "right" });
    expect(at(right, 1, 10)[0]).toBe(255);
    expect(at(right, W - 2, 10)[0]).toBe(0);
    const left = blendTransition("wipe", black, white, 0.5, { direction: "left" });
    expect(at(left, W - 2, 10)[0]).toBe(255);
    expect(at(left, 1, 10)[0]).toBe(0);
  });
  it("opens an iris from the center and pushes A out of frame", () => {
    const iris = blendTransition("iris", black, white, 0.4);
    expect(at(iris, W / 2, H / 2)[0]).toBe(255);
    expect(at(iris, 0, 0)[0]).toBe(0);
    const push = blendTransition("push", black, white, 0.5, { direction: "right" });
    expect(at(push, 2, 10)[0]).toBe(255);
    expect(at(push, W - 3, 10)[0]).toBe(0);
  });
  it("swaps frames at the whip midpoint and keeps light leaks seeded", () => {
    expect(at(blendTransition("whip", black, white, 0.2), 20, 10)[0]).toBe(0);
    expect(at(blendTransition("whip", black, white, 0.8), 20, 10)[0]).toBe(255);
    const leak = blendTransition("light-leak", black, black, 0.5, { seed: 3 });
    expect(leak.equals(blendTransition("light-leak", black, black, 0.5, { seed: 3 }))).toBe(true);
    expect(leak.equals(blendTransition("light-leak", black, black, 0.5, { seed: 4 }))).toBe(false);
    // The seed picks the glowing edge; whichever it is, the glow is warm (red over blue).
    const edges = [at(leak, 0, 10), at(leak, W - 1, 10)];
    const glow = edges[0][0] >= edges[1][0] ? edges[0] : edges[1];
    expect(glow[0]).toBeGreaterThan(glow[2]);
    expect(() => blendTransition("spin", black, white, 0.5)).toThrow(/Unknown overlap transition/);
  });
});

describe("overlay compositing", () => {
  it("alpha-blends in order with opacity and blend modes", () => {
    const half = solid([255, 255, 255, 128]);
    expect(at(compositeOverlay(black, half), 0, 0)[0]).toBe(188);
    expect(at(compositeOverlay(black, white, 0.5), 0, 0)[0]).toBe(188);
    expect(compositeOverlay(black, white, 0)).toBe(black);
    expect(at(compositeOverlay(red, solid([0, 255, 0, 255]), 1, "screen"), 0, 0)).toEqual([255, 255, 0, 255]);
    expect(at(compositeOverlay(white, red, 1, "multiply"), 0, 0)).toEqual([255, 0, 0, 255]);
    // Later overlays sit on top.
    expect(at(compositeOverlay(compositeOverlay(black, red), solid([0, 0, 255, 255])), 0, 0)).toEqual([0, 0, 255, 255]);
  });
});

describe("sound design and loudness", () => {
  let root = "";
  beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "velora-sound-")); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  it.each(SFX_PRESET_NAMES)("%s renders identical bytes for the same seed", async preset => {
    const a = path.join(root, `${preset}-a.wav`), b = path.join(root, `${preset}-b.wav`), c = path.join(root, `${preset}-c.wav`);
    await synthesizeSfx({ preset, gainDb: -6, seed: 4 }, a);
    await synthesizeSfx({ preset, gainDb: -6, seed: 4 }, b);
    expect((await readFile(a)).equals(await readFile(b))).toBe(true);
    if (["whoosh", "swish", "riser", "impact"].includes(preset)) {
      await synthesizeSfx({ preset, gainDb: -6, seed: 5 }, c);
      expect((await readFile(a)).equals(await readFile(c))).toBe(false);
    }
  }, 30_000);
  it("normalizes a mix to the target within 1 LU", async () => {
    const file = path.join(root, "quiet.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x36:r=30:d=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6,volume=-30dB",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
    expect((await measureLoudness(file)).integrated).toBeLessThan(-30);
    const { result } = await normalizeLoudness(file, { integrated: -14, truePeak: -1, range: 11 });
    expect(Math.abs(result.integrated - -14)).toBeLessThanOrEqual(1);
    expect(Math.abs((await measureLoudness(file)).integrated - -14)).toBeLessThanOrEqual(1);
  }, 60_000);
  it("places transition sound at the cut", () => {
    const composition = CompositionSchema.parse({ version: 1, id: "c", title: "C", width: 64, height: 64, fps: 30,
      scenes: [{ id: "a", recipe: "x", startMs: 0, durationMs: 2000 }, { id: "b", recipe: "y", startMs: 1600, durationMs: 2000, transition: { type: "whip", durationMs: 400, sfx: "whoosh" } },
        { id: "c", recipe: "z", startMs: 3600, durationMs: 1000, transition: { type: "dissolve", durationMs: 300, sfx: { preset: "pop", gainDb: -12 } } }],
      sfx: [{ id: "hit", preset: "impact", atMs: 4000 }] });
    expect(compositionSfx(composition).map(entry => [entry.id, entry.preset, entry.atMs, entry.gainDb])).toEqual([
      ["transition-b", "whoosh", 1800, -6], ["transition-c", "pop", 3600, -12], ["hit", "impact", 4000, -6]]);
  });
});
