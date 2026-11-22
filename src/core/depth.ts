import { z } from "zod";
import { hashSeed } from "./random";
import { applyPoint, focusForSurface, intersectPlane, invertAffine, projectWorld, screenRay, signedFocus, type Matrix } from "./spatial";
import type { CameraDefinition, FocusDefinition } from "./scene";

/** SOURCE OF TRUTH: DEPTH_TIERS, classifyDepth, evaluateDepthLayers.
 * WHAT: classify layout snapshots and derive elevation, projection and light from the scene camera.
 * WHY: Studio and export must evaluate the same depth at the same scene time.
 * WHERE: React supplies layout and paints the result, and authoring stores rules and frozen layers.
 */
export const DEPTH_TIERS = Object.freeze({
  base: Object.freeze({ z: 0, extrude: 0 }), container: Object.freeze({ z: 8, extrude: 2 }),
  card: Object.freeze({ z: 24, extrude: 4 }), control: Object.freeze({ z: 40, extrude: 2 }),
  floating: Object.freeze({ z: 96, extrude: 3 }), cursor: Object.freeze({ z: 120, extrude: 0 }),
});
export const DEFAULT_DEPTH_LIGHT = Object.freeze({ azimuthDeg: -35, elevationDeg: 55, intensity: 1, sheen: 0.12 });
const intensityFactors = { subtle: 0.5, standard: 1, dramatic: 2 } as const;
export const DepthTierSchema = z.enum(["base", "container", "card", "control", "floating", "cursor"]);
export const DepthModeSchema = z.enum(["auto", "rules", "off"]);
export const DepthIntensitySchema = z.enum(["subtle", "standard", "dramatic"]);
const tierOrder = DepthTierSchema.options;
const zPixels = z.number().finite().min(0).max(3840);
const extrusion = z.number().finite().min(0).max(128);
const anchorMatch = z.strictObject({ anchor: z.string().min(1).max(240) });
const selectorMatch = z.strictObject({ selector: z.string().min(1).max(4096) });
const ruleMatch = z.union([anchorMatch, selectorMatch, z.strictObject({ tier: DepthTierSchema })]);
export const DepthRuleSchema = z.union([
  z.strictObject({ match: ruleMatch, tier: DepthTierSchema }),
  z.strictObject({ match: ruleMatch, z: zPixels }),
]);
export const ResolvedDepthLayerSchema = z.strictObject({ match: z.union([anchorMatch, selectorMatch]), tier: DepthTierSchema, z: zPixels });
export const ResolvedDepthSchema = z.strictObject({ hash: z.string().regex(/^[0-9a-f]{8}$/), layers: z.array(ResolvedDepthLayerSchema).max(128) });
export const DepthFocusSampleSchema = z.strictObject({ depth: z.number(), signed: z.number(), blur: z.number().nonnegative() });
export type DepthFocusSample = z.output<typeof DepthFocusSampleSchema>;
export const DepthEvidenceSchema = ResolvedDepthSchema.extend({ surface: z.string().min(1), focus: z.array(DepthFocusSampleSchema).max(128).optional() });
export const DepthLineageSchema = DepthEvidenceSchema.pick({ surface: true, hash: true });
export const DepthConfigSchema = z.strictObject({
  mode: DepthModeSchema,
  render: z.enum(["auto", "volumetric", "projected"]).optional(), intensity: DepthIntensitySchema.optional(),
  tiers: z.partialRecord(DepthTierSchema, z.strictObject({ z: zPixels.optional(), extrude: extrusion.optional() })).optional(),
  rules: z.array(DepthRuleSchema).max(256).optional(), maxLayers: z.number().int().min(1).max(128).optional(),
  light: z.strictObject({ azimuthDeg: z.number().min(-360).max(360).optional(), elevationDeg: z.number().min(5).max(90).optional(),
    intensity: z.number().min(0).max(4).optional(), sheen: z.number().min(0).max(1).optional() }).optional(),
  resolved: ResolvedDepthSchema.optional(),
});
const depthSurfaceLimit = 32;
export const DepthMapSchema = z.record(z.string().min(1).max(128), DepthConfigSchema)
  .refine(value => Object.keys(value).length <= depthSurfaceLimit, `Configure depth on at most ${depthSurfaceLimit} surfaces.`)
  .meta({ maxProperties: depthSurfaceLimit });
