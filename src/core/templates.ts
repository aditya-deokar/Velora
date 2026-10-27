import { z } from "zod";
import { SceneRecipeIdSchema } from "./recipes";
import { AspectSchema, IntensitySchema, ShotKindSchema, buildShot, framingReport, ASPECT_FRAMES, type Aspect, type ShotDefinition, type ShotInput } from "./shots";

/** SOURCE OF TRUTH: TemplateManifestSchema, BlueprintSchema, TEMPLATE_CATALOG, BLUEPRINT_CATALOG, resolveTemplateParams, templateDefinition, certifyTemplate.
 * WHAT: the shipped template catalog (camera-move starting points with typed params, slots, craft
 * notes and certification thresholds) plus multi-scene blueprints, and the pure functions that
 * turn a template + params + aspect into a scene definition and certify its framing.
 * WHY: templates are starting points the creator owns: scaffolding copies plain recipe data into
 * the project, so one catalog serves the CLI, the guide, tests and the studio without a runtime engine.
 * WHERE: project/templates scaffolds recipe + binding files; CLI templates ls/show/check and new
 * scene/video read this catalog; skills describe it. Template IDs name techniques, never people.
 */
const TemplateParamSchema = z.discriminatedUnion("type", [
  z.strictObject({ name: z.string(), type: z.literal("number"), min: z.number(), max: z.number(), default: z.number(), unit: z.string().optional(), description: z.string() }),
  z.strictObject({ name: z.string(), type: z.literal("enum"), options: z.array(z.string()).min(1), default: z.string(), description: z.string() }),
  z.strictObject({ name: z.string(), type: z.literal("region"), description: z.string() }),
]);
export type TemplateParam = z.output<typeof TemplateParamSchema>;
// A same-origin path on the running app: leading "/", no protocol-relative "//", no scheme, no backslash or whitespace.
export const RouteSchema = z.string().max(512).regex(/^\/(?![/\\])[^\s\\]*$/, "Use a same-origin route path such as / or /pricing (no scheme, host or //).");
export const TemplateManifestSchema = z.strictObject({
  version: z.literal(1),
  id: SceneRecipeIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  category: z.enum(["camera", "layered", "motion-graphics"]),
  tags: z.array(z.enum(["hero", "feature", "detail", "website", "social", "loop", "transition", "data", "mobile"])).min(1),
  shot: ShotKindSchema,
  slots: z.array(z.strictObject({ name: z.string(), kinds: z.array(z.enum(["component", "route"])).min(1), required: z.boolean(), description: z.string() })).min(1),
  params: z.array(TemplateParamSchema),
  aspects: z.array(AspectSchema).min(1),
  craft: z.strictObject({ technique: z.string(), motivation: z.string(), lineage: z.string(), pitfalls: z.string(), pairsWith: z.array(SceneRecipeIdSchema) }),
  // Framing gates: every sample after `checkFrom` (fraction of the duration) keeps at least
  // this much of the subject in frame and this camera-plane margin; the region is sharp at the end.
  certification: z.strictObject({ minSubjectVisible: z.number().min(0).max(1), minDepthMargin: z.number().min(0), checkFrom: z.number().min(0).max(1).default(0), maxEndBlur: z.number().nonnegative().default(0.5) }),
});
export type TemplateManifest = z.output<typeof TemplateManifestSchema>;
export const BlueprintSchema = z.strictObject({
  version: z.literal(1),
  id: SceneRecipeIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  aspects: z.array(AspectSchema).min(1),
  scenes: z.array(z.strictObject({ template: SceneRecipeIdSchema, params: z.record(z.string(), z.union([z.string(), z.number()])).default({}) })).min(1),
  brief: z.string().min(1),
});
export type Blueprint = z.output<typeof BlueprintSchema>;

