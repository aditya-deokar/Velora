import { describe, expect, it } from "vitest";
import { layersAt, timelineFromComposition, validateTimeline } from "../../src/core/timeline";
import { CompositionSchema } from "../../src/core/composition";
import { reviewComposition, pacingFor } from "../../src/core/editorial";
import { SFX_PRESETS, SFX_PRESET_NAMES, sfxGraph, sfxStartMs } from "../../src/core/sound";
import { BLUEPRINT_CATALOG, findTemplate } from "../../src/core/templates";

const timeline = (segments: object[]) => ({ version: 1, fps: 30, durationMs: 10_000, segments });
describe("overlap legality", () => {
  const a = { id: "a", recipe: "x", startMs: 0, durationMs: 3000 };
  it.each([
    ["butt join", [a, { id: "b", recipe: "y", startMs: 3000, durationMs: 2000 }], true],
    ["gap", [a, { id: "b", recipe: "y", startMs: 3500, durationMs: 2000 }], true],
    ["undeclared overlap", [a, { id: "b", recipe: "y", startMs: 2500, durationMs: 2000 }], false],
    ["entering transition overlap", [a, { id: "b", recipe: "y", startMs: 2500, durationMs: 2000, transition: { type: "dissolve", durationMs: 500 } }], false],
    ["exact crossfade window", [a, { id: "b", recipe: "y", startMs: 2500, durationMs: 2000, transition: { type: "crossfade", durationMs: 500 } }], true],
    ["window shorter than overlap", [a, { id: "b", recipe: "y", startMs: 2400, durationMs: 2000, transition: { type: "crossfade", durationMs: 500 } }], false],
    ["window longer than a shot", [a, { id: "b", recipe: "y", startMs: 1000, durationMs: 1500, transition: { type: "whip", durationMs: 2000 } }], false],
    ["three-way overlap", [a, { id: "b", recipe: "y", startMs: 2500, durationMs: 1000, transition: { type: "crossfade", durationMs: 500 } }, { id: "c", recipe: "z", startMs: 2900, durationMs: 2000, transition: { type: "crossfade", durationMs: 600 } }], false],
  ])("%s", (_name, segments, valid) => {
    const result = validateTimeline(timeline(segments as object[]));
    expect(result.valid, JSON.stringify(result.issues)).toBe(valid);
    if (!valid) expect(result.issues[0].code).toBe("ERR_TIMELINE_OVERLAP");
  });
  it("resolves both segments and eased progress inside the window, one outside it", () => {
    const t = timelineFromComposition({ fps: 30, scenes: [a, { id: "b", recipe: "y", startMs: 2500, durationMs: 2000, transition: { type: "crossfade", durationMs: 500, ease: "linear" } }] } as never);
    expect(layersAt(t, 2000).segments.map(entry => entry.segment.id)).toEqual(["a"]);
    const mid = layersAt(t, 2750);
    expect(mid.segments.map(entry => [entry.segment.id, entry.localMs])).toEqual([["a", 2750], ["b", 250]]);
    expect(mid.blend?.progress).toBeCloseTo(0.5, 6);
    expect(layersAt(t, 3200).segments.map(entry => entry.segment.id)).toEqual(["b"]);
    expect(layersAt(t, 9000).segments).toEqual([]);
  });
});

describe("sound", () => {
  it("builds seeded lavfi graphs for every preset with the gain applied", () => {
    for (const preset of SFX_PRESET_NAMES) {
      const graph = sfxGraph({ preset, gainDb: -6, seed: 9 });
      expect(graph).toContain("volume=-6dB[sfx]");
      expect(graph).toContain("sample_rates=48000");
      if (graph.includes("anoisesrc")) expect(graph).toContain(":s=9");
    }
    expect(sfxStartMs({ preset: "whoosh", atMs: 1000 })).toBe(1000 - SFX_PRESETS.whoosh.peakMs);
    expect(sfxStartMs({ preset: "riser", atMs: 500 })).toBe(0);
  });
});

