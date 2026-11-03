import { describe, expect, it } from "vitest";
import { applyLut, encodePng, finishLook, parsePng } from "../../src/export/compositor";
import { finishFrame } from "../../src/export/commands";
import { parseCube, resolveLook } from "../../src/core/looks";

const image = (width: number, height: number, paint: (x: number, y: number) => [number, number, number]) => {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([...paint(x, y), 255], (y * width + x) * 4);
  return encodePng(width, height, pixels);
};
const at = (png: Buffer, x: number, y: number) => { const { pixels, width } = parsePng(png); const o = (y * width + x) * 4; return [...pixels.subarray(o, o + 3)]; };
// A white dot in the middle of a dark frame.
const dot = () => image(64, 64, (x, y) => Math.hypot(x - 32, y - 32) < 3 ? [255, 255, 255] : [20, 20, 20]);
const identityCube = (size = 2) => {
  const rows: string[] = [];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) rows.push(`${r / (size - 1)} ${g / (size - 1)} ${b / (size - 1)}`);
  return parseCube(`LUT_3D_SIZE ${size}\n${rows.join("\n")}`);
};

describe("export finishing", () => {
  it("returns the frame bytes unchanged when the look has no export finishing", () => {
    const frame = dot();
    expect(finishLook(frame, resolveLook({ preset: "noir" }))).toBe(frame);
    expect(finishLook(frame, undefined)).toBe(frame);
  });
  it("blooms highlights into their surroundings without touching far pixels", () => {
    const bloomed = finishLook(dot(), resolveLook({ bloom: { intensity: 1, threshold: 0.5, radius: 9 } }));
    expect(at(bloomed, 37, 32)[0]).toBeGreaterThan(at(dot(), 37, 32)[0]);
    expect(at(bloomed, 2, 2)).toEqual(at(dot(), 2, 2));
  });
  it("tints halation warm (red over blue)", () => {
    const glowing = finishLook(dot(), resolveLook({ halation: { amount: 1, radius: 9 } }));
    const [r, , b] = at(glowing, 36, 32);
    expect(r).toBeGreaterThan(b);
  });
  it("splits channels radially for chromatic aberration and leaves the center aligned", () => {
    const ring = image(64, 64, x => x === 56 ? [255, 255, 255] : [0, 0, 0]);
    const shifted = finishLook(ring, resolveLook({ chromaticAberration: 6 }));
    const red = [...Array(64).keys()].filter(x => at(shifted, x, 32)[0] > 128), blue = [...Array(64).keys()].filter(x => at(shifted, x, 32)[2] > 128);
    expect(red[0]).not.toBe(blue[0]);
  });
  it("sharpens an edge (overshoot on the bright side)", () => {
    const edge = image(32, 8, x => x < 16 ? [60, 60, 60] : [180, 180, 180]);
    expect(at(finishLook(edge, resolveLook({ sharpen: 1.5 })), 16, 4)[0]).toBeGreaterThan(180);
  });
  it("maps colors through an identity LUT unchanged and through a swap LUT exactly", () => {
    const frame = image(8, 8, (x, y) => [x * 30, y * 30, 100]);
    expect(parsePng(finishLook(frame, resolveLook({}), identityCube(17))).pixels.equals(parsePng(frame).pixels)).toBe(true);
    const rows: string[] = [];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${b} ${g} ${r}`);
    expect(applyLut(parseCube(`LUT_3D_SIZE 2\n${rows.join("\n")}`), 1, 0.5, 0)).toEqual([0, 0.5, 1]);
  });
  it("is applied by finishFrame after compositing, so stills match video frames", async () => {
    const look = resolveLook({ bloom: { intensity: 0.8, threshold: 0.5, radius: 6 } });
    const viaFrame = await finishFrame(0, 30, 1000, { motionBlur: 0, motionSamples: 0, supersample: 1 }, async () => dot(), { look });
    expect(viaFrame.png.equals(finishLook(dot(), look))).toBe(true);
  });
});
