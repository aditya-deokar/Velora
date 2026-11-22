import { z } from "zod";
import { CameraSchema, FocusSchema, PERSPECTIVE_MAX } from "./scene";
import { DEFAULT_STAGE, STAGE_PRESETS, type Stage } from "./stage";
import type { EditOp } from "./edit";
import type { PreviewDefinitionInput } from "./preview";

/** SOURCE OF TRUTH: perspectiveForFocalLength, focalLengthForPerspective, lensFor, LENS_PRESETS, lensPreset, applyLens, framingDistance.
 * WHAT: full-frame (24 mm sensor height) lens language mapped to CSS perspective and focus focal length.
 * WHY: cinematographers think in 24/35/50/85/135 mm; one number should drive both field of view
 * and depth of field so a "50 mm" shot reads the same in every scene and aspect.
 * WHERE: shot builders, templates and the guide's lens table; scenes still store plain camera values.
 * Vertical field of view = 2·atan(12 / mm), so perspective = (frameHeight / 2) / tan(fov / 2) = frameHeight · mm / 24.
 */
const SENSOR_HEIGHT_MM = 24;
const PERSPECTIVE_MIN = 100, LEGACY_PERSPECTIVE_MAX = 10_000;
function positive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number.`);
}
export function perspectiveForFocalLength(mm: number, frameHeight: number): number {
  return perspectiveInRange(mm, frameHeight, PERSPECTIVE_MAX);
}
function perspectiveInRange(mm: number, frameHeight: number, limit: number): number {
  positive("Focal length", mm);
  positive("Frame height", frameHeight);
  const perspective = (frameHeight * mm) / SENSOR_HEIGHT_MM;
  if (perspective < PERSPECTIVE_MIN || perspective > limit)
    throw new RangeError(`A ${mm} mm lens at ${frameHeight} px needs perspective ${Math.round(perspective)}, outside the camera's ${PERSPECTIVE_MIN}–${limit} range.`);
  return perspective;
}
export function focalLengthForPerspective(perspective: number, frameHeight: number): number {
  positive("Perspective", perspective);
  positive("Frame height", frameHeight);
  return (perspective * SENSOR_HEIGHT_MM) / frameHeight;
}
/** Camera perspective plus the matching focus focal length for one physical lens. */
export function lensFor(mm: number, frameHeight: number): { perspective: number; focus: { focalLength: number } } {
  return { perspective: perspectiveInRange(mm, frameHeight, LEGACY_PERSPECTIVE_MAX), focus: { focalLength: Math.min(300, mm) } };
}

export const LensPresetSchema = z.enum(["24mm-drone", "50mm-prime", "85mm-portrait", "200mm-telephoto"]);
export type LensPresetId = z.output<typeof LensPresetSchema>;
export const LensHoldSchema = z.enum(["framing", "position"]);
export const LENS_PRESETS = Object.freeze({
  "24mm-drone": Object.freeze({ mm: 24, fStop: 5.6, maxBlur: 6, breathing: 0.010 }),
  "50mm-prime": Object.freeze({ mm: 50, fStop: 2.8, maxBlur: 8, breathing: 0.012 }),
  "85mm-portrait": Object.freeze({ mm: 85, fStop: 2, maxBlur: 10, breathing: 0.015 }),
  "200mm-telephoto": Object.freeze({ mm: 200, fStop: 2.8, maxBlur: 14, breathing: 0.018 }),
});
export function lensPreset(id: LensPresetId, { frameHeight, stage }: { frameHeight: number; stage?: Pick<Stage, "width" | "physicalWidthMm"> }) {
  const { mm, fStop, maxBlur, breathing } = LENS_PRESETS[LensPresetSchema.parse(id)];
  const reference = STAGE_PRESETS[DEFAULT_STAGE];
  const focalLength = mm * (stage?.physicalWidthMm ? stage.width / stage.physicalWidthMm : reference.width / reference.physicalWidthMm);
  return { perspective: perspectiveForFocalLength(mm, frameHeight), focus: { focalLength, fStop, maxBlur }, breathing };
}

type Size = { width: number; height: number };
export function framingDistance(perspective: number, frame: Size, subjectRect: Size, fill: number): number {
  const scale = fill / Math.max(subjectRect.width / frame.width, subjectRect.height / frame.height);
  return perspective * (1 / scale - 1);
}

