import { z } from "zod";
import { MotionClipSchema, type MotionClipInput, type MotionClipOutput } from "./motion";
import { animatableChannel } from "./animatable";
import { buildKineticTracks } from "./typography";
import { createCascadeClip } from "./choreography";
import type { EasingInput } from "./easing";

/** SOURCE OF TRUTH: BEHAVIOR_CATALOG, buildBehavior.
 * WHAT: the behaviors library as data plus one pure builder: enter, exit, emphasis and data behaviors
 * compile to an ordinary clip (tracks, add mode, noise, style or channel tracks) with provenance
 * `source: {behavior, version, params}` so the editor can show and regenerate its parameters.
 * WHY: tasteful motion in one gesture without a runtime behavior engine: the result is plain recipe
 * data that the timeline, graph editor, CLI and capture treat like any other clip. Intensity defaults to
 * subtle (principle 7); kinetic presets (typography.ts) and the cascade (choreography.ts) are reused.
 * WHERE: the editor's Behaviors panel and stagger tool, presets of kind "behavior" and `velora edit`
 * (as a `clip.set` op) call it. Nothing here touches the DOM or a clock.
 */
export const BEHAVIOR_VERSION = 1;
export const BEHAVIOR_INTENSITIES = Object.freeze(["subtle", "standard", "dramatic"] as const);
export type BehaviorIntensity = (typeof BEHAVIOR_INTENSITIES)[number];
export type BehaviorKind = "enter" | "exit" | "emphasis" | "data";
export type BehaviorParam = { name: string; type: "number" | "enum" | "color" | "string"; label: string; default: number | string;
  /** Number params scale with intensity: subtle ×1, standard ×1.5, dramatic ×2. */ scales?: boolean; min?: number; max?: number; unit?: string; options?: readonly string[] };