export type DepthTier = z.output<typeof DepthTierSchema>;
export type DepthConfig = z.output<typeof DepthConfigSchema>;
export type DepthMap = z.output<typeof DepthMapSchema>;
export type ResolvedDepth = z.output<typeof ResolvedDepthSchema>;
export type DepthEvidence = z.output<typeof DepthEvidenceSchema>;
export type DepthMatch = z.output<typeof ResolvedDepthLayerSchema>["match"];
export type DepthRect = { x: number; y: number; width: number; height: number };
export type DepthSnapshotNode = {
  order: number; parent?: number; tag: string; role?: string; tier?: string; anchor?: string;
  attrs?: Readonly<Record<string, string>>; selectors?: readonly string[];
  rect: DepthRect;
  style: {
    position: string; zIndex: number; display: string; visibility: string; backgroundAlpha: number;
    boxShadow: string; borderWidth: number; radius: number; overflow: string; opacity: number;
    filter: string; clipPath: string; mask: string; isolation: string; mixBlendMode: string; contain: string;
  };
};
export type DepthSnapshot = { width: number; height: number; nodes: readonly DepthSnapshotNode[] };
export type DepthLayer = {
  order: number; tier: DepthTier; z: number; extrude: number; rect: DepthRect; parent?: number; localZ: number;
  flattened?: { order: number; property: string };
};

export function depthGroupingProperty(node: DepthSnapshotNode): string | undefined {
  const css = node.style;
  if (node.tier === "flat") return "flat";
  if (css.overflow.split(/\s+/).some(value => value !== "visible" && value !== "clip")) return "overflow";
  if (css.opacity < 1) return "opacity";
  if (css.filter !== "none") return "filter";
  if (css.clipPath !== "none") return "clip-path";
  if (css.mask !== "none") return "mask";
  if (css.isolation === "isolate") return "isolation";
  if (css.mixBlendMode !== "normal") return "mix-blend-mode";
  if (/\b(paint|strict|content)\b/.test(css.contain)) return "contain";
}

function automaticTier(node: DepthSnapshotNode, area: number): DepthTier {
  const { tag, role = "", attrs = {}, style } = node;
  const fraction = node.rect.width * node.rect.height / area;
  if (["dialog", "tooltip", "menu"].includes(role) || tag === "dialog" || Object.hasOwn(attrs, "popover") || style.position === "fixed" && style.zIndex > 0) return "floating";
  if (["button", "input", "select", "textarea", "canvas", "meter", "progress"].includes(tag) ||
    ["button", "tab", "switch", "checkbox", "radio", "slider", "status", "progressbar"].includes(role) ||
    tag === "svg" && node.rect.width >= 80 && node.rect.height >= 48 || Object.hasOwn(attrs, "data-badge")) return "control";
  if (["aside", "nav", "header", "footer", "fieldset"].includes(tag) || ["navigation", "complementary", "banner", "tabpanel"].includes(role)) return "container";
  if (fraction >= 0.01 && fraction <= 0.4 && style.radius > 0 && (style.backgroundAlpha > 0 || style.boxShadow !== "none" || style.borderWidth > 0)) return "card";
  return "base";
}
function matches(node: DepthSnapshotNode, tier: DepthTier, match: z.output<typeof ruleMatch>) {
  return "anchor" in match ? node.anchor === match.anchor : "selector" in match ? node.selectors?.includes(match.selector) === true : tier === match.tier;
}
function closestTier(z: number): DepthTier {
  return tierOrder.reduce((tier, candidate) => z >= DEPTH_TIERS[candidate].z ? candidate : tier, "base" as DepthTier);
}
function chooseLayer(node: DepthSnapshotNode, config: DepthConfig, area: number) {
  if (node.tier === "none" || node.tier === "flat" || node.style.display === "none" || node.style.visibility !== "visible" || node.rect.width <= 0 || node.rect.height <= 0) return;
  if (config.resolved) return config.resolved.layers.find(layer => matches(node, layer.tier, layer.match));
  const detected = automaticTier(node, area);
  const marked = node.tier && Object.hasOwn(DEPTH_TIERS, node.tier) ? node.tier as DepthTier : undefined;
  const pixels = node.tier && /^\d+(?:\.\d+)?(?:px)?$/i.test(node.tier) ? Number.parseFloat(node.tier) : NaN;
  const rule = !marked && !Number.isFinite(pixels) ? config.rules?.find(value => matches(node, detected, value.match)) : undefined;
  const z = Number.isFinite(pixels) ? Math.min(3840, pixels) : rule && "z" in rule ? rule.z : undefined;
  const tier = marked ?? (rule && "tier" in rule ? rule.tier : z !== undefined ? closestTier(z) : config.mode === "auto" ? detected : "base");
  return { tier, z: z ?? config.tiers?.[tier]?.z ?? DEPTH_TIERS[tier].z };
}

