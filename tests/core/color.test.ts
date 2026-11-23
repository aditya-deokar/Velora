import { describe, expect, it } from "vitest";
import { colorDifference, formatCssColor, mixColors, parseCssColor } from "../../src/core/color";

const print = (text: string) => {
  const parsed = parseCssColor(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return formatCssColor(parsed.color);
};
describe("parseCssColor", () => {
  it.each([
    ["#f00", "rgb(255 0 0 / 1)"], ["#ff000080", "rgb(255 0 0 / 0.502)"], ["#0f08", "rgb(0 255 0 / 0.533)"], ["#3B82F6", "rgb(59 130 246 / 1)"],
    ["rgb(59, 130, 246)", "rgb(59 130 246 / 1)"], ["rgba(59,130,246,0.5)", "rgb(59 130 246 / 0.5)"], ["rgb(59 130 246 / 25%)", "rgb(59 130 246 / 0.25)"],
    ["rgb(100% 0% 0%)", "rgb(255 0 0 / 1)"], ["hsl(120 100% 50%)", "rgb(0 255 0 / 1)"], ["hsla(240, 100%, 50%, 0.5)", "rgb(0 0 255 / 0.5)"],
    ["hsl(0.5turn 100% 50%)", "rgb(0 255 255 / 1)"], ["oklab(1 0 0)", "rgb(255 255 255 / 1)"], ["oklch(0 0 0)", "rgb(0 0 0 / 1)"],
    ["transparent", "rgb(0 0 0 / 0)"], ["  #FFF  ", "rgb(255 255 255 / 1)"],
  ])("%s -> %s", (input, expected) => expect(print(input)).toBe(expected));
  it.each(["red", "currentColor", "#ff", "#ggg", "rgb(1, 2)", "rgb(a b c)", "color(display-p3 1 0 0)", "", "hsl(0 100% 50%) extra", "rgb(1 2 3 / 4 / 5)"])("rejects %j", input => {
    const parsed = parseCssColor(input);
    expect(parsed.ok).toBe(false);
  });
  it("hints hex for named colors", () => {
    const parsed = parseCssColor("rebeccapurple");
    expect(parsed.ok === false && parsed.message).toMatch(/use hex/);
  });
});
describe("mixColors (OKLab, premultiplied)", () => {
  it("prints endpoints exactly", () => {
    for (const color of ["#3b82f6", "#ff000080", "oklch(0.7 0.15 30)"]) {
      expect(mixColors(color, "#000000", 0)).toBe(print(color));
      expect(mixColors("#000000", color, 1)).toBe(print(color));
    }
  });
  const channels = (text: string) => text.match(/[\d.]+/g)!.map(Number);
  it("matches reference OKLab midpoints (published OKLab coordinates of sRGB red and blue)", () => {
    // red = oklab(0.627955 0.224863 0.125846), blue = oklab(0.452014 -0.032457 -0.311528).
    const reference = channels(print("oklab(0.5399845 0.096203 -0.092841)"));
    channels(mixColors("#ff0000", "#0000ff", 0.5)).forEach((value, i) => expect(Math.abs(value - reference[i])).toBeLessThan(0.05));
    // Mid-gray in OKLab is L = 0.5: linear 0.125, about 99 in sRGB (sRGB-space mixing would give 127.5).
    channels(mixColors("#000000", "#ffffff", 0.5)).slice(0, 3).forEach(value => expect(value).toBeCloseTo(99.08, 0));
    // Determinism snapshot of the canonical string.
    expect(mixColors("#ff0000", "#0000ff", 0.5)).toBe("rgb(140.362 83.033 162.308 / 1)");
  });
  it("premultiplies alpha: white to transparent stays white while fading", () => {
    expect(mixColors("#ffffff", "transparent", 0.5)).toBe("rgb(255 255 255 / 0.5)");
    expect(mixColors("transparent", "transparent", 0.5)).toBe("rgb(0 0 0 / 0)");
  });
  it("is deterministic, locale-free and never prints -0 or exponents", () => {
    const results = new Set(Array.from({ length: 5 }, () => mixColors("#123456", "oklch(0.9 0.2 120)", 0.37)));
    expect(results.size).toBe(1);
    for (let t = 0; t <= 1; t += 0.05) expect(mixColors("#000", "#010101", t)).toMatch(/^rgb\((?:\d+(?:\.\d{1,3})? ){3}\/ (?:\d+(?:\.\d{1,3})?)\)$/);
  });
  it("gamut-clamps out-of-sRGB oklch", () => expect(print("oklch(0.7 0.4 150)")).toMatch(/^rgb\(/));
  it("measures differences in 0..255 units", () => {
    expect(colorDifference("#000", "#000")).toBe(0);
    expect(colorDifference("#000", "#fff")).toBeCloseTo(255, 6);
  });
});