export type BehaviorSpec = { id: string; kind: BehaviorKind; label: string; description: string; target: "surface" | "animatable"; durationMs: number; params: readonly BehaviorParam[]; mirrors?: string };
const distance = (value: number, label = "Distance"): BehaviorParam => ({ name: "distance", type: "number", label, default: value, scales: true, min: 0, max: 2000, unit: "px" });
const direction: BehaviorParam = { name: "direction", type: "enum", label: "Direction", default: "up", options: ["up", "down", "left", "right"] };
export const BEHAVIOR_CATALOG: readonly BehaviorSpec[] = Object.freeze([
  { id: "fade-up", kind: "enter", label: "Fade up", description: "Fades in while rising a short distance.", target: "surface", durationMs: 600, params: [distance(24)] },
  { id: "rise", kind: "enter", label: "Rise", description: "Rises into place out of a soft blur.", target: "surface", durationMs: 700, params: [distance(40), { name: "blur", type: "number", label: "Blur", default: 4, scales: true, min: 0, max: 64, unit: "px" }] },
  { id: "scale-in", kind: "enter", label: "Scale in", description: "Grows from slightly smaller while fading in.", target: "surface", durationMs: 600, params: [{ name: "from", type: "number", label: "From scale", default: 0.94, min: 0.05, max: 1 }] },
  { id: "blur-in", kind: "enter", label: "Blur in", description: "Sharpens from a blur while fading in.", target: "surface", durationMs: 700, params: [{ name: "amount", type: "number", label: "Blur", default: 8, scales: true, min: 0, max: 64, unit: "px" }] },
  { id: "mask-wipe", kind: "enter", label: "Mask wipe", description: "Reveals with a clip wipe in one direction (the kinetic mask-reveal).", target: "surface", durationMs: 800, params: [{ ...direction, default: "right" }] },
  { id: "iris", kind: "enter", label: "Iris", description: "Opens a circular clip from the center.", target: "surface", durationMs: 800, params: [{ name: "clipRadius", type: "number", label: "End radius", default: 150, min: 0, max: 150, unit: "%" }] },
  { id: "slide", kind: "enter", label: "Slide", description: "Slides in from one side while fading in.", target: "surface", durationMs: 700, params: [{ ...direction, default: "left" }, distance(80)] },
  { id: "pop", kind: "enter", label: "Pop", description: "Springs up from smaller with a gentle overshoot.", target: "surface", durationMs: 700, params: [{ name: "spring", type: "enum", label: "Spring", default: "gentle", options: ["gentle", "snappy", "bouncy"] }] },
  { id: "tracking-in", kind: "enter", label: "Tracking in", description: "Letter spacing closes in (style var --tracking, em) while fading in.", target: "surface", durationMs: 900, params: [{ name: "tracking", type: "number", label: "Start tracking", default: 0.2, scales: true, min: 0, max: 2, unit: "em" }] },
  { id: "fade-down", kind: "exit", label: "Fade down", description: "Fades out while sinking a short distance.", target: "surface", durationMs: 500, mirrors: "fade-up", params: [distance(24)] },
  { id: "fall", kind: "exit", label: "Fall", description: "Falls away into a soft blur.", target: "surface", durationMs: 600, mirrors: "rise", params: [distance(40), { name: "blur", type: "number", label: "Blur", default: 4, scales: true, min: 0, max: 64, unit: "px" }] },
  { id: "scale-out", kind: "exit", label: "Scale out", description: "Shrinks slightly while fading out.", target: "surface", durationMs: 500, mirrors: "scale-in", params: [{ name: "to", type: "number", label: "To scale", default: 0.94, min: 0.05, max: 1 }] },
  { id: "blur-out", kind: "exit", label: "Blur out", description: "Blurs while fading out.", target: "surface", durationMs: 600, mirrors: "blur-in", params: [{ name: "amount", type: "number", label: "Blur", default: 8, scales: true, min: 0, max: 64, unit: "px" }] },
  { id: "wipe-out", kind: "exit", label: "Wipe out", description: "Hides with a clip wipe in one direction.", target: "surface", durationMs: 700, mirrors: "mask-wipe", params: [{ ...direction, default: "right" }] },
  { id: "iris-out", kind: "exit", label: "Iris out", description: "Closes a circular clip to the center.", target: "surface", durationMs: 700, mirrors: "iris", params: [{ name: "clipRadius", type: "number", label: "Start radius", default: 150, min: 0, max: 150, unit: "%" }] },
  { id: "slide-out", kind: "exit", label: "Slide out", description: "Slides out to one side while fading out.", target: "surface", durationMs: 600, mirrors: "slide", params: [{ ...direction, default: "right" }, distance(80)] },
  { id: "pulse", kind: "emphasis", label: "Pulse", description: "One gentle scale beat (from and back to scale 1).", target: "surface", durationMs: 800, params: [{ name: "scale", type: "number", label: "Scale", default: 0.04, scales: true, min: 0, max: 1 }] },
  { id: "float", kind: "emphasis", label: "Float", description: "A slow seeded drift on y (add mode noise).", target: "surface", durationMs: 4000, params: [{ name: "amplitude", type: "number", label: "Amplitude", default: 6, scales: true, min: 0, max: 200, unit: "px" }, { name: "seed", type: "number", label: "Seed", default: 1, min: 0, max: 4_294_967_295 }] },
  { id: "glow", kind: "emphasis", label: "Glow", description: "A brief brightness lift (grade).", target: "surface", durationMs: 900, params: [{ name: "brightness", type: "number", label: "Lift", default: 0.12, scales: true, min: 0, max: 3 }] },
  { id: "wiggle", kind: "emphasis", label: "Wiggle", description: "Seeded rotation jitter (add mode noise on rotateZ).", target: "surface", durationMs: 1200, params: [{ name: "degrees", type: "number", label: "Degrees", default: 1.5, scales: true, min: 0, max: 45, unit: "°" }, { name: "seed", type: "number", label: "Seed", default: 1, min: 0, max: 4_294_967_295 }] },
  { id: "highlight", kind: "emphasis", label: "Highlight", description: "Flashes the style var --highlight to a color and back.", target: "surface", durationMs: 1200, params: [{ name: "color", type: "color", label: "Color", default: "#ffd166" }, { name: "rest", type: "color", label: "Rest color", default: "#ffd16600" }] },
  { id: "counter-up", kind: "data", label: "Counter up", description: "Counts an animatable's value up (<id>.value).", target: "animatable", durationMs: 1500, params: [{ name: "from", type: "number", label: "From", default: 0 }, { name: "to", type: "number", label: "To", default: 100 }] },
  { id: "typewriter", kind: "data", label: "Typewriter", description: "Types a specified number of graphemes (<id>.chars).", target: "animatable", durationMs: 1500, params: [{ name: "to", type: "number", label: "Characters", default: 24, min: 0 }] },
  { id: "reveal", kind: "data", label: "Reveal", description: "Scrubs a kit component's reveal with a cinematic ease (<id>.reveal.progress 0→1).", target: "animatable", durationMs: 1200, params: [] },
] satisfies BehaviorSpec[]);
export type BehaviorId = (typeof BEHAVIOR_CATALOG)[number]["id"];
export const behaviorById = (id: string): BehaviorSpec | undefined => BEHAVIOR_CATALOG.find(entry => entry.id === id);
export function behaviorChannelProperty(id: string): "value" | "chars" | "reveal.progress" | undefined {
  if (id === "counter-up") return "value";
  if (id === "typewriter") return "chars";
  if (id === "reveal") return "reveal.progress";
}
const LEVEL: Record<BehaviorIntensity, number> = { subtle: 1, standard: 1.5, dramatic: 2 };
const DURATION: Record<BehaviorIntensity, number> = { subtle: 1, standard: 1.15, dramatic: 1.3 };
export const BehaviorTargetSchema = z.union([z.strictObject({ surface: z.string().min(1) }), z.strictObject({ animatable: z.string().min(1).max(120) })]);
export type BehaviorTarget = z.output<typeof BehaviorTargetSchema>;
const BaseParamsSchema = z.looseObject({
  intensity: z.enum(BEHAVIOR_INTENSITIES).default("subtle"),
  durationMs: z.number().finite().min(50).max(60_000).optional(),
  startMs: z.number().finite().nonnegative().default(0),
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/).optional(),
});
export type BehaviorParams = z.input<typeof BaseParamsSchema>;
const SPRINGS = { gentle: { stiffness: 170, damping: 22 }, snappy: { stiffness: 320, damping: 26 }, bouncy: { stiffness: 260, damping: 12 } } as const;
const round = (value: number) => Math.round(value * 10_000) / 10_000;
/** Resolved parameters: catalog defaults scaled by intensity, then explicit values (clamped). */
export function resolveBehaviorParams(spec: BehaviorSpec, params: BehaviorParams = {}): Record<string, number | string> & { intensity: BehaviorIntensity; durationMs: number; startMs: number } {
  const base = BaseParamsSchema.parse(params);
  const out: Record<string, number | string> = {};
  for (const param of spec.params) {
    const given = (params as Record<string, unknown>)[param.name];
    if (param.type === "number") {
      const value = typeof given === "number" && Number.isFinite(given) ? given : (param.default as number) * (param.scales ? LEVEL[base.intensity] : 1);
      out[param.name] = round(Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, value)));
    } else if (param.type === "enum") out[param.name] = typeof given === "string" && param.options?.includes(given) ? given : param.default;
    else out[param.name] = typeof given === "string" && given ? given : param.default;
  }
  return { ...out, intensity: base.intensity, durationMs: base.durationMs ?? Math.round(spec.durationMs * DURATION[base.intensity]), startMs: base.startMs };
}
type Key = { timeMs: number; value: number | string; easing?: EasingInput };
const surfaceTrack = (id: string, property: string, keyframes: Key[], extra: Record<string, unknown> = {}) => ({ target: { kind: "surface", id }, property, keyframes, ...extra });
const clipIdFor = (behavior: string, target: BehaviorTarget) => `${behavior}-${("surface" in target ? target.surface : target.animatable)}`.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^[^a-zA-Z0-9]+/, "").slice(0, 64) || behavior;
/** Compile one behavior for one target into a validated clip with provenance. Throws on an unknown id,
 * a target of the wrong kind or output that does not validate (a bug, never silent). */
