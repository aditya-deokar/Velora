import { z } from "zod";
import { DEFAULT_DEPTH_LIGHT, type DepthMap } from "./depth";
import { SceneRecipeIdSchema } from "./recipes";
import type { ElementTarget } from "./targets";
import { AspectSchema, IntensitySchema, ShotKindSchema, buildShot, lockShotFocus, framingReport, projectPoints, ASPECT_FRAMES, type Aspect, type ShotDefinition, type ShotInput } from "./shots";
import { fitStage, type Stage } from "./stage";
import { SegmentTransitionSchema } from "./transitions";
import { COMPOSITE_IDS, buildComposite, readingTimeMs, type CompositeDefinition } from "./composites";

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
  z.strictObject({ name: z.string(), type: z.literal("text"), default: z.string(), maxLength: z.number().int().positive().max(2000), description: z.string() }),
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
  tags: z.array(z.enum(["hero", "feature", "detail", "website", "social", "loop", "transition", "data", "mobile", "type", "brand"])).min(1),
  // Camera templates compile a shot; layered and motion-graphics templates compile a composite layout.
  shot: ShotKindSchema.optional(),
  composite: z.enum(COMPOSITE_IDS).optional(),
  slots: z.array(z.strictObject({ name: z.string(), kinds: z.array(z.enum(["component", "route"])).min(1), required: z.boolean(), description: z.string() })),
  params: z.array(TemplateParamSchema),
  aspects: z.array(AspectSchema).min(1),
  craft: z.strictObject({ technique: z.string(), motivation: z.string(), lineage: z.string(), pitfalls: z.string(), pairsWith: z.array(SceneRecipeIdSchema) }),
  // Framing gates: every sample after `checkFrom` (fraction of the duration) keeps at least
  // this much of the subject in frame and this camera-plane margin; the region is sharp at the end.
  certification: z.strictObject({ minSubjectVisible: z.number().min(0).max(1), minDepthMargin: z.number().min(0), checkFrom: z.number().min(0).max(1).default(0), maxEndBlur: z.number().nonnegative().default(0.5) }),
}).refine(manifest => (manifest.shot === undefined) !== (manifest.composite === undefined), "A template compiles exactly one of shot or composite.");
export type TemplateManifest = z.output<typeof TemplateManifestSchema>;
const BlueprintParams = z.record(z.string(), z.union([z.string(), z.number()])).default({});
export const BlueprintSchema = z.strictObject({
  version: z.literal(1),
  id: SceneRecipeIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  aspects: z.array(AspectSchema).min(1),
  // V1 shots in order; an overlap transition starts its shot that much before the previous one ends.
  scenes: z.array(z.strictObject({ template: SceneRecipeIdSchema, params: BlueprintParams, section: z.string().max(40).optional(), transition: SegmentTransitionSchema.optional() })).min(1),
  // V2 graphics over the picture (times on the finished timeline).
  overlays: z.array(z.strictObject({ template: SceneRecipeIdSchema, params: BlueprintParams, startMs: z.number().nonnegative(), durationMs: z.number().positive() })).default([]),
  // Caption skeleton written as <id>.captions.srt (style karaoke) for the creator to rewrite.
  captions: z.array(z.strictObject({ startMs: z.number().nonnegative(), endMs: z.number().positive(), text: z.string().min(1) })).default([]),
  // Music cue suggestions written as cue markers (no music is bundled).
  cues: z.array(z.strictObject({ atMs: z.number().nonnegative(), label: z.string().max(80) })).default([]),
  brief: z.string().min(1),
});
export type Blueprint = z.output<typeof BlueprintSchema>;

const intensity: TemplateParam = { name: "intensity", type: "enum", options: [...IntensitySchema.options], default: "subtle", description: "How far the move travels: subtle (restraint by default), standard or dramatic." };
const lens = (fallback: number): TemplateParam => ({ name: "lens", type: "number", min: 24, max: 200, default: fallback, unit: "mm", description: "Wide lenses emphasize perspective. Long lenses up to 200 mm compress depth." });
const duration = (fallback: number, min = 2000, max = 15000): TemplateParam => ({ name: "durationMs", type: "number", min, max, default: fallback, unit: "ms", description: "Shot length in milliseconds." });
const region: TemplateParam = { name: "focusRegion", type: "region", description: "Subject pixels x,y,width,height (top-left origin) the shot frames and keeps sharp; defaults to the center third." };
const allAspects: Aspect[] = ["16:9", "21:9", "1:1", "4:5", "9:16"];
const subjectSlot = [{ name: "subject", kinds: ["component", "route"] as ("component" | "route")[], required: true, description: "The real page or component: --component path#Export or --route /path." }];
const template = (manifest: Omit<TemplateManifest, "version" | "slots" | "aspects"> & { aspects?: Aspect[] }): TemplateManifest =>
  TemplateManifestSchema.parse({ version: 1, slots: subjectSlot, aspects: allAspects, ...manifest });

