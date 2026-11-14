import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyEdits, coalesce, describeOp, parseTrackShorthand, lineDiff, type EditOp } from "../../src/core/edit";
import { formatJsonDocument, parseJsonDocument } from "../../src/core/json";
import { SceneRecipeSchema } from "../../src/core/recipes";
import { presentPreview } from "../../src/core/preview";
import { createRng } from "../../src/core/random";
import { goldenPath } from "./v21-golden";

const corpus = JSON.parse(readFileSync(goldenPath("format-corpus.json"), "utf8")) as Record<string, { base64: string }>;
const recipes = Object.entries(corpus).filter(([file]) => file.endsWith(".scene.json")).map(([file, entry]) => {
  const text = Buffer.from(entry.base64, "base64").toString("utf8");
  return { file, text, recipe: parseJsonDocument(text) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}).filter(({ recipe }) => SceneRecipeSchema.safeParse(recipe).success && presentPreview(SceneRecipeSchema.parse(recipe).definition).valid);
const base = () => ({ version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [{ id: "card" }] }, motion: { durationMs: 2000, speed: 1, tracks: [
  { target: { kind: "surface", id: "card" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 100 }] }] } } });
const cardX = { target: { kind: "surface" as const, id: "card" }, property: "x" };

/** A random but plausible op for a recipe (some will be rejected; that is part of the property). */
function randomOp(recipe: any, rng: () => number): EditOp { // eslint-disable-line @typescript-eslint/no-explicit-any
  const tracks = recipe.definition.motion?.tracks ?? [];
  const nodes = recipe.definition.scene.nodes as { id: string }[];
  const duration = recipe.definition.motion?.durationMs ?? 1000;
  const pick = <T,>(list: T[]) => list[Math.floor(rng() * list.length)];
  const track: any = tracks.length ? pick(tracks) : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  const address = track ? { target: track.target, property: track.property } : { target: { kind: "camera" }, property: "z" };
  const at = Math.round(rng() * duration);
  const frame = track ? pick(track.keyframes as { timeMs: number }[]) : undefined;
  const numeric = track && typeof track.keyframes[0].value === "number";
  const options: (() => unknown)[] = [
    () => ({ op: "key.set", track: address, atMs: at, value: numeric || !track ? Math.round(rng() * 200 - 100) : track.keyframes[0].value, easing: pick(["linear", "cinematic", "auto", "expo.out"]) }),
    () => frame && ({ op: "key.move", track: address, fromMs: frame.timeMs, toMs: Math.round(rng() * duration) }),
    () => frame && ({ op: "key.ease", track: address, atMs: frame.timeMs, easing: pick(["linear", "sine.inOut", { cubicBezier: [0.3, 0, 0.2, 1] }]) }),
    () => frame && ({ op: "key.remove", track: address, atMs: frame.timeMs }),
    () => frame && ({ op: "keys.shift", refs: [{ track: address, atMs: frame.timeMs }], deltaMs: Math.round(rng() * 400 - 200) }),
    () => ({ op: "camera.set", property: pick(["x", "y", "z", "rotateY"]), value: rng() < 0.2 ? null : Math.round(rng() * 100) }),
    () => ({ op: "focus.set", property: "fStop", value: 1 + Math.round(rng() * 10) }),
    () => ({ op: "node.ensure", id: `n${Math.floor(rng() * 3)}` }),
    () => ({ op: "motion.set", durationMs: Math.round(duration * (0.5 + rng())) }),
    () => track && ({ op: "track.remove", track: address }),
    () => ({ op: "track.add", track: { target: { kind: "surface", id: pick(nodes)?.id ?? "card" }, property: "opacity" }, keyframes: [{ timeMs: 0, value: 0 }, { timeMs: Math.min(duration, 500), value: 1 }] }),
    () => track && ({ op: "clip.create", id: `c${Math.floor(rng() * 4)}`, refs: [address], startMs: 0 }),
    () => ({ op: "editor.set", labels: { [pick(nodes)?.id ?? "card"]: "Label" }, markers: [{ atMs: at, label: "beat" }] }),
    () => ({ op: "link.set", link: { to: { target: { kind: "channel", id: "echo" }, property: "value" }, from: { target: { kind: "camera" }, property: "x" }, scale: 0.5 } }),
    () => ({ op: "constraint.set", constraint: { kind: "focusFollow", target: { point: [0, 0, 0] } } }),
  ];
  for (;;) { const op = pick(options)(); if (op) return op as EditOp; }
}

