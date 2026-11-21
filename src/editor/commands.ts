import type { EditOp, TrackAddress } from "../core";
import type { EditorState, EditorStore, KeyRef, ViewportTool } from "./store";
import type { SceneSnapshot } from "../react";
import { CameraSchema, FocusSchema } from "../core";
import { defaultDirector } from "./viewport/DirectorView";
import { rackOps } from "./viewport/FocusTool";
import { toAuthored } from "./properties";
import { intentToOps } from "./intents";
import { findTrack, listTracks, snapToFrame, trackKey } from "./model";
import { groupOps } from "./group";

/** SOURCE OF TRUTH: EDITOR_COMMANDS.
 * WHAT: every editor action as data: a stable id, a label, shortcuts (EDITOR-UX §5), enabled(state) and
 * run(controller). The command palette, menus, the timeline context menu and the shortcut handler read it.
 * WHY: keyboard-first and accessible: every action is reachable by name, shortcuts never collide with the
 * preview transport (Space, J/K/L, arrows, Home/End, [ ]), and Phase 11 docs and tests cite the ids.
 * WHERE: Editor.tsx builds the controller and dispatches keydown through matchShortcut; panels run
 * commands by id. Edits go through intents and the store, never around them.
 */
export type EditorPanel = "palette" | "easing" | "history" | "advisories" | "stagger" | "behaviors" | "camera-moves" | "presets" | "save-easing" | "timing" | "ungroup";
export type EditorController = {
  store: EditorStore;
  state: EditorState;
  session: { timeMs: number; durationMs: number; seek(ms: number): void };
  fps: number;
  /** The property the user last focused (inspector row or timeline row), for Alt+K. */
  focused?: { track: TrackAddress; value: number | string };
  open(panel: EditorPanel): void;
  copy(): void; cut(): void; paste(): void; duplicate(): void;
  zoom(direction: 1 | -1 | 0): void;
  notify(message: string): void;
  /** The latest Scene snapshot (viewport commands: director view, rack focus). */
  snapshot?: SceneSnapshot;
};
export type EditorCommand = {
  id: string; label: string; group: string; shortcuts: readonly string[];
  enabled(state: EditorState): boolean; run(controller: EditorController): void;
};
const EASY_EASE = { cubicBezier: [0.333, 0, 0.667, 1] as [number, number, number, number] };
const EASE_IN = { cubicBezier: [0.333, 0, 1, 1] as [number, number, number, number] };
const EASE_OUT = { cubicBezier: [0, 0, 0.667, 1] as [number, number, number, number] };
const hasKeys = (state: EditorState) => state.selection.keys.length > 0;
const tool = (id: ViewportTool, key: string, label: string): EditorCommand =>
  ({ id: `tool.${id}`, label, group: "Viewport", shortcuts: [key], enabled: always, run: c => c.store.setUi({ tool: id }) });
const SPECIAL_LAYERS = new Set(["camera", "focus", "motion", "look"]);
export const surfaceLayers = (state: EditorState) => state.selection.layers.filter(id => !SPECIAL_LAYERS.has(id) && !id.startsWith("clip:") && !id.startsWith("animatable:"));
const always = () => true;
const commit = (c: EditorController, ops: EditOp[], label?: string) => { if (ops.length) c.store.commit(ops, label); };
/** Keys whose outgoing segment exists (the last keyframe of a track has no segment to ease). */
function easable(c: EditorController): KeyRef[] {
  const doc = c.store.committed();
  return c.state.selection.keys.filter(ref => { const track = findTrack(doc, ref.track); return track && track.keyframes[track.keyframes.length - 1].timeMs !== ref.atMs; });
}
const easeSelection = (c: EditorController, easing: EditOp extends never ? never : unknown, label: string) =>
  commit(c, easable(c).map(ref => ({ op: "key.ease", track: ref.track, atMs: ref.atMs, easing } as EditOp)), label);
