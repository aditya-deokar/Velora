import { describe, expect, it } from "vitest";
import { detectForbiddenClock, gsapToVelora, mapGsapEasing } from "../../src/core/gsap";

describe("GSAP easing map", () => {
  it("maps every pure GSAP ease losslessly and rejects only plugin or parameterized eases", () => {
    expect(mapGsapEasing("linear")).toEqual({ easing: "linear" });
    expect(mapGsapEasing("none")).toEqual({ easing: "linear" });
    expect(mapGsapEasing("power2.inOut")).toEqual({ easing: "cubic.inOut" });
    expect(mapGsapEasing("power1")).toEqual({ easing: "quad.out" });
    expect(mapGsapEasing("power4.in")).toEqual({ easing: "quint.in" });
    expect(mapGsapEasing("expo.out")).toEqual({ easing: "expo.out" });
    expect(mapGsapEasing("elastic.out")).toEqual({ easing: "elastic.out" });
    expect(mapGsapEasing("back.inOut")).toEqual({ easing: "back.inOut" });
    expect(mapGsapEasing("bounce")).toEqual({ easing: "bounce.out" });
    expect(mapGsapEasing("steps(4)")).toEqual({ easing: { steps: 4, jump: "end" } });
    for (const ease of ["rough", "slow(0.7, 0.7)", "back.out(3)", "expoScale(0.5,3)", "custom"]) {
      const mapped = mapGsapEasing(ease);
      expect("issue" in mapped).toBe(true);
    }
  });
});
describe("gsapToVelora", () => {
  it("converts seconds-based tweens to millisecond motion tracks", () => {
    const converted = gsapToVelora([
      { target: "hero", property: "y", from: 120, to: 0, at: 0.5, dur: 1.5, ease: "power2.out" },
      { target: "hero", property: "opacity", from: 0, to: 1, at: 0.5, dur: 1.5 },
    ]);
    expect("tracks" in converted).toBe(true);
    if (!("tracks" in converted)) throw new Error("unreachable");
    expect(converted.tracks).toHaveLength(2);
    expect(converted.tracks[0].keyframes).toMatchObject([{ timeMs: 500, value: 120 }, { timeMs: 2000, value: 0 }]);
    // GSAP's default ease is power1.out, which is the quadratic out curve.
    expect(converted.tracks[1].keyframes[0].easing).toBe("quad.out");
  });
  it("rejects unknown properties, bad times and unmapped easings with codes", () => {
    const badProp = gsapToVelora([{ target: "a", property: "rotation", from: 0, to: 90, at: 0, dur: 1 }]);
    expect("issues" in badProp && badProp.issues[0].code).toBe("ERR_ANIMATION_CLOCK");
    const badEase = gsapToVelora([{ target: "a", property: "x", from: 0, to: 1, at: 0, dur: 1, ease: "rough" }]);
    expect("issues" in badEase && badEase.issues[0].path).toBe("gsap.0.ease");
    const empty = gsapToVelora([]);
    expect("issues" in empty).toBe(true);
  });
});
describe("detectForbiddenClock", () => {
  it("flags ScrollTrigger, tickers and rAF loops with line numbers", () => {
    const source = [
      "import { gsap } from 'gsap';",
      "import { ScrollTrigger } from 'gsap/ScrollTrigger';",
      "gsap.ticker.add(update);",
      "function loop() { requestAnimationFrame(loop); }",
      "const x = 1;",
    ].join("\n");
    expect(detectForbiddenClock(source)).toEqual([
      { kind: "scrolltrigger", line: 2 },
      { kind: "ticker", line: 3 },
      { kind: "raf-loop", line: 4 },
    ]);
  });
  it("passes time-driven sources", () => {
    expect(detectForbiddenClock("import { Surface } from '@adityadeokar/velora';\nexport default function S() { return null; }")).toEqual([]);
  });
});
