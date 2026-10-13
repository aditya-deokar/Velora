import { z } from "zod";
import { MotionTrackSchema, type MotionTrack } from "./motion";
import { NodeSchema, type SceneIssue } from "./scene";
import { createRng } from "./random";

/** SOURCE OF TRUTH: procedural primitives compiling to scene nodes and tracks.
 * WHAT: seeded generators (grids, matrices, sweeps, drifts, bars) producing
 * valid scene nodes plus matching motion tracks.
 * WHY: agents build rich backgrounds without placing hundreds of nodes by hand.
 * WHERE: scene authors paste output into recipes; validate enforces budgets.
 * All randomness flows from an explicit seed: same seed, same nodes, same
 * tracks, same frames. Counts and durations are bounded; over-budget requests
 * fail with ERR_PROCEDURAL_BUDGET instead of exhausting the live DOM.
 */
export const MAX_PROCEDURAL_NODES = 200;
export const ProceduralKindSchema = z.enum(["grid-field", "dot-matrix", "gradient-veil", "line-sweep", "particle-drift", "waveform-bar"]);
export type ProceduralKind = z.output<typeof ProceduralKindSchema>;
export const ProceduralInputSchema = z.strictObject({
  kind: ProceduralKindSchema,
  prefix: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase slug prefix for generated node IDs."),
  seed: z.number().int().nonnegative().max(4_294_967_295).default(0),
  count: z.number().int().positive().max(MAX_PROCEDURAL_NODES).default(24),
  width: z.number().finite().positive().max(7680).default(1400),
  height: z.number().finite().positive().max(7680).default(980),
  durationMs: z.number().finite().positive().max(120_000).default(4000),
  data: z.array(z.number().finite().min(0).max(1)).max(64).optional(),
}).superRefine((value, ctx) => {
  if (value.data !== undefined && value.data.length !== value.count)
    ctx.addIssue({ code: "custom", path: ["data"], message: `Data has ${value.data.length} levels but count is ${value.count}. Match them or omit data for seeded levels.` });
});
export type ProceduralInput = z.input<typeof ProceduralInputSchema>;
export type ProceduralOutput = { nodes: z.output<typeof NodeSchema>[]; tracks: MotionTrack[] };
function mustTrack(track: unknown): MotionTrack {
  const parsed = MotionTrackSchema.safeParse(track);
  if (!parsed.success) throw new Error(`Procedural builder produced an invalid track: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}
function mustNode(node: unknown): z.output<typeof NodeSchema> {
  const parsed = NodeSchema.safeParse(node);
  if (!parsed.success) throw new Error(`Procedural builder produced an invalid node: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}
// Generate nodes+tracks. Throws ERR-coded faults? No: input validation uses
// issues (caller maps to ERR_PROCEDURAL_BUDGET); generation itself is total.
export function buildProcedural(input: ProceduralInput): ProceduralOutput {
  const options = ProceduralInputSchema.parse(input);
  const rng = createRng(options.seed);
  const nodes: z.output<typeof NodeSchema>[] = [];
  const tracks: MotionTrack[] = [];
  const id = (suffix: string) => `${options.prefix}-${suffix}`;
  if (options.kind === "gradient-veil") {
    nodes.push(mustNode({ id: id("veil"), transform: { z: -160 } }));
    tracks.push(mustTrack({ target: { kind: "surface", id: id("veil") }, property: "opacity", keyframes: [
      { timeMs: 0, value: 0.35 }, { timeMs: options.durationMs, value: 0.6 },
    ] }));
    return { nodes, tracks };
  }
  if (options.kind === "grid-field") {
    const cols = Math.max(1, Math.ceil(Math.sqrt(options.count)));
    const rows = Math.max(1, Math.ceil(options.count / cols));
    let n = 0;
    for (let r = 0; r < rows && n < options.count; r++) {
      for (let c = 0; c < cols && n < options.count; c++, n++) {
        const nodeId = id(`r${r}c${c}`);
        nodes.push(mustNode({ id: nodeId, transform: {
          x: (c - (cols - 1) / 2) * (options.width / Math.max(cols, 4)),
          y: (r - (rows - 1) / 2) * (options.height / Math.max(rows, 4)),
          z: -40,
        } }));
        tracks.push(mustTrack({ target: { kind: "surface", id: nodeId }, property: "z", keyframes: [
          { timeMs: 0, value: -40 }, { timeMs: options.durationMs, value: 0 },
        ] }));
      }
    }
    return { nodes, tracks };
  }
  if (options.kind === "line-sweep") {
    for (let i = 0; i < options.count; i++) {
      const nodeId = id(`line${i}`);
      const y = (i / Math.max(1, options.count - 1) - 0.5) * options.height;
      nodes.push(mustNode({ id: nodeId, transform: { x: -options.width / 2, y } }));
      tracks.push(mustTrack({ target: { kind: "surface", id: nodeId }, property: "x", keyframes: [
        { timeMs: (i / options.count) * options.durationMs * 0.5, value: -options.width / 2 },
        { timeMs: options.durationMs, value: options.width / 2 },
      ] }));
    }
    return { nodes, tracks };
  }
  if (options.kind === "waveform-bar") {
    const levels = options.data ?? Array.from({ length: options.count }, () => 0.2 + rng() * 0.8);
    for (let i = 0; i < options.count; i++) {
      const nodeId = id(`bar${i}`);
      nodes.push(mustNode({ id: nodeId, transform: {
        x: (i / Math.max(1, options.count - 1) - 0.5) * options.width,
        scale: 1,
      } }));
      tracks.push(mustTrack({ target: { kind: "surface", id: nodeId }, property: "scale", keyframes: [
        { timeMs: 0, value: 0.3 + levels[i] * 0.4 },
        { timeMs: options.durationMs / 2, value: 0.3 + levels[(i + 1) % levels.length] * 1.4 },
        { timeMs: options.durationMs, value: 0.3 + levels[i] * 0.4 },
      ] }));
    }
    return { nodes, tracks };
  }
  // dot-matrix and particle-drift: seeded scatter; drift adds travel.
  const drifting = options.kind === "particle-drift";
  for (let i = 0; i < options.count; i++) {
    const nodeId = id(`p${i}`);
    const x = (rng() - 0.5) * options.width;
    const y = (rng() - 0.5) * options.height;
    const z = -20 - rng() * 140;
    nodes.push(mustNode({ id: nodeId, transform: { x, y, z } }));
    if (drifting) {
      tracks.push(mustTrack({ target: { kind: "surface", id: nodeId }, property: "x", keyframes: [
        { timeMs: 0, value: x }, { timeMs: options.durationMs, value: x + (rng() - 0.5) * options.width * 0.3 },
      ] }));
      tracks.push(mustTrack({ target: { kind: "surface", id: nodeId }, property: "opacity", keyframes: [
        { timeMs: 0, value: 0 }, { timeMs: options.durationMs * 0.2, value: 1 },
        { timeMs: options.durationMs, value: 0 },
      ] }));
    }
  }
  return { nodes, tracks };
}
export function proceduralIssues(input: unknown): SceneIssue[] {
  const parsed = ProceduralInputSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({ path: `procedural.${issue.path.join(".")}`, message: issue.message }));
}
