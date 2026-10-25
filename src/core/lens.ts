/** SOURCE OF TRUTH: perspectiveForFocalLength, focalLengthForPerspective, lensFor.
 * WHAT: full-frame (24 mm sensor height) lens language mapped to CSS perspective and focus focal length.
 * WHY: cinematographers think in 24/35/50/85/135 mm; one number should drive both field of view
 * and depth of field so a "50 mm" shot reads the same in every scene and aspect.
 * WHERE: shot builders, templates and the guide's lens table; scenes still store plain camera values.
 * Vertical field of view = 2·atan(12 / mm), so perspective = (frameHeight / 2) / tan(fov / 2) = frameHeight · mm / 24.
 */
const SENSOR_HEIGHT_MM = 24;
const PERSPECTIVE_MIN = 100, PERSPECTIVE_MAX = 10_000;
function positive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number.`);
}
export function perspectiveForFocalLength(mm: number, frameHeight: number): number {
  positive("Focal length", mm);
  positive("Frame height", frameHeight);
  const perspective = (frameHeight * mm) / SENSOR_HEIGHT_MM;
  if (perspective < PERSPECTIVE_MIN || perspective > PERSPECTIVE_MAX)
    throw new RangeError(`A ${mm} mm lens at ${frameHeight} px needs perspective ${Math.round(perspective)}, outside the camera's ${PERSPECTIVE_MIN}–${PERSPECTIVE_MAX} range.`);
  return perspective;
}
export function focalLengthForPerspective(perspective: number, frameHeight: number): number {
  positive("Perspective", perspective);
  positive("Frame height", frameHeight);
  return (perspective * SENSOR_HEIGHT_MM) / frameHeight;
}
/** Camera perspective plus the matching focus focal length for one physical lens. */
export function lensFor(mm: number, frameHeight: number): { perspective: number; focus: { focalLength: number } } {
  return { perspective: perspectiveForFocalLength(mm, frameHeight), focus: { focalLength: Math.min(300, mm) } };
}
