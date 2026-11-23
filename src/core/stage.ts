import { z } from "zod";
import { evaluateScene, projectWorld } from "./spatial";
import { evaluateMotion, motionDuration, withAdditive, withCameraAdditive, type MotionInput } from "./motion";
import { TransformSchema, type CameraDefinition, type SceneDefinition } from "./scene";

/** SOURCE OF TRUTH: StageSchema, STAGE_PRESETS, resolutionBudget.
 * WHAT: concrete logical viewport and DPR, placement, and sampled raster demand.
 * WHY: video dimensions and host-device metrics must never change the authored layout.
 * WHERE: recipes store the stage, AppStage consumes it, and export and review read its DPR.
 */
export const STAGE_PRESETS = Object.freeze({
  "laptop-14": Object.freeze({ width: 1512, height: 982, dpr: 2, physicalWidthMm: 302 }),
  "laptop-13": Object.freeze({ width: 1440, height: 900, dpr: 2, physicalWidthMm: 286 }),
  "laptop-16": Object.freeze({ width: 1728, height: 1117, dpr: 2, physicalWidthMm: 346 }),
  "desktop-1080": Object.freeze({ width: 1920, height: 1080, dpr: 1, physicalWidthMm: 531 }),
} as const);
export const DEFAULT_STAGE = "laptop-14";
export const STAGE_DPRS = [1, 1.25, 1.5, 1.75, 2, 3] as const;
export const StageDprSchema = z.literal(STAGE_DPRS);
export const StagePresetSchema = z.enum(["laptop-14", "laptop-13", "laptop-16", "desktop-1080", "user-native", "custom"]);
const dimension = z.number().int().min(320).max(3840);
const measuredSize = z.number().int().positive().max(100_000);
const measuredDpr = z.number().positive().max(100);
const detection = z.strictObject({
  innerWidth: measuredSize, innerHeight: measuredSize, screenWidth: measuredSize, screenHeight: measuredSize,
  devicePixelRatio: measuredDpr, basis: z.enum(["window", "screen"]), atIso: z.iso.datetime({ offset: true }),
});
export const StageSizeSchema = z.strictObject({ width: dimension, height: dimension, dpr: StageDprSchema });
export const StageSchema = z.strictObject({
  ...StageSizeSchema.shape,
  preset: StagePresetSchema.optional(),
  physicalWidthMm: z.number().gt(50).max(2000).optional(),
  detected: detection.optional(),
}).superRefine(({ preset, ...stage }, ctx) => {
  if (!preset || preset === "custom" || preset === "user-native") return;
  const expected = STAGE_PRESETS[preset];
  for (const key of ["width", "height", "dpr", "physicalWidthMm"] as const) {
    if (stage[key] !== expected[key])
      ctx.addIssue({ code: "custom", path: [key], message: `Use the ${preset} value ${expected[key]} or choose the custom preset.` });
  }
});
export type Stage = z.output<typeof StageSchema>;
export type StageSize = z.output<typeof StageSizeSchema>;
export type StageDpr = StageSize["dpr"];
type Size = Pick<StageSize, "width" | "height">;

export function stageFromSpec(spec: string, preset?: "user-native" | "custom"): Stage | undefined {
  if (!preset && Object.hasOwn(STAGE_PRESETS, spec)) {
    const id = spec as keyof typeof STAGE_PRESETS;
    return { preset: id, ...STAGE_PRESETS[id] };
  }
  const match = /^(\d+)x(\d+)@(\d+(?:\.\d+)?)$/i.exec(spec);
  if (!match) return undefined;
  const parsed = StageSchema.safeParse({ preset: preset ?? "custom", width: Number(match[1]), height: Number(match[2]), dpr: Number(match[3]),
    ...(preset === "user-native" ? { physicalWidthMm: STAGE_PRESETS[DEFAULT_STAGE].physicalWidthMm } : {}) });
  return parsed.success ? parsed.data : undefined;
}