export function classifyDepth(snapshot: DepthSnapshot, config: DepthConfig): DepthLayer[] {
  if (config.mode === "off" || !(snapshot.width > 0 && snapshot.height > 0)) return [];
  const byOrder = new Map(snapshot.nodes.map(node => [node.order, node]));
  const explicitlyFlat = new Set<number>();
  const candidates = snapshot.nodes.flatMap(node => {
    if (node.tier === "flat" || node.parent !== undefined && explicitlyFlat.has(node.parent)) { explicitlyFlat.add(node.order); return []; }
    const selected = chooseLayer(node, config, snapshot.width * snapshot.height);
    if (!selected || selected.z === 0 && selected.tier === "base") return [];
    const { tier, z } = selected;
    return [{ order: node.order, tier, z, rect: node.rect, extrude: config.tiers?.[tier]?.extrude ?? DEPTH_TIERS[tier].extrude }];
  });
  const retained = candidates.sort((a, b) => tierOrder.indexOf(b.tier) - tierOrder.indexOf(a.tier) ||
    b.rect.width * b.rect.height - a.rect.width * a.rect.height || a.order - b.order).slice(0, config.maxLayers ?? 48);
  const lifted = new Map<number, DepthLayer>();
  for (const layer of retained.sort((a, b) => a.order - b.order)) {
    let parent = byOrder.get(layer.order)?.parent;
    let ancestor: DepthLayer | undefined;
    let flattened: DepthLayer["flattened"];
    while (parent !== undefined && parent < layer.order) {
      const entry = byOrder.get(parent);
      if (!entry) break;
      ancestor ??= lifted.get(parent);
      const property = depthGroupingProperty(entry);
      if (property && (!flattened || property === "flat")) flattened = { order: parent, property };
      parent = entry.parent;
    }
    const z = Math.max(layer.z, ancestor?.z ?? 0);
    lifted.set(layer.order, { ...layer, z, localZ: z - (ancestor?.z ?? 0), ...(ancestor ? { parent: ancestor.order } : {}), ...(flattened ? { flattened } : {}) });
  }
  return [...lifted.values()];
}

export function hashDepthLayers(layers: ResolvedDepth["layers"]) {
  const ordered = layers.map(layer => ["anchor" in layer.match ? ["anchor", layer.match.anchor] : ["selector", layer.match.selector], layer.tier, layer.z]);
  return (hashSeed(JSON.stringify(ordered)) >>> 0).toString(16).padStart(8, "0");
}

type Vec3 = [number, number, number];
const normalized = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};
const radians = Math.PI / 180;
const viewportOrigin = { width: 0, height: 0 };
export type EvaluatedDepthLayer = DepthLayer & {
  world: Vec3; height: number;
  shadow: { x: number; y: number; blur: number; opacity: number; z: number };
  edge: { thickness: number; shades: readonly number[] };
  sheen: { u: number; v: number; opacity: number };
  projected: { x: number; y: number; scale: number; centerX: number; centerY: number; absoluteScale: number };
};

