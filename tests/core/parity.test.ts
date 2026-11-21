import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CLI_COMMANDS } from "../../src/core/cli-schema";
import { EditOpSchema, DEFERRED_EDIT_OPS, describeOp, type EditOp } from "../../src/core/edit";
import { isCompositionOp } from "../../src/core/composition-edit";
import { EDITOR_COMMANDS } from "../../src/editor/commands";
import { runCli } from "../../src/cli";

const track = { target: { kind: "camera" }, property: "x" };
const ref = { track, atMs: 0 };
const segment = { id: "intro", atMs: 1000 };
const audio = { id: "bed", assetId: "bed", startMs: 0 };
const clip = { id: "intro", startMs: 0 };
const samples: Record<Exclude<EditOp["op"], (typeof DEFERRED_EDIT_OPS)[number]>, object> = {
  "key.set": { ...ref, value: 30 }, "key.remove": ref, "key.move": { track, fromMs: 0, toMs: 50 }, "key.ease": { ...ref, easing: "linear" },
  "keys.shift": { refs: [ref], deltaMs: 50 }, "keys.scale": { refs: [ref], pivotMs: 0, factor: 2 },
  "keys.reverse": { refs: [ref, { ...ref, atMs: 50 }] }, "keys.retime": { refs: [{ ...ref, toMs: 80 }] },
  "track.add": { track, keyframes: [{ timeMs: 0, value: 30 }] }, "track.remove": { track }, "track.options": { track, interpolation: "smooth" },
  "camera.set": { property: "x", value: 0 }, "focus.set": { property: "distance", value: 1400 },
  "node.ensure": { id: "hero" }, "node.parent": { id: "hero", parentId: null }, "node.remove": { id: "hero" },
  "motion.set": { durationMs: 4000 }, "look.set": { look: { preset: "film" } }, "clip.create": { ...clip, refs: [track] },
  "stage.set": { width: 1512, height: 982, dpr: 2 },
  "depth.set": { surface: "subject", config: { mode: "auto" } },
  "depth.rule.add": { surface: "subject", rule: { match: { anchor: "chart" }, tier: "control" } },
  "depth.rule.remove": { surface: "subject", index: 0 },
  "depth.resolve": { surface: "subject", resolved: { hash: "741638a5", layers: [] } },
  "clip.update": { ...clip, speed: 0.5 }, "clip.set": { clip }, "clip.dissolve": { id: clip.id },
  "stagger.set": { clipId: clip.id, members: ["a", "b"], eachMs: 150 },
  "link.set": { link: { to: track, from: { ...track, property: "y" } } }, "link.remove": { to: track },
  "constraint.set": { constraint: { kind: "lookAt", target: { point: [0, 0, 0] } } }, "constraint.remove": { index: 0 },
  "path.fromAxes": { target: track.target }, "path.tangent": { ...ref, outTangent: [100, 0, 0] },
  "editor.set": { markers: [{ atMs: 800, label: "Entrance" }] }, restore: { at: { field: "editor" }, value: null },
  "segment.add": { ...segment, recipe: "demo", durationMs: 900 }, "segment.move": segment, "segment.reorder": { id: segment.id, beforeId: null },
  "segment.trim": { id: segment.id, edge: "out", deltaMs: -40, mode: "ripple" }, "segment.roll": { leftId: "intro", rightId: "body", deltaMs: 50 },
  "segment.slip": { id: segment.id, deltaMs: 50 }, "segment.split": segment, "segment.remove": { id: segment.id },
  "transition.set": { segmentId: "body", type: "crossfade", durationMs: 400 }, "transition.remove": { segmentId: "body" },
  "overlay.add": { ...segment, recipe: "caption", durationMs: 500 }, "overlay.move": segment, "overlay.trim": { id: segment.id, edge: "out", deltaMs: -50 },
  "overlay.remove": { id: segment.id }, "overlay.set": { id: segment.id, opacity: 0.5 },
  "audio.add": audio, "audio.move": { id: audio.id, atMs: 500 }, "audio.trim": { id: audio.id, edge: "in", deltaMs: 100 },
  "audio.remove": { id: audio.id }, "audio.set": { id: audio.id, gain: 0.8 }, "marker.add": { atMs: 200, kind: "beat" },
  "marker.move": { index: 0, atMs: 250 }, "marker.remove": { index: 0 }, "captions.set": { captions: { file: "captions.srt", style: "karaoke" } },
  "composition.restore": { fields: [{ field: "markers", before: null, after: [{ atMs: 50 }] }] },
};

describe("agent and editor parity", () => {
  it("documents each implemented EditOp and supplies a human label and CLI entry point", async () => {
    const text = await readFile(new URL("../../skills/velora-editor/SKILL.md", import.meta.url), "utf8");
    const tables = text.split(/\r?\n/).filter(line => line.startsWith("|")).join("\n");
    const names = EditOpSchema.options.map(variant => variant.shape.op.value);
    const implemented = names.filter((name): name is keyof typeof samples => !DEFERRED_EDIT_OPS.some(deferred => deferred === name));
    expect(Object.keys(samples).sort()).toEqual([...implemented].sort());
    for (const name of implemented) {
      const parsed = EditOpSchema.parse({ op: name, ...samples[name] });
      expect(tables, name).toMatch(new RegExp("`" + name.replace(".", "\\.") + "(?:[ `{])"));
      expect(describeOp(parsed), name).not.toMatch(/not yet available|undefined|NaN/);
      const command = isCompositionOp(parsed) ? "compose" : "edit";
      const entry = CLI_COMMANDS.find(item => item.name === command);
      expect(entry?.flags, name).toContain("--ops");
    }
    const help = await Promise.all(["edit", "compose"].map(command => runCli([command, "--help"], { root: process.cwd() })));
    expect(help[0].stdout).toContain("velora edit apply --scene ID --ops FILE|-");
    expect(help[0].stdout).toContain("velora edit stage --scene ID");
    expect(help[1].stdout).toContain("velora compose edit --composition FILE --ops FILE|-");
    for (const name of DEFERRED_EDIT_OPS) expect(tables).not.toContain(`\`${name}`);
    for (const helper of ["trim", "move", "split", "transition"]) expect(help[1].stdout).toContain(`velora compose ${helper}`);
  });

  it("tags every editor command with implemented EditOps or UI-only effects", () => {
    for (const command of EDITOR_COMMANDS) {
      if (command.effects === "ui-only") continue;
      expect(command.effects, command.id).not.toHaveLength(0);
      for (const op of command.effects) expect(Object.hasOwn(samples, op), `${command.id}: ${op}`).toBe(true);
    }
  });
});
