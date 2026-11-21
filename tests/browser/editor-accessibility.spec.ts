import { expect, test, type Page } from "@playwright/test";
import { audit, loadAudit } from "./audit";

const entry = "/tests/preview/fixture.html?mode=editor&velora-scene=editable&velora-edit=1";

test("scene editor panels pass the axe rule set", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(entry);
  await expect(page.getByTestId("editor-save-state")).toBeVisible();
  await loadAudit(page);
  await page.locator('[data-item="caption"]').click();
  for (const [name, selector] of [["toolbar", ".velora-editor-top"], ["layer tree", ".velora-editor-left"], ["inspector", ".velora-editor-right"],
    ["viewport", ".velora-editor-center"], ["dope sheet", ".velora-editor-bottom"]]) await audit(page, selector, name);
  await page.locator('[data-cell="|surface|caption|opacity@0"]').focus();
  await page.keyboard.press("g");
  await audit(page, ".velora-editor-bottom", "graph editor");
  await page.keyboard.press("g");
  for (const [name, button] of [["history", /^History$/], ["advisories", /^Advisories/], ["behaviors", /^Behaviors$/],
    ["camera moves", /^Camera moves$/], ["presets", /^Presets$/]] as const) {
    await page.getByRole("button", { name: button }).first().click();
    await audit(page, ".ve-popover", name);
    await page.locator(".ve-popover").getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.keyboard.press("Control+k");
  await audit(page, '[aria-label="Command palette"]', "command palette");
  await page.keyboard.press("Escape");
  await page.keyboard.press("e");
  await audit(page, '[aria-label="Easing library"]', "easing library");
  await page.locator('[aria-label="Easing library"]').getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Ask agent", exact: true }).click();
  await audit(page, '[aria-label="Ask agent"]', "agent handoff");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Ask agent" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask agent", exact: true })).toBeFocused();
});

async function tabTo(page: Page, selector: string) {
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(selector => document.activeElement?.matches(selector), selector)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not tab to ${selector}.`);
}

test("keyboard-only scene journey keys a property, eases and groups its track", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(entry);
  await expect(page.getByTestId("editor-save-state")).toBeVisible();
  await tabTo(page, '[data-item="camera"]');
  await page.keyboard.press("Enter");
  await tabTo(page, '[aria-label="Animate x"]');
  await page.keyboard.press("Enter");
  await expect(page.getByRole("gridcell", { name: /camera x.*0\.00 s/i })).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight");
  await tabTo(page, '[aria-label="x value"]');
  await page.keyboard.press("Control+a");
  await page.keyboard.type("120");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("gridcell", { name: /camera x.*1\.00 s/i })).toBeVisible();
  await tabTo(page, '.ve-kf[tabindex="0"]');
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("F9");
  await expect(page.getByRole("gridcell", { name: /camera x.*0\.00 s.*easing custom/i })).toBeVisible();
  await page.keyboard.press("Control+g");
  await expect(page.locator('[data-clip="group-1"]')).toHaveCount(1);
});
