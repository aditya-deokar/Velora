import { z } from "zod";
import { StageDprSchema } from "./stage";
import { DELIVERY_PRESETS, findDeliveryPreset, type DeliveryPreset } from "./delivery";
import type { Composition } from "./composition";
import type { VideoCodec } from "./export";

/** SOURCE OF TRUTH: DELIVER_TARGETS, resolveDeliverTargets, sizeLadder, heroTimeMs, heroEmbedHtml, heroVideoTsx, DeliverablesManifestSchema.
 * WHAT: the launch-target vocabulary of `velora deliver` (short names mapped to delivery presets and the
 * files each target emits), the deterministic quality ladder used to meet a preset's size budget, the
 * still/poster time, the website-hero embed snippets, and the deliverables.json manifest.
 * WHY: one launch needs a dozen correctly sized files; a pure plan keeps every target, retry and snippet
 * reproducible and testable without FFmpeg or a browser.
 * WHERE: export/commands executeDeliver runs the plan; cli `deliver` adapts arguments; skills cite targets.
 */
export const DELIVER_TARGETS = Object.freeze({
  youtube: { preset: "youtube-1080p", kind: "video" },
  x: { preset: "x-landscape", kind: "video" },
  "x-square": { preset: "x-square", kind: "video" },
  linkedin: { preset: "linkedin", kind: "video" },
  reels: { preset: "instagram-reel", kind: "video" },
  "instagram-feed": { preset: "instagram-feed-4x5", kind: "video" },
  tiktok: { preset: "tiktok", kind: "video" },
  shorts: { preset: "youtube-shorts", kind: "video" },
  "website-hero": { preset: "website-hero", kind: "website-hero" },
  "readme-gif": { preset: "github-readme-gif", kind: "video" },
  "og-image": { preset: "og-image", kind: "still" },
  "product-hunt": { preset: "product-hunt-gallery", kind: "product-hunt" },
} as const);
export type DeliverTargetName = keyof typeof DELIVER_TARGETS;
export type DeliverTargetKind = (typeof DELIVER_TARGETS)[DeliverTargetName]["kind"];
export type DeliverTarget = { name: string; kind: DeliverTargetKind; preset: DeliveryPreset };

/** Short names (`reels`) or preset ids (`instagram-reel`) to unique targets, in request order. */
export function resolveDeliverTargets(list: readonly string[]): { targets: DeliverTarget[]; unknown: string[] } {
  const targets: DeliverTarget[] = [], unknown: string[] = [];
  for (const raw of list) {
    const name = raw.trim();
    if (!name) continue;
    const alias = (DELIVER_TARGETS as Record<string, { preset: string; kind: DeliverTargetKind }>)[name];
    const byPreset = alias ? undefined : Object.entries(DELIVER_TARGETS).find(([, entry]) => entry.preset === name);
    const entry = alias ?? byPreset?.[1];
    const preset = entry ? findDeliveryPreset(entry.preset) : findDeliveryPreset(name);
    if (!preset) { unknown.push(name); continue; }
    const resolved: DeliverTarget = { name: alias ? name : byPreset?.[0] ?? name, kind: entry?.kind ?? "video", preset };
    if (!targets.some(target => target.name === resolved.name)) targets.push(resolved);
  }
  return { targets, unknown };
}
export const ALL_DELIVER_TARGETS: readonly string[] = Object.freeze(Object.keys(DELIVER_TARGETS));

/** Rate-control steps per codec: attempt 0 is the preset's quality; each later step trades size for detail. */
export type LadderStep = { crf?: number; gifFps?: number };
const BASE_CRF: Record<Exclude<VideoCodec, "gif" | "prores4444">, Record<"draft" | "standard" | "master", number>> = {
  h264: { draft: 26, standard: 18, master: 14 },
  hevc: { draft: 30, standard: 22, master: 18 },
  vp9: { draft: 40, standard: 31, master: 24 },
  av1: { draft: 45, standard: 32, master: 24 },
};
const CRF_MAX: Record<string, number> = { h264: 40, hevc: 42, vp9: 56, av1: 58 };
export function sizeLadder(codec: VideoCodec, quality: "draft" | "standard" | "master", gifFps = 15): LadderStep[] {
  if (codec === "prores4444") return [{}];
  if (codec === "gif") return [...new Set([gifFps, 12, 10, 8].filter(fps => fps <= gifFps))].map(fps => ({ gifFps: fps }));
  const base = BASE_CRF[codec][quality], step = codec === "vp9" || codec === "av1" ? 6 : 4;
  return [0, 1, 2, 3].map(index => ({ crf: Math.min(CRF_MAX[codec], base + index * step) }))
    .filter((entry, index, all) => index === 0 || entry.crf !== all[index - 1].crf);
}

