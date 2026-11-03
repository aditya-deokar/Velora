import { describe, expect, it } from "vitest";
import { TEMPLATE_CATALOG, BLUEPRINT_CATALOG, TemplateManifestSchema, certifyTemplate, findTemplate, resolveTemplateParams, templateDefinition } from "../../src/core/templates";
import { ASPECT_FRAMES, buildShot, framingReport } from "../../src/core/shots";
import { presentPreview } from "../../src/core/preview";
import { compositePreview } from "../../src/core/composites";
import { evaluateMotion, loopSeam } from "../../src/core/motion";

// Craft certification: every template x every declared aspect x every intensity yields a valid,
// deterministic scene that keeps its subject framed, clear of the camera plane, and in focus at the end.
const intensities = ["subtle", "standard", "dramatic"];
// Templates without an intensity param (motion graphics) certify once per aspect.
const configurations = TEMPLATE_CATALOG.flatMap(manifest => manifest.aspects.flatMap(aspect =>
  (manifest.params.some(param => param.name === "intensity") ? intensities : [undefined]).map(intensity => ({ manifest, aspect, intensity }))));

describe("template catalog", () => {
  it("ships Wave 1 camera and Wave 2 layered / motion-graphics templates with unique IDs, valid manifests and real pairings", () => {
    expect(TEMPLATE_CATALOG.map(t => t.id)).toEqual(["hero-push", "monumental-survey", "orbit-reveal", "crane-down", "tilt-up-reveal", "dolly-zoom", "rack-focus", "scroll-through", "macro-detail", "float-loop", "handheld-push", "whip-pan",
      "exploded-stack", "parallax-planes", "cascade-build", "floating-focus", "device-showcase", "cursor-demo", "split-compare", "screen-wall",
      "title-reveal", "logo-sting", "kinetic-statement", "stat-counter", "feature-trio", "lower-third", "quote-card", "end-card", "countdown", "changelog-card"]);
    expect(TEMPLATE_CATALOG.filter(t => t.category === "layered")).toHaveLength(8);
    expect(TEMPLATE_CATALOG.filter(t => t.category === "motion-graphics")).toHaveLength(10);
    const ids = new Set(TEMPLATE_CATALOG.map(t => t.id));
    for (const manifest of TEMPLATE_CATALOG) {
      expect(TemplateManifestSchema.safeParse(manifest).success).toBe(true);
      for (const partner of manifest.craft.pairsWith) if (!["kinetic-statement"].includes(partner)) expect(ids.has(partner), `${manifest.id} pairs with ${partner}`).toBe(true);
      expect(`${manifest.id} ${manifest.title} ${manifest.craft.lineage}`).not.toMatch(/Hitchcock|Spielberg|Deakins|Lubezki|Fincher|Kubrick|Anderson|Villeneuve/);
    }
  });
  it.each(configurations.map(c => [`${c.manifest.id} ${c.aspect} ${c.intensity}`, c] as const))("%s certifies", (_label, { manifest, aspect, intensity }) => {
    const resolved = resolveTemplateParams(manifest, intensity ? { intensity } : {});
    expect(resolved.issues).toEqual([]);
    const definition = templateDefinition(manifest, resolved.params, aspect);
    const preview = presentPreview(compositePreview(definition));
    expect(preview.valid, JSON.stringify(!preview.valid && preview.issues)).toBe(true);
    expect(certifyTemplate(manifest, resolved.params, aspect)).toEqual([]);
    expect(JSON.stringify(templateDefinition(manifest, resolved.params, aspect))).toBe(JSON.stringify(definition));
  });
  it("blueprints reference real templates and supported aspects", () => {
    for (const blueprint of BLUEPRINT_CATALOG)
      for (const scene of blueprint.scenes) {
        const manifest = findTemplate(scene.template)!;
        expect(manifest, scene.template).toBeDefined();
        expect(resolveTemplateParams(manifest, scene.params).issues).toEqual([]);
        for (const aspect of blueprint.aspects) expect(manifest.aspects).toContain(aspect);
      }
  });
});

describe("template params", () => {
  const hero = findTemplate("hero-push")!;
  it("coerces CLI strings and regions and fills defaults", () => {
    const { params, issues } = resolveTemplateParams(hero, { lens: "35", focusRegion: "100, 80, 400, 200" });
    expect(issues).toEqual([]);
    expect(params).toEqual({ intensity: "subtle", lens: 35, durationMs: 6000, focusRegion: { x: 100, y: 80, width: 400, height: 200 } });
  });
  it("rejects unknown params, out-of-range numbers, bad enums and malformed regions", () => {
    const { issues } = resolveTemplateParams(hero, { tilt: 5, lens: "400", intensity: "wild", focusRegion: "1,2,3" });
    expect(issues.map(issue => issue.path).sort()).toEqual(["params.focusRegion", "params.intensity", "params.lens", "params.tilt"]);
    expect(issues.every(issue => issue.code === "ERR_TEMPLATE_PARAM")).toBe(true);
  });
});

describe("shot behavior", () => {
  const subject = ASPECT_FRAMES["16:9"].subject;
  it("float-loop is seamless and dolly-zoom holds the subject size", () => {
    const loop = buildShot({ kind: "float-loop" });
    expect(loop.motion.loop).toBe(true);
    expect(loopSeam(loop.motion)).toBe(0);
    const dolly = buildShot({ kind: "dolly-zoom", intensity: "dramatic" });
    const start = evaluateMotion(dolly.motion, 0).camera.perspective!, end = evaluateMotion(dolly.motion, dolly.motion.durationMs).camera.perspective!;
    expect(end).toBeLessThan(start * 0.6);
    expect(dolly.scene.camera.z).toBe(0);
  });
  it("rack-focus starts soft on the target and ends sharp; push-in ends sharp on its region", () => {
    const rack = framingReport(buildShot({ kind: "rack-focus" }), subject, { focusRegion: { x: 576, y: 135, width: 288, height: 90 } });
    expect(rack.samples[0].regionBlur).toBeGreaterThan(2);
    expect(rack.samples[rack.samples.length - 1].regionBlur).toBeLessThan(0.5);
    const region = { x: 900, y: 120, width: 300, height: 160 };
    const push = framingReport(buildShot({ kind: "push-in", focusRegion: region }), subject, { focusRegion: region });
    expect(push.samples[push.samples.length - 1].regionBlur).toBeLessThan(0.5);
  });
  it("whip lands on the subject and scroll-through drives the scroll channel", () => {
    const whip = framingReport(buildShot({ kind: "whip" }), subject);
    expect(whip.samples[0].subjectVisible).toBe(0);
    expect(whip.samples[whip.samples.length - 1].subjectVisible).toBe(1);
    const scroll = buildShot({ kind: "scroll-through", scrollDistance: 3000 });
    expect(evaluateMotion(scroll.motion, scroll.motion.durationMs).channels["subject-scroll"]).toBe(3000);
  });
});