const text = (name: string, fallback: string, description: string, maxLength = 240): TemplateParam => ({ name, type: "text", default: fallback, maxLength, description });
const backdropParam: TemplateParam = { name: "backdrop", type: "enum", options: ["on", "off"], default: "on", description: "off renders the graphic alone, for use as a V2 overlay over the picture." };
const layered = (manifest: Omit<TemplateManifest, "version" | "slots" | "aspects" | "category" | "certification"> & { certification?: Partial<TemplateManifest["certification"]> }): TemplateManifest =>
  TemplateManifestSchema.parse({ version: 1, slots: subjectSlot, aspects: allAspects, category: "layered", ...manifest, certification: { minSubjectVisible: 0.85, minDepthMargin: 0.15, checkFrom: 0.5, maxEndBlur: 2, ...manifest.certification } });
const graphic = (manifest: Omit<TemplateManifest, "version" | "slots" | "aspects" | "category" | "certification">): TemplateManifest =>
  TemplateManifestSchema.parse({ version: 1, slots: [], aspects: allAspects, category: "motion-graphics", ...manifest, certification: { minSubjectVisible: 1, minDepthMargin: 0.3, checkFrom: 0.5, maxEndBlur: 2 } });
const WAVE_2: TemplateManifest[] = [
  layered({ id: "exploded-stack", title: "The exploded view", composite: "exploded-stack", tags: ["hero", "feature"],
    summary: "The product separates into floating layers while the camera arcs around them, then reassembles.",
    params: [intensity, { name: "separation", type: "number", min: 80, max: 400, default: 220, unit: "px", description: "Depth between layers at full separation." }, { name: "orbit", type: "number", min: 0, max: 40, default: 28, unit: "deg", description: "Camera arc." }, lens(50), duration(7000)],
    craft: { technique: "Layers part along z while the camera orbits; they settle back together for the payoff.", motivation: "Shows depth and craft inside a product.", lineage: "Exploded-view technical illustration.", pitfalls: "Too much separation reads as clutter; keep the orbit slow.", pairsWith: ["device-showcase", "title-reveal"] } }),
  layered({ id: "parallax-planes", title: "The multiplane truck", composite: "parallax-planes", tags: ["hero", "website"],
    summary: "Background, product and drifting foreground particles at depth; a lateral truck reveals parallax.",
    params: [intensity, { name: "truck", type: "number", min: 0, max: 600, default: 260, unit: "px", description: "Lateral camera travel at 1920 px wide (scaled to narrower frames)." }, { name: "spacing", type: "number", min: 200, max: 1200, default: 600, unit: "px", description: "Depth spacing between planes." }, lens(35), duration(8000)],
    craft: { technique: "Planes at different depths move at different speeds under one lateral move.", motivation: "Gives a flat page real space.", lineage: "The multiplane animation camera.", pitfalls: "Overdoing foreground particles distracts from the product.", pairsWith: ["float-loop", "end-card"] } }),
  layered({ id: "cascade-build", title: "The cascade build", composite: "cascade-build", tags: ["feature", "data"],
    summary: "Brand cards (your key numbers) drop in a staggered cascade onto your live page.",
    params: [text("pieces", "Revenue: $48.2k|Active users: 12,480|Conversion: 4.8%", "Up to four cards: 'label: value' separated by |."), lens(50), duration(7000)],
    craft: { technique: "Staggered settle from depth with an overshoot.", motivation: "Makes the dashboard's value visible at a glance.", lineage: "Plated, assembled UI reveals.", pitfalls: "More than four pieces dilutes the beat.", pairsWith: ["stat-counter", "hero-push"] } }),
  layered({ id: "floating-focus", title: "The lifted card", composite: "floating-focus", tags: ["feature", "detail"],
    summary: "A lifted message card floats sharp over your page, which falls softly out of focus; a slow drift shows the depth.",
    params: [text("headline", "Ship in minutes", "Card headline.", 60), text("body", "The real product, front and center.", "Card body.", 140), { name: "lift", type: "number", min: 100, max: 800, default: 420, unit: "px", description: "How far the card floats toward the camera." }, lens(85), duration(7000)],
    craft: { technique: "Shallow focus separates foreground from background; a slight drift proves the depth.", motivation: "One idea, framed by the product.", lineage: "Foreground/background staging.", pitfalls: "Long copy on the card; keep it to one line.", pairsWith: ["macro-detail", "quote-card"] },
    certification: { minSubjectVisible: 0.95 } }),
  layered({ id: "device-showcase", title: "The device showcase", composite: "device-showcase", tags: ["hero", "mobile"],
    summary: "Your UI in a CSS browser, phone, laptop or tablet frame on a lit backdrop with a contact shadow, slow orbit and light sweep.",
    params: [intensity, { name: "device", type: "enum", options: ["browser", "phone", "laptop", "tablet", "window"], default: "browser", description: "Frame around the screen." },
      { name: "backdrop", type: "enum", options: ["grid-floor", "gradient", "mesh", "aurora", "spotlight", "solid"], default: "grid-floor", description: "Atmosphere behind the device." },
      text("url", "yourproduct.com", "Address shown in the browser frame.", 80), lens(50), duration(8000)],
    craft: { technique: "A product shot: framed device, grounded by a contact shadow, a specular sweep at the midpoint.", motivation: "The product as an object worth owning.", lineage: "3D device-mockup product films.", pitfalls: "Fast orbits; the sweep should be the only flourish.", pairsWith: ["title-reveal", "end-card"] } }),
  layered({ id: "cursor-demo", title: "The guided click", composite: "cursor-demo", tags: ["feature", "detail"],
    summary: "A cursor glides to the target, clicks with a ripple, and the camera eases in toward the click.",
    params: [region, { name: "pressMs", type: "number", min: 500, max: 10000, default: 3000, unit: "ms", description: "When the click lands." }, { name: "zoom", type: "number", min: 1, max: 2.5, default: 1.6, description: "How close the camera gets to the click." }, lens(50), duration(6000)],
    craft: { technique: "The eye follows the cursor; the camera follows the eye.", motivation: "Demonstrates one interaction without a screen recording.", lineage: "Auto-zoom screen recordings.", pitfalls: "Several clicks in one shot; cut between shots instead.", pairsWith: ["macro-detail", "lower-third"] },
    certification: { minSubjectVisible: 0.2 } }),
  layered({ id: "split-compare", title: "The before and after", composite: "split-compare", tags: ["feature", "transition"],
    summary: "Before and after planes with a true-mask divider that sweeps across and settles mid-frame.",
    params: [text("before", "/", "Same-origin route for the 'before' side.", 200), text("beforeLabel", "Before", "Left label.", 30), text("afterLabel", "After", "Right label.", 30), lens(50), duration(6000)],
    craft: { technique: "One plane masks the other along a moving divider.", motivation: "Makes a redesign or speed-up undeniable.", lineage: "Before/after reveals.", pitfalls: "Comparing screens with different layouts; align them first.", pairsWith: ["stat-counter", "hero-push"] } }),
  layered({ id: "screen-wall", title: "The screen wall", composite: "screen-wall", tags: ["hero", "website"],
    summary: "A wall of your app's pages at angles; the camera flies across and settles on the first screen.",
    params: [intensity, text("routes", "/", "Routes for the other screens, separated by | (each repeats with a different scroll).", 400), lens(35), duration(9000)],
    craft: { technique: "An establishing shot of breadth, ending on one screen.", motivation: "Shows the size of the product in one move.", lineage: "Video-wall establishing shots.", pitfalls: "Too many distinct pages make the wall noisy.", pairsWith: ["hero-push", "end-card"] },
    certification: { minSubjectVisible: 0.6, checkFrom: 0.8 } }),
  graphic({ id: "title-reveal", title: "The title reveal", composite: "title-reveal", tags: ["hero", "type"],
    summary: "A masked line reveal of your headline (and subtitle) over a brand backdrop.",
    params: [backdropParam, text("title", "A new perspective\non your product", "Headline; use \\n for a line break.", 120), text("subtitle", "", "Optional subtitle.", 120), { name: "scale", type: "number", min: 0.5, max: 1.6, default: 1, description: "Type size multiplier." }, duration(5000, 2000, 12000)],
    craft: { technique: "Words rise from behind a mask in reading order.", motivation: "Names the idea before the product appears.", lineage: "Kinetic title design.", pitfalls: "More than eight words; split them across two cards.", pairsWith: ["hero-push", "device-showcase"] } }),
  graphic({ id: "logo-sting", title: "The logo sting", composite: "logo-sting", tags: ["brand", "transition"],
    summary: "Your logo (or name) settles in scale under a light sweep and a soft glow bloom, in 2.5 seconds.",
    params: [text("name", "", "Override the brand name shown when no logo is set.", 40), duration(2500, 1500, 6000)],
    craft: { technique: "Scale settle, specular sweep, glow.", motivation: "A brand beat that opens or closes a film.", lineage: "Broadcast idents.", pitfalls: "Holding too long; a sting is a beat, not a scene.", pairsWith: ["end-card", "title-reveal"] } }),
  graphic({ id: "kinetic-statement", title: "The kinetic statement", composite: "kinetic-statement", tags: ["social", "type"],
    summary: "Two to six bold words spring in, one at a time, with the key word in your accent color.",
    params: [backdropParam, text("words", "Build. Ship. Delight.", "The statement (2-6 words).", 80), text("accent", "", "The word to highlight (defaults to the last).", 30), duration(4000, 2000, 8000)],
    craft: { technique: "Spring cascade with one accented word.", motivation: "Sets rhythm for a social cut.", lineage: "Kinetic typography.", pitfalls: "Accenting more than one word.", pairsWith: ["handheld-push", "whip-pan"] } }),
  graphic({ id: "stat-counter", title: "The stat counter", composite: "stat-counter", tags: ["data", "type"],
    summary: "One to three numbers count up with tabular figures, prefixes and suffixes.",
    params: [backdropParam, text("stats", "12k+ teams|98% uptime|3x faster", "Up to three stats separated by |, each 'number+suffix label' (prefixes like $ work).", 160), duration(4500, 2500, 10000)],
    craft: { technique: "expo.out counts land together, staggered slightly.", motivation: "Proof in numbers.", lineage: "Data-driven broadcast graphics.", pitfalls: "Unverifiable numbers.", pairsWith: ["cascade-build", "split-compare"] } }),
  graphic({ id: "feature-trio", title: "The feature trio", composite: "feature-trio", tags: ["feature", "type"],
    summary: "Three brand cards with numbered icons, titles and one-line descriptions, staggered in.",
    params: [text("features", "Fast: Renders in seconds|Private: Runs on your machine|Yours: Plain source, no lock-in", "Three 'Title: description' entries separated by |.", 300), duration(6000, 3000, 10000)],
    craft: { technique: "A staggered rule-of-three.", motivation: "Summarizes why, in one card.", lineage: "Keynote feature slides.", pitfalls: "Paragraphs on cards; one line each.", pairsWith: ["device-showcase", "end-card"] } }),
  graphic({ id: "lower-third", title: "The lower third", composite: "lower-third", tags: ["type", "social"],
    summary: "A name and role (or feature) bar that wipes in with a clip mask and wipes out at the end.",
    params: [text("label", "Ada Park", "Primary line.", 50), text("sublabel", "Head of Product", "Secondary line.", 70), { name: "side", type: "enum", options: ["left", "right"], default: "left", description: "Which side the bar sits on." }, duration(4000, 2500, 10000)],
    craft: { technique: "A clip-mask wipe, accent rule, two lines.", motivation: "Labels a speaker or a feature over footage.", lineage: "Broadcast lower thirds.", pitfalls: "Covering the subject's key UI.", pairsWith: ["cursor-demo", "quote-card"] } }),
  graphic({ id: "quote-card", title: "The quote card", composite: "quote-card", tags: ["type", "social"],
    summary: "A testimonial revealed word by word under a slow push, attributed below.",
    params: [text("quote", "“It made our launch video in an afternoon.”", "The quote.", 200), text("name", "A happy customer", "Who said it.", 60), text("role", "", "Their role or company.", 60), duration(7000, 4000, 14000)],
    craft: { technique: "Word reveal with a long hold and a gentle push.", motivation: "Social proof with time to read.", lineage: "Documentary testimonial cards.", pitfalls: "Rushing the hold; readers need time.", pairsWith: ["floating-focus", "end-card"] } }),
  graphic({ id: "end-card", title: "The end card", composite: "end-card", tags: ["brand", "website"],
    summary: "Logo, headline, URL and a call to action, holding long enough to act on.",
    params: [text("headline", "Make your launch memorable", "Headline.", 80), text("url", "yourproduct.com", "Where to go.", 80), text("cta", "Try it free", "Call to action.", 30), duration(4000, 2500, 10000)],
    craft: { technique: "A settled card with a held CTA (2.5 s or more).", motivation: "Tells the viewer what to do next.", lineage: "Film end cards and app-store trailers.", pitfalls: "Ending on motion; let it rest.", pairsWith: ["logo-sting", "title-reveal"] } }),
  graphic({ id: "countdown", title: "The countdown", composite: "countdown", tags: ["social", "type"],
    summary: "3 · 2 · 1 numbers popping over an aurora backdrop, for teasers.",
    params: [{ name: "from", type: "number", min: 1, max: 10, default: 3, description: "Start number." }, duration(3600, 1600, 11000)],
    craft: { technique: "Pop-in numbers on a steady beat.", motivation: "Builds anticipation before a reveal.", lineage: "Teaser countdowns.", pitfalls: "Mismatched beat and music; snap cuts to the downbeat.", pairsWith: ["logo-sting", "title-reveal"] } }),
  graphic({ id: "changelog-card", title: "The changelog card", composite: "changelog-card", tags: ["feature", "type"],
    summary: "A version badge and three to five items that stagger in.",
    params: [text("version", "v2.0", "Version label.", 20), text("items", "Template gallery|Quick shots of your live app|Master-quality renders|Brand looks", "Items separated by |.", 300), duration(6000, 3000, 12000)],
    craft: { technique: "A staggered list on a brand card.", motivation: "Release notes people actually watch.", lineage: "Product update videos.", pitfalls: "More than five items.", pairsWith: ["feature-trio", "end-card"] } }),
];

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
  ...WAVE_2,
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
  BlueprintSchema.parse({ version: 1, id: "launch-film-30s", title: "Launch film (30 s)", aspects: ["16:9"],
    summary: "Hook title, the problem in detail, the product revealed in a device, proof in numbers, a call to action: whips, crossfades, sound and karaoke captions.",
    scenes: [
      { template: "title-reveal", section: "Hook", params: { durationMs: 3500, title: "Your launch,\\nmade unforgettable", subtitle: "" } },
      { template: "hero-push", section: "Problem", params: { durationMs: 5500 }, transition: { type: "whip", durationMs: 400, direction: "left", sfx: "whoosh" } },
      { template: "macro-detail", params: { durationMs: 5500 }, transition: { type: "crossfade", durationMs: 600 } },
      { template: "device-showcase", section: "Reveal", params: { durationMs: 6500 }, transition: { type: "dip-to-black", durationMs: 800, sfx: "riser" } },
      { template: "stat-counter", section: "Proof", params: { durationMs: 5000 }, transition: { type: "push", durationMs: 500, direction: "left", sfx: "swish" } },
      { template: "end-card", section: "CTA", params: { durationMs: 6900 }, transition: { type: "crossfade", durationMs: 600, sfx: { preset: "impact", gainDb: -10 } } },
    ],
    overlays: [{ template: "lower-third", params: { durationMs: 3600, label: "The old way", sublabel: "Static screenshots nobody watches" }, startMs: 8400, durationMs: 3600 }],
    captions: [
      { startMs: 400, endMs: 3200, text: "Your launch deserves more than screenshots" },
      { startMs: 3600, endMs: 8000, text: "Real product UI, in real 3D" },
      { startMs: 13200, endMs: 18800, text: "Framed like a film, built from your app" },
      { startMs: 23800, endMs: 29400, text: "Try it free today" },
    ],
    cues: [{ atMs: 0, label: "music: soft intro" }, { atMs: 13100, label: "music: drop on the reveal" }, { atMs: 23400, label: "music: resolve" }],
    brief: "Hook (0-3.5 s): one bold line. Problem (3.5-13 s): the pain, shown on your real UI with a lower third. Reveal (13-19 s): the product as an object. Proof (19-23.5 s): numbers. CTA (23.5-30 s): hold the end card. Cut on the downbeat; let the whip carry the energy into the problem." }),
  BlueprintSchema.parse({ version: 1, id: "feature-drop-15s", title: "Feature drop (15 s)", aspects: ["16:9", "1:1"],
    summary: "A statement, the feature in action with a guided click, three benefits, an end card.",
    scenes: [
      { template: "kinetic-statement", section: "Hook", params: { durationMs: 2600, words: "New. Faster. Yours." } },
      { template: "cursor-demo", section: "Reveal", params: { durationMs: 5000 }, transition: { type: "crossfade", durationMs: 500, sfx: "swish" } },
      { template: "feature-trio", section: "Proof", params: { durationMs: 6000 }, transition: { type: "wipe", durationMs: 500, direction: "left", sfx: "swish" } },
      { template: "end-card", section: "CTA", params: { durationMs: 3500, headline: "Available today" }, transition: { type: "dip-to-black", durationMs: 600 } },
    ],
    captions: [{ startMs: 2600, endMs: 7000, text: "One click does it" }, { startMs: 12000, endMs: 15000, text: "Available today" }],
    cues: [{ atMs: 2500, label: "music: hit on the reveal" }],
    brief: "Hook (0-2.6 s): three words. Reveal (2.6-7.6 s): one interaction, followed by the camera. Proof (7.6-13 s): three benefits. CTA: the date and the link." }),
  BlueprintSchema.parse({ version: 1, id: "social-teaser-9x16", title: "Social teaser (10 s, vertical)", aspects: ["9:16"],
    summary: "Countdown, handheld energy on your product, a punchy statement, an end card: vertical and fast.",
    scenes: [
      { template: "countdown", section: "Hook", params: { durationMs: 2600, from: 2 } },
      { template: "handheld-push", section: "Reveal", params: { durationMs: 3000 }, transition: { type: "whip", durationMs: 300, direction: "up", sfx: "whoosh" } },
      { template: "kinetic-statement", section: "Proof", params: { durationMs: 2400, words: "Coming soon." }, transition: { type: "push", durationMs: 400, direction: "up", sfx: "swish" } },
      { template: "end-card", section: "CTA", params: { durationMs: 3200, headline: "Mark the date" }, transition: { type: "crossfade", durationMs: 400, sfx: "pop" } },
    ],
    captions: [{ startMs: 2700, endMs: 5400, text: "Something new is coming" }],
    cues: [{ atMs: 2300, label: "music: drop" }],
    brief: "Vertical, muted-first: the countdown hooks, the whip lands on the downbeat, captions carry the message clear of platform UI." }),
  BlueprintSchema.parse({ version: 1, id: "changelog-20s", title: "Changelog (20 s)", aspects: ["16:9", "1:1"],
    summary: "Version title, the list of changes, the new page scrolling past, an end card.",
    scenes: [
      { template: "title-reveal", section: "Hook", params: { durationMs: 3000, title: "What's new", subtitle: "This release" } },
      { template: "changelog-card", section: "Proof", params: { durationMs: 6500 }, transition: { type: "crossfade", durationMs: 500 } },
      { template: "scroll-through", section: "Reveal", params: { durationMs: 6000 }, transition: { type: "wipe", durationMs: 600, direction: "up", sfx: "swish" } },
      { template: "end-card", section: "CTA", params: { durationMs: 5100, headline: "Update now" }, transition: { type: "dip-to-black", durationMs: 600 } },
    ],
    captions: [{ startMs: 3000, endMs: 9000, text: "Everything that shipped this week" }],
    brief: "Name the version, list three to five changes, show the biggest one live, end with how to get it." }),
  BlueprintSchema.parse({ version: 1, id: "product-hunt-kit", title: "Product Hunt kit (30 s film + stills + GIF)", aspects: ["16:9"],
    summary: "A 30-second gallery film; the same composition yields gallery stills (velora frames) and a README GIF (render --preset github-readme-gif).",
    scenes: [
      { template: "title-reveal", section: "Hook", params: { durationMs: 3500 } },
      { template: "device-showcase", section: "Reveal", params: { durationMs: 6000 }, transition: { type: "whip", durationMs: 400, direction: "left", sfx: "whoosh" } },
      { template: "cursor-demo", params: { durationMs: 5500 }, transition: { type: "crossfade", durationMs: 500 } },
      { template: "stat-counter", section: "Proof", params: { durationMs: 4500 }, transition: { type: "push", durationMs: 500, direction: "left", sfx: "swish" } },
      { template: "quote-card", params: { durationMs: 6000 }, transition: { type: "crossfade", durationMs: 500 } },
      { template: "end-card", section: "CTA", params: { durationMs: 6000 }, transition: { type: "dip-to-black", durationMs: 600 } },
    ],
    captions: [{ startMs: 3200, endMs: 9000, text: "Meet the product, live" }],
    cues: [{ atMs: 3300, label: "music: lift" }],
    brief: "Gallery viewers watch muted: lead with the title, show the real product, prove it, quote a customer, end on the CTA. Stills: velora frames --at at each section; GIF: render --preset github-readme-gif." }),
  BlueprintSchema.parse({ version: 1, id: "app-preview-25s", title: "App preview (25 s, portrait)", aspects: ["9:16"],
    summary: "An app-store style preview: title, the app in a phone, one interaction, three benefits, an end card.",
    scenes: [
      { template: "title-reveal", section: "Hook", params: { durationMs: 3500 } },
      { template: "device-showcase", section: "Reveal", params: { durationMs: 6500, device: "phone" }, transition: { type: "zoom", durationMs: 500 } },
      { template: "cursor-demo", params: { durationMs: 5500 }, transition: { type: "crossfade", durationMs: 500, sfx: "click" } },
      { template: "feature-trio", section: "Proof", params: { durationMs: 6000 }, transition: { type: "push", durationMs: 500, direction: "up", sfx: "swish" } },
      { template: "end-card", section: "CTA", params: { durationMs: 5000 }, transition: { type: "crossfade", durationMs: 500 } },
    ],
    captions: [{ startMs: 3500, endMs: 9500, text: "Everything in your pocket" }],
    brief: "Portrait, phone-framed: one feature per beat, captions above the platform UI zones, a long end-card hold." }),
]);

