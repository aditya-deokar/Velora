import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CameraSchema, FocusSchema, intersectPlane, projectWorld, screenRay, type CameraDefinition, type EditOp, type Matrix, type Transform } from "../../core";
import { useEditor, useEditorState } from "../context";
import { stateAt, toAuthored, toPresentation } from "../properties";
import type { Doc } from "../store";
import { intentToOps, type IntentContext } from "../intents";
import type { GizmoDrag, SceneGizmo } from "../../react/registry";
import { combineSelection, enterGroup, exitGroup, marquee, pick, pickables, pickThreeCanvas, type Pickable } from "./picking";
import { displayCamera, framePoint, parentWorld, realCamera, transformAt, type Frame } from "./scene";
import { guideLines, moveTo, pushTo, setOps, movePlane } from "./MovePlane";
import { ringDelta, rotateTo, unwrap, type RingAxis } from "./RotateRings";
import { dragFactor, scaleAxis, scaleUniform } from "./ScaleHandles";
import { pivotTo } from "./Pivot";
import { cameraChanges, dolly, dollyZoom, focalLengthOf, lens, orbit, panTilt, pivotPoint, toStage, truck, type Camera } from "./CameraTool";
import { cameraGizmo, dragCamera } from "./DirectorView";
import { focusHit, followOps } from "./FocusTool";
import { cameraPath, keyDotOps, layerPath, pathKeys, pathWindow, sampleTimes } from "./MotionPath";
import { onionSkin } from "./OnionSkin";
import { GizmoHandles, gizmoGeometry, type HandleId } from "./Gizmo";
import { pickSourceElement } from "../source/pick";

/** The viewport overlay (Phase 06): a chrome-marked SVG in frame pixels above the scaled frame (the
 * ScenePreview overlay slot). It picks Surfaces from projected quads, draws selection, gizmos, motion
 * paths, onion skin and the director-view camera, and turns every drag into EditOps through intentToOps
 * (transient previews, one commit on release, Esc restores). It never moves DOM nodes itself. */
type Point = { x: number; y: number };
type Drag = { from: Point; to: Point; moved: boolean; typed: string; ops: EditOp[]; label: string } & (
  | { kind: "move"; axis?: "x" | "y"; ids: string[]; starts: Map<string, Transform>; parents: Map<string, Matrix>; center?: Point }
  | { kind: "depth"; ids: string[]; starts: Map<string, Transform>; depths: Map<string, number> }
  | { kind: "rotate"; axis: RingAxis; id: string; start: Transform; center: Point; angle: number }
  | { kind: "scale"; handle: HandleId; id: string; start: Transform; anchor: Point; fixed: Point; width: number; height: number }
  | { kind: "pivot"; id: string; start: Transform; world: Matrix; width: number; height: number }
  | { kind: "camera"; mode: "orbit" | "truck" | "pan" | "dolly" | "roll"; start: Camera; pivot: number[]; depth: number; navigate: boolean }
  | { kind: "camera-gizmo"; start: Camera }
  | { kind: "key"; id: string; timeMs: number; tracks: string[]; start: Transform; parent: Matrix }
  | { kind: "marquee"; mode: "replace" | "add" | "toggle" });