/** The frame that best represents the film: the middle of its longest V1 shot (ties: the earliest). */
export function heroTimeMs(composition: Pick<Composition, "scenes">): number {
  const longest = composition.scenes.reduce((best, scene) => scene.durationMs > best.durationMs ? scene : best, composition.scenes[0]);
  return Math.round(longest.startMs + longest.durationMs / 2);
}
/** Gallery stills spread across the film at 25%, 50% and 75% of its span. */
export function galleryTimesMs(durationMs: number): number[] {
  return [0.25, 0.5, 0.75].map(fraction => Math.round(durationMs * fraction));
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
export type HeroFiles = { webm: string; mp4: string; poster: string; width: number; height: number; title: string };
/** Autoplaying, muted, inline loop; WebM first, MP4 fallback; poster with fixed dimensions (no layout shift); reduced motion shows the poster. */
export function heroEmbedHtml(files: HeroFiles): string {
  const { webm, mp4, poster, width, height } = files;
  const title = escapeHtml(files.title);
  return `<!-- Velora website hero: ${title}. Paths are relative to this file; adjust them to where you host the files. -->
<picture class="velora-hero-poster">
  <img src="${poster}" width="${width}" height="${height}" alt="" decoding="async">
</picture>
<video class="velora-hero" autoplay muted loop playsinline preload="metadata" poster="${poster}" width="${width}" height="${height}" aria-label="${title}">
  <source src="${webm}" type="video/webm">
  <source src="${mp4}" type="video/mp4">
</video>
<style>
  .velora-hero, .velora-hero-poster img { display: block; width: 100%; height: auto; aspect-ratio: ${width} / ${height}; }
  .velora-hero-poster { display: none; }
  @media (prefers-reduced-motion: reduce) {
    .velora-hero { display: none; }
    .velora-hero-poster { display: block; }
  }
</style>
`;
}
export function heroVideoTsx(files: HeroFiles): string {
  const { webm, mp4, poster, width, height } = files;
  return `// Velora website hero: ${files.title.replace(/[\r\n*/]/g, " ")}.
// Copy the files next to your public assets and adjust the paths. Reduced motion shows the poster.
import { useEffect, useState } from "react";

export function HeroVideo({ className }: { className?: string }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const style = { display: "block", width: "100%", height: "auto", aspectRatio: "${width} / ${height}" } as const;
  if (reduced) return <img className={className} src=${JSON.stringify(poster)} width={${width}} height={${height}} alt="" style={style} />;
  return (
    <video className={className} autoPlay muted loop playsInline preload="metadata" poster=${JSON.stringify(poster)} width={${width}} height={${height}} style={style}>
      <source src=${JSON.stringify(webm)} type="video/webm" />
      <source src=${JSON.stringify(mp4)} type="video/mp4" />
    </video>
  );
}
`;
}

const AttemptSchema = z.strictObject({ crf: z.number().optional(), gifFps: z.number().optional(), bytes: z.number().int().nonnegative(), withinBudget: z.boolean() });
export const DeliverableFileSchema = z.strictObject({
  path: z.string(), role: z.enum(["video", "fallback", "poster", "still", "embed", "component", "manifest"]),
  bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().optional(), height: z.number().int().optional(), durationMs: z.number().optional(),
  codec: z.string().optional(), renderManifest: z.string().optional(),
});
export const DeliverablesManifestSchema = z.strictObject({
  version: z.literal(1),
  composition: z.string(), compositionId: z.string(), compositionSha: z.string(),
  heroTimeMs: z.number(), veloraVersion: z.string(), createdAt: z.string(),
  targets: z.array(z.strictObject({
    name: z.string(), preset: z.string(), kind: z.enum(["video", "website-hero", "still", "product-hunt"]),
    presetLastVerified: z.string(), loudnessLufs: z.number().optional(), measuredLufs: z.number().optional(),
    files: z.array(DeliverableFileSchema), attempts: z.array(AttemptSchema),
    warnings: z.array(z.strictObject({ code: z.string(), message: z.string() })),
  })),
});
export type DeliverablesManifest = z.output<typeof DeliverablesManifestSchema>;
export const DeliverInputSchema = z.strictObject({
  composition: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1).max(DELIVERY_PRESETS.length + 4),
  out: z.string().min(1).regex(/^(?!\/)(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/, "Use a project-relative output directory without traversal.").optional(),
  quality: z.enum(["draft", "standard", "master"]).optional(),
  stageDpr: StageDprSchema.optional(),
  parallel: z.number().int().min(1).max(8).optional(),
  noCache: z.boolean().optional(),
});
export type DeliverInput = z.output<typeof DeliverInputSchema>;