export function applyLens(definition: PreviewDefinitionInput, preset: LensPresetId, { hold = "framing" }: { hold?: z.output<typeof LensHoldSchema> } = {}) {
  const camera = CameraSchema.parse(definition.scene.camera ?? {}), focus = FocusSchema.parse(definition.scene.focus ?? {});
  const next = lensPreset(preset, { frameHeight: definition.height ?? 980, stage: definition.stage });
  const ratio = next.perspective / camera.perspective;
  const subject = definition.scene.nodes.find(node => node.id === "subject") ?? definition.scene.nodes[0];
  const subjectZ = subject?.transform?.z ?? 0;
  const distance = camera.z - subjectZ;
  const zoomFactor = (camera.perspective / (camera.perspective + distance)) / (next.perspective / (next.perspective + distance));
  const operations: EditOp[] = [{ op: "camera.set", property: "perspective", value: next.perspective },
    { op: "focus.set", property: "focalLength", value: next.focus.focalLength },
    { op: "focus.set", property: "fStop", value: next.focus.fStop },
    { op: "focus.set", property: "maxBlur", value: next.focus.maxBlur }];
  const mapDepth = (value: number, additive: boolean) => hold === "framing" ? value * ratio : value + (additive ? 0 : next.perspective - camera.perspective);
  operations.push({ op: "focus.set", property: "distance", value: Math.max(next.focus.focalLength + 1, mapDepth(focus.distance, false)) });
  if (hold === "framing") operations.push({ op: "camera.set", property: "z", value: subjectZ + distance * ratio });
  else operations.push({ op: "camera.set", property: "zoom", value: (camera.zoom ?? 1) * zoomFactor });
  const cameraZ = (value: number, additive: boolean) => additive ? value * ratio : subjectZ + (value - subjectZ) * ratio;
  const visit = (tracks: NonNullable<PreviewDefinitionInput["motion"]>["tracks"] | undefined, clip?: string, additive = false) => {
    for (const track of tracks ?? []) {
      for (const frame of track.keyframes) {
        if (hold === "framing" && track.target.kind === "camera" && track.property === "position" && Array.isArray(frame.value)) {
          const [x, y, z] = frame.value;
          const address = { target: track.target, property: "position", ...(clip ? { clip } : {}) };
          operations.push({ op: "key.set", track: address, atMs: frame.timeMs, value: [x, y, cameraZ(z, additive)] });
          const scaleTangent = (tangent: [number, number, number]): [number, number, number] => [tangent[0], tangent[1], tangent[2] * ratio];
          const { inTangent, outTangent } = frame as { inTangent?: [number, number, number]; outTangent?: [number, number, number] };
          if (inTangent || outTangent) operations.push({ op: "path.tangent", track: address, atMs: frame.timeMs,
            ...(inTangent ? { inTangent: scaleTangent(inTangent) } : {}), ...(outTangent ? { outTangent: scaleTangent(outTangent) } : {}) });
          continue;
        }
        if (typeof frame.value !== "number") continue;
        const key = track.target.kind + "." + track.property;
        const value = key === "camera.perspective" ? frame.value * ratio
          : key === "focus.distance" ? mapDepth(frame.value, additive)
          : key === "camera.z" && hold === "framing" ? cameraZ(frame.value, additive)
          : key === "camera.zoom" && hold === "position" ? frame.value * zoomFactor : frame.value;
        if (value !== frame.value && (track.target.kind === "camera" || track.target.kind === "focus"))
          operations.push({ op: "key.set", track: { target: track.target, property: track.property, ...(clip ? { clip } : {}) }, atMs: frame.timeMs, value });
      }
    }
  };
  const visitClips = (clips: NonNullable<PreviewDefinitionInput["motion"]>["clips"], additive = false) => {
    for (const clip of clips ?? []) {
      const add = additive || clip.mode === "add";
      visit(clip.tracks, clip.id, add);
      visitClips(clip.clips, add);
    }
  };
  visit(definition.motion?.tracks);
  visitClips(definition.motion?.clips);
  const growth = (z: number) => next.perspective / (next.perspective + (hold === "framing" ? subjectZ + distance * ratio : camera.z) - z)
    / (camera.perspective / (camera.perspective + camera.z - z)) * (hold === "position" ? zoomFactor : 1);
  const issues = definition.scene.nodes.flatMap(node => (node.transform?.z ?? 0) < -1000 && growth(node.transform!.z!) > 1.5
    ? [{ code: "lens-compression", path: `definition.scene.nodes.${node.id}`, message: `Check frame coverage on ${node.id} after the lens change.` }]
    : []);
  return { ops: operations, issues };
}
