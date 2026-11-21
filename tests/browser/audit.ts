import { expect, type Page } from "@playwright/test";
import axe from "axe-core";

const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function loadAudit(page: Page) {
  await page.addScriptTag({ content: axe.source });
}

export async function audit(page: Page, selector: string, name: string) {
  await expect(page.locator(selector).first()).toBeVisible();
  const violations = await page.evaluate(async ({ selector, tags }) => {
    const engine = (window as unknown as { axe: typeof axe }).axe;
    const results = await engine.run(selector, { runOnly: { type: "tag", values: tags } });
    return results.violations.map(issue => ({
      id: issue.id, targets: issue.nodes.map(node => node.target), detail: issue.nodes.map(node => node.failureSummary),
    }));
  }, { selector, tags });
  expect.soft(violations, name).toEqual([]);
}
