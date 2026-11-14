import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** v2.1 Phase 00 capture golden: frame SHAs of the existing browser fixtures at standard quality
 * (device scale 1). They are the "no stage, no depth" reference for Phases 12-14. Rasterization is
 * machine-specific, so records are keyed by platform-arch; other machines skip with a notice.
 * Regenerate deliberately: node scripts/golden.mjs --update --capture (after npm run build:test).
 */
const file = path.join(fileURLToPath(new URL("../core/fixtures/v21-golden/", import.meta.url)), "capture.json");
const machine = `${process.platform}-${process.arch}`;
const updating = process.env.VELORA_GOLDEN === "update";
const frames = [
  ...["dolly", "wipe"].flatMap(shot => [0, 500, 1000].map(t => `/tests/fixtures/motion.html?shot=${shot}&t=${t}`)),
  "/tests/fixtures/focus.html?planes",
];
const recorded: Record<string, Record<string, string>> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const actual: Record<string, string> = {};

test.describe.configure({ mode: "serial" });
for (const url of frames)
  test(`capture golden ${url}`, async ({ page }) => {
    test.skip(!updating && !recorded[machine], `No capture golden for ${machine}; record one with node scripts/golden.mjs --update --capture.`);
    await page.setViewportSize({ width: 800, height: 400 });
    await page.goto(url);
    await expect(page.locator("[data-velora-scene]")).toHaveAttribute("data-velora-valid", "true");
    const scene = page.locator("[data-velora-scene]");
    const sha = createHash("sha256").update(await scene.screenshot({ animations: "disabled" })).digest("hex");
    // A second capture of the same time must be identical (deterministic frame sampling).
    const again = createHash("sha256").update(await scene.screenshot({ animations: "disabled" })).digest("hex");
    expect(again).toBe(sha);
    actual[url] = sha;
    if (!updating) expect(sha, url).toBe(recorded[machine][url]);
  });
test.afterAll(() => {
  if (!updating || Object.keys(actual).length !== frames.length) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...recorded, [machine]: actual }, null, 2) + "\n");
});