export type ParamValue = string | number | { x: number; y: number; width: number; height: number };
export type TemplateIssue = { code: string; path: string; message: string };
/** Validate and coerce overrides (CLI --set strings or numbers) against the template's typed params. */
export function resolveTemplateParams(manifest: TemplateManifest, overrides: Readonly<Record<string, string | number>>): { params: Record<string, ParamValue>; issues: TemplateIssue[] } {
  const params: Record<string, ParamValue> = {};
  const issues: TemplateIssue[] = [];
  for (const name of Object.keys(overrides))
    if (name !== "lens" && !manifest.params.some(param => param.name === name))
      issues.push({ code: "ERR_TEMPLATE_PARAM", path: `params.${name}`, message: `Template ${manifest.id} has no param "${name}". Available: ${manifest.params.map(param => param.name).join(", ")}.` });
  const parameters = overrides.lens !== undefined && !manifest.params.some(param => param.name === "lens") ? [...manifest.params, lens(50)] : manifest.params;
  for (const param of parameters) {
    const raw = overrides[param.name];
    if (param.type === "region") {
      if (raw === undefined) continue;
      const parts = String(raw).split(",").map(part => Number(part.trim()));
      if (parts.length !== 4 || parts.some(part => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0)
        issues.push({ code: "ERR_TEMPLATE_PARAM", path: `params.${param.name}`, message: `${param.name} must be x,y,width,height in subject pixels (width and height positive).` });
      else params[param.name] = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    } else if (param.type === "text") {
      const value = raw === undefined ? param.default : String(raw);
      if (value.length > param.maxLength) issues.push({ code: "ERR_TEMPLATE_PARAM", path: `params.${param.name}`, message: `${param.name} must be at most ${param.maxLength} characters.` });
      else params[param.name] = value.replace(/\\n/g, "\n");
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
export function templateShotInput(manifest: TemplateManifest, params: Record<string, ParamValue>, aspect: Aspect, subject?: { width: number; height: number }, focusTarget?: ElementTarget): ShotInput {
  if (!manifest.shot) throw new Error(`Template ${manifest.id} compiles a composite layout, not a camera shot.`);
  return {
    kind: manifest.shot, aspect, ...(subject ? { subject } : {}),
    ...(typeof params.intensity === "string" ? { intensity: params.intensity as ShotInput["intensity"] } : {}),
    ...(typeof params.lens === "number" ? { lens: params.lens } : {}),
    ...(typeof params.durationMs === "number" ? { durationMs: params.durationMs } : {}),
    ...(focusTarget ? { focusTarget } : typeof params.focusRegion === "object" ? { focusRegion: params.focusRegion } : {}),
    ...(typeof params.scrollDistance === "number" ? { scrollDistance: params.scrollDistance } : {}),
    ...(typeof params.seed === "number" ? { seed: params.seed } : {}),
  };
}
export function templateDefinition(manifest: TemplateManifest, params: Record<string, ParamValue>, aspect: Aspect, subject?: { width: number; height: number }, focusTarget?: ElementTarget): ShotDefinition | CompositeDefinition {
  if (manifest.composite) {
    const definition = buildComposite(manifest.composite, aspect, params);
    return focusTarget ? lockShotFocus(definition, focusTarget) : definition;
  }
  return buildShot(templateShotInput(manifest, params, aspect, subject, focusTarget), { stageFit: !!subject });
}
export function templateDepth(manifest: TemplateManifest): DepthMap | undefined {
  return manifest.id === "parallax-planes" ? { subject: { mode: "auto", intensity: "subtle", light: DEFAULT_DEPTH_LIGHT } } : undefined;
}
/** Framing, title-safe placement and reading time for a layered or motion-graphics template. */
function certifyComposite(manifest: TemplateManifest, definition: CompositeDefinition, aspect: Aspect, stage?: Stage): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const at = `${manifest.id}@${aspect}`;
  const node = definition.layout.find(entry => entry.id === definition.primary);
  if (!node) return [{ code: "ERR_TEMPLATE_FRAMING", path: at, message: `Primary node ${definition.primary} is missing from the layout.` }];
  const W = definition.width, H = definition.height;
  const cx = node.left + node.width / 2 - W / 2, cy = node.top + node.height / 2 - H / 2, z = node.transform?.z ?? 0;
  const subject = stage && node.element.type === "Slot" ? fitStage(stage, node) : node;
  // A staged parallax template lifts its tallest tray by 60 CSS px at subtle strength.
  const elevations = stage && templateDepth(manifest) ? [z, z + 60] : [z];
  const grids = elevations.map(elevation => Array.from({ length: 49 }, (_, i) => [cx + subject.width * ((i % 7) / 6 - 0.5), cy + subject.height * (Math.floor(i / 7) / 6 - 0.5), elevation] as const));
  const duration = definition.motion.durationMs;
  const { minSubjectVisible, checkFrom } = manifest.certification;
  const safe = manifest.category === "motion-graphics" ? 0.9 : 1;
  for (let k = 0; k <= 12; k++) {
    const timeMs = (duration * k) / 12;
    if (timeMs < checkFrom * duration) continue;
    const inside = Math.min(...grids.map(grid => {
      const points = projectPoints(definition, grid, timeMs);
      return points.filter(point => point && Math.abs(point.x - W / 2) <= (W * safe) / 2 + 0.5 && Math.abs(point.y - H / 2) <= (H * safe) / 2 + 0.5).length / points.length;
    }));
    if (inside < minSubjectVisible)
      issues.push({ code: "ERR_TEMPLATE_FRAMING", path: at, message: `Only ${(inside * 100).toFixed(0)}% of ${definition.primary} is ${safe < 1 ? "title-safe" : "in frame"} at ${Math.round(timeMs)}ms (needs ${minSubjectVisible * 100}%).` });
  }
  const reading = readingTimeMs(definition.copy);
  if (reading > duration)
    issues.push({ code: "ERR_TEMPLATE_FRAMING", path: at, message: `The copy needs ${reading}ms to read (0.3 s per word + 1 s) but the template runs ${duration}ms; shorten it or raise durationMs.` });
  return issues;
}
/** Framing certification for one template configuration; failures name the gate and the time. */
export function templateSubject(aspect: Aspect, stage?: Stage) {
  const frame = ASPECT_FRAMES[aspect].subject;
  if (!stage) return frame;
  const { width, height } = fitStage(stage, frame);
  return { width: Math.round(width), height: Math.round(height) };
}
export function certifyTemplate(manifest: TemplateManifest, params: Record<string, ParamValue>, aspect: Aspect, stage?: Stage, focusTarget?: ElementTarget): TemplateIssue[] {
  const subject = templateSubject(aspect, stage);
  if (manifest.composite) return certifyComposite(manifest, buildComposite(manifest.composite, aspect, params), aspect, stage);
  const definition = templateDefinition(manifest, params, aspect, subject, focusTarget);
  // Without a chosen region, a rack pull lands on the far edge (centered 30% above the subject center).
  const focusRegion = focusTarget ? undefined : typeof params.focusRegion === "object" ? params.focusRegion
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
  if (!focusTarget && (last.regionBlur > maxEndBlur || last.regionVisible < 0.95))
    issues.push({ code: "ERR_TEMPLATE_FRAMING", path: `${manifest.id}@${aspect}`, message: `The focus region ends ${last.regionVisible < 0.95 ? "out of frame" : `soft (${last.regionBlur.toFixed(2)}px blur)`}.` });
  return issues;
}
