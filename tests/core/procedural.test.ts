import { describe, expect, it } from "vitest";
import { MotionSchema } from "../../src/core/motion";
import { NodeSchema } from "../../src/core/scene";
import { MAX_PROCEDURAL_NODES, buildProcedural, proceduralIssues, type ProceduralKind } from "../../src/core/procedural";

const kinds: ProceduralKind[] = ["grid-field", "dot-matrix", "gradient-veil", "line-sweep", "particle-drift", "waveform-bar"];
function build(kind: ProceduralKind, extra: Record<string, unknown> = {}) {
  const out = buildProcedural({ kind, prefix: "bg", seed: 11, count: 12, durationMs: 3000, ...extra });
  for (const node of out.nodes) expect(NodeSchema.safeParse(node).success, JSON.stringify(node)).toBe(true);
  expect(MotionSchema.safeParse({ durationMs: 3000, tracks: out.tracks }).success, JSON.stringify(out.tracks)).toBe(true);
  const ids = out.nodes.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  return out;
}
describe("procedural primitives", () => {
  it.each(kinds)("compiles %s to valid nodes and tracks", (kind) => {
    const out = build(kind);
    expect(out.nodes.length).toBeGreaterThan(0);
    if (kind === "grid-field") expect(out.nodes.length).toBe(12);
    if (kind === "gradient-veil") expect(out.nodes).toHaveLength(1);
  });
  it("replays identically from the same seed and diverges otherwise", () => {
    expect(build("dot-matrix")).toEqual(build("dot-matrix"));
    const other = buildProcedural({ kind: "dot-matrix", prefix: "bg", seed: 12, count: 12, durationMs: 3000 });
    expect(other).not.toEqual(build("dot-matrix"));
    const wave = build("waveform-bar", { count: 3, data: [0, 0.5, 1] });
    expect(wave.nodes).toHaveLength(3);
    expect(proceduralIssues({ kind: "waveform-bar", prefix: "bg", count: 12, data: [0, 0.5, 1] })).not.toEqual([]);
  });
  it("enforces budgets with issues instead of exhausting the DOM", () => {
    expect(proceduralIssues({ kind: "dot-matrix", prefix: "bg", count: MAX_PROCEDURAL_NODES + 1 })).not.toEqual([]);
    expect(proceduralIssues({ kind: "nope", prefix: "bg" })).not.toEqual([]);
    expect(proceduralIssues({ kind: "dot-matrix", prefix: "UPPER" })).not.toEqual([]);
    expect(proceduralIssues({ kind: "dot-matrix", prefix: "bg", count: 4 })).toEqual([]);
    expect(() => buildProcedural({ kind: "dot-matrix", prefix: "bg", count: MAX_PROCEDURAL_NODES + 1, durationMs: 1000 })).toThrow();
  });
});
