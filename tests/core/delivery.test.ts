import { describe, expect, it } from "vitest";
import { CODEC_CONTAINERS, DELIVERY_PRESETS, DeliveryPresetSchema, deliveryWarnings, findDeliveryPreset } from "../../src/core";

describe("delivery presets", () => {
  it("are valid, unique and dated", () => {
    const ids = DELIVERY_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of DELIVERY_PRESETS) {
      expect(DeliveryPresetSchema.parse(preset)).toEqual(preset);
      expect(Date.parse(preset.lastVerified)).not.toBeNaN();
      expect(CODEC_CONTAINERS[preset.codec].length).toBeGreaterThan(0);
    }
    for (const id of ["youtube-1080p", "youtube-4k", "x-landscape", "x-square", "linkedin", "instagram-reel", "tiktok", "youtube-shorts", "instagram-feed-4x5", "website-hero", "github-readme-gif", "og-image", "product-hunt-gallery"])
      expect(findDeliveryPreset(id), id).toBeDefined();
  });
  it("warns about duration, size, aspect and frame rate but never fails", () => {
    const gif = findDeliveryPreset("github-readme-gif")!;
    expect(deliveryWarnings(gif, { width: 960, height: 540, fps: 30, durationMs: 8000, bytes: 1_000_000 })).toEqual([]);
    expect(deliveryWarnings(gif, { width: 1080, height: 1920, fps: 60, durationMs: 20_000, bytes: 50 * 1024 * 1024 }).map(warning => warning.code))
      .toEqual(["WARN_DELIVERY_DURATION", "WARN_DELIVERY_SIZE", "WARN_DELIVERY_ASPECT", "WARN_DELIVERY_FPS"]);
  });
});
