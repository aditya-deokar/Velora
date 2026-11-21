import { Matrix4, Object3D, type Camera, type Scene } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { GizmoDrag, GizmoMode, GizmoPoint } from "../react/registry";

const axes = ["x", "y", "z"] as const;

/** The proxy keeps a gesture from mutating the authored object. The editor previews every drag
 * through channel ops, so cancellation, keyframing and file writes all use the same store. */
export function makeGizmo(scene: Scene, camera: Camera, object: Object3D, mode: GizmoMode, draw: () => void) {
  const parent = new Object3D();
  const proxy = new Object3D();
  parent.matrixAutoUpdate = false;
  parent.add(proxy);
  scene.add(parent);
  const controls = new TransformControls(camera, document.createElement("div"));
  controls.setMode(mode);
  controls.attach(proxy);
  // Before r169 the controls themselves are the Object3D added to the scene.
  const helper = typeof controls.getHelper === "function" ? controls.getHelper() : controls as unknown as Object3D;
  helper.name = "Velora editor gizmo";
  scene.add(helper);
  const identity = new Matrix4();
  function sync() {
    if (controls.dragging) return;
    object.updateWorldMatrix(true, false);
    parent.matrix.copy(object.parent?.matrixWorld ?? identity);
    proxy.position.copy(object.position);
    proxy.rotation.order = object.rotation.order;
    proxy.quaternion.copy(object.quaternion);
    proxy.scale.copy(object.scale);
    parent.updateMatrixWorld(true);
    helper.updateMatrixWorld(true);
  }
  // TransformControls' manual hooks take normalized x/y and a button. The Three
  // declarations currently annotate them as DOM PointerEvents.
  const pointer = (point: GizmoPoint, button: number) => ({ ...point, button }) as PointerEvent;
  const group = mode === "translate" ? "position" : mode === "rotate" ? "rotation" : "scale";
  const units = mode === "rotate" ? 180 / Math.PI : 1;

  return {
    object,
    mode,
    sync,
    setCamera(next: Camera) { controls.camera = next; },
    hover(point: GizmoPoint) {
      const previous = controls.axis;
      controls.pointerHover(pointer(point, -1));
      if (controls.axis !== previous) draw();
    },
    begin(point: GizmoPoint): GizmoDrag | undefined {
      sync();
      controls.pointerHover(pointer(point, 0));
      controls.pointerDown(pointer(point, 0));
      if (!controls.dragging) return;
      const initial = axes.map(axis => proxy[group][axis]);
      return {
        move(next) {
          if (!controls.dragging) return {};
          controls.pointerMove(pointer(next, -1));
          return Object.fromEntries(axes.flatMap((axis, index) => {
            const value = proxy[group][axis];
            return Math.abs(value - initial[index]) > 1e-7 ? [[`${group}.${axis}`, value * units]] : [];
          }));
        },
        end() {
          if (!controls.dragging) return;
          controls.pointerUp(pointer(point, 0));
          sync();
          draw();
        },
      };
    },
    dispose() {
      controls.detach();
      scene.remove(helper, parent);
      controls.dispose();
    },
  };
}