export function sampleDepthFocus(matrix: Matrix, center: readonly number[], camera: CameraDefinition, focus: FocusDefinition) {
  const world: Matrix = [matrix[0], matrix[1], matrix[2], center[0], matrix[4], matrix[5], matrix[6], center[1],
    matrix[8], matrix[9], matrix[10], center[2], 0, 0, 0, 1];
  const field = focusForSurface(world, focus, camera.perspective);
  const sample = signedFocus(field);
  const screenScale = camera.perspective / Math.max(1, sample.depth) * (camera.zoom ?? 1);
  return { ...sample, blur: sample.blur * screenScale, sigma: sample.blur / Math.max(1e-6, field.scale), screenScale };
}

/** Surface matrix maps the snapshot's top-left layout coordinates into camera space. */
export function evaluateDepthLayers(surfaceWorld: Matrix, layers: readonly DepthLayer[], camera: CameraDefinition,
  light: DepthConfig["light"] = {}, intensity: DepthConfig["intensity"] = "standard", elevation = 1, projectOnPlane = true): EvaluatedDepthLayer[] {
  const inverse = invertAffine(surfaceWorld);
  if (!inverse) return [];
  const eye = applyPoint(inverse, [0, 0, camera.perspective]);
  const setup = { ...DEFAULT_DEPTH_LIGHT, ...light };
  const az = setup.azimuthDeg * radians, el = setup.elevationDeg * radians;
  const direction: Vec3 = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
  const [lx, ly, lz] = direction;
  const factor = intensityFactors[intensity] * Math.max(0, elevation);
  const absolute = new Map<number, { x: number; y: number; u: number; v: number; scale: number }>();
  const project = (world: Vec3) => {
    const pixel = projectWorld(camera, viewportOrigin, world, "view");
    if (!pixel) return;
    const hit = intersectPlane(screenRay(camera, viewportOrigin, pixel), surfaceWorld);
    if (hit) return { u: hit.u, v: hit.v, scale: hit.t * camera.perspective / pixel.depth };
  };
  return layers.map(layer => {
    const x = layer.rect.x + layer.rect.width / 2, y = layer.rect.y + layer.rect.height / 2;
    const z = layer.z * factor, height = layer.localZ * factor;
    const world = applyPoint(surfaceWorld, [x, y, z]);
    const projected = (projectOnPlane ? project(world) : undefined) ?? { u: x, v: y, scale: 1 };
    absolute.set(layer.order, { x, y, ...projected });
    const parent = layer.parent === undefined ? undefined : absolute.get(layer.parent);
    const dx = parent ? (projected.u - parent.u) / parent.scale - (x - parent.x) : projected.u - x;
    const dy = parent ? (projected.v - parent.v) / parent.scale - (y - parent.y) : projected.v - y;
    const [vx, vy, vz] = normalized([eye[0] - x, eye[1] - y, eye[2] - z]);
    const [hx, hy, hz] = normalized([lx + vx, ly + vy, lz + vz]);
    return { ...layer, localZ: height, z, height, world,
      shadow: { x: height * lx / lz, y: height * ly / lz, blur: 0.6 * height, opacity: height ? Math.min(0.36, setup.intensity * 0.34 / (1 + height / 30)) : 0, z: z - height },
      edge: { thickness: Math.min(height, layer.extrude * factor), shades: [-ly, lx, ly, -lx].map(dot => Math.max(0.16, Math.min(0.88, 0.38 + dot * setup.intensity * 0.35))) },
      sheen: { u: 50 + 46 * hx, v: 50 + 46 * hy, opacity: height > 0 ? Math.min(0.18, setup.sheen * Math.max(0, hz) ** 12) : 0 },
      projected: { x: dx, y: dy, scale: projected.scale / (parent?.scale ?? 1), centerX: projected.u, centerY: projected.v, absoluteScale: projected.scale },
    };
  });
}
