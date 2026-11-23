import { expect, test } from "@playwright/test";

test("48 volumetric layers retain interactive scrub and bounded classification cost", async ({ page }) => {
  await page.goto("/tests/fixtures/depth.html?performance");
  await expect(page.locator("[data-velora-depth-proxies] > div")).toHaveCount(48);
  const evidence = await page.evaluate(async () => {
    const fixture = (window as unknown as { depthFixture: { seek(ms: number): void; classify(): { ms: number; nodes: number } } }).depthFixture;
    const intervals: number[] = [];
    const commits: number[] = [];
    let prior: number | undefined;
    const frame = () => new Promise<number>(requestAnimationFrame);
    for (let i = 0; i < 160; i++) {
      const now = await frame();
      const start = performance.now();
      fixture.seek(i * 37 % 1000);
      if (i >= 20 && prior !== undefined) { intervals.push(now - prior); commits.push(performance.now() - start); }
      prior = now;
    }
    intervals.sort((a, b) => a - b);
    commits.sort((a, b) => a - b);
    return { medianFps: 1000 / intervals[Math.floor(intervals.length / 2)], p95Ms: intervals[Math.floor(intervals.length * 0.95)],
      medianCommitMs: commits[Math.floor(commits.length / 2)], classifier: fixture.classify() };
  });
  console.log(JSON.stringify(evidence));
  expect(evidence.classifier.nodes).toBe(2000);
  expect(evidence.classifier.ms).toBeLessThanOrEqual(30);
  expect(evidence.medianFps).toBeGreaterThanOrEqual(55);
});
