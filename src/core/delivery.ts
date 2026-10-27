import { z } from "zod";
import { ExportFrameRateSchema, QualityPresetSchema, VideoCodecSchema } from "./export";

/** SOURCE OF TRUTH: DeliveryPresetSchema, DELIVERY_PRESETS, deliveryWarnings.
 * WHAT: platform delivery targets (frame size, frame rates, codec, quality, duration and file-size
 * budgets, loudness target) with the date each entry was last checked against the platform.
 * WHY: launches ship to many surfaces; one table keeps render defaults and budget warnings honest.
 * WHERE: `velora render --preset` applies defaults (explicit flags win) and reports warnings;
 * the loudness target is consumed by the editorial phase. Platform limits change: re-verify
 * `lastVerified` before each release. Values are conservative upload targets, not platform maxima.
 */
export const DeliveryPresetSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  width: z.number().int().min(64).max(3840).multipleOf(2),
  height: z.number().int().min(64).max(3840).multipleOf(2),
  fps: z.array(ExportFrameRateSchema).min(1),
  codec: VideoCodecSchema,
  quality: QualityPresetSchema,
  maxDurationMs: z.number().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
  loudnessLufs: z.number().max(0).optional(),
  gifFps: z.number().int().min(5).max(30).optional(),
  notes: z.string(),
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type DeliveryPreset = z.output<typeof DeliveryPresetSchema>;
const MB = 1024 * 1024;
const verified = "2026-10-27";
const preset = (entry: Omit<DeliveryPreset, "lastVerified">) => DeliveryPresetSchema.parse({ ...entry, lastVerified: verified });
export const DELIVERY_PRESETS: readonly DeliveryPreset[] = Object.freeze([
  preset({ id: "youtube-1080p", title: "YouTube 1080p", width: 1920, height: 1080, fps: [24, 25, 30, 50, 60], codec: "h264", quality: "master", loudnessLufs: -14, notes: "Upload the master; YouTube re-encodes. 24 fps reads cinematic, 60 fps suits UI motion." }),
  preset({ id: "youtube-4k", title: "YouTube 4K", width: 3840, height: 2160, fps: [24, 25, 30, 50, 60], codec: "h264", quality: "standard", loudnessLufs: -14, notes: "4K renders at 1x capture (no supersampling above 3840 px)." }),
  preset({ id: "youtube-shorts", title: "YouTube Shorts", width: 1080, height: 1920, fps: [30, 60], codec: "h264", quality: "master", maxDurationMs: 180_000, loudnessLufs: -14, notes: "Vertical; keep captions out of the bottom fifth." }),
  preset({ id: "x-landscape", title: "X (landscape)", width: 1920, height: 1080, fps: [30, 60], codec: "h264", quality: "master", maxDurationMs: 140_000, maxBytes: 512 * MB, loudnessLufs: -14, notes: "Autoplays muted in feed: the first two seconds must read without sound." }),
  preset({ id: "x-square", title: "X (square)", width: 1080, height: 1080, fps: [30, 60], codec: "h264", quality: "master", maxDurationMs: 140_000, maxBytes: 512 * MB, loudnessLufs: -14, notes: "Square takes more feed height than landscape on phones." }),
  preset({ id: "linkedin", title: "LinkedIn feed", width: 1920, height: 1080, fps: [30], codec: "h264", quality: "master", maxDurationMs: 600_000, maxBytes: 200 * MB, loudnessLufs: -14, notes: "Burn in captions; most feed views are muted." }),
  preset({ id: "instagram-reel", title: "Instagram Reel", width: 1080, height: 1920, fps: [30], codec: "h264", quality: "master", maxDurationMs: 180_000, loudnessLufs: -14, notes: "Keep text inside the 9:16 platform zones (studio Guides)." }),
  preset({ id: "instagram-feed-4x5", title: "Instagram feed 4:5", width: 1080, height: 1350, fps: [30], codec: "h264", quality: "master", maxDurationMs: 60_000, loudnessLufs: -14, notes: "4:5 is the tallest feed crop." }),
  preset({ id: "tiktok", title: "TikTok", width: 1080, height: 1920, fps: [30, 60], codec: "h264", quality: "master", maxDurationMs: 600_000, loudnessLufs: -14, notes: "Vertical; the right rail and caption block cover UI." }),
  preset({ id: "website-hero", title: "Website hero loop", width: 1920, height: 1080, fps: [24, 30], codec: "vp9", quality: "standard", maxDurationMs: 15_000, maxBytes: 4 * MB, notes: "Muted, looping WebM; also render an H.264 MP4 fallback and a poster." }),
  preset({ id: "github-readme-gif", title: "GitHub README GIF", width: 960, height: 540, fps: [30], codec: "gif", quality: "standard", gifFps: 15, maxDurationMs: 10_000, maxBytes: 10 * MB, notes: "GitHub caps image uploads; keep loops short and calm." }),
  preset({ id: "og-image", title: "Open Graph poster", width: 1200, height: 630, fps: [30], codec: "h264", quality: "master", maxDurationMs: 6_000, notes: "Render with --poster MS to get the share image; the clip is a by-product." }),
  preset({ id: "product-hunt-gallery", title: "Product Hunt gallery", width: 1270, height: 760, fps: [30], codec: "h264", quality: "master", maxDurationMs: 60_000, notes: "Gallery video is best as a short, captioned walkthrough." }),
]);
export function findDeliveryPreset(id: string): DeliveryPreset | undefined {
  return DELIVERY_PRESETS.find(entry => entry.id === id);
}
export type DeliveryWarning = { code: string; message: string };
/** Budget and fit warnings for a finished render against a preset (never errors: platforms change). */
export function deliveryWarnings(target: DeliveryPreset, render: { width: number; height: number; fps: number; durationMs: number; bytes?: number }): DeliveryWarning[] {
  const warnings: DeliveryWarning[] = [];
  if (target.maxDurationMs && render.durationMs > target.maxDurationMs)
    warnings.push({ code: "WARN_DELIVERY_DURATION", message: `${target.title} accepts about ${target.maxDurationMs / 1000}s; this render is ${(render.durationMs / 1000).toFixed(1)}s.` });
  if (target.maxBytes && render.bytes !== undefined && render.bytes > target.maxBytes)
    warnings.push({ code: "WARN_DELIVERY_SIZE", message: `${target.title} budget is ${(target.maxBytes / MB).toFixed(0)} MB; this file is ${(render.bytes / MB).toFixed(1)} MB. Try --quality standard, a shorter cut or a lower frame rate.` });
  if (Math.abs(render.width / render.height - target.width / target.height) > 0.01)
    warnings.push({ code: "WARN_DELIVERY_ASPECT", message: `${target.title} expects ${target.width}x${target.height}; this render is ${render.width}x${render.height}.` });
  if (!(target.fps as number[]).includes(render.fps))
    warnings.push({ code: "WARN_DELIVERY_FPS", message: `${target.title} expects ${target.fps.join(" or ")} fps; this render is ${render.fps} fps.` });
  return warnings;
}
