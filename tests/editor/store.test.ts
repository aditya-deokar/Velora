import { describe, expect, it } from "vitest";
import { createEditorStore, type EditorWriter } from "../../src/editor/store";
import type { EditOp } from "../../src/core";

const recipe = () => ({ version: 1, id: "demo", title: "Demo", definition: { scene: { nodes: [{ id: "card" }] }, motion: { durationMs: 2000, speed: 1, tracks: [
  { target: { kind: "surface", id: "card" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 100 }] }] } } });
const x = { target: { kind: "surface" as const, id: "card" }, property: "x" };
const keySet = (value: number, atMs = 500): EditOp => ({ op: "key.set", track: x, atMs, value });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function connected(reply: (ops: EditOp[]) => Awaited<ReturnType<EditorWriter>> = () => ({ status: "ok", sha: "s" + Math.random() })) {
  const calls: EditOp[][] = [];
  const writer: EditorWriter = async (_sha, ops) => { calls.push(ops); return reply(ops); };
  return { store: createEditorStore({ sceneId: "demo", base: recipe(), sha: "a".repeat(64), readOnly: false, writer, schedule: () => undefined }), calls };
}
describe("editor store", () => {
  it("commits a gesture as one entry and one write, and acknowledges it", async () => {
    const { store, calls } = connected();
    store.preview([keySet(10)]); store.preview([keySet(20)]); store.preview([keySet(30)]);
    expect(store.getState().draft.definition.motion.tracks[0].keyframes[1].value).toBe(30);
    store.commit([keySet(30)]);
    await flush();
    expect(calls).toHaveLength(1);
    expect(store.getState().undo).toHaveLength(1);
    expect(store.getState().save).toBe("saved");
    expect(store.getState().base.definition.motion.tracks[0].keyframes).toHaveLength(3);
  });
  it("undoes and redoes exactly", async () => {
    const { store } = connected();
    store.commit([keySet(40)]);
    await flush();
    store.undo();
    await flush();
    expect(store.getState().draft).toEqual(recipe());
    store.redo();
    await flush();
    expect(store.getState().draft.definition.motion.tracks[0].keyframes[1].value).toBe(40);
  });
  it("coalesces rapid single-op edits of one target into one history step", () => {
    let now = 0;
    const store = createEditorStore({ sceneId: "demo", base: recipe(), readOnly: true, now: () => now });
    store.commit([keySet(1)]); now += 100;
    store.commit([keySet(2)], undefined, { merge: true }); now += 100;
    store.commit([keySet(3)], undefined, { merge: true }); now += 5000;
    store.commit([keySet(4)], undefined, { merge: true });
    expect(store.getState().undo).toHaveLength(2);
    store.undo(); store.undo();
    expect(store.getState().draft).toEqual(recipe());
  });
  it("cancels a gesture back to the pre-drag draft and keeps the last valid draft for invalid steps", () => {
    const store = createEditorStore({ sceneId: "demo", base: recipe(), readOnly: true });
    store.preview([keySet(5)]);
    store.preview([{ op: "key.set", track: x, atMs: 99999, value: 1 }]);
    expect(store.getState().draft.definition.motion.tracks[0].keyframes[1].value).toBe(5);
    store.cancel();
    expect(store.getState().draft).toEqual(recipe());
  });
  it("ignores its own echo, adopts external changes without pending ops, and rebases with them", async () => {
    const { store } = connected();
    store.external(recipe(), "a".repeat(64), "");
    expect(store.getState().revision).toBe(0);
    const external = { ...recipe(), title: "Changed" };
    store.external(external, "b".repeat(64), JSON.stringify(external));
    expect(store.getState().base.title).toBe("Changed");
    const slow = createEditorStore({ sceneId: "demo", base: recipe(), sha: "a".repeat(64), readOnly: false, writer: () => new Promise(() => undefined), schedule: () => undefined });
    slow.commit([keySet(7)]);
    slow.external(external, "c".repeat(64), "");
    expect(slow.getState().draft.title).toBe("Changed");
    expect(slow.getState().draft.definition.motion.tracks[0].keyframes[1].value).toBe(7);
  });
  it("enters the conflict state when pending ops no longer apply, and resolves either way", () => {
    const store = createEditorStore({ sceneId: "demo", base: recipe(), sha: "a".repeat(64), readOnly: false, writer: () => new Promise(() => undefined), schedule: () => undefined });
    store.commit([{ op: "key.move", track: x, fromMs: 1000, toMs: 1500 }]);
    const external = recipe();
    external.definition.motion.tracks[0].keyframes[1].timeMs = 900;
    store.external(external, "d".repeat(64), JSON.stringify(external));
    expect(store.getState().save).toBe("conflict");
    store.resolve("disk");
    expect(store.getState().draft).toEqual(external);
    expect(store.getState().save).toBe("saved");
  });
  it("rolls back a batch the bridge refuses (422) and its history entry", async () => {
    const { store } = connected(() => ({ status: "invalid", issues: [{ code: "ERR_EDIT_INVALID", path: "ops.0", message: "nope" }] }));
    store.commit([keySet(9)]);
    await flush();
    expect(store.getState().draft).toEqual(recipe());
    expect(store.getState().undo).toHaveLength(0);
    expect(store.getState().issues[0].message).toBe("nope");
  });
  it("keeps edits in memory in read-only mode and freezes drafts in development", () => {
    const store = createEditorStore({ sceneId: "demo", base: recipe(), readOnly: true });
    store.commit([keySet(3)]);
    expect(store.getState().save).toBe("unsaved");
    expect(store.unsavedOps()).toEqual([keySet(3)]);
    expect(Object.isFrozen(store.getState().draft)).toBe(true);
  });
  it("caps history at 200 entries", () => {
    const store = createEditorStore({ sceneId: "demo", base: recipe(), readOnly: true });
    for (let i = 0; i < 205; i++) store.commit([keySet(i)]);
    expect(store.getState().undo).toHaveLength(200);
  });
});
