import { z } from "zod";
import { LookSchema } from "./looks";

/** SOURCE OF TRUTH: ExportVideoSchema, CaptureManifestSchema, FrameRenderSchema, RenderManifestSchema, QualityPresetSchema, VideoCodecSchema.
 * WHAT: runtime contracts for local video requests, the live browser capture bridge,
 * frame-accurate still renders, composition video renders and reproducibility manifests,
 * plus the master-quality vocabulary: quality presets, codecs/containers, motion blur and alpha.
 * WHY: adapters and operations share validation without importing Node or motion policy.
 * WHERE: export/commands validates; export/services captures and encodes; export/compositor
 * averages and downscales; React supplies the bridge.
 */
export const SUPPORTED_EXPORT_FPS = Object.freeze([24, 25, 30, 50, 60, 120] as const);
export const ExportFrameRateSchema = z.union(SUPPORTED_EXPORT_FPS.map(fps => z.literal(fps)));
// Quality presets: capture scale (supersampling), encoder effort and default motion blur.
export const QualityPresetSchema = z.enum(["draft", "standard", "master"]);
export type QualityPreset = z.output<typeof QualityPresetSchema>;
export const QUALITY_PRESETS = Object.freeze({
  draft: { scale: 0.5, x264: "veryfast", crf: 26, motionBlur: 0, motionSamples: 0 },
  standard: { scale: 1, x264: "slow", crf: 18, motionBlur: 0, motionSamples: 0 },
  master: { scale: 2, x264: "slower", crf: 14, motionBlur: 180, motionSamples: 8 },
} as const);
export const VideoCodecSchema = z.enum(["h264", "hevc", "vp9", "av1", "prores4444", "gif"]);
export type VideoCodec = z.output<typeof VideoCodecSchema>;
// Containers each codec may write, the first being the default; alpha-capable codecs accept --transparent.
export const CODEC_CONTAINERS: Readonly<Record<VideoCodec, readonly string[]>> = Object.freeze({
  h264: [".mp4"], hevc: [".mp4"], vp9: [".webm"], av1: [".mp4", ".webm"], prores4444: [".mov"], gif: [".gif"],
});
export const ALPHA_CODECS: readonly VideoCodec[] = Object.freeze(["vp9", "prores4444"]);
export const VIDEO_EXTENSIONS = Object.freeze([".mp4", ".webm", ".mov", ".gif"] as const);
const projectRelativeVideo = z.string().min(1).refine(value =>
  VIDEO_EXTENSIONS.some(extension => value.toLowerCase().endsWith(extension)) && !value.includes("\\") && !value.includes("\0") && !/^[A-Za-z]:/.test(value)
  && value.split("/").every(part => part !== "" && part !== "." && part !== ".."),
"Use a project-relative .mp4, .webm, .mov or .gif path without traversal.");
// Finishing options shared by live export and composition render; every field is optional so earlier requests are unchanged.
const finishing = {
  quality: QualityPresetSchema.optional(),
  codec: VideoCodecSchema.optional(),
  transparent: z.boolean().optional(),
  // Shutter angle in degrees (0 disables) and sub-frames per output frame.
  motionBlur: z.number().finite().min(0).max(360).optional(),
  motionSamples: z.number().int().min(2).max(64).optional(),
  gifFps: z.number().int().min(5).max(30).optional(),
  poster: z.number().finite().nonnegative().max(120_000).optional(),
};
type Finishing = { codec?: VideoCodec; transparent?: boolean; motionBlur?: number; motionSamples?: number; gifFps?: number };
function checkFinishing(input: Finishing, output: string, ctx: z.RefinementCtx, path: string) {
  const codec = input.codec ?? "h264";
  const lower = output.toLowerCase();
  if (!CODEC_CONTAINERS[codec].some(extension => lower.endsWith(extension)))
    ctx.addIssue({ code: "custom", path: [path], message: `${codec} writes ${CODEC_CONTAINERS[codec].join(" or ")}; rename the output or choose another --codec.` });
  if (input.transparent && !ALPHA_CODECS.includes(codec))
    ctx.addIssue({ code: "custom", path: ["transparent"], message: `--transparent needs an alpha codec: ${ALPHA_CODECS.join(" or ")} (PNG frames always keep alpha).` });
  if (input.motionSamples !== undefined && !input.motionBlur)
    ctx.addIssue({ code: "custom", path: ["motionSamples"], message: "--motion-samples applies only with --motion-blur." });
  if (input.gifFps !== undefined && codec !== "gif")
    ctx.addIssue({ code: "custom", path: ["gifFps"], message: "--gif-fps applies only with --codec gif." });
}
/** Resolved finishing for one render: explicit flags win over the quality preset. */
export function resolveFinishing(input: Finishing & { quality?: QualityPreset }, frame: { width: number; height: number }) {
  const quality = input.quality ?? "standard";
  const preset = QUALITY_PRESETS[quality];
  const motionBlur = input.motionBlur ?? preset.motionBlur;
  const motionSamples = motionBlur > 0 ? input.motionSamples ?? (preset.motionSamples || 8) : 0;
  // Supersampling never exceeds a 3840px capture side; 4K output renders at 1x.
  const largest = Math.max(frame.width, frame.height);
  const supersample = preset.scale > 1 ? Math.max(1, Math.min(preset.scale, Math.floor(3840 / largest))) : preset.scale;
  return { quality, codec: input.codec ?? "h264" as VideoCodec, transparent: !!input.transparent, motionBlur, motionSamples, supersample,
    gifFps: input.gifFps ?? 20, x264: preset.x264, crf: preset.crf };
}
export type ResolvedFinishing = ReturnType<typeof resolveFinishing>;
/** Sub-frame times for one output frame: a trailing shutter of `shutter` degrees split into N samples, clamped at the end. */
export function shutterSamples(timeMs: number, fps: number, shutter: number, samples: number, endMs: number): number[] {
  if (!(shutter > 0) || samples < 2) return [timeMs];
  const open = (shutter / 360) * (1000 / fps);
  return Array.from({ length: samples }, (_, i) => Math.min(endMs, timeMs + ((i + 0.5) / samples) * open));
}
export const ExportVideoSchema = z.strictObject({
  url: z.url().regex(/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/, "Use an HTTP loopback URL without credentials."),
  output: projectRelativeVideo,
  fps: ExportFrameRateSchema.default(60),
  width: z.number().int().min(64).max(3840).multipleOf(2).default(1440),
  height: z.number().int().min(64).max(3840).multipleOf(2).default(1000),
  audio: z.string().min(1).optional(),
  captions: z.string().min(1).optional(),
  ...finishing,
}).superRefine((input, ctx) => {
  checkFinishing(input, input.output, ctx, "output");
  if ((input.audio || input.captions) && (input.codec === "gif" || input.transparent))
    ctx.addIssue({ code: "custom", path: ["audio"], message: "Audio and captions need an opaque video codec (h264, hevc, vp9 or av1)." });
  if (input.captions && (input.codec ?? "h264") !== "h264")
    ctx.addIssue({ code: "custom", path: ["captions"], message: "Burned-in captions re-encode H.264; export with --codec h264." });
});
export const CaptureManifestSchema = z.strictObject({
  version: z.literal(1),
  durationMs: z.number().nonnegative().max(120_000),
  selector: z.literal('[data-velora-capture="scene"]'),
  // The scene's look (browser layer already captured); export applies its finishing fields.
  look: LookSchema.optional(),
});
export const ExportIssueSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  hint: z.string().optional(),
});
const projectRelativeFile = (extension: ".png" | ".mp4" | ".json") => z.string().min(1).refine(value =>
  value.endsWith(extension) && !value.includes("\\") && !value.includes("\0") && !/^[A-Za-z]:/.test(value)
  && value.split("/").every(part => part !== "" && part !== "." && part !== ".."),
`Use a project-relative ${extension} path without traversal.`);
// Frame render request: exactly one of frame (integer index) or timeMs.
// The renderer resolves frame <-> timeMs through the canonical frame clock
// and reports both, so agents never guess float-frame positions.
export const FrameRenderSchema = z.strictObject({
  composition: z.string().min(1),
  frame: z.number().int().nonnegative().max(864000).optional(),
  timeMs: z.number().finite().nonnegative().max(120_000).optional(),
  out: projectRelativeFile(".png"),
  cacheDir: z.string().min(1).optional(),
  noCache: z.boolean().optional(),
}).superRefine((input, ctx) => {
  if ((input.frame === undefined) === (input.timeMs === undefined))
    ctx.addIssue({ code: "custom", path: ["frame"], message: "Pass exactly one of --frame or --time." });
});
export type FrameRender = z.output<typeof FrameRenderSchema>;
// Reproducibility manifest (v1 lineage): any PNG/MP4 traces to composition
// bytes + seed + fps + code version. Equality of renders is judged on frame
// SHAs, never on container bytes or createdAt.
export const RenderFrameSchema = z.strictObject({
  frame: z.number().int().nonnegative(),
  timeMs: z.number().finite().nonnegative(),
  sceneId: z.string().min(1),
  segmentId: z.string().min(1),
  file: z.string().optional(),
  sha: z.string().regex(/^[0-9a-f]{64}$/),
  renderMs: z.number().finite().nonnegative().optional(),
  clamped: z.boolean().optional(),
  cached: z.boolean().optional(),
  // Sub-frame SHAs when motion blur averaged several samples into this frame.
  subFrames: z.array(z.string().regex(/^[0-9a-f]{64}$/)).optional(),
  // Layer SHAs (V1 segments of a transition, overlays, captions) composited into this frame.
  layers: z.array(z.strictObject({ id: z.string(), sha: z.string().regex(/^[0-9a-f]{64}$/) })).optional(),
});
export type RenderFrame = z.output<typeof RenderFrameSchema>;
export const RenderSegmentSchema = z.strictObject({
  id: z.string().min(1),
  recipe: z.string().min(1),
  startMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().positive(),
  frames: z.number().int().nonnegative(),
});
export const RenderCheckSchema = z.strictObject({ id: z.string(), pass: z.boolean(), detail: z.string().optional() });
export const RenderManifestSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(["frame", "frames", "video"]),
  compositionId: z.string().optional(),
  compositionSha: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  seed: z.number().int().nonnegative(),
  fps: ExportFrameRateSchema,
  width: z.number().int().min(64).max(3840),
  height: z.number().int().min(64).max(3840),
  durationMs: z.number().finite().nonnegative(),
  segments: z.array(RenderSegmentSchema),
  frames: z.array(RenderFrameSchema),
  audio: z.strictObject({ tracks: z.array(z.strictObject({ id: z.string(), assetId: z.string(), startMs: z.number() })), driftMs: z.number().optional() }).optional(),
  captions: z.strictObject({ file: z.string().optional(), cues: z.number().int().nonnegative().optional(), burnIn: z.boolean().optional(),
    windows: z.array(z.strictObject({ startMs: z.number().finite().nonnegative(), endMs: z.number().finite().positive() })).optional() }).optional(),
  ffmpegArgs: z.array(z.string()).optional(),
  // Finishing lineage (optional so earlier manifests stay valid).
  quality: QualityPresetSchema.optional(),
  codec: VideoCodecSchema.optional(),
  container: z.string().optional(),
  colorimetry: z.literal("bt709").optional(),
  motionBlur: z.strictObject({ shutter: z.number(), samples: z.number().int() }).optional(),
  supersample: z.number().positive().optional(),
  transparent: z.boolean().optional(),
  workers: z.number().int().positive().optional(),
  // Loudness normalization: target, first-pass measurement and the measured result.
  loudness: z.strictObject({ target: z.record(z.string(), z.number()), measured: z.record(z.string(), z.number().nullable()), result: z.record(z.string(), z.number().nullable()), skipped: z.literal(true).optional() }).optional(),
  sfx: z.array(z.strictObject({ id: z.string(), preset: z.string(), atMs: z.number(), gainDb: z.number(), seed: z.number() })).optional(),
  poster: z.string().optional(),
  veloraVersion: z.string().min(1),
  checks: z.array(RenderCheckSchema).optional(),
  createdAt: z.string().min(1),
});
export type RenderManifest = z.output<typeof RenderManifestSchema>;
export const FrameRenderResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), data: z.strictObject({
    out: z.string(), manifest: z.string(), frame: z.number().int().nonnegative(),
    timeMs: z.number().finite().nonnegative(), sceneId: z.string(), segmentId: z.string(),
    sha: z.string(), cached: z.boolean(),
  }) }),
  z.strictObject({ success: z.literal(false), issues: z.array(ExportIssueSchema) }),
]);
export type FrameRenderResult = z.output<typeof FrameRenderResultSchema>;
// Composition video render request: the timeline path. fps/width/height
// override the composition when given; parallel caps segment workers at 4.
export const VideoRenderSchema = z.strictObject({
  composition: z.string().min(1),
  out: projectRelativeVideo,
  parallel: z.number().int().min(1).max(8).optional(),
  cacheDir: z.string().min(1).optional(),
  noCache: z.boolean().optional(),
  fps: ExportFrameRateSchema.optional(),
  width: z.number().int().min(64).max(3840).multipleOf(2).optional(),
  height: z.number().int().min(64).max(3840).multipleOf(2).optional(),
  ...finishing,
  // Delivery preset id (core/delivery); explicit flags win over its defaults.
  preset: z.string().min(1).max(64).optional(),
  // Extra aspect variants rendered in the same run, written as <out>-<w>x<h>.<ext>.
  aspects: z.array(z.enum(["16:9", "9:16", "1:1", "4:5", "21:9"])).min(1).max(5).optional(),
}).superRefine((input, ctx) => {
  // With a preset and no --codec, the preset's codec decides the container (checked after resolution).
  if (input.preset === undefined || input.codec !== undefined) checkFinishing(input, input.out, ctx, "out");
  else checkFinishing({ ...input, codec: undefined, transparent: false }, input.out.replace(/\.[a-z0-9]+$/i, ".mp4"), ctx, "out");
});
export type VideoRender = z.output<typeof VideoRenderSchema>;
export const VideoRenderResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), data: z.strictObject({
    out: z.string(), manifest: z.string(), frames: z.number().int().nonnegative(),
    durationMs: z.number().finite().nonnegative(), fps: z.number(), width: z.number(), height: z.number(),
    seed: z.number().int().nonnegative(), cachedFrames: z.number().int().nonnegative(), renderedFrames: z.number().int().nonnegative(),
    codec: z.string().optional(), quality: z.string().optional(), poster: z.string().optional(),
    variants: z.array(z.strictObject({ aspect: z.string(), out: z.string(), width: z.number(), height: z.number() })).optional(),
    warnings: z.array(ExportIssueSchema).optional(),
  }) }),
  z.strictObject({ success: z.literal(false), issues: z.array(ExportIssueSchema) }),
]);
export type VideoRenderResult = z.output<typeof VideoRenderResultSchema>;
// Frame extraction request: PNG sequence plus manifest.json into a directory.
// Exactly one selector; neither means one frame per second.
const projectRelativeDir = z.string().min(1).refine(value =>
  !value.includes("\\") && !value.includes("\0") && !/^[A-Za-z]:/.test(value)
  && value.split("/").every(part => part !== "" && part !== "." && part !== ".."),
"Use a project-relative directory path without traversal.");
export const FramesRenderSchema = z.strictObject({
  composition: z.string().min(1),
  out: projectRelativeDir,
  every: z.number().int().positive().optional(),
  at: z.array(z.number().finite().nonnegative()).max(4096).optional(),
  // One storyboard PNG of every extracted frame, in order (contact-sheet.png in the out directory).
  contactSheet: z.boolean().optional(),
  columns: z.number().int().min(1).max(12).optional(),
  cacheDir: z.string().min(1).optional(),
  noCache: z.boolean().optional(),
}).superRefine((input, ctx) => {
  if (input.columns !== undefined && !input.contactSheet)
    ctx.addIssue({ code: "custom", path: ["columns"], message: "--columns applies only with --contact-sheet." });
  if (input.every !== undefined && input.at !== undefined)
    ctx.addIssue({ code: "custom", path: ["every"], message: "Pass only one of --every or --at." });
});
export type FramesRender = z.output<typeof FramesRenderSchema>;
export const FramesRenderResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), data: z.strictObject({
    out: z.string(), manifest: z.string(), total: z.number().int().nonnegative(),
    frames: z.array(z.strictObject({ frame: z.number().int().nonnegative(), file: z.string(), sha: z.string() })),
    contactSheet: z.string().optional(),
  }) }),
  z.strictObject({ success: z.literal(false), issues: z.array(ExportIssueSchema) }),
]);
export type FramesRenderResult = z.output<typeof FramesRenderResultSchema>;
// Single-scene still without a composition: ergonomic alias over frame render.
export const ShotRenderSchema = z.strictObject({
  scene: z.string().min(1).max(128),
  timeMs: z.number().finite().nonnegative().max(120_000),
  out: projectRelativeFile(".png"),
  // Still previews of export finishing: supersampling and motion blur at a given frame rate.
  quality: QualityPresetSchema.optional(),
  motionBlur: z.number().finite().min(0).max(360).optional(),
  motionSamples: z.number().int().min(2).max(64).optional(),
  fps: ExportFrameRateSchema.optional(),
  transparent: z.boolean().optional(),
  // Apply the look's export finishing (bloom, halation, aberration, sharpen, LUT) as video export does.
  finish: z.boolean().optional(),
});
export type ShotRender = z.output<typeof ShotRenderSchema>;
export const ShotRenderResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), data: z.strictObject({
    out: z.string(), sceneId: z.string(), timeMs: z.number().finite().nonnegative(),
    sha: z.string(), clamped: z.boolean().optional(),
  }) }),
  z.strictObject({ success: z.literal(false), issues: z.array(ExportIssueSchema) }),
]);
export type ShotRenderResult = z.output<typeof ShotRenderResultSchema>;
// Automated visual checks over rendered evidence. Exactly one target; budget
// applies to the fps-budget check only (evidence, never a promise).
export const CheckRenderSchema = z.strictObject({
  frames: z.string().min(1).optional(),
  video: z.string().min(1).optional(),
  manifest: z.string().min(1).optional(),
  budgetMs: z.number().finite().positive().optional(),
}).superRefine((input, ctx) => {
  if ((input.frames === undefined) === (input.video === undefined))
    ctx.addIssue({ code: "custom", path: ["frames"], message: "Pass exactly one of --frames or --video." });
});
export type CheckRender = z.output<typeof CheckRenderSchema>;
export const VisualCheckSchema = z.strictObject({
  id: z.string(), pass: z.boolean(), detail: z.string(), frameRefs: z.array(z.string()).optional(),
});
export type VisualCheck = z.output<typeof VisualCheckSchema>;
export const CheckRenderResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), command: z.literal("check"),
    data: z.strictObject({ target: z.string(), checks: z.array(VisualCheckSchema) }) }),
  z.strictObject({ success: z.literal(false), command: z.literal("check"),
    data: z.strictObject({ target: z.string(), checks: z.array(VisualCheckSchema) }).optional(),
    issues: z.array(ExportIssueSchema).min(1), next: z.array(z.string()).optional() }),
]);
export type CheckRenderResult = z.output<typeof CheckRenderResultSchema>;
export const ExportVideoResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), data: z.strictObject({
    output: z.string(), fps: z.number(), frames: z.number().int(), durationMs: z.number(),
    codec: z.string().optional(), quality: z.string().optional(), poster: z.string().optional(),
    audio: z.strictObject({ file: z.string(), codec: z.string(), driftMs: z.number(), peakDb: z.number().nullable() }).optional(),
    captions: z.strictObject({ file: z.string(), cues: z.number().int().nonnegative(), burnIn: z.boolean() }).optional(),
  }) }),
  z.strictObject({ success: z.literal(false), issues: z.array(ExportIssueSchema) }),
]);
export type ExportVideo = z.output<typeof ExportVideoSchema>;
export type CaptureManifest = z.output<typeof CaptureManifestSchema>;
// seek may return a promise when components registered async settle work; services await it.
export type CaptureBridge = CaptureManifest & { seek: (elapsedMs: number) => void | Promise<void> };
export type ExportVideoResult = z.output<typeof ExportVideoResultSchema>;
