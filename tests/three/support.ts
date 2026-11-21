import { expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

type FrameProbe = { t: number; seconds: number; seed: number; absolute: number; x: number; markerX: number; markerY: number };
export type ProbeWindow = Window & { __VELORA_CAPTURE__?: { seek(ms: number): Promise<void> }; threeFrames?: FrameProbe[] };

export async function waitForBridge(page: Page) {
  await expect.poll(() => page.evaluate(() => !!(window as ProbeWindow).__VELORA_CAPTURE__)).toBe(true);
}
export async function seek(page: Page, ms: number) {
  await waitForBridge(page);
  await page.evaluate(ms => (window as ProbeWindow).__VELORA_CAPTURE__!.seek(ms), ms);
}
export function getFrames(page: Page) {
  return page.evaluate(() => (window as ProbeWindow).threeFrames ?? []);
}
export async function canvasHash(page: Page) {
  const bytes = await page.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  return createHash("sha256").update(Buffer.from(bytes.split(",")[1], "base64")).digest("hex");
}
