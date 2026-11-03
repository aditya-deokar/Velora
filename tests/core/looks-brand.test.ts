import { describe, expect, it } from "vitest";
import { LOOK_PRESETS, LookSchema, gradeColorMatrix, gradeTransferTable, grainOffset, hasBrowserLook, hasExportFinishing, parseCube, resolveLook } from "../../src/core/looks";
import { BrandSchema, DEFAULT_BRAND, MOTION_PERSONALITIES, brandTokensFromCss, completeBrandColors, contrastRatio } from "../../src/core/brand";
import { FLASH_LIMIT_PER_SECOND, bandingScore, flashRisk } from "../../src/core/safety";
import { buildComposite, parseStat, readingTimeMs, COMPOSITE_IDS } from "../../src/core/composites";
import { EasingSchema } from "../../src/core/easing";

describe("looks", () => {
  it("validates every preset and merges explicit fields over the preset", () => {
    for (const preset of Object.keys(LOOK_PRESETS)) expect(LookSchema.safeParse({ preset }).success, preset).toBe(true);
    const film = resolveLook({ preset: "film", grade: { contrast: 0.3 }, vignette: { amount: 0.1 } })!;
    expect(film.grade).toMatchObject({ contrast: 0.3, temperature: 0.12, lift: 0.03 });
    expect(film.vignette).toEqual({ amount: 0.1, softness: 0.5 });
    expect(film.grain).toEqual({ amount: 0.12, size: 1.2 });
    expect(hasBrowserLook(resolveLook({ preset: "clean" }))).toBe(false);
    expect(hasExportFinishing(resolveLook({ preset: "neon" }))).toBe(true);
    expect(hasExportFinishing(resolveLook({ preset: "noir" }))).toBe(false);
    expect(LookSchema.safeParse({ lut: "grade.png" }).success).toBe(false);
  });
  it("builds an identity matrix for a neutral grade and a luma matrix for full desaturation", () => {
    expect(gradeColorMatrix({})).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    const grey = gradeColorMatrix({ saturation: -1 });
    expect(grey.slice(0, 3)).toEqual(grey.slice(5, 8));
    expect(grey.slice(0, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(gradeColorMatrix({ contrast: 0.2 })[4]).toBeCloseTo(-0.1, 6);
  });
  it("tabulates lift, gamma and gain", () => {
    expect(gradeTransferTable(0, 1, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(gradeTransferTable(0.1, 1, 1, 3)[0]).toBeCloseTo(0.1, 5);
    expect(gradeTransferTable(0, 1, 0.5, 3).at(-1)).toBe(0.5);
  });
  it("offsets grain deterministically per seed and frame", () => {
    expect(grainOffset(3, 10)).toEqual(grainOffset(3, 10));
    expect(grainOffset(3, 10)).not.toEqual(grainOffset(3, 11));
    expect(grainOffset(4, 10)).not.toEqual(grainOffset(3, 10));
  });
  it("parses .cube LUTs and rejects malformed ones", () => {
    const rows: string[] = [];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${r} ${g} ${b}`);
    const lut = parseCube(`TITLE "id"\n# comment\nLUT_3D_SIZE 2\n${rows.join("\n")}\n`);
    expect(lut.size).toBe(2);
    expect([...lut.table.slice(3, 6)]).toEqual([1, 0, 0]);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n")).toThrow(/Expected 8 RGB rows/);
    expect(() => parseCube("LUT_1D_SIZE 4\n")).toThrow(/1D/);
  });
});

describe("brand", () => {
  it("fills defaults and maps every personality to a valid easing", () => {
    expect(DEFAULT_BRAND).toMatchObject({ version: 1, motion: "calm", radius: 16, colors: { accent: "#7c5cff" } });
    for (const personality of Object.values(MOTION_PERSONALITIES)) expect(EasingSchema.safeParse(personality.easing).success).toBe(true);
    expect(BrandSchema.safeParse({ version: 1, name: "X", colors: { accent: "url(evil)" } }).success).toBe(false);
  });
  it("seeds tokens from CSS custom properties without evaluating anything", () => {
    const tokens = brandTokensFromCss(`/* --color-primary: red; */
      :root { --background: 222 47% 11%; --color-primary: #ff6600; --accent: oklch(70% 0.2 300); --font-sans: "Inter", sans-serif; --radius: 0.75rem; --text: var(--x); }
      .dark { --color-primary: #000; }`);
    expect(tokens.colors).toEqual({ background: "hsl(222 47% 11%)", primary: "#ff6600", accent: "oklch(70% 0.2 300)" });
    expect(tokens.fonts).toEqual({ display: '"Inter", sans-serif', body: '"Inter", sans-serif' });
    expect(tokens.radius).toBe(12);
    expect(BrandSchema.safeParse({ version: 1, name: "Seeded", colors: tokens.colors, fonts: tokens.fonts, radius: tokens.radius }).success).toBe(true);
  });
});

describe("brand palette completion", () => {
  it("fills a light palette for light backgrounds and keeps seeded values", () => {
    const light = completeBrandColors({ background: "#fff", accent: "#aa3bff", text: "#6b6375" });
    expect(light).toMatchObject({ background: "#fff", accent: "#aa3bff", text: "#6b6375", primary: "#6b6375", surface: "#f4f4f6" });
    expect(completeBrandColors({}).surface).toBe("#17171c");
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777", "#888")).toBeLessThan(1.5);
    expect(contrastRatio("oklch(50% 0 0)", "#fff")).toBeUndefined();
  });
});

describe("flash safety and banding", () => {
  const frames = (fps: number, seconds: number, value: (timeMs: number) => [number, number, number]) =>
    Array.from({ length: fps * seconds }, (_, i) => { const timeMs = (i * 1000) / fps; const rgb = Buffer.alloc(64 * 3); for (let c = 0; c < 64; c++) rgb.set(value(timeMs), c * 3); return { timeMs, rgb }; });
  it("fails a full-frame 4 Hz strobe and passes a slow fade", () => {
    const strobe = flashRisk(frames(30, 2, t => Math.floor(t / 125) % 2 ? [255, 255, 255] : [0, 0, 0]), 64);
    expect(strobe.pass).toBe(false);
    expect(strobe.worst).toBeGreaterThan(FLASH_LIMIT_PER_SECOND);
    expect(strobe.kind).toBe("general");
    const fade = flashRisk(frames(30, 3, t => { const v = Math.round(255 * Math.min(1, t / 3000)); return [v, v, v]; }), 64);
    expect(fade.pass).toBe(true);
    expect(fade.worst).toBe(0);
  });
  it("ignores a strobe that covers a small area and catches saturated red flashes", () => {
    const small = Array.from({ length: 60 }, (_, i) => { const rgb = Buffer.alloc(64 * 3, 30); if (Math.floor(i / 4) % 2) rgb.set([255, 255, 255], 0); return { timeMs: (i * 1000) / 30, rgb }; });
    expect(flashRisk(small, 64).pass).toBe(true);
    const red = flashRisk(frames(30, 2, t => Math.floor(t / 125) % 2 ? [255, 0, 0] : [40, 0, 0]), 64);
    expect(red.pass).toBe(false);
  });
  it("scores smooth 8-bit gradients as banding-prone and noise as clean", () => {
    const width = 512, height = 64;
    const gradient = Buffer.alloc(width * height * 4);
    const noise = Buffer.alloc(width * height * 4);
    let seed = 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const v = 40 + Math.floor((x / width) * 12), o = (y * width + x) * 4;
      gradient.set([v, v, v, 255], o);
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = seed % 256; noise.set([n, n, n, 255], o);
    }
    expect(bandingScore(gradient, width, height)).toBeGreaterThan(0.5);
    expect(bandingScore(noise, width, height)).toBeLessThan(0.05);
  });
});

describe("composites", () => {
  it("builds every Wave 2 layout with nodes matching its surfaces", () => {
    for (const id of COMPOSITE_IDS) for (const aspect of ["16:9", "9:16"] as const) {
      const built = buildComposite(id, aspect, {});
      expect(built.scene.nodes.map(node => node.id).sort(), id).toEqual(built.layout.map(node => node.id).sort());
      expect(built.layout.some(node => node.id === built.primary), id).toBe(true);
    }
  });
  it("parses stats and estimates reading time", () => {
    expect(parseStat("$1.2M ARR")).toEqual({ prefix: "$", value: 1.2, suffix: "M", label: "ARR", decimals: 1 });
    expect(parseStat("12,480 users")).toEqual({ prefix: "", value: 12480, suffix: "users", label: "", decimals: 0 });
    expect(parseStat("98% uptime")).toMatchObject({ value: 98, suffix: "%", label: "uptime" });
    expect(readingTimeMs(["three short words", ""])).toBe(1900);
    expect(readingTimeMs([])).toBe(0);
  });
});