export function buildBehavior(id: string, params: BehaviorParams, target: BehaviorTarget, options: { flat?: boolean } = {}): MotionClipOutput {
  const spec = behaviorById(id);
  if (!spec) throw new Error(`Unknown behavior "${id}". Choose one of: ${BEHAVIOR_CATALOG.map(entry => entry.id).join(", ")}.`);
  const parsedTarget = BehaviorTargetSchema.parse(target);
  if ((spec.target === "surface") !== ("surface" in parsedTarget)) throw new Error(`Behavior "${id}" targets ${spec.target === "surface" ? "a Surface ({surface})" : "an animatable ({animatable})"}.`);
  const p = resolveBehaviorParams(spec, params);
  const d = p.durationMs;
  const clipId = (params as { id?: string }).id ?? clipIdFor(spec.id, parsedTarget);
  const s = "surface" in parsedTarget ? parsedTarget.surface : "";
  const enterEase: EasingInput = "cubic.out", exitEase: EasingInput = "cubic.in";
  // Two kinds of tracks: offsets layered on the layer's own values (add mode: position, blur, grade) and
  // absolute values (opacity, scale, clips, style vars, channels) that have bounded ranges.
  const offset: unknown[] = [], set: unknown[] = [];
  const keys = (from: number | string, to: number | string, ease: EasingInput): Key[] => [{ timeMs: 0, value: from, easing: ease }, { timeMs: d, value: to }];
  const off = (property: string, from: number, to: number, ease: EasingInput, extra: Record<string, unknown> = {}) => offset.push(surfaceTrack(s, property, keys(from, to, ease), extra));
  const abs = (property: string, from: number, to: number, ease: EasingInput) => set.push(surfaceTrack(s, property, keys(from, to, ease)));
  const axis = (dir: string) => (dir === "left" || dir === "right" ? "x" : "y");
  const sign = (dir: string) => (dir === "left" || dir === "up" ? -1 : 1);
  const wipeSide = (dir: string) => ({ right: "clipRight", left: "clipLeft", down: "clipBottom", up: "clipTop" })[dir] ?? "clipRight";
  const fadeIn = () => abs("opacity", 0, 1, enterEase), fadeOut = () => abs("opacity", 1, 0, exitEase);
  switch (spec.id) {
    case "fade-up": off("y", p.distance as number, 0, enterEase); fadeIn(); break;
    case "rise": off("y", p.distance as number, 0, enterEase); off("blur", p.blur as number, 0, enterEase); fadeIn(); break;
    case "scale-in": abs("scale", p.from as number, 1, enterEase); fadeIn(); break;
    case "blur-in": off("blur", p.amount as number, 0, enterEase); fadeIn(); break;
    case "mask-wipe": {
      // The kinetic mask-reveal (clipRight 100 → 0) for the default side; other sides mirror it.
      const reveal = buildKineticTracks("mask-reveal", { surfaceIds: [s], durationMs: d }).tracks[0] as { keyframes: Key[] };
      set.push(surfaceTrack(s, wipeSide(p.direction as string), reveal.keyframes.map(frame => ({ ...frame }))));
      break;
    }
    case "iris": abs("clipRadius", 0, p.clipRadius as number, enterEase); break;
    case "slide": off(axis(p.direction as string), sign(p.direction as string) * (p.distance as number), 0, enterEase); fadeIn(); break;
    case "pop": {
      const spring = SPRINGS[p.spring as keyof typeof SPRINGS] ?? SPRINGS.gentle;
      set.push(surfaceTrack(s, "scale", [{ timeMs: 0, value: round(1 - 0.12 * LEVEL[p.intensity]), easing: { spring } }, { timeMs: d, value: 1 }]));
      set.push(surfaceTrack(s, "opacity", [{ timeMs: 0, value: 0, easing: enterEase }, { timeMs: Math.round(d / 3), value: 1 }]));
      break;
    }
    case "tracking-in":
      set.push({ target: { kind: "style", id: s }, property: "--tracking", unit: "em", keyframes: keys(p.tracking as number, 0, "expo.out") });
      fadeIn();
      break;
    case "fade-down": off("y", 0, p.distance as number, exitEase); fadeOut(); break;
    case "fall": off("y", 0, p.distance as number, exitEase); off("blur", 0, p.blur as number, exitEase); fadeOut(); break;
    case "scale-out": abs("scale", 1, p.to as number, exitEase); fadeOut(); break;
    case "blur-out": off("blur", 0, p.amount as number, exitEase); fadeOut(); break;
    case "wipe-out": abs(wipeSide(p.direction as string), 0, 100, "cinematic"); break;
    case "iris-out": abs("clipRadius", p.clipRadius as number, 0, exitEase); break;
    case "slide-out": off(axis(p.direction as string), 0, sign(p.direction as string) * (p.distance as number), exitEase); fadeOut(); break;
    case "pulse": set.push(surfaceTrack(s, "scale", [{ timeMs: 0, value: 1, easing: "sine.inOut" }, { timeMs: Math.round(d / 2), value: round(1 + (p.scale as number)), easing: "sine.inOut" }, { timeMs: d, value: 1 }])); break;
    case "float": off("y", 0, 0, "linear", { noise: { amplitude: p.amplitude, frequency: 0.25, octaves: 2, seed: Math.round(p.seed as number) } }); break;
    case "glow": offset.push(surfaceTrack(s, "brightness", [{ timeMs: 0, value: 0, easing: "sine.inOut" }, { timeMs: Math.round(d / 2), value: p.brightness as number, easing: "sine.inOut" }, { timeMs: d, value: 0 }])); break;
    case "wiggle": off("rotateZ", 0, 0, "linear", { noise: { amplitude: p.degrees, frequency: 2, octaves: 1, seed: Math.round(p.seed as number) } }); break;
    case "highlight": set.push({ target: { kind: "style", id: s }, property: "--highlight", keyframes: [{ timeMs: 0, value: p.rest, easing: "sine.inOut" }, { timeMs: Math.round(d / 3), value: p.color, easing: "sine.inOut" }, { timeMs: d, value: p.rest }] }); break;
    case "counter-up": case "typewriter": case "reveal": {
      const animatable = (parsedTarget as { animatable: string }).animatable;
      const channel = animatableChannel(animatable, behaviorChannelProperty(spec.id)!);
      const [from, to] = spec.id === "counter-up" ? [p.from as number, p.to as number] : [0, spec.id === "typewriter" ? p.to as number : 1];
      set.push({ target: { kind: "channel", id: channel }, property: "value", keyframes: keys(from, to, spec.id === "typewriter" ? "linear" : spec.id === "counter-up" ? "expo.out" : "cinematic") });
      break;
    }
  }
  const { startMs, ...rest } = p;
  // Flat (stagger clips cannot nest $member tracks): offsets become absolute values over the rest pose.
  const flat = options.flat === true;
  const restValue = (property: string) => (["scale", "scaleX", "scaleY", "brightness", "contrast", "saturate"].includes(property) ? 1 : 0);
  const absolute = (track: unknown) => { const t = track as { property: string; keyframes: Key[] }; return { ...t, keyframes: t.keyframes.map(frame => ({ ...frame, value: round((frame.value as number) + restValue(t.property)) })) }; };
  const tracks = flat ? [...set, ...offset.map(absolute)] : set.length ? set : offset;
  const nested = !flat && set.length && offset.length ? [{ id: `${clipId.slice(0, 57)}-offset`, startMs: 0, mode: "add" as const, tracks: offset }] : undefined;
  const clip = {
    id: clipId, label: spec.label, startMs,
    ...(!flat && !set.length ? { mode: "add" } : {}), tracks, ...(nested ? { clips: nested } : {}),
    source: { behavior: spec.id, version: BEHAVIOR_VERSION, params: rest },
  };
  const parsed = MotionClipSchema.safeParse(clip);
  if (!parsed.success) throw new Error(`Behavior "${id}" produced an invalid clip: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}
/** The stagger tool's template for N layers: one behavior as a stagger clip over `$member` (the cascade's
 * shape, reused from choreography.ts when the behavior is the depth cascade). */
export function buildStaggeredBehavior(id: string, params: BehaviorParams, members: readonly string[], stagger: NonNullable<MotionClipInput["stagger"]>, clipId?: string): MotionClipOutput {
  if (id === "cascade") {
    const clip = createCascadeClip({ items: members.map(member => ({ id: member })), staggerMs: stagger.eachMs, depthStep: 0 }, clipId ?? "cascade");
    return MotionClipSchema.parse({ ...clip, startMs: params.startMs ?? 0, stagger });
  }
  const one = buildBehavior(id, { ...params, startMs: 0 }, { surface: "$member" }, { flat: true });
  return MotionClipSchema.parse({
    ...one, id: clipId ?? `${id}-stagger`, startMs: params.startMs ?? 0, members: [...members],
    stagger,
    source: { behavior: id, version: BEHAVIOR_VERSION, params: { ...(one.source as { params?: Record<string, unknown> }).params, eachMs: stagger.eachMs } },
  });
}
