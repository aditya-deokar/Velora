import type { RootState } from "@react-three/fiber";
import { Raycaster, Vector2, type Matrix4, type Object3D, type PerspectiveCamera } from "three";
import type { CameraDefinition } from "../core";
import type { ThreeSelection } from "../react";
import type { GizmoPoint, Registry } from "../react/registry";
import { applyVeloraCamera } from "./camera";
import { makeGizmo } from "./gizmo";

export type Channels = { channels: Readonly<Record<string, number>>; colorChannels: Readonly<Record<string, string>> };
export type FrameInput = Channels & {
  seconds: number;
  seed: number;
  camera?: CameraDefinition;
  selection?: ThreeSelection;
};
type FrameEffect = (frame: FrameInput) => void;

export class ThreeRuntime {
  objects = new Map<string, Object3D>();
  transforms = new Map<Object3D, (channels: Channels["channels"]) => Matrix4>();
  private effects = new Set<FrameEffect>();
  private mixers = new Set<FrameEffect>();
  ready?: FrameInput;
  error?: Error;
  private state?: RootState;
  private gizmo?: ReturnType<typeof makeGizmo>;
  private selection?: ThreeSelection;
  private capturing = false;
  private rendered?: { frame: FrameInput; width: number; height: number; dpr: number; camera: RootState["camera"]; revision: number };
  private revision = 0;
  private raycaster = new Raycaster();

  constructor(readonly registry: Registry, readonly owner: string, readonly unified: boolean) {}

  register(effect: FrameEffect, kind?: "mixer") {
    const effects = kind === "mixer" ? this.mixers : this.effects;
    effects.add(effect);
    this.revision++;
    return () => { if (effects.delete(effect)) this.revision++; };
  }

  private draw = () => {
    if (!this.state || !this.rendered) return;
    // R3F 9 takes absolute seconds in never mode. Root-local advancement avoids global effects.
    this.state.advance(this.rendered.frame.seconds, false);
  };

  render(frame: FrameInput, state: RootState) {
    const { width, height } = state.size;
    if (width <= 0 || height <= 0) return;
    const old = this.rendered;
    const dpr = state.viewport.dpr;
    if (this.ready === frame && old?.width === width && old.height === height && old.dpr === dpr && old.revision === this.revision && old.camera === state.camera) return;
    this.state = state;
    this.rendered = { frame, width, height, dpr, camera: state.camera, revision: this.revision };
    for (const mixer of this.mixers) mixer(frame);
    for (const effect of this.effects) effect(frame);
    if (this.unified && frame.camera) {
      const camera = state.camera as PerspectiveCamera;
      if (!camera.isPerspectiveCamera) throw new Error('ThreeSurface camera="velora" requires a perspective camera.');
      applyVeloraCamera(camera, frame.camera, width, height);
    }
    this.selection = state.gl.domElement.closest('[data-velora-layout="editor"]') ? frame.selection : undefined;
    this.syncGizmo();
    this.draw();
    this.ready = frame;
  }

  private syncGizmo() {
    const state = this.state;
    const selection = this.selection;
    const object = !this.capturing && selection && this.objects.get(selection.id);
    if (!object || this.gizmo?.object !== object || this.gizmo?.mode !== selection?.mode) {
      this.gizmo?.dispose();
      this.gizmo = state && object && selection ? makeGizmo(state.scene, state.camera, object, selection.mode, this.draw) : undefined;
      if (state) {
        if (this.gizmo) state.gl.domElement.dataset.veloraGizmo = selection!.id;
        else delete state.gl.domElement.dataset.veloraGizmo;
      }
    }
    if (state) this.gizmo?.setCamera(state.camera);
    this.gizmo?.sync();
  }

  hideForCapture() {
    this.capturing = true;
    if (!this.gizmo) return;
    this.syncGizmo();
    this.draw();
  }

  clear() {
    this.gizmo?.dispose();
    if (this.state) delete this.state.gl.domElement.dataset.veloraGizmo;
    this.gizmo = undefined;
    this.ready = undefined;
    this.rendered = undefined;
    this.state = undefined;
  }

  pick(point: GizmoPoint): string | undefined {
    const state = this.state;
    if (!state) return;
    const ids = new Map([...this.objects].map(([id, object]) => [object, id]));
    state.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new Vector2(point.x, point.y), state.camera);
    for (const { object } of this.raycaster.intersectObjects([...ids.keys()], true)) {
      let found: string | undefined;
      let shown = object.layers.test(state.camera.layers);
      for (let node: Object3D | null = object; node; node = node.parent) {
        found ??= ids.get(node);
        shown &&= node.visible;
      }
      if (found && shown) return found;
    }
  }

  hover(point: GizmoPoint) { this.gizmo?.hover(point); }
  begin(point: GizmoPoint) {
    if (this.capturing) {
      this.capturing = false;
      this.syncGizmo();
      this.draw();
    }
    return this.gizmo?.begin(point);
  }
}