function deleteSelection(c: EditorController) {
  const doc = c.store.committed();
  const groups = new Map<string, { track: TrackAddress; times: number[] }>();
  for (const ref of c.state.selection.keys) {
    const key = trackKey(ref.track);
    if (!groups.has(key)) groups.set(key, { track: ref.track, times: [] });
    groups.get(key)!.times.push(ref.atMs);
  }
  const ops: EditOp[] = [];
  for (const { track, times } of groups.values()) {
    const found = findTrack(doc, track);
    if (!found) continue;
    if (times.length >= found.keyframes.length) ops.push({ op: "track.remove", track });
    else for (const atMs of times) ops.push({ op: "key.remove", track, atMs });
  }
  commit(c, ops, `Delete ${c.state.selection.keys.length} keyframe${c.state.selection.keys.length === 1 ? "" : "s"}`);
  c.store.select({ keys: [] });
}
function nudge(c: EditorController, frames: number) {
  const delta = (frames * 1000) / c.fps;
  const refs = c.state.selection.keys;
  if (!refs.length) return;
  if (refs.some(ref => ref.atMs + delta < 0)) { c.notify("Keyframes cannot move before 0."); return; }
  const issues = c.store.commit([{ op: "keys.shift", refs, deltaMs: delta }], undefined, { merge: true });
  if (!issues.length) c.store.select({ keys: refs.map(ref => ({ ...ref, atMs: ref.atMs + delta })) });
  else c.notify(issues[0].message);
}
function stepKeyframe(c: EditorController, direction: 1 | -1) {
  const doc = c.store.committed();
  const scope = c.state.selection.tracks.length ? c.state.selection.tracks.map(trackKey) : undefined;
  const times = listTracks(doc).filter(entry => !scope || scope.includes(entry.key)).flatMap(entry => entry.track.keyframes.map((frame: { timeMs: number }) => frame.timeMs + (entry.clip ? clipStart(doc, entry.clip) : 0)));
  const now = c.session.timeMs;
  const sorted = [...new Set(times)].sort((a, b) => a - b);
  const target = direction > 0 ? sorted.find(time => time > now + 1e-6) : [...sorted].reverse().find(time => time < now - 1e-6);
  if (target !== undefined) c.session.seek(target);
}
function clipStart(doc: ReturnType<EditorStore["committed"]>, id: string): number {
  const visit = (clips: { id: string; startMs: number; clips?: unknown[] }[] | undefined, offset: number): number | undefined => {
    for (const clip of clips ?? []) {
      if (clip.id === id) return offset + clip.startMs;
      const nested = visit(clip.clips as never, offset + clip.startMs);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return visit(doc?.definition?.motion?.clips, 0) ?? 0;
}
export const EDITOR_COMMANDS: readonly EditorCommand[] = Object.freeze([
  { id: "palette.open", label: "Command palette", group: "General", shortcuts: ["Mod+K"], enabled: always, run: c => c.open("palette") },
  { id: "history.undo", label: "Undo", group: "General", shortcuts: ["Mod+Z"], enabled: s => s.undo.length > 0, run: c => c.store.undo() },
  { id: "history.redo", label: "Redo", group: "General", shortcuts: ["Mod+Shift+Z", "Ctrl+Y"], enabled: s => s.redo.length > 0, run: c => c.store.redo() },
  { id: "history.open", label: "Show history", group: "General", shortcuts: [], enabled: always, run: c => c.open("history") },
  { id: "advisories.open", label: "Show advisories", group: "General", shortcuts: [], enabled: always, run: c => c.open("advisories") },
  { id: "selection.clear", label: "Clear selection / cancel drag", group: "General", shortcuts: ["Escape"], enabled: always, run: c => { c.store.cancel(); c.store.select({ keys: [], clips: [] }); } },
  { id: "autokey.toggle", label: "Toggle Auto-key", group: "General", shortcuts: [], enabled: always, run: c => c.store.setUi({ autoKey: !c.state.ui.autoKey }) },
  { id: "snap.toggle", label: "Toggle snapping", group: "General", shortcuts: [], enabled: always, run: c => c.store.setUi({ snap: !c.state.ui.snap }) },
  { id: "view.graph", label: "Toggle dope sheet / graph editor", group: "Timeline", shortcuts: ["G"], enabled: always, run: c => c.store.setUi({ view: c.state.ui.view === "dope" ? "graph" : "dope" }) },
  { id: "view.animated", label: "Show only animated properties", group: "Timeline", shortcuts: ["U"], enabled: always, run: c => c.store.setUi({ animatedOnly: !c.state.ui.animatedOnly }) },
  { id: "keyframe.previous", label: "Previous keyframe", group: "Timeline", shortcuts: [","], enabled: always, run: c => stepKeyframe(c, -1) },
  { id: "keyframe.next", label: "Next keyframe", group: "Timeline", shortcuts: ["."], enabled: always, run: c => stepKeyframe(c, 1) },
  { id: "keyframe.toggle", label: "Add or remove keyframe at playhead", group: "Keyframes", shortcuts: ["Alt+K"], enabled: always, run: c => {
    if (!c.focused) { c.notify("Focus a property first."); return; }
    commit(c, intentToOps({ kind: "toggle-key", track: c.focused.track, value: c.focused.value }, c.store.committed(), { timeMs: c.session.timeMs, fps: c.fps, autoKey: c.state.ui.autoKey, armed: c.state.ui.armed }));
  } },
  { id: "keyframes.nudge-left", label: "Nudge keyframes one frame earlier", group: "Keyframes", shortcuts: ["Alt+ArrowLeft"], enabled: hasKeys, run: c => nudge(c, -1) },
  { id: "keyframes.nudge-right", label: "Nudge keyframes one frame later", group: "Keyframes", shortcuts: ["Alt+ArrowRight"], enabled: hasKeys, run: c => nudge(c, 1) },
  { id: "keyframes.nudge-left-10", label: "Nudge keyframes ten frames earlier", group: "Keyframes", shortcuts: ["Alt+Shift+ArrowLeft"], enabled: hasKeys, run: c => nudge(c, -10) },
  { id: "keyframes.nudge-right-10", label: "Nudge keyframes ten frames later", group: "Keyframes", shortcuts: ["Alt+Shift+ArrowRight"], enabled: hasKeys, run: c => nudge(c, 10) },
  { id: "ease.easy", label: "Easy Ease", group: "Easing", shortcuts: ["F9"], enabled: hasKeys, run: c => easeSelection(c, EASY_EASE, "Easy Ease") },
  { id: "ease.in", label: "Easy Ease In", group: "Easing", shortcuts: ["Shift+F9"], enabled: hasKeys, run: c => easeSelection(c, EASE_IN, "Easy Ease In") },
  { id: "ease.out", label: "Easy Ease Out", group: "Easing", shortcuts: ["Mod+Shift+F9"], enabled: hasKeys, run: c => easeSelection(c, EASE_OUT, "Easy Ease Out") },
  { id: "ease.hold", label: "Toggle hold", group: "Easing", shortcuts: ["Mod+Alt+H"], enabled: hasKeys, run: c => {
    const doc = c.store.committed();
    const allHeld = easable(c).every(ref => findTrack(doc, ref.track)?.keyframes.find((frame: { timeMs: number }) => frame.timeMs === ref.atMs)?.easing === "hold");
    easeSelection(c, allHeld ? "cinematic" : "hold", allHeld ? "Release hold" : "Hold");
  } },
  { id: "ease.linear", label: "Linear", group: "Easing", shortcuts: [], enabled: hasKeys, run: c => easeSelection(c, "linear", "Linear") },
  { id: "ease.auto", label: "Auto bezier", group: "Easing", shortcuts: [], enabled: hasKeys, run: c => easeSelection(c, "auto", "Auto bezier") },
  { id: "ease.library", label: "Easing library", group: "Easing", shortcuts: ["E"], enabled: always, run: c => c.open("easing") },
  { id: "keyframes.reverse", label: "Reverse keyframes", group: "Keyframes", shortcuts: [], enabled: s => s.selection.keys.length > 1, run: c => commit(c, [{ op: "keys.reverse", refs: c.state.selection.keys }]) },
  { id: "keyframes.delete", label: "Delete selection", group: "Keyframes", shortcuts: ["Delete", "Backspace"], enabled: hasKeys, run: deleteSelection },
  { id: "edit.copy", label: "Copy keyframes", group: "Keyframes", shortcuts: ["Mod+C"], enabled: hasKeys, run: c => c.copy() },
  { id: "edit.cut", label: "Cut keyframes", group: "Keyframes", shortcuts: ["Mod+X"], enabled: hasKeys, run: c => c.cut() },
  { id: "edit.paste", label: "Paste keyframes at playhead", group: "Keyframes", shortcuts: ["Mod+V"], enabled: always, run: c => c.paste() },
  { id: "edit.duplicate", label: "Duplicate keyframes", group: "Keyframes", shortcuts: ["Mod+D"], enabled: hasKeys, run: c => c.duplicate() },
  { id: "clip.group", label: "Group animation into a clip", group: "Structure", shortcuts: ["Mod+G"], enabled: s => !!groupOps(s.draft, s.selection), run: c => {
    const group = groupOps(c.store.committed(), c.state.selection);
    if (!group) return;
    const issues = c.store.commit(group.ops, "Group animation");
    if (issues.length) c.notify(issues[0].message);
    else c.store.select({ tracks: [], keys: [], clips: [group.id], layers: [`clip:${group.id}`] });
  } },
  { id: "clip.ungroup", label: "Ungroup clip", group: "Structure", shortcuts: ["Mod+Shift+G"], enabled: s => s.selection.clips.length > 0, run: c => c.open("ungroup") },
  { id: "stagger.open", label: "Stagger layers", group: "Motion Design", shortcuts: [], enabled: s => surfaceLayers(s).length > 1, run: c => c.open("stagger") },
  { id: "behaviors.open", label: "Apply a behavior", group: "Motion Design", shortcuts: [], enabled: always, run: c => c.open("behaviors") },
  { id: "shots.open", label: "Apply a camera move", group: "Motion Design", shortcuts: [], enabled: s => surfaceLayers(s).length === 1, run: c => c.open("camera-moves") },
  { id: "presets.open", label: "Browse or save project presets", group: "Motion Design", shortcuts: [], enabled: always, run: c => c.open("presets") },
  { id: "timing.open", label: "Sequence layers, align, distribute or stretch keyframes", group: "Motion Design", shortcuts: [], enabled: s => surfaceLayers(s).length > 1 || hasKeys(s), run: c => c.open("timing") },
  { id: "marker.add", label: "Add marker at playhead", group: "Timeline", shortcuts: ["M"], enabled: always, run: c => {
    const markers = (c.store.committed().editor?.markers ?? []) as { atMs: number; label: string }[];
    const atMs = snapToFrame(c.session.timeMs, c.fps);
    if (markers.some(marker => marker.atMs === atMs)) return;
    commit(c, [{ op: "editor.set", markers: [...markers, { atMs, label: `Marker ${markers.length + 1}` }].sort((a, b) => a.atMs - b.atMs) }], "Add marker");
  } },
  { id: "workarea.start", label: "Set work-area start", group: "Timeline", shortcuts: ["B"], enabled: always, run: c => {
    const end = c.state.ui.workArea?.endMs ?? c.session.durationMs;
    c.store.setUi({ workArea: { startMs: Math.min(c.session.timeMs, end), endMs: end } });
  } },
  { id: "workarea.end", label: "Set work-area end", group: "Timeline", shortcuts: ["N"], enabled: always, run: c => {
    const start = c.state.ui.workArea?.startMs ?? 0;
    c.store.setUi({ workArea: { startMs: start, endMs: Math.max(c.session.timeMs, start) } });
  } },
  { id: "workarea.clear", label: "Clear work area", group: "Timeline", shortcuts: [], enabled: s => !!s.ui.workArea, run: c => c.store.setUi({ workArea: undefined }) },
  { id: "timeline.zoom-in", label: "Zoom timeline in", group: "Timeline", shortcuts: ["="], enabled: always, run: c => c.zoom(1) },
  { id: "timeline.zoom-out", label: "Zoom timeline out", group: "Timeline", shortcuts: ["-"], enabled: always, run: c => c.zoom(-1) },
  { id: "timeline.fit", label: "Fit timeline", group: "Timeline", shortcuts: ["\\"], enabled: always, run: c => c.zoom(0) },
  tool("move", "V", "Move tool"), tool("rotate", "R", "Rotate tool"), tool("scale", "S", "Scale tool"),
  tool("camera", "C", "Camera tool"), tool("focus", "F", "Focus tool"), tool("pivot", "P", "Pivot (anchor point) tool"),
  { id: "view.director", label: "Toggle director view", group: "Viewport", shortcuts: ["Tab"], enabled: always, run: c => {
    if (c.state.ui.director) { c.store.setUi({ director: undefined }); return; }
    const doc = c.store.committed();
    const real = c.snapshot?.camera ?? CameraSchema.parse(doc?.definition?.scene?.camera ?? {});
    const focus = c.snapshot?.focus ?? FocusSchema.parse(doc?.definition?.scene?.focus ?? {});
    c.store.setUi({ director: defaultDirector(real, focus.distance) });
  } },
  { id: "view.onion", label: "Toggle onion skin", group: "Viewport", shortcuts: [], enabled: always, run: c => c.store.setUi({ onion: !c.state.ui.onion }) },
  { id: "view.paths", label: "Toggle motion paths", group: "Viewport", shortcuts: [], enabled: always, run: c => c.store.setUi({ paths: !c.state.ui.paths }) },
  { id: "path.convert", label: "Convert to position path", group: "Structure", shortcuts: [], enabled: s => surfaceLayers(s).length > 0 || s.selection.layers.includes("camera"), run: c => {
    const ops = c.state.selection.layers.filter(id => id === "camera" || surfaceLayers(c.state).includes(id))
      .map(id => ({ op: "path.fromAxes", target: id === "camera" ? { kind: "camera" } : { kind: "surface", id } } as EditOp));
    const issues = c.store.commit(ops, "Convert to path");
    if (issues.length) c.notify(issues[0].message);
  } },
  { id: "focus.rack", label: "Rack focus between two layers", group: "Viewport", shortcuts: [], enabled: s => surfaceLayers(s).length === 2, run: c => {
    const [from, to] = surfaceLayers(c.state);
    const doc = c.store.committed();
    if (!c.snapshot) return;
    const area = c.state.ui.workArea;
    const start = toAuthored(doc, area?.startMs ?? c.session.timeMs), end = toAuthored(doc, area?.endMs ?? Math.min(c.session.durationMs, c.session.timeMs + 1500));
    const result = rackOps(doc, c.snapshot, from, to, start, end, c.fps);
    if (!result) { c.notify("Set a work area (B/N) or move the playhead before the scene end to rack focus."); return; }
    const issues = c.store.commit(result.ops, `Rack focus ${from} → ${to}`);
    if (issues.length) c.notify(issues[0].message);
  } },
] satisfies EditorCommand[]);
/** Transport keys (src/preview/transport.ts) that editor shortcuts must never take. */
export const TRANSPORT_KEYS: readonly string[] = Object.freeze([" ", "J", "K", "L", "Shift+J", "Shift+K", "Shift+L", "ArrowLeft", "ArrowRight", "Shift+ArrowLeft", "Shift+ArrowRight", "Home", "End", "[", "]"]);
/** Normalize a keyboard event to the shortcut notation ("Mod+Shift+Z", "Alt+K", "F9", "G"). */
export function shortcutOf(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code">): string {
  // Alt changes event.key on macOS; use the physical key for letters and digits under Alt.
  const physical = event.altKey && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : event.altKey && /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key;
  const key = physical.length === 1 ? physical.toUpperCase() : physical;
  const mods = [event.ctrlKey || event.metaKey ? "Mod" : "", event.altKey ? "Alt" : "", event.shiftKey && !(key.length === 1 && /[^A-Z0-9]/.test(key) && key !== "\\") ? "Shift" : ""].filter(Boolean);
  if (event.ctrlKey && !event.metaKey && key === "Y") return "Ctrl+Y";
  return [...mods, key].join("+");
}
export function matchShortcut(event: Parameters<typeof shortcutOf>[0], state: EditorState): EditorCommand | undefined {
  const shortcut = shortcutOf(event);
  return EDITOR_COMMANDS.find(command => command.shortcuts.includes(shortcut) && command.enabled(state));
}
export function commandById(id: string): EditorCommand | undefined { return EDITOR_COMMANDS.find(command => command.id === id); }