const SPECIAL = new Set(["camera", "focus", "motion", "look"]);
const centerOf = (world: Matrix) => [world[3], world[7], world[11]];
/** The authored camera at the playhead (static base + camera tracks, before constraints): what edits write. */
function authoredCamera(doc: Doc, presentationMs: number): Camera {
  const state = stateAt(doc, presentationMs);
  return CameraSchema.parse({ ...doc?.definition?.scene?.camera, ...state?.camera });
}
export function Overlay() {
  const { store, host, snapshot, notify, sourcePicking, pickSource } = useEditor();
  const state = useEditorState(store);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);
  dragRef.current = drag;
  const threeDrag = useRef<{ drag: GizmoDrag; ops: EditOp[]; id: string; toPoint(client: Point, frame: Point): Point | undefined } | undefined>(undefined);
  const previousGizmo = useRef<SceneGizmo | undefined>(undefined);
  const doc = state.draft as Doc;
  const frame: Frame = useMemo(() => ({ width: host.frame.width, height: host.frame.height }), [host.frame.width, host.frame.height]);
  const scale = host.frame.scale || 1;
  const camera = displayCamera(snapshot, doc);
  const real = realCamera(snapshot, doc);
  const director = state.ui.director;
  const tool = state.ui.tool;
  const locked: string[] = doc?.editor?.locked ?? [];
  const lockedKey = locked.join("\u0000"), hiddenKey = state.ui.hidden.join("\u0000");
  const items = useMemo(() => pickables(snapshot, camera, frame, { locked, hidden: state.ui.hidden }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, camera, frame, lockedKey, hiddenKey]);
  const selected = state.selection.layers.filter(id => !SPECIAL.has(id) && snapshot?.nodes.some(node => node.id === id));
  const context = (): IntentContext => ({ timeMs: toAuthored(store.committed(), host.session.timeMs), fps: host.fps, autoKey: store.getState().ui.autoKey, armed: store.getState().ui.armed });
  const nodeOf = (id: string) => snapshot?.nodes.find(node => node.id === id);
  const widthOf = (id: string) => nodeOf(id)?.width ?? 0, heightOf = (id: string) => nodeOf(id)?.height ?? 0;
  const startOf = (id: string) => transformAt(store.committed(), id, stateAt(store.committed(), host.session.timeMs), snapshot);
  // ---------- ops from the current drag ----------
  function opsFor(current: Drag, to: Point, modifiers: { shift: boolean; alt: boolean }, typed?: number): { ops: EditOp[]; director?: CameraDefinition } {
    const committed = store.committed();
    const ctx = context();
    const surface = (id: string) => ({ kind: "surface" as const, id });
    switch (current.kind) {
      case "move": return { ops: current.ids.flatMap(id => {
        const start = current.starts.get(id)!;
        if (typed !== undefined) return setOps(committed, surface(id), current.axis === "y" ? { y: start.y + typed } : { x: start.x + typed }, start, ctx);
        const moved = moveTo({ camera, frame, parent: current.parents.get(id)!, start, from: current.from, to, ...(current.axis ? { axis: current.axis } : {}), shift: modifiers.shift,
          ...(store.getState().ui.snap && current.center && current.ids.length === 1 ? { center: current.center, guides: guideLines(frame), threshold: 8 / scale } : {}) });
        return moved ? setOps(committed, surface(id), { x: moved.x, y: moved.y }, start, ctx) : [];
      }) };
      case "depth": return { ops: current.ids.flatMap(id => {
        const start = current.starts.get(id)!;
        const z = typed !== undefined ? start.z + typed : pushTo(start, current.depths.get(id)!, camera.perspective, to.y - current.from.y, modifiers.shift);
        return setOps(committed, surface(id), { z }, start, ctx);
      }) };
      case "rotate": {
        const delta = typed !== undefined ? typed : current.axis === "rotateZ" ? unwrap(current.angle, ringDelta("rotateZ", current.center, current.from, to)) : ringDelta(current.axis, current.center, current.from, to);
        if (current.axis === "rotateZ" && typed === undefined) current.angle = delta;
        return { ops: setOps(committed, surface(current.id), { [current.axis]: rotateTo(current.start[current.axis], delta, modifiers.shift) }, current.start, ctx) };
      }
      case "scale": {
        const factor = typed !== undefined ? typed / 100 : dragFactor(current.anchor, current.from, to);
        const values = current.handle === "side-x" ? scaleAxis(current.start, "scaleX", factor, modifiers.shift)
          : current.handle === "side-y" ? scaleAxis(current.start, "scaleY", factor, modifiers.shift)
          : scaleUniform(current.start, current.width, current.height, factor, current.fixed, modifiers.alt, modifiers.shift);
        return { ops: setOps(committed, surface(current.id), values, current.start, ctx) };
      }
      case "pivot": {
        const hit = intersectPlane(screenRay(camera, frame, to), current.world);
        if (!hit) return { ops: [] };
        return { ops: setOps(committed, surface(current.id), pivotTo(current.start, current.width, current.height, { x: hit.u, y: hit.v }), current.start, ctx) };
      }
      case "camera": {
        const dx = to.x - current.from.x, dy = to.y - current.from.y;
        const next = current.mode === "orbit" ? orbit(current.start, current.pivot, -dx * 0.25, dy * 0.25)
          : current.mode === "truck" ? truck(current.start, dx, dy, current.depth)
          : current.mode === "pan" ? panTilt(current.start, -dx * 0.1, dy * 0.1)
          : current.mode === "roll" ? panTilt(current.start, 0, 0, ringDelta("rotateZ", { x: frame.width / 2, y: frame.height / 2 }, current.from, to))
          : dolly(current.start, -dy * (current.depth / current.start.perspective) * 2);
        if (current.navigate) return { ops: [], director: next };
        return { ops: setOps(committed, { kind: "camera" }, cameraChanges(current.start, next), current.start, ctx) };
      }
      case "camera-gizmo": {
        const next = director && dragCamera(current.start, director, frame, current.from, to);
        return { ops: next ? setOps(committed, { kind: "camera" }, cameraChanges(current.start, next), current.start, ctx) : [] };
      }
      case "key": {
        const moved = moveTo({ camera, frame, parent: current.parent, start: current.start, from: current.from, to, shift: modifiers.shift });
        return { ops: moved ? keyDotOps(committed, current.id, current.timeMs, current.tracks, current.start, moved) : [] };
      }
      case "marquee": return { ops: [] };
    }
  }
  function update(current: Drag, to: Point, modifiers: { shift: boolean; alt: boolean }) {
    const moved = current.moved || Math.hypot(to.x - current.from.x, to.y - current.from.y) * scale > 2;
    const next = { ...current, to, moved } as Drag;
    if (current.kind !== "marquee" && moved) {
      const result = opsFor(next, to, modifiers);
      if (result.director) store.setUi({ director: result.director });
      next.ops = result.ops;
      if (result.ops.length) store.preview(result.ops); else store.cancel();
    }
    setDrag(next);
  }
  function finish(current: Drag) {
    setDrag(undefined);
    if (current.kind === "marquee") {
      if (!current.moved) { store.select({ layers: [], clips: [], tracks: [], keys: [] }); return; }
      const ids = marquee(items, current.from, current.to, store.getState().ui.scope);
      store.select({ layers: combineSelection(store.getState().selection.layers.filter(id => !id.startsWith("clip:")), ids, current.mode), clips: [], tracks: [], keys: [] });
      return;
    }
    if (!current.ops.length) { store.cancel(); return; }
    const issues = store.commit(current.ops, current.label);
    if (issues.length) notify(issues[0].message);
  }
  // ---------- keyboard: Esc cancels or leaves a group; digits + Enter type a value during a drag ----------
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && threeDrag.current) { event.preventDefault(); finishThree(false); return; }
      const current = dragRef.current;
      if (current) {
        if (event.key === "Escape") { event.preventDefault(); store.cancel(); setDrag(undefined); return; }
        if (/^[\d.-]$/.test(event.key)) { event.preventDefault(); setDrag({ ...current, typed: current.typed + event.key } as Drag); return; }
        if (event.key === "Backspace") { event.preventDefault(); setDrag({ ...current, typed: current.typed.slice(0, -1) } as Drag); return; }
        if (event.key === "Enter" && current.typed) {
          event.preventDefault();
          const value = Number(current.typed);
          if (!Number.isFinite(value)) return;
          const result = opsFor(current, current.to, { shift: false, alt: false }, value);
          setDrag(undefined);
          if (result.ops.length) { const issues = store.commit(result.ops, current.label); if (issues.length) notify(issues[0].message); } else store.cancel();
        }
        return;
      }
      if (event.key === "Escape" && store.getState().ui.scope) {
        event.preventDefault();
        const up = exitGroup(items, store.getState().ui.scope!);
        store.setUi({ scope: up.scope });
        store.select({ layers: [up.selected], clips: [], tracks: [], keys: [] });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });
  // ---------- wheel: dolly, Alt lens, Alt+Shift dolly-zoom (camera tool) ----------
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (store.getState().ui.tool !== "camera") return;
      event.preventDefault();
      const ui = store.getState().ui;
      const steps = Math.sign(event.deltaY) * Math.min(3, Math.max(1, Math.abs(event.deltaY) / 100));
      const committed = store.committed();
      const ctx = context();
      if (ui.director && !event.altKey) { store.setUi({ director: dolly(ui.director, -steps * 120) }); return; }
      const start = authoredCamera(committed, host.session.timeMs);
      const depth = (snapshot?.focus ?? FocusSchema.parse(committed?.definition?.scene?.focus ?? {})).distance;
      let ops: EditOp[] = [];
      if (event.altKey) {
        const mm = Math.min(400, Math.max(8, focalLengthOf(start, frame.height) * Math.pow(1.06, -steps)));
        let next: { camera: Camera; focalLength: number };
        try { next = lens(start, mm, frame.height); } catch (error) { notify(error instanceof Error ? error.message : String(error)); return; }
        if (event.shiftKey) {
          // Dolly-zoom: keep the selected layer (or the focus point) the same projected size.
          const id = selected[0], node = id ? nodeOf(id) : undefined;
          const subject = node ? toStage(camera, centerOf(node.world)) : pivotPoint(start, depth);
          ops = setOps(committed, { kind: "camera" }, cameraChanges(start, dollyZoom(start, subject, next.camera.perspective)), start, ctx);
        } else ops = setOps(committed, { kind: "camera" }, cameraChanges(start, next.camera), start, ctx);
      } else ops = setOps(committed, { kind: "camera" }, cameraChanges(start, dolly(start, -steps * Math.max(20, depth * 0.05))), start, ctx);
      if (!ops.length) return;
      const issues = store.commit(ops, event.altKey ? (event.shiftKey ? "Dolly-zoom" : "Change lens") : "Dolly camera", { merge: true });
      if (issues.length) notify(issues[0].message);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  });
  // ---------- pointer ----------
  const pointOf = (event: { clientX: number; clientY: number }) => framePoint(svg.current!, event.clientX, event.clientY, frame);
  function threeAt(event: ReactPointerEvent<SVGSVGElement>) {
    if (!snapshot || director || tool === "camera" || tool === "focus" || sourcePicking) return;
    return pickThreeCanvas({ x: event.clientX, y: event.clientY }, snapshot, camera, frame, new Set([...locked, ...state.ui.hidden]));
  }
  function finishThree(commit: boolean) {
    const current = threeDrag.current;
    if (!current) return;
    threeDrag.current = undefined;
    current.drag.end();
    if (!commit || !current.ops.length) { store.cancel(); return; }
    const issues = store.commit(current.ops, `Transform ${current.id}`);
    if (issues.length) notify(issues[0].message);
  }
  function updateThree(event: ReactPointerEvent<SVGSVGElement>) {
    const client = { x: event.clientX, y: event.clientY }, frame = pointOf(event);
    const current = threeDrag.current;
    if (current) {
      const point = current.toPoint(client, frame);
      if (!point) return;
      const committed = store.committed();
      const ctx = context();
      current.ops = Object.entries(current.drag.move(point)).flatMap(([name, value]) => intentToOps({
        kind: "set", track: { target: { kind: "channel", id: `${current.id}.${name}` }, property: "value" }, value,
      }, committed, ctx));
      if (current.ops.length) store.preview(current.ops);
      else store.cancel();
      return;
    }
    const hit = threeAt(event);
    if (previousGizmo.current && previousGizmo.current !== hit?.gizmo) previousGizmo.current.hover({ x: 2, y: 2 });
    previousGizmo.current = hit?.gizmo;
    const point = hit?.toPoint(client, frame);
    if (point) hit?.gizmo.hover(point);
  }
  function begin(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !snapshot) return;
    event.currentTarget.focus({ preventScroll: true });
    const p = pointOf(event);
    const target = event.target as Element;
    const handle = target.closest?.("[data-handle]")?.getAttribute("data-handle") as HandleId | null;
    const keyDot = target.closest?.("[data-key-dot]")?.getAttribute("data-key-dot");
    if (!handle && !keyDot && !event.altKey) {
      const hit = threeAt(event);
      const point = hit?.toPoint({ x: event.clientX, y: event.clientY }, p);
      if (hit && point) {
        const current = state.selection.layers[0];
        const active = current?.startsWith("three:") && hit.gizmo.begin(point);
        if (active) {
          threeDrag.current = { drag: active, id: current, ops: [], toPoint: hit.toPoint };
          svg.current?.setPointerCapture(event.pointerId);
        } else {
          const id = hit.gizmo.pick(point) ?? hit.surface;
          const mode = event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "add" : "replace";
          const layers = combineSelection(state.selection.layers, [id], mode).filter(id => !id.startsWith("clip:"));
          store.select({ layers, clips: [], tracks: [], keys: [] });
        }
        event.preventDefault();
        return;
      }
    }
    const base = { from: p, to: p, moved: false, typed: "", ops: [] as EditOp[] };
    const committed = store.committed();
    let next: Drag | undefined;
    if (target.closest?.("[data-camera-gizmo]") && director) {
      next = { ...base, kind: "camera-gizmo", start: authoredCamera(committed, host.session.timeMs), label: "Move camera" };
    } else if (keyDot) {
      const [id, time] = keyDot.split("@");
      const key = pathKeys(committed, snapshot, id, camera, frame).find(entry => String(entry.timeMs) === time);
      if (key) next = { ...base, kind: "key", id, timeMs: key.timeMs, tracks: key.tracks, label: `Move ${id} keyframe`,
        start: transformAt(committed, id, stateAt(committed, toPresentation(committed, key.timeMs)), snapshot), parent: movePlane(parentWorld(snapshot, id, camera), 0) };
    } else if (tool === "camera") {
      const navigate = !!director;
      const start = navigate ? director! : authoredCamera(committed, host.session.timeMs);
      const focusDistance = (snapshot.focus ?? FocusSchema.parse(committed?.definition?.scene?.focus ?? {})).distance;
      const node = selected[0] ? nodeOf(selected[0]) : undefined;
      // Orbit around the selected layer when there is one, else around the focus point.
      const pivot = node ? toStage(camera, centerOf(node.world)) : pivotPoint(start, focusDistance);
      const depth = node ? camera.perspective - node.world[11] : focusDistance;
      const mode = handle === "rotateZ" ? "roll" : event.shiftKey ? "truck" : event.ctrlKey || event.metaKey ? "pan" : event.altKey ? "dolly" : "orbit";
      next = { ...base, kind: "camera", mode, start, pivot, depth, navigate, label: { orbit: "Orbit camera", truck: "Truck camera", pan: "Pan/tilt camera", dolly: "Dolly camera", roll: "Roll camera" }[mode] };
    } else if (tool === "focus") {
      const id = pick(items, p, { scope: undefined });
      const leaf = id && items.find(item => item.id === id) ? hitLeaf(items, p, id) : undefined;
      const node = leaf ? nodeOf(leaf) : undefined;
      const hit = node && focusHit(camera, real, frame, node, p);
      if (!leaf || !hit) { notify("Click a layer to focus on it."); return; }
      const ops = event.shiftKey ? followOps(committed, leaf, hit.anchor)
        : setOps(committed, { kind: "focus" }, { distance: hit.depth }, { distance: snapshot.focus?.distance }, context());
      const issues = store.commit(ops, event.shiftKey ? `Follow focus on ${leaf}` : `Focus on ${leaf}`);
      if (issues.length) notify(issues[0].message);
      return;
    } else if (handle && handle !== "body" && selected.length) {
      const id = selected[0], node = nodeOf(id)!, start = startOf(id);
      const geometry = gizmoFor(id);
      if (!geometry) return;
      if (handle === "axis-x" || handle === "axis-y")
        next = { ...base, kind: "move", axis: handle === "axis-x" ? "x" : "y", ids: [id], starts: new Map([[id, start]]), parents: new Map([[id, parentWorld(snapshot, id, camera)]]), label: `Move ${id}` };
      else if (handle === "depth")
        next = { ...base, kind: "depth", ids: selected, starts: new Map(selected.map(entry => [entry, startOf(entry)])), depths: new Map(selected.map(entry => [entry, camera.perspective - (nodeOf(entry)?.world[11] ?? 0)])), label: "Push along z" };
      else if (handle === "rotateX" || handle === "rotateY" || handle === "rotateZ")
        next = { ...base, kind: "rotate", axis: handle, id, start, center: geometry.center, angle: 0, label: `Rotate ${id}` };
      else if (handle.startsWith("corner-") || handle === "side-x" || handle === "side-y") {
        const index = handle.startsWith("corner-") ? Number(handle.slice(7)) : -1;
        const w = node.width / 2, h = node.height / 2;
        const corners = [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }];
        const opposite = index >= 0 ? (index + 2) % 4 : -1;
        const anchor = event.altKey || index < 0 ? geometry.center : geometry.quad[opposite];
        next = { ...base, kind: "scale", handle, id, start, anchor, fixed: index >= 0 ? corners[opposite] : { x: 0, y: 0 }, width: node.width, height: node.height, label: `Scale ${id}` };
      } else if (handle === "pivot")
        next = { ...base, kind: "pivot", id, start, world: node.world, width: node.width, height: node.height, label: `Move ${id} pivot` };
    } else {
      // Click picking: Alt cycles the stack, Shift adds, Ctrl/⌘ toggles; a plain drag on a layer moves it.
      const scope = store.getState().ui.scope;
      const current = store.getState().selection.layers[0];
      const id = handle === "body" && selected.length ? selected[0] : pick(items, p, { scope, cycle: event.altKey, ...(current ? { current } : {}) });
      const mode = event.shiftKey ? "add" : event.ctrlKey || event.metaKey ? "toggle" : "replace";
      if (!id) { next = { ...base, kind: "marquee", mode, label: "Select" }; }
      else {
        const layers = mode === "replace" && selected.includes(id) ? selected : combineSelection(store.getState().selection.layers, [id], mode);
        store.select({ layers: layers.filter(id => !id.startsWith("clip:")), clips: [], tracks: [], keys: [] });
        const ids = layers.filter(entry => !SPECIAL.has(entry) && nodeOf(entry));
        if (tool === "move" && ids.includes(id) && mode !== "toggle") {
          const centerPoint = projectWorld(camera, frame, centerOf(nodeOf(id)!.world), "view");
          next = { ...base, kind: "move", ids, starts: new Map(ids.map(entry => [entry, startOf(entry)])), parents: new Map(ids.map(entry => [entry, parentWorld(snapshot, entry, camera)])),
            ...(centerPoint ? { center: { x: centerPoint.x, y: centerPoint.y } } : {}), label: ids.length === 1 ? `Move ${id}` : `Move ${ids.length} layers` };
        }
      }
    }
    if (!next) return;
    event.preventDefault();
    svg.current?.setPointerCapture?.(event.pointerId);
    setDrag(next);
  }
  const gizmoFor = (id: string) => {
    const node = nodeOf(id);
    const item = items.find(entry => entry.id === id);
    if (!node || !item || !snapshot) return null;
    const start = startOf(id);
    const origin: [number, number] = [(((start.originX ?? 50) - 50) / 100) * node.width, (((start.originY ?? 50) - 50) / 100) * node.height];
    return gizmoGeometry(node, parentWorld(snapshot, id, camera), origin, camera, frame, item.quad);
  };
  function doubleClick(event: ReactMouseEvent<SVGSVGElement>) {
    const p = pointOf(event);
    const scope = store.getState().ui.scope;
    const group = pick(items, p, { scope });
    if (!group || !items.some(item => item.parentId === group)) return;
    const inside = enterGroup(items, p, group);
    store.setUi({ scope: inside.scope });
    if (inside.selected) store.select({ layers: [inside.selected], clips: [], tracks: [], keys: [] });
  }
  // ---------- drawing ----------
  const s = 1 / Math.max(scale, 0.05);
  const pathsFor = useMemo(() => {
    if (!snapshot || !state.ui.paths || drag) return [];
    const [from, to] = pathWindow(doc, state.ui.workArea, host.session.durationMs);
    const times = sampleTimes(from, to, Math.min(host.fps, 30));
    return selected.filter(id => (doc?.definition?.motion?.tracks ?? []).some((track: Doc) => track.target?.id === id && ["x", "y", "z", "position"].includes(track.property)))
      .map(id => ({ id, samples: layerPath(doc, snapshot, id, camera, frame, times), keys: pathKeys(doc, snapshot, id, camera, frame) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, snapshot?.bindings, camera, frame, state.ui.paths, state.ui.workArea, selected.join("\u0000"), !!drag]);
  const ghosts = useMemo(() => !snapshot || !state.ui.onion || !selected.length ? [] :
    onionSkin(doc, snapshot, selected, camera, frame, host.session.timeMs, host.fps, { durationMs: host.session.durationMs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  [doc, snapshot, camera, frame, state.ui.onion, selected.join("\u0000"), host.session.timeMs]);
  const gizmo = director && snapshot ? cameraGizmo(real, snapshot.focus ?? FocusSchema.parse({}), director, frame) : undefined;
  const camPath = useMemo(() => {
    if (!director || !snapshot || !state.ui.paths) return [];
    const animated = (doc?.definition?.motion?.tracks ?? []).some((track: Doc) => track.target?.kind === "camera") || (doc?.definition?.motion?.clips ?? []).length > 0;
    return animated ? cameraPath(doc, snapshot, director, frame, sampleTimes(0, host.session.durationMs, 30)) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [director, doc, snapshot?.bindings, frame, state.ui.paths]);
  const poly = (points: ({ x: number; y: number } | null)[]) => points.filter(Boolean).map(p => `${p!.x},${p!.y}`).join(" ");
  const primary = selected[0] && tool !== "camera" && tool !== "focus" ? gizmoFor(selected[0]) : null;
  const typed = drag?.typed;
  return <svg ref={svg} data-velora-viewport-overlay="" data-tool={tool} viewBox={`0 0 ${frame.width} ${frame.height}`} width={frame.width} height={frame.height}
    role="application" tabIndex={-1} aria-label={`Viewport (${tool} tool${director ? ", director view" : ""})`} aria-roledescription="viewport"
    style={{ position: "absolute", inset: 0, pointerEvents: "all", cursor: sourcePicking || tool === "focus" ? "crosshair" : tool === "camera" ? "grab" : "default", touchAction: "none", overflow: "visible" }}
    onPointerDown={event => {
      if (sourcePicking && event.button === 0) { event.preventDefault(); pickSource?.(pickSourceElement(event.clientX, event.clientY)); return; }
      begin(event);
    }}
    onPointerMove={event => {
      const current = dragRef.current;
      if (current) update(current, pointOf(event), { shift: event.shiftKey, alt: event.altKey });
      else updateThree(event);
    }}
    onPointerUp={() => { finishThree(true); const current = dragRef.current; if (current) finish(current); }}
    onPointerCancel={() => { finishThree(false); if (dragRef.current) { store.cancel(); setDrag(undefined); } }}
    onLostPointerCapture={() => finishThree(false)}
    onDoubleClick={doubleClick}>
    <style>{`.ve-outline{fill:none;stroke:#4cc2ff;stroke-width:${2 * s}px}.ve-outline[data-primary]{stroke-width:${3 * s}px}
.ve-handle{fill:#fff;stroke:#1677c8;stroke-width:${1.5 * s}px;cursor:pointer}.ve-depth{fill:#9be7ff}
.ve-axis{stroke:#4cc2ff}.ve-axis[data-axis=x]{stroke:#ff5d5d}.ve-axis[data-axis=y]{stroke:#4ade80}
.ve-ring{fill:none;stroke:rgba(255,209,102,.85);cursor:grab}.ve-ring-x{stroke:rgba(255,93,93,.8)}.ve-ring-y{stroke:rgba(74,222,128,.8)}
.ve-path{fill:none;stroke:#ff9f43;stroke-width:${1.5 * s}px}.ve-tick{fill:#ff9f43}.ve-key{fill:#ffd166;stroke:#000;stroke-width:${s}px;cursor:move}
.ve-ghost{fill:none;stroke:rgba(76,194,255,.35);stroke-dasharray:${4 * s} ${4 * s};stroke-width:${s}px}
.ve-frustum{fill:none;stroke:#e879f9;stroke-width:${1.5 * s}px}.ve-focus-plane{fill:rgba(232,121,249,.12);stroke:rgba(232,121,249,.6);stroke-width:${s}px}
.ve-marquee{fill:rgba(76,194,255,.1);stroke:#4cc2ff;stroke-dasharray:${4 * s} ${3 * s};stroke-width:${s}px}
.ve-badge{font:${12 * s}px system-ui,sans-serif;fill:#fff}.ve-badge-bg{fill:rgba(20,20,28,.85)}`}</style>
    {ghosts.map((ghost, index) => <polygon key={`g${index}`} className="ve-ghost" data-ghost={`${ghost.id}${ghost.offset}`} points={poly(ghost.quad)} opacity={1 - Math.abs(ghost.offset) * 0.22}/>)}
    {pathsFor.map(path => <g key={path.id} data-motion-path={path.id}>
      <polyline className="ve-path" points={poly(path.samples.map(sample => sample?.point ?? null))}/>
      {path.samples.map((sample, index) => sample && <circle key={index} className="ve-tick" cx={sample.point.x} cy={sample.point.y} r={1.6 * s}/>)}
      {path.keys.map(key => <g key={key.timeMs}>
        {key.tangents?.in && <line x1={key.point.x} y1={key.point.y} x2={key.tangents.in.x} y2={key.tangents.in.y} className="ve-path"/>}
        {key.tangents?.out && <line x1={key.point.x} y1={key.point.y} x2={key.tangents.out.x} y2={key.tangents.out.y} className="ve-path"/>}
        <rect role="img" data-key-dot={`${path.id}@${key.timeMs}`} aria-label={`${path.id} keyframe at ${(key.timeMs / 1000).toFixed(2)} s`} className="ve-key"
          x={key.point.x - 5 * s} y={key.point.y - 5 * s} width={10 * s} height={10 * s} transform={`rotate(45 ${key.point.x} ${key.point.y})`}/>
      </g>)}
    </g>)}
    {items.filter(item => selected.includes(item.id)).map(item => <polygon key={item.id} className="ve-outline" data-outline={item.id} {...(item.id === selected[0] ? { "data-primary": "" } : {})} points={poly(item.quad)}/>)}
    {primary && <GizmoHandles tool={tool} geometry={primary} scale={scale}/>}
    {tool === "camera" && !director && <circle role="img" data-handle="rotateZ" aria-label="Roll camera" cx={frame.width / 2} cy={frame.height / 2} r={Math.min(frame.width, frame.height) * 0.42} className="ve-ring" strokeWidth={6 * s} fill="none"/>}
    {gizmo && <g role="img" data-camera-gizmo="" aria-label="Real camera">
      <polygon className="ve-focus-plane" data-focus-plane="" points={poly(gizmo.focus)}/>
      <polygon className="ve-frustum" points={poly(gizmo.frustum)}/>
      {gizmo.eye && gizmo.frustum.map((corner, index) => corner && <line key={index} className="ve-frustum" x1={gizmo.eye!.x} y1={gizmo.eye!.y} x2={corner.x} y2={corner.y}/>)}
      {gizmo.eye && <circle cx={gizmo.eye.x} cy={gizmo.eye.y} r={9 * s} fill="#e879f9" stroke="#fff" strokeWidth={2 * s} style={{ cursor: "move" }}/>}
      {camPath.length > 0 && <polyline className="ve-path" points={poly(camPath.map(sample => sample?.point ?? null))}/>}
    </g>}
    {drag?.kind === "marquee" && drag.moved && <rect className="ve-marquee" x={Math.min(drag.from.x, drag.to.x)} y={Math.min(drag.from.y, drag.to.y)} width={Math.abs(drag.to.x - drag.from.x)} height={Math.abs(drag.to.y - drag.from.y)}/>}
    {director && <g data-testid="director-badge"><rect className="ve-badge-bg" x={12 * s} y={12 * s} width={430 * s} height={24 * s} rx={4 * s}/>
      <text className="ve-badge" x={20 * s} y={29 * s}>Director view: depth of field off · Tab returns to camera</text></g>}
    {typed && <g><rect className="ve-badge-bg" x={12 * s} y={frame.height - 40 * s} width={160 * s} height={26 * s} rx={4 * s}/>
      <text className="ve-badge" x={20 * s} y={frame.height - 22 * s} data-testid="numeric-entry">{typed}</text></g>}
  </svg>;
}
/** The leaf Surface under the cursor inside the picked group (the focus tool focuses what you click). */
function hitLeaf(items: readonly Pickable[], p: Point, picked: string): string {
  const descendant = (id: string) => { let current: string | undefined = id; while (current) { if (current === picked) return true; current = items.find(item => item.id === current)?.parentId; } return false; };
  for (const item of items) if (descendant(item.id) && pointInside(p, item)) return item.id;
  return picked;
}
const pointInside = (p: Point, item: Pickable) => pick([item], p) === item.id;
