import { describe, expect, it } from "vitest";
import { composite, encodePng, linearToSrgb, parsePng, srgbToLinear, voidPng } from "../../src/export/compositor";
import { finishFrame } from "../../src/export/commands";

const solid = (width: number, height: number, rgba: [number, number, number, number]) => {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set(rgba, i * 4);
  return encodePng(width, height, pixels);
};
const pixel = (png: Buffer, x = 0, y = 0) => { const { pixels, width } = parsePng(png); const o = (y * width + x) * 4; return [...pixels.subarray(o, o + 4)]; };

describe("sRGB transfer", () => {
  it("round-trips every 8-bit level exactly", () => {
    for (let v = 0; v < 256; v++) expect(linearToSrgb(srgbToLinear(v))).toBe(v);
  });
});

describe("linear-light compositing", () => {
  it("averages black and white to linear mid-grey (188), not sRGB mid-grey (128)", () => {
    const out = composite([solid(2, 2, [0, 0, 0, 255]), solid(2, 2, [255, 255, 255, 255])]);
    expect(pixel(out)).toEqual([188, 188, 188, 255]);
  });
  it("returns a single frame's bytes unchanged and keeps identical frames identical", () => {
    const frame = solid(4, 2, [12, 200, 77, 255]);
    expect(composite([frame])).toBe(frame);
    expect(pixel(composite([frame, frame, frame]))).toEqual([12, 200, 77, 255]);
  });
  it("box-downscales 2x2 blocks in linear light", () => {
    const pixels = Buffer.alloc(4 * 2 * 4);
    // Left block: black/white checker; right block: solid red.
    const set = (x: number, y: number, rgba: number[]) => pixels.set(rgba, (y * 4 + x) * 4);
    set(0, 0, [0, 0, 0, 255]); set(1, 0, [255, 255, 255, 255]); set(0, 1, [255, 255, 255, 255]); set(1, 1, [0, 0, 0, 255]);
    for (const [x, y] of [[2, 0], [3, 0], [2, 1], [3, 1]]) set(x, y, [255, 0, 0, 255]);
    const out = composite([encodePng(4, 2, pixels)], 2);
    expect(parsePng(out).width).toBe(2);
    expect(pixel(out, 0)).toEqual([188, 188, 188, 255]);
    expect(pixel(out, 1)).toEqual([255, 0, 0, 255]);
  });
  it("uses premultiplied alpha so transparent samples do not darken color", () => {
    const out = composite([solid(1, 1, [255, 0, 0, 255]), solid(1, 1, [0, 0, 0, 0])]);
    expect(pixel(out)).toEqual([255, 0, 0, 128]);
    expect(parsePng(voidPng(2, 2, true)).pixels[3]).toBe(0);
  });
  it("rejects mismatched sizes and non-integer factors", () => {
    expect(() => composite([solid(2, 2, [0, 0, 0, 255]), solid(4, 2, [0, 0, 0, 255])])).toThrow(/share one frame size/);
    expect(() => composite([solid(3, 3, [0, 0, 0, 255])], 2)).toThrow(/not divisible/);
  });
});

describe("finishFrame", () => {
  const finishing = { motionBlur: 180, motionSamples: 4, supersample: 1 };
  it("samples a trailing shutter and averages distinct sub-frames", async () => {
    const times: number[] = [];
    const result = await finishFrame(100, 50, 1000, finishing, async time => { times.push(time); return time < 104 ? solid(1, 1, [0, 0, 0, 255]) : solid(1, 1, [255, 255, 255, 255]); });
    // 180 degrees at 50 fps opens for 10 ms: samples at 1.25, 3.75, 6.25 and 8.75 ms after the frame.
    expect(times).toEqual([101.25, 103.75, 106.25, 108.75]);
    expect(result.subFrames).toHaveLength(4);
    expect(pixel(result.png)).toEqual([188, 188, 188, 255]);
  });
  it("skips averaging when every sub-frame is identical (byte-identical to no blur)", async () => {
    const still = solid(2, 2, [40, 90, 160, 255]);
    const result = await finishFrame(0, 30, 1000, finishing, async () => Buffer.from(still));
    expect(result.subFrames).toBeUndefined();
    expect(result.png.equals(still)).toBe(true);
  });
  it("clamps sub-frames at the scene end and captures once without blur", async () => {
    const times: number[] = [];
    await finishFrame(998, 30, 1000, finishing, async time => { times.push(time); return solid(1, 1, [0, 0, 0, 255]); });
    expect(Math.max(...times)).toBe(1000);
    times.length = 0;
    await finishFrame(500, 30, 1000, { motionBlur: 0, motionSamples: 0, supersample: 1 }, async time => { times.push(time); return solid(1, 1, [0, 0, 0, 255]); });
    expect(times).toEqual([500]);
  });
});
