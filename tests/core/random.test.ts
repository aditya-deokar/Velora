import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRng, hashSeed, rngInt, rngPick, rngRange } from "../../src/core/random";

describe("deterministic random", () => {
  it("replays the same sequence from the same seed", () => {
    const first = createRng(42);
    const second = createRng(42);
    const a = Array.from({ length: 100 }, () => first());
    const b = Array.from({ length: 100 }, () => second());
    expect(a).toEqual(b);
    for (const value of a) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of a) expect(value).toBeLessThan(1);
  });
  it("diverges across seeds and stays inside helper bounds", () => {
    const a = Array.from({ length: 50 }, () => createRng(1)());
    const b = Array.from({ length: 50 }, () => createRng(2)());
    expect(a).not.toEqual(b);
    const rng = createRng(7);
    for (let i = 0; i < 200; i++) {
      expect(rngRange(rng, -5, 5)).toBeGreaterThanOrEqual(-5);
      expect(rngInt(rng, 0, 10)).toBeLessThanOrEqual(10);
    }
    expect(rngPick(createRng(3), ["only"])).toBe("only");
    expect(() => rngPick(createRng(3), [])).toThrow();
  });
  it("hashes strings to stable 32-bit seeds", () => {
    expect(hashSeed("launch-teaser")).toBe(hashSeed("launch-teaser"));
    expect(hashSeed("launch-teaser")).not.toBe(hashSeed("launch-teaser!"));
    expect(hashSeed("x")).toBeGreaterThanOrEqual(0);
  });
  it("never touches Math.random, Date.now or layout reads in the render path", () => {
    const spy = vi.spyOn(Math, "random");
    const rng = createRng(9);
    for (let i = 0; i < 20; i++) { rng(); rngRange(rng, 0, 1); rngInt(rng, 0, 5); }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    for (const file of ["src/core/random.ts", "src/core/timeline.ts", "src/core/motion.ts", "src/core/spatial.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/Math\.random/);
      expect(text, file).not.toMatch(/Date\.now/);
      expect(text, file).not.toMatch(/performance\.now/);
    }
  });
});
