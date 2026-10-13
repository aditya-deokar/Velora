import { z } from "zod";

/** SOURCE OF TRUTH: ExportVideoSchema, CaptureManifestSchema, FrameRenderSchema, RenderManifestSchema.
 * WHAT: runtime contracts for local video requests, the live browser capture bridge,
 * frame-accurate still renders, composition video renders and reproducibility manifests.
 * WHY: adapters and operations share validation without importing Node or motion policy.
 * WHERE: export/commands validates; export/services captures; React supplies the bridge.
 */
export const SUPPORTED_EXPORT_FPS = Object.freeze([30, 60, 120] as const);
export const ExportFrameRateSchema = z.union(SUPPORTED_EXPORT_FPS.map(fps => z.literal(fps)));
export const ExportVideoSchema = z.strictObject({
  url: z.url().regex(/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/, "Use an HTTP loopback URL without credentials."),
  output: z.string().min(1).endsWith(".mp4").refine(value =>
    !value.includes("\\") && !value.includes("\0") && !/^[A-Za-z]:/.test(value)
    && value.split("/").every(part => part !== "" && part !== "." && part !== ".."),
  "Use a project-relative .mp4 path without traversal."),
  fps: ExportFrameRateSchema.default(60),
  width: z.number().int().min(64).max(3840).multipleOf(2).default(1440),
  height: z.number().int().min(64).max(3840).multipleOf(2).default(1000),
  audio: z.string().min(1).optional(),
  captions: z.string().min(1).optional(),
});
export const CaptureManifestSchema = z.strictObject({
  version: z.literal(1),
  durationMs: z.number().nonnegative().max(120_000),
  selector: z.literal('[data-flute-capture="scene"]'),
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
  out: projectRelativeFile(".mp4"),
  parallel: z.number().int().min(1).max(4).optional(),
  cacheDir: z.string().min(1).optional(),
  noCache: z.boolean().optional(),
  fps: ExportFrameRateSchema.optional(),
  width: z.number().int().min(64).max(3840).multipleOf(2).optional(),
  height: z.number().int().min(64).max(3840).multipleOf(2).optional(),
});
export type VideoRender = z.output<typeof VideoRenderSchema>;
export const VideoRenderResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), data: z.strictObject({
    out: z.string(), manifest: z.string(), frames: z.number().int().nonnegative(),
    durationMs: z.number().finite().nonnegative(), fps: z.number(), width: z.number(), height: z.number(),
    seed: z.number().int().nonnegative(), cachedFrames: z.number().int().nonnegative(), renderedFrames: z.number().int().nonnegative(),
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
  cacheDir: z.string().min(1).optional(),
  noCache: z.boolean().optional(),
}).superRefine((input, ctx) => {
  if (input.every !== undefined && input.at !== undefined)
    ctx.addIssue({ code: "custom", path: ["every"], message: "Pass only one of --every or --at." });
});
export type FramesRender = z.output<typeof FramesRenderSchema>;
export const FramesRenderResultSchema = z.discriminatedUnion("success", [
  z.strictObject({ success: z.literal(true), data: z.strictObject({
    out: z.string(), manifest: z.string(), total: z.number().int().nonnegative(),
    frames: z.array(z.strictObject({ frame: z.number().int().nonnegative(), file: z.string(), sha: z.string() })),
  }) }),
  z.strictObject({ success: z.literal(false), issues: z.array(ExportIssueSchema) }),
]);
export type FramesRenderResult = z.output<typeof FramesRenderResultSchema>;
// Single-scene still without a composition: ergonomic alias over frame render.
export const ShotRenderSchema = z.strictObject({
  scene: z.string().min(1).max(128),
  timeMs: z.number().finite().nonnegative().max(120_000),
  out: projectRelativeFile(".png"),
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
    audio: z.strictObject({ file: z.string(), codec: z.string(), driftMs: z.number(), peakDb: z.number().nullable() }).optional(),
    captions: z.strictObject({ file: z.string(), cues: z.number().int().nonnegative(), burnIn: z.boolean() }).optional(),
  }) }),
  z.strictObject({ success: z.literal(false), issues: z.array(ExportIssueSchema) }),
]);
export type ExportVideo = z.output<typeof ExportVideoSchema>;
export type CaptureManifest = z.output<typeof CaptureManifestSchema>;
export type CaptureBridge = CaptureManifest & { seek: (elapsedMs: number) => void };
export type ExportVideoResult = z.output<typeof ExportVideoResultSchema>;
