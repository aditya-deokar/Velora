import { describe, expect, it } from "vitest";
import { ASPECT_FRAMES, TEMPLATE_CATALOG, decodeBase64Url, encodeBase64Url, projectSubject, quickShotCommands, quickShotQuery, readQuickShot, templateDefinition, resolveTemplateParams, type QuickShotState } from "../../src/core";

const query = (state: QuickShotState) => new URLSearchParams(quickShotQuery(state));

describe("base64url", () => {
  it("round-trips ASCII, unicode and every padding length", () => {
    for (const text of ["", "a", "ab", "abc", '{"lens":85}', "héllo → 世界 🎬"]) {
      const encoded = encodeBase64Url(text);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(decodeBase64Url(encoded)).toBe(text);
    }
    expect(encodeBase64Url("hello")).toBe(Buffer.from("hello").toString("base64url"));
    expect(decodeBase64Url("not base64!")).toBeUndefined();
  });
});

describe("quick-shot URL contract", () => {
  it("round-trips template, route, aspect and params into the same definition the CLI scaffolds", () => {
    const state: QuickShotState = { template: "hero-push", route: "/pricing", aspect: "9:16", overrides: { intensity: "standard", lens: 35 } };
    const shot = readQuickShot(query(state))!;
    expect(shot.issues).toEqual([]);
    expect({ template: shot.template, route: shot.route, aspect: shot.aspect, overrides: shot.overrides }).toEqual(state);
    const manifest = TEMPLATE_CATALOG.find(entry => entry.id === "hero-push")!;
    expect(shot.definition).toEqual(templateDefinition(manifest, resolveTemplateParams(manifest, state.overrides).params, "9:16"));
    expect(shot.definition!.width).toBe(ASPECT_FRAMES["9:16"].width);
  });
  it("omits defaults from the URL and ignores unrelated params", () => {
    expect(quickShotQuery({ template: "orbit-reveal", aspect: "16:9", overrides: {} })).toEqual({ "velora-quick": "orbit-reveal" });
    expect(readQuickShot(new URLSearchParams("velora-preview=1&utm=x"))).toBeUndefined();
  });
  it("reports invalid params, aspects, routes and templates instead of throwing", () => {
    const codes = (search: string) => readQuickShot(new URLSearchParams(search))!.issues.map(issue => issue.code);
    expect(codes(new URLSearchParams(quickShotQuery({ template: "hero-push", aspect: "16:9", overrides: { lens: 500 } })).toString())).toEqual(["ERR_TEMPLATE_PARAM"]);
    expect(codes(new URLSearchParams(quickShotQuery({ template: "hero-push", aspect: "16:9", overrides: { nope: 1 } })).toString())).toEqual(["ERR_TEMPLATE_PARAM"]);
    expect(codes("velora-quick=hero-push&velora-params=" + encodeBase64Url('{"aspect":"3:2"}'))).toEqual(["ERR_TEMPLATE_ASPECT"]);
    expect(codes("velora-quick=hero-push&velora-params=%%%")).toEqual(["ERR_TEMPLATE_PARAM"]);
    expect(codes("velora-quick=hero-push&velora-route=https://evil.com")).toEqual(["ERR_ROUTE_INVALID"]);
    expect(codes("velora-quick=nope")).toEqual(["ERR_TEMPLATE_NOT_FOUND"]);
    expect(readQuickShot(new URLSearchParams("velora-quick=hero-push&velora-params=" + encodeBase64Url('{"lens":999}')))!.definition).toBeUndefined();
  });
  it("copies exact scaffold and export commands", () => {
    const state: QuickShotState = { template: "scroll-through", route: "/", aspect: "9:16", overrides: { intensity: "standard", focusRegion: "0,0,400,200" } };
    const href = "http://127.0.0.1:5173/?velora-preview=1&velora-quick=scroll-through";
    const commands = quickShotCommands(state, href, { id: "landing" });
    expect(commands.scaffold).toBe("npx velora new scene --template scroll-through --id landing --route / --aspect 9:16 --set intensity=standard --set focusRegion=0,0,400,200 --json");
    expect(commands.export).toBe(`npx velora export --url '${href}' --output landing.mp4 --width 1080 --height 1920 --fps 30`);
    expect(quickShotCommands({ template: "hero-push", aspect: "16:9", overrides: {} }, href).scaffold).toBe("npx velora new scene --template hero-push --id hero-push-shot --component <path#Export> --json");
    expect(quickShotCommands({ template: "hero-push", route: "/it's", aspect: "16:9", overrides: {} }, href).scaffold).toContain("--route '/it'\\''s'");
  });
});

describe("projectSubject", () => {
  it("projects the subject plane through the shot camera at start and end", () => {
    const manifest = TEMPLATE_CATALOG.find(entry => entry.id === "hero-push")!;
    const definition = templateDefinition(manifest, resolveTemplateParams(manifest, {}).params, "16:9");
    const subject = ASPECT_FRAMES["16:9"].subject;
    const start = projectSubject(definition, subject, 0);
    const end = projectSubject(definition, subject, definition.motion.durationMs);
    expect(start.every(Boolean) && end.every(Boolean)).toBe(true);
    const area = (points: typeof start) => Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]!; return sum + point!.x * next.y - next.x * point!.y; }, 0)) / 2;
    // A push-in ends closer: the subject covers more of the frame.
    expect(area(end)).toBeGreaterThan(area(start));
  });
});