const intensity: TemplateParam = { name: "intensity", type: "enum", options: [...IntensitySchema.options], default: "subtle", description: "How far the move travels: subtle (restraint by default), standard or dramatic." };
const lens = (fallback: number): TemplateParam => ({ name: "lens", type: "number", min: 24, max: 135, default: fallback, unit: "mm", description: "Full-frame lens: wide (24-35 mm) exaggerates depth, long (85-135 mm) compresses it." });
const duration = (fallback: number, min = 2000, max = 15000): TemplateParam => ({ name: "durationMs", type: "number", min, max, default: fallback, unit: "ms", description: "Shot length in milliseconds." });
const region: TemplateParam = { name: "focusRegion", type: "region", description: "Subject pixels x,y,width,height (top-left origin) the shot frames and keeps sharp; defaults to the center third." };
const allAspects: Aspect[] = ["16:9", "21:9", "1:1", "4:5", "9:16"];
const subjectSlot = [{ name: "subject", kinds: ["component", "route"] as ("component" | "route")[], required: true, description: "The real page or component: --component path#Export or --route /path." }];
const template = (manifest: Omit<TemplateManifest, "version" | "slots" | "aspects"> & { aspects?: Aspect[] }): TemplateManifest =>
  TemplateManifestSchema.parse({ version: 1, slots: subjectSlot, aspects: allAspects, ...manifest });

