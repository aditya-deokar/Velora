import { test, expect } from "@playwright/test";

// v2.1 Phase 06 budget (device-specific evidence): a move-gizmo drag in a 60-Surface scene, from pointer
// move to the next painted frame. The number is attached to the report.
const p95 = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]; };
test("move-gizmo drag in a 60-Surface scene repaints within the budget", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/tests/preview/fixture.html?mode=perf&velora-scene=sixty&velora-edit=1");
  await expect(page.locator("[data-velora-viewport-overlay]")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-velora-id="s-12"]')).toBeVisible();
  const samples = await page.evaluate(async () => {
    const overlay = document.querySelector<SVGSVGElement>("[data-velora-viewport-overlay]")!;
    const leaf = document.querySelector<HTMLElement>('[data-velora-id="s-12"] > [data-velora-content]')!;
    const rect = leaf.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    overlay.setPointerCapture = () => undefined;
    const fire = (type: string, dx: number) => overlay.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x + dx, clientY: y, pointerId: 1, button: 0 }));
    fire("pointerdown", 0);
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    const out: number[] = [];
    for (let i = 1; i <= 40; i++) {
      const start = performance.now();
      fire("pointermove", i * 3);
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
      out.push(performance.now() - start);
    }
    fire("pointerup", 120);
    return out;
  });
  const report = { gizmoDragP95Ms: p95(samples), samples: samples.length };
  await info.attach("viewport-sixty", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log("[budget] viewport gizmo drag", JSON.stringify(report));
  expect(report.gizmoDragP95Ms).toBeLessThanOrEqual(16);
});