type ViewportMetrics = Omit<z.input<typeof detection>, "basis">;
export function stageFromViewport(metrics: ViewportMetrics, { basis = "window" }: { basis?: "window" | "screen" } = {}): Stage {
  const clamp = (value: number) => Math.min(3840, Math.max(320, Math.round(value)));
  const { atIso, devicePixelRatio, ...sizes } = metrics;
  const detectedSizes = Object.fromEntries(Object.entries(sizes).map(([key, value]) => [key, Math.max(1, Math.round(value))]));
  const nearest = STAGE_DPRS.reduce((best, value) => Math.abs(value - metrics.devicePixelRatio) < Math.abs(best - metrics.devicePixelRatio) ? value : best, 1 as StageDpr);
  return StageSchema.parse({
    preset: "user-native",
    width: clamp(basis === "window" ? metrics.innerWidth : metrics.screenWidth),
    height: clamp(basis === "window" ? metrics.innerHeight : metrics.screenHeight),
    dpr: nearest,
    physicalWidthMm: STAGE_PRESETS[DEFAULT_STAGE].physicalWidthMm,
    detected: { ...detectedSizes, atIso, devicePixelRatio, basis },
  });
}

export function fitStage(stage: Size, frame: Size, fill = 1) {
  const scale = Math.min(frame.width / stage.width, frame.height / stage.height) * fill;
  const width = stage.width * scale, height = stage.height * scale;
  return { width, height, scale, left: (frame.width - width) / 2, top: (frame.height - height) / 2 };
}

export function resolutionBudget(input: {
  frame: Size; effectiveDpr: number; coverScale?: number;
  samples: readonly { timeMs: number; camera: CameraDefinition; target: readonly number[]; scale?: number }[];
}) {
  let peak = { timeMs: 0, pixelsPerCssPixel: 0 };
  for (const { timeMs, camera, target, scale = 1 } of input.samples) {
    const center = projectWorld(camera, input.frame, target, "view");
    if (!center) continue;
    const demand = scale * camera.perspective / center.depth * (camera.zoom ?? 1) * (input.coverScale ?? 1);
    if (demand > peak.pixelsPerCssPixel) peak = { timeMs, pixelsPerCssPixel: demand };
  }
  return { ...peak, effectiveDpr: input.effectiveDpr, undersampled: peak.pixelsPerCssPixel > input.effectiveDpr * 1.1 };
}

const transformBase = TransformSchema.parse({});
/** Estimate the raster demand when inspecting authored data without a live DOM. */
export function sceneStageBudget(input: {
  stage: Stage; frame: Size; scene: SceneDefinition; motion: MotionInput; effectiveDpr: number;
  placementScale?: number;
}) {
  const { stage, frame, scene, motion } = input;
  const duration = motionDuration(motion);
  const subject = scene.nodes.find(node => node.id === "subject") ?? scene.nodes[0];
  const focusTarget = scene.constraints?.slice().reverse().find(item => item.kind === "focusFollow" && !("three" in item.target))?.target;
  const placementScale = input.placementScale ?? 1;
  const measurements = subject ? { [subject.id]: { width: stage.width * placementScale, height: stage.height * placementScale } } : {};
  const samples = Array.from({ length: duration ? 25 : 1 }, (_, index) => {
    const timeMs = index * duration / 24;
    const values = evaluateMotion(motion, timeMs);
    const evaluation = evaluateScene({
      ...scene,
      camera: withCameraAdditive({ ...scene.camera, ...values.camera }, values.additive?.camera, values.cameraPositionSpace),
      focus: withAdditive({ ...scene.focus, ...values.focus }, values.additive?.focus),
      nodes: scene.nodes.map(node => ({
        ...node, transform: withAdditive({
          ...node.transform,
          ...Object.fromEntries(Object.entries(values.surfaces[node.id] ?? {}).filter(([key]) => Object.hasOwn(transformBase, key) || key === "position")),
        }, values.additive?.surfaces?.[node.id], transformBase),
      })),
    }, measurements, { channels: values.channels });
    const camera = evaluation.camera ?? scene.camera;
    const node = evaluation.nodes.find(entry => entry.id === (focusTarget && "surface" in focusTarget ? focusTarget.surface : subject?.id));
    const z = focusTarget ? evaluation.focusDepth : node?.world[11] ?? evaluation.focusDepth;
    const target = [0, 0, z];
    const scale = placementScale * (node ? Math.max(Math.hypot(node.world[0], node.world[4], node.world[8]), Math.hypot(node.world[1], node.world[5], node.world[9])) : 1);
    return { timeMs, camera, target, scale };
  });
  return resolutionBudget({ frame, effectiveDpr: input.effectiveDpr, samples });
}