describe("applyEdits property tests over the corpus", () => {
  it("rejects atomically or yields a valid recipe whose inverse restores the input exactly", () => {
    expect(recipes.length).toBeGreaterThanOrEqual(15);
    const rng = createRng(2026);
    let applied = 0, rejected = 0, plain = 0;
    for (let trial = 0; trial < 400; trial++) {
      const { recipe, text } = recipes[trial % recipes.length];
      const before = JSON.stringify(recipe);
      const ops = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => randomOp(recipe, rng));
      const result = applyEdits(recipe, ops);
      expect(JSON.stringify(recipe)).toBe(before); // never mutates the input
      if (!result.ok) { rejected++; expect(result.issues.length).toBeGreaterThan(0); continue; }
      applied++;
      expect(SceneRecipeSchema.safeParse(result.recipe).success).toBe(true);
      const undo = applyEdits(result.recipe, result.inverse);
      expect(undo.ok, JSON.stringify(ops)).toBe(true);
      if (undo.ok) {
        expect(undo.recipe).toEqual(recipe);
        // On disk: the edited file, undone with the pre-edit text as layout reference (what the bridge
        // history keeps), is byte-identical to the original.
        const edited = formatJsonDocument(text, result.recipe);
        const restored = formatJsonDocument(edited, undo.recipe, { reference: text });
        expect(restored, `${JSON.stringify(ops)}
${lineDiff(text, restored)}`).toBe(text);
        if (formatJsonDocument(edited, undo.recipe) === text) plain++;
      }
    }
    // Without a reference, layout survives unless an edit removed every node of a shape.
    expect(plain / applied).toBeGreaterThan(0.9);
    expect(applied).toBeGreaterThan(100);
    expect(rejected).toBeGreaterThan(0);
  }, 120_000);
});
describe("edit ops", () => {
  it("upserts keyframes, inserts sorted and adds missing nodes automatically (recorded in the inverse)", () => {
    const result = applyEdits(base(), [{ op: "key.set", track: { target: { kind: "surface", id: "title" }, property: "opacity" }, atMs: 200, value: 1 },
      { op: "key.set", track: cardX, atMs: 500, value: 40, easing: "auto" }]);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.recipe.definition).toMatchObject({ scene: { nodes: [{ id: "card" }, { id: "title" }] } });
    expect((result.recipe as any).definition.motion.tracks[0].keyframes.map((k: { timeMs: number }) => k.timeMs)).toEqual([0, 500, 1000]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(result.touched).toEqual(expect.arrayContaining(["node:title"]));
    const undo = applyEdits(result.recipe, result.inverse);
    expect(undo.ok && undo.recipe).toEqual(base());
  });
  it("guards the duration unless the batch extends it", () => {
    const late = applyEdits(base(), [{ op: "key.set", track: cardX, atMs: 3000, value: 1 }]);
    expect(late.ok).toBe(false);
    if (!late.ok) { expect(late.issues[0].path).toMatch(/^ops\.0:/); expect(late.issues[0].hint).toMatch(/motion\.set/); }
    expect(applyEdits(base(), [{ op: "key.set", track: cardX, atMs: 3000, value: 1 }, { op: "motion.set", durationMs: 3000 }]).ok).toBe(true);
  });
  it("is atomic and names the failing op", () => {
    const result = applyEdits(base(), [{ op: "camera.set", property: "x", value: 5 }, { op: "key.move", track: cardX, fromMs: 7, toMs: 9 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toMatchObject({ code: "ERR_EDIT_TARGET", path: "ops.1" });
    const invalid = applyEdits(base(), [{ op: "key.set", track: cardX }]);
    expect(!invalid.ok && invalid.issues[0].path.startsWith("ops.0")).toBe(true);
  });
  it("refuses node.remove while targeted, and the last keyframe removal", () => {
    expect(applyEdits(base(), [{ op: "node.remove", id: "card" }]).ok).toBe(false);
    expect(applyEdits(base(), [{ op: "key.remove", track: cardX, atMs: 0 }, { op: "key.remove", track: cardX, atMs: 1000 }]).ok).toBe(false);
    expect(applyEdits(base(), [{ op: "track.remove", track: cardX }, { op: "node.remove", id: "card" }]).ok).toBe(true);
  });
  it("creates clips without changing the render, updates and dissolves them exactly", async () => {
    const { evaluateMotion } = await import("../../src/core/motion");
    const grouped = applyEdits(base(), [{ op: "clip.create", id: "intro", refs: [cardX], startMs: 0 }, { op: "clip.update", id: "intro", startMs: 500 }]);
    if (!grouped.ok) throw new Error(JSON.stringify(grouped.issues));
    expect(evaluateMotion((grouped.recipe as any).definition.motion, 1000).surfaces.card.x).toBe(50); // eslint-disable-line @typescript-eslint/no-explicit-any
    const dissolved = applyEdits(grouped.recipe, [{ op: "clip.dissolve", id: "intro" }]);
    if (!dissolved.ok) throw new Error(JSON.stringify(dissolved.issues));
    expect((dissolved.recipe as any).definition.motion.tracks[0].keyframes.map((k: { timeMs: number }) => k.timeMs)).toEqual([500, 1500]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const eased = applyEdits(grouped.recipe, [{ op: "clip.update", id: "intro", ease: "cubic.out" }, { op: "clip.dissolve", id: "intro" }]);
    expect(eased.ok).toBe(false);
    const baked = applyEdits(grouped.recipe, [{ op: "clip.update", id: "intro", ease: "cubic.out" }, { op: "clip.dissolve", id: "intro", bake: { samplesPerSecond: 30 } }]);
    expect(baked.ok).toBe(true);
  });
  it("converts x/y/z tracks into a position path and edits its tangents", () => {
    const recipe = base();
    recipe.definition.motion.tracks.push(
      { target: { kind: "surface", id: "card" }, property: "y", keyframes: [{ timeMs: 0, value: 5 }, { timeMs: 1000, value: 9 }] },
      { target: { kind: "surface", id: "card" }, property: "z", keyframes: [{ timeMs: 500, value: -20 }] });
    const result = applyEdits(recipe, [{ op: "path.fromAxes", target: { kind: "surface", id: "card" } },
      { op: "path.tangent", track: { target: { kind: "surface", id: "card" }, property: "position" }, atMs: 0, outTangent: [0, 30, 0] }]);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const track = (result.recipe as any).definition.motion.tracks[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(track.property).toBe("position");
    expect(track.keyframes.map((k: { timeMs: number; value: number[] }) => [k.timeMs, k.value])).toEqual([[0, [0, 5, -20]], [500, [50, 7, -20]], [1000, [100, 9, -20]]]);
    expect(track.keyframes[0].outTangent).toEqual([0, 30, 0]);
  });
  it("returns ERR_EDIT_UNSUPPORTED for later-phase ops", () => {
    const result = applyEdits(base(), [{ op: "stage.set", preset: "laptop-14" }]);
    expect(!result.ok && result.issues[0].code).toBe("ERR_EDIT_UNSUPPORTED");
  });
  it("coalesces drag gestures and labels ops for history", () => {
    expect(coalesce({ op: "key.move", track: cardX, fromMs: 0, toMs: 100 }, { op: "key.move", track: cardX, fromMs: 100, toMs: 140 })).toEqual({ op: "key.move", track: cardX, fromMs: 0, toMs: 140 });
    expect(coalesce({ op: "key.set", track: cardX, atMs: 0, value: 1 }, { op: "key.set", track: cardX, atMs: 0, value: 2 })).toMatchObject({ value: 2 });
    expect(coalesce({ op: "key.set", track: cardX, atMs: 0, value: 1 }, { op: "key.set", track: cardX, atMs: 10, value: 2 })).toBeUndefined();
    expect(coalesce({ op: "keys.shift", refs: [{ track: cardX, atMs: 0 }], deltaMs: 10 }, { op: "keys.shift", refs: [{ track: cardX, atMs: 10 }], deltaMs: 5 })).toMatchObject({ deltaMs: 15 });
    expect(describeOp({ op: "key.move", track: { target: { kind: "surface", id: "headline" }, property: "x" }, fromMs: 1200, toMs: 1350 })).toBe("Move headline x keyframe 1.20 s → 1.35 s");
  });
  it("parses track shorthand with clear errors", () => {
    expect(parseTrackShorthand("camera.z")).toEqual({ ok: true, track: { target: { kind: "camera" }, property: "z" } });
    expect(parseTrackShorthand("focus.distance")).toMatchObject({ ok: true, track: { target: { kind: "focus" } } });
    expect(parseTrackShorthand("hero.card.x")).toEqual({ ok: true, track: { target: { kind: "surface", id: "hero.card" }, property: "x" } });
    expect(parseTrackShorthand("style:card.--accent")).toEqual({ ok: true, track: { target: { kind: "style", id: "card" }, property: "--accent" } });
    expect(parseTrackShorthand("channel:cursor-x")).toEqual({ ok: true, track: { target: { kind: "channel", id: "cursor-x" }, property: "value" } });
    expect(parseTrackShorthand("card.x@intro")).toMatchObject({ ok: true, track: { clip: "intro" } });
    for (const bad of ["camera", "x.", "style:card", "channel:", "a@b@c"]) expect(parseTrackShorthand(bad).ok, bad).toBe(false);
  });
  it("diffs lines for dry runs", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\n")).toBe("@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n ");
    expect(lineDiff("same", "same")).toBe("");
  });
});