describe("editorial review", () => {
  const recipe = (id: string, extra: object = {}) => ({ id, definition: { width: 1920, height: 1080, scene: { camera: { perspective: 1400 }, focus: { distance: 1400 }, nodes: [{ id: "subject" }] }, motion: { durationMs: 4000, speed: 1, tracks: [] }, ...extra } } as never);
  const moving = (id: string, from: number, to: number) => recipe(id, { motion: { durationMs: 4000, speed: 1, tracks: [{ target: { kind: "camera" }, property: "x", keyframes: [{ timeMs: 0, value: from }, { timeMs: 4000, value: to }] }] } });
  const compose = (scenes: object[], extra: object = {}) => CompositionSchema.parse({ version: 1, id: "c", title: "C", width: 1920, height: 1080, fps: 30, scenes, ...extra });
  const codes = (composition: ReturnType<typeof compose>, recipes: never[], platform?: string) => reviewComposition(composition, recipes, { ...(platform ? { platform } : {}) }).advisories.map(item => item.code);
  it("flags a late hook, a short end card and shot lengths against the platform's pacing", () => {
    const composition = compose([{ id: "s1", recipe: "still", startMs: 0, durationMs: 9000 }, { id: "s2", recipe: "still", startMs: 9000, durationMs: 1200 }]);
    const found = codes(composition, [recipe("still")], "tiktok");
    expect(found).toEqual(expect.arrayContaining(["ADV_HOOK_LATE", "ADV_ENDCARD_SHORT", "ADV_SHOT_LENGTH"]));
    expect(pacingFor("tiktok")).toEqual(pacingFor("social"));
    expect(pacingFor("linkedin")).toEqual(pacingFor("feed"));
    expect(pacingFor("linkedin").maxMs).toBeGreaterThan(pacingFor("tiktok").maxMs);
    expect(codes(compose([{ id: "s1", recipe: "move", startMs: 0, durationMs: 3000 }, { id: "s2", recipe: "move", startMs: 3000, durationMs: 3000 }]), [moving("move", 0, 200)])).not.toContain("ADV_HOOK_LATE");
  });
  it("flags camera direction flips unless a section marker sits on the cut", () => {
    const scenes = [{ id: "s1", recipe: "right", startMs: 0, durationMs: 4000 }, { id: "s2", recipe: "left", startMs: 4000, durationMs: 4000 }];
    const recipes = [moving("right", 0, 300), moving("left", 300, 0)];
    expect(codes(compose(scenes), recipes)).toContain("ADV_DIRECTION_FLIP");
    expect(codes(compose(scenes, { markers: [{ atMs: 4000, kind: "section", label: "Reveal" }] }), recipes)).not.toContain("ADV_DIRECTION_FLIP");
  });
  it("flags off-beat cuts against beat markers (overlap cuts land at the end of the window)", () => {
    const scenes = [{ id: "s1", recipe: "move", startMs: 0, durationMs: 3000 }, { id: "s2", recipe: "move", startMs: 2500, durationMs: 3000, transition: { type: "crossfade", durationMs: 500 } }, { id: "s3", recipe: "move", startMs: 5500, durationMs: 3000 }];
    const markers = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000].map(atMs => ({ atMs, kind: "beat" }));
    const review = reviewComposition(compose(scenes, { markers }), [moving("move", 0, 10)]);
    expect(review.advisories.filter(item => item.code === "ADV_OFFBEAT_CUT").map(item => item.atMs)).toEqual([5500]);
    expect(review.requiresVisualReview).toBe(true);
  });
  it("estimates reading time for template copy", () => {
    const copy = recipe("title", { });
    (copy as unknown as { template: object }).template = { id: "title-reveal", aspect: "16:9", params: { title: "one two three four five six seven eight nine ten eleven twelve", subtitle: "", durationMs: 5000 } };
    expect(codes(compose([{ id: "s1", recipe: "title", startMs: 0, durationMs: 2000 }, { id: "s2", recipe: "title", startMs: 2000, durationMs: 3000 }]), [copy])).toContain("ADV_READING_TIME");
  });
});

describe("blueprints", () => {
  it("reference real templates, supported aspects and only overlap-legal transitions", () => {
    for (const blueprint of BLUEPRINT_CATALOG) {
      for (const scene of [...blueprint.scenes, ...blueprint.overlays]) {
        const manifest = findTemplate(scene.template);
        expect(manifest, `${blueprint.id}: ${scene.template}`).toBeDefined();
        for (const aspect of blueprint.aspects) expect(manifest!.aspects).toContain(aspect);
      }
      expect(blueprint.scenes[0].transition).toBeUndefined();
    }
    expect(BLUEPRINT_CATALOG.map(entry => entry.id)).toEqual(["product-reel-20s", "website-hero-loop-8s", "launch-film-30s", "feature-drop-15s", "social-teaser-9x16", "changelog-20s", "product-hunt-kit", "app-preview-25s"]);
  });
});