export const TEMPLATE_CATALOG: readonly TemplateManifest[] = Object.freeze([
  template({ id: "hero-push", title: "The precise push-in", shot: "push-in", category: "camera", tags: ["hero", "feature"],
    summary: "A slow dolly-in on a three-quarter product plane; focus settles on the hero region as the camera arrives.",
    params: [intensity, lens(50), duration(6000), region],
    craft: { technique: "Single motivated dolly-in at a fixed angle; focus tracks the framed region.", motivation: "Opens a launch with gravity: here is the product.", lineage: "The patient, locked-on push-ins of modern thriller cinematography and product-film openers.", pitfalls: "Adding rotation (two ideas in one shot); pushing into the projection plane.", pairsWith: ["macro-detail", "orbit-reveal"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "monumental-survey", title: "The monumental surface", shot: "survey", category: "camera", tags: ["hero", "website"],
    summary: "A close oblique camera glides along the page as if it were a vast monolith; the near edge looms, the far edge recedes.",
    params: [intensity, lens(35), duration(8000)],
    craft: { technique: "Camera travel along the tilted page's own axis at a held angle and distance.", motivation: "Gives an ordinary page scale and drama.", lineage: "Monumental-scale framing in contemporary science-fiction cinematography.", pitfalls: "Fitting the whole page (loses scale); leveling the tilt at the end.", pairsWith: ["dolly-zoom", "hero-push"] },
    certification: { minSubjectVisible: 0.35, minDepthMargin: 0.15, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "orbit-reveal", title: "The hero arc", shot: "orbit", category: "camera", tags: ["hero", "feature"],
    summary: "The camera arcs around the product and lands on a hero three-quarter view.",
    params: [intensity, lens(50), duration(7000)],
    craft: { technique: "A smooth arc about the subject's center to a settled three-quarter angle.", motivation: "A product turntable reveal: shape first, then the hero view.", lineage: "Product turntables and automotive commercial arcs.", pitfalls: "Arcs past 60 degrees show edges; a tiny subject in empty void.", pairsWith: ["hero-push"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "crane-down", title: "Crane to hero", shot: "crane", category: "camera", tags: ["hero"],
    summary: "Starts in an overhead view, then cranes down and tilts up to the hero angle.",
    params: [intensity, lens(35), duration(7000)],
    craft: { technique: "Combined pedestal and tilt from a high angle to eye level.", motivation: "Establishes the whole product before settling on it.", lineage: "Jib and crane establishing shots.", pitfalls: "An overhead start that reads as a blank texture.", pairsWith: ["hero-push", "macro-detail"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "tilt-up-reveal", title: "The rise", shot: "rise", category: "camera", tags: ["hero", "social"],
    summary: "The plane starts nearly edge-on and rises to face the viewer, settling at a gentle angle.",
    params: [intensity, lens(50), duration(5000, 2000, 10000)],
    craft: { technique: "An expo-out tilt from edge-on to readable.", motivation: "A reveal that withholds the content for one beat.", lineage: "Keynote-style product rises.", pitfalls: "Holding edge-on too long; starting at 90 degrees (invisible).", pairsWith: ["kinetic-statement", "hero-push"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "dolly-zoom", title: "Vertigo", shot: "dolly-zoom", category: "camera", tags: ["feature", "transition"],
    summary: "The lens widens while the subject holds its size, so the depth around it stretches.",
    params: [intensity, lens(85), duration(5000, 2000, 10000)],
    craft: { technique: "An animated perspective with the subject held on the projection plane.", motivation: "An unsettling or epic emphasis beat.", lineage: "The dolly zoom made famous in Vertigo and Jaws.", pitfalls: "A flat face-on plane shows nothing; more than once per film.", pairsWith: ["monumental-survey"] },
    certification: { minSubjectVisible: 0.85, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "rack-focus", title: "The focus pull", shot: "rack-focus", category: "camera", tags: ["detail", "feature"],
    summary: "A locked camera on a steeply tilted page; focus pulls from the near edge to the far edge or a chosen region.",
    params: [intensity, lens(85), duration(5000, 2000, 10000), region],
    craft: { technique: "Shallow depth of field with focus distance racking between two depths.", motivation: "Moves attention without moving the camera.", lineage: "The focus puller's craft in narrative cinema.", pitfalls: "Both regions at the same depth (nothing pulls); blurring text past readability.", pairsWith: ["macro-detail"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "scroll-through", title: "The website showcase", shot: "scroll-through", category: "camera", tags: ["website", "hero"],
    summary: "The real page scrolls on a tilted plane while the camera drifts: the classic landing-page showcase.",
    params: [intensity, lens(50), duration(9000, 4000, 20000), { name: "scrollDistance", type: "number", min: 0, max: 20000, default: 2400, unit: "px", description: "How far the page scrolls over the shot." }],
    craft: { technique: "A channel-driven scroll inside a held three-quarter frame with gentle lateral drift.", motivation: "Shows a whole landing page in one continuous take.", lineage: "Website showcase reels.", pitfalls: "Scrolling faster than people can read; sticky headers covering content.", pairsWith: ["float-loop", "hero-push"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "macro-detail", title: "Detail to context", shot: "macro", category: "camera", tags: ["detail", "feature", "data"],
    summary: "An extreme close-up on one meaningful control or metric, then a slow pull back that reveals where it lives.",
    params: [intensity, lens(85), duration(6000), region],
    craft: { technique: "Camera centered on the region at macro distance, pulling out to the whole subject.", motivation: "Makes one detail the hero, then explains its context.", lineage: "Macro inserts in product films; the detail-to-context progression of editing grammar.", pitfalls: "A detail that means nothing; zooming until the projection clips.", pairsWith: ["hero-push", "rack-focus"] },
    certification: { minSubjectVisible: 0.15, minDepthMargin: 0.25, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "float-loop", title: "The living hero", shot: "float-loop", category: "camera", tags: ["loop", "website", "hero"],
    summary: "A gentle bob and slow arc that return exactly to the start: a seamless website hero background.",
    params: [intensity, lens(50), duration(8000, 4000, 20000)],
    craft: { technique: "Sine-eased swing and bob with zero velocity at every extreme and an exact seam.", motivation: "Ambient motion that never distracts from copy laid over it.", lineage: "Loop design for web hero media.", pitfalls: "Motion large enough to compete with page copy; noise on loops.", pairsWith: ["scroll-through"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "handheld-push", title: "Documentary energy", shot: "handheld-push", category: "camera", tags: ["social", "hero"],
    summary: "A push-in with seeded handheld micro-motion for urgency in social cuts.",
    params: [intensity, lens(50), duration(4000, 2000, 10000), region, { name: "seed", type: "number", min: 0, max: 4294967295, default: 1, description: "Handheld noise seed; change it for a different but replayable shake." }],
    craft: { technique: "A push-in with seeded noise on camera x, y and roll.", motivation: "Energy and immediacy for social edits.", lineage: "Handheld documentary camerawork.", pitfalls: "Noise on text-dense close-ups, on loops or on every shot of a film.", pairsWith: ["whip-pan"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0, maxEndBlur: 0.5 } }),
  template({ id: "whip-pan", title: "The whip", shot: "whip", category: "camera", tags: ["transition", "social"],
    summary: "A fast lateral whip that lands and settles on the subject; best as a transition-in. Motion blur (Phase 04) sells it.",
    params: [intensity, lens(50), duration(2500, 1500, 6000)],
    craft: { technique: "An expo-out lateral pan from off-frame to the subject, then a hold.", motivation: "Rhythmic energy between beats.", lineage: "Whip pans in stylized comedic and symmetrical filmmaking.", pitfalls: "More than one whip per 15 seconds; strobing without motion blur.", pairsWith: ["handheld-push"] },
    certification: { minSubjectVisible: 0.9, minDepthMargin: 0.3, checkFrom: 0.3, maxEndBlur: 0.5 } }),
]);

export const BLUEPRINT_CATALOG: readonly Blueprint[] = Object.freeze([
  BlueprintSchema.parse({ version: 1, id: "product-reel-20s", title: "Product reel (20 s)", aspects: allAspects,
    summary: "Four camera shots of the same product with hard cuts: push-in, detail, scroll, hero arc.",
    scenes: [{ template: "hero-push", params: { durationMs: 5000 } }, { template: "macro-detail", params: { durationMs: 5000 } },
      { template: "scroll-through", params: { durationMs: 6000 } }, { template: "orbit-reveal", params: { durationMs: 4000 } }],
    brief: "Hook with the push-in, prove one detail, show the whole page, end on the hero arc. Cut on the settle of each move." }),
  BlueprintSchema.parse({ version: 1, id: "website-hero-loop-8s", title: "Website hero loop (8 s)", aspects: ["16:9", "21:9", "1:1"],
    summary: "One seamless float loop of the landing page for a website hero background.",
    scenes: [{ template: "float-loop", params: { durationMs: 8000 } }],
    brief: "Keep motion quieter than the copy above it. Export muted, looping and small; pair with a poster frame." }),
]);

export type ParamValue = string | number | { x: number; y: number; width: number; height: number };
export type TemplateIssue = { code: string; path: string; message: string };
/** Validate and coerce overrides (CLI --set strings or numbers) against the template's typed params. */
export function resolveTemplateParams(manifest: TemplateManifest, overrides: Readonly<Record<string, string | number>>): { params: Record<string, ParamValue>; issues: TemplateIssue[] } {
  const params: Record<string, ParamValue> = {};
  const issues: TemplateIssue[] = [];
  for (const name of Object.keys(overrides))
    if (!manifest.params.some(param => param.name === name))
      issues.push({ code: "ERR_TEMPLATE_PARAM", path: `params.${name}`, message: `Template ${manifest.id} has no param "${name}". Available: ${manifest.params.map(param => param.name).join(", ")}.` });
  for (const param of manifest.params) {
    const raw = overrides[param.name];
    if (param.type === "region") {
      if (raw === undefined) continue;
      const parts = String(raw).split(",").map(part => Number(part.trim()));
      if (parts.length !== 4 || parts.some(part => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0)
        issues.push({ code: "ERR_TEMPLATE_PARAM", path: `params.${param.name}`, message: `${param.name} must be x,y,width,height in subject pixels (width and height positive).` });
      else params[param.name] = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    } else if (param.type === "enum") {
      const value = raw === undefined ? param.default : String(raw);
      if (!param.options.includes(value)) issues.push({ code: "ERR_TEMPLATE_PARAM", path: `params.${param.name}`, message: `${param.name} must be one of ${param.options.join(", ")}.` });
      else params[param.name] = value;
    } else {
      const value = raw === undefined ? param.default : typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value) || value < param.min || value > param.max)
        issues.push({ code: "ERR_TEMPLATE_PARAM", path: `params.${param.name}`, message: `${param.name} must be a number from ${param.min} to ${param.max}${param.unit ? " " + param.unit : ""}.` });
      else params[param.name] = value;
    }
  }
  return { params, issues };
}
export function findTemplate(id: string): TemplateManifest | undefined {
  return TEMPLATE_CATALOG.find(entry => entry.id === id);
}
export function findBlueprint(id: string): Blueprint | undefined {
  return BLUEPRINT_CATALOG.find(entry => entry.id === id);
}
/** The shot input a resolved template compiles to. */
export function templateShotInput(manifest: TemplateManifest, params: Record<string, ParamValue>, aspect: Aspect, subject?: { width: number; height: number }): ShotInput {
  return {
    kind: manifest.shot, aspect, ...(subject ? { subject } : {}),
    ...(typeof params.intensity === "string" ? { intensity: params.intensity as ShotInput["intensity"] } : {}),
    ...(typeof params.lens === "number" ? { lens: params.lens } : {}),
    ...(typeof params.durationMs === "number" ? { durationMs: params.durationMs } : {}),
    ...(typeof params.focusRegion === "object" ? { focusRegion: params.focusRegion } : {}),
    ...(typeof params.scrollDistance === "number" ? { scrollDistance: params.scrollDistance } : {}),
    ...(typeof params.seed === "number" ? { seed: params.seed } : {}),
  };
}
export function templateDefinition(manifest: TemplateManifest, params: Record<string, ParamValue>, aspect: Aspect, subject?: { width: number; height: number }): ShotDefinition {
  return buildShot(templateShotInput(manifest, params, aspect, subject));
}
/** Framing certification for one template configuration; failures name the gate and the time. */
export function certifyTemplate(manifest: TemplateManifest, params: Record<string, ParamValue>, aspect: Aspect): TemplateIssue[] {
  const subject = ASPECT_FRAMES[aspect].subject;
  const definition = templateDefinition(manifest, params, aspect);
  // Without a chosen region, a rack pull lands on the far edge (centered 30% above the subject center).
  const focusRegion = typeof params.focusRegion === "object" ? params.focusRegion
    : manifest.shot === "rack-focus" ? { x: subject.width * 0.4, y: subject.height * 0.15, width: subject.width * 0.2, height: subject.height * 0.1 } : undefined;
  const report = framingReport(definition, subject, focusRegion ? { focusRegion } : {});
  const { minSubjectVisible, minDepthMargin, checkFrom, maxEndBlur } = manifest.certification;
  const duration = definition.motion.durationMs;
  const issues: TemplateIssue[] = [];
  for (const sample of report.samples) {
    if (sample.timeMs < checkFrom * duration) continue;
    if (sample.subjectVisible < minSubjectVisible)
      issues.push({ code: "ERR_TEMPLATE_FRAMING", path: `${manifest.id}@${aspect}`, message: `Only ${(sample.subjectVisible * 100).toFixed(0)}% of the subject is in frame at ${Math.round(sample.timeMs)}ms (needs ${minSubjectVisible * 100}%).` });
    if (sample.depthMargin < minDepthMargin)
      issues.push({ code: "ERR_TEMPLATE_FRAMING", path: `${manifest.id}@${aspect}`, message: `The subject comes within ${(sample.depthMargin * 100).toFixed(0)}% of the camera plane at ${Math.round(sample.timeMs)}ms.` });
  }
  const last = report.samples[report.samples.length - 1];
  if (last.regionBlur > maxEndBlur || last.regionVisible < 0.95)
    issues.push({ code: "ERR_TEMPLATE_FRAMING", path: `${manifest.id}@${aspect}`, message: `The focus region ends ${last.regionVisible < 0.95 ? "out of frame" : `soft (${last.regionBlur.toFixed(2)}px blur)`}.` });
  return issues;
}
