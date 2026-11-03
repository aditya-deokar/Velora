import type { Composition } from "./composition";
import type { BoundRecipe } from "./recipes";
import { evaluateMotion, loopSeam } from "./motion";
import { projectPoints, ASPECT_FRAMES, type Aspect } from "./shots";
import { findTemplate, templateDefinition, type ParamValue } from "./templates";
import { isOverlapTransition } from "./transitions";
import { readingTimeMs, type CompositeDefinition } from "./composites";

/** SOURCE OF TRUTH: reviewComposition, PACING, EditorialAdvisory.
 * WHAT: advisory editorial review of a composition: hook timing, shot length against platform pacing,
 * reading time, end-card hold, eye-trace continuity and match-cut drift across cuts (template recipes),
 * camera direction flips, loop seams and off-beat cuts against beat markers.
 * WHY: Murch's Rule of Six puts emotion and story first; a tool can only measure rhythm and eye-trace,
 * so every finding is advice for a human (requiresVisualReview), never a gate.
 * WHERE: `velora review --composition FILE [--platform P]` (project/commands) supplies the catalog.
 */
export type EditorialAdvisory = { code: string; path: string; message: string; atMs?: number };
export const PACING: Readonly<Record<string, { minMs: number; maxMs: number }>> = Object.freeze({
  default: { minMs: 1500, maxMs: 8000 },
  // Vertical short-form: the swipe is one thumb away.
  social: { minMs: 800, maxMs: 4000 },
  // Landscape and square feed placements: muted autoplay, but a product demo can hold a shot longer.
  feed: { minMs: 1000, maxMs: 7000 },
  youtube: { minMs: 2000, maxMs: 10000 },
  "website-hero": { minMs: 3000, maxMs: 20000 },
});
const SOCIAL = new Set(["tiktok", "instagram-reel", "youtube-shorts"]);
const FEED = new Set(["x-landscape", "x-square", "linkedin", "instagram-feed-4x5"]);
export const pacingFor = (platform?: string) => PACING[platform ?? "default"] ?? (platform && SOCIAL.has(platform) ? PACING.social : platform && FEED.has(platform) ? PACING.feed : platform?.startsWith("youtube") ? PACING.youtube : PACING.default);
type Scene = Pick<BoundRecipe, "id" | "definition"> & { template?: { id: string; aspect?: string; params?: Record<string, unknown> } };
// Screen center and apparent size of a template recipe's subject at a local time, as frame fractions.
function subjectOnScreen(scene: Scene, localMs: number): { x: number; y: number; size: number } | undefined {
  if (!scene.template) return undefined;
  const manifest = findTemplate(scene.template.id);
  if (!manifest) return undefined;
  const aspect = (scene.template.aspect ?? "16:9") as Aspect;
  const definition = scene.definition as unknown as Parameters<typeof projectPoints>[0];
  const built = manifest.composite ? templateDefinition(manifest, (scene.template.params ?? {}) as Record<string, ParamValue>, aspect) : undefined;
  const composite = built && "layout" in built ? built as CompositeDefinition : undefined;
  const node = composite?.layout.find(entry => entry.id === composite.primary);
  const subject = ASPECT_FRAMES[aspect]?.subject ?? { width: 1440, height: 900 };
  const W = definition.width, H = definition.height;
  const box = node ? { cx: node.left + node.width / 2 - W / 2, cy: node.top + node.height / 2 - H / 2, w: node.width, h: node.height, z: node.transform?.z ?? 0 }
    : { cx: 0, cy: 0, w: subject.width, h: subject.height, z: 0 };
  const [center, left, right] = projectPoints(definition, [[box.cx, box.cy, box.z], [box.cx - box.w / 2, box.cy, box.z], [box.cx + box.w / 2, box.cy, box.z]], localMs);
  if (!center || !left || !right) return undefined;
  return { x: center.x / W, y: center.y / H, size: Math.abs(right.x - left.x) / W };
}
function cameraTravel(scene: Scene): number {
  const motion = scene.definition.motion;
  if (!motion) return 0;
  const end = motion.durationMs / (motion.speed ?? 1);
  return (evaluateMotion(motion, end).camera.x ?? 0) - (evaluateMotion(motion, 0).camera.x ?? 0);
}
function sceneCopy(scene: Scene): string[] {
  if (!scene.template) return [];
  const manifest = findTemplate(scene.template.id);
  if (!manifest?.composite) return [];
  const built = templateDefinition(manifest, (scene.template.params ?? {}) as Record<string, ParamValue>, (scene.template.aspect ?? "16:9") as Aspect);
  return "copy" in built ? (built as CompositeDefinition).copy : [];
}
function movesEarly(scene: Scene, untilMs: number): boolean {
  const motion = scene.definition.motion;
  if (!motion?.tracks.length) return false;
  const a = JSON.stringify(evaluateMotion(motion, 0)), b = JSON.stringify(evaluateMotion(motion, Math.min(untilMs, motion.durationMs)));
  return a !== b;
}
/** Advisories for one composition; `scenes` are the validated recipes it references. */
export function reviewComposition(composition: Composition, scenes: readonly Scene[], options: { platform?: string; beatToleranceMs?: number } = {}): { advisories: EditorialAdvisory[]; requiresVisualReview: true; pacing: { minMs: number; maxMs: number } } {
  const advisories: EditorialAdvisory[] = [];
  const add = (code: string, path: string, message: string, atMs?: number) => advisories.push({ code, path, message, ...(atMs !== undefined ? { atMs: Math.round(atMs) } : {}) });
  const ordered = [...composition.scenes].map((segment, index) => ({ segment, index, scene: scenes.find(scene => scene.id === segment.recipe) })).sort((a, b) => a.segment.startMs - b.segment.startMs);
  const pacing = pacingFor(options.platform);
  if (!ordered.length) return { advisories, requiresVisualReview: true, pacing };
  // Hook: something moves or reads within the first two seconds.
  const first = ordered[0];
  const earlyOverlay = composition.overlays.some(overlay => overlay.startMs < 2000);
  const earlyCopy = first.scene && sceneCopy(first.scene).some(Boolean);
  if (first.segment.startMs >= 2000 || (!earlyOverlay && !earlyCopy && !(first.scene && movesEarly(first.scene, 2000 - first.segment.startMs))))
    add("ADV_HOOK_LATE", `composition.scenes.${first.index}`, "Nothing moves or reads in the first 2 s; open on motion or a title so the hook lands before viewers scroll.", 0);
  for (const { segment, index, scene } of ordered) {
    const path = `composition.scenes.${index}`;
    if (segment.durationMs < pacing.minMs) add("ADV_SHOT_LENGTH", path, `Shot "${segment.id}" lasts ${segment.durationMs}ms; this platform reads best from ${pacing.minMs}ms.`, segment.startMs);
    if (segment.durationMs > pacing.maxMs) add("ADV_SHOT_LENGTH", path, `Shot "${segment.id}" lasts ${segment.durationMs}ms; this platform holds attention up to about ${pacing.maxMs}ms. Cut it or split it.`, segment.startMs);
    if (scene) {
      const needed = readingTimeMs(sceneCopy(scene));
      if (needed && needed > segment.durationMs) add("ADV_READING_TIME", path, `Shot "${segment.id}" shows copy that needs about ${needed}ms to read but is on screen ${segment.durationMs}ms.`, segment.startMs);
      if (scene.definition.motion?.loop) {
        const seam = loopSeam(scene.definition.motion);
        if (Number.isFinite(seam) && seam > 0.5) add("ADV_LOOP_SEAM", path, `Scene "${scene.id}" loops with a ${seam.toFixed(2)} jump at the seam; match its first and last keyframes.`);
      }
    }
  }
  for (const [index, overlay] of composition.overlays.entries()) {
    const scene = scenes.find(entry => entry.id === overlay.recipe);
    const needed = scene ? readingTimeMs(sceneCopy(scene)) : 0;
    if (needed && needed > overlay.durationMs) add("ADV_READING_TIME", `composition.overlays.${index}`, `Overlay "${overlay.id}" needs about ${needed}ms to read but is on screen ${overlay.durationMs}ms.`, overlay.startMs);
  }
  const last = ordered[ordered.length - 1];
  if (last.segment.durationMs < 2000) add("ADV_ENDCARD_SHORT", `composition.scenes.${last.index}`, `The final shot holds ${last.segment.durationMs}ms; end cards need 2 s or more to read and act on.`, last.segment.startMs);
  // Across each cut: eye trace, match-cut drift and camera direction.
  const beats = composition.markers.filter(marker => marker.kind === "beat" || marker.kind === "downbeat").map(marker => marker.atMs);
  const tolerance = options.beatToleranceMs ?? 80;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    const transition = b.segment.transition;
    const cutMs = b.segment.startMs + (transition && isOverlapTransition(transition.type) ? transition.durationMs : 0);
    const path = `composition.scenes.${b.index}`;
    if (a.scene && b.scene) {
      const out = subjectOnScreen(a.scene, a.segment.durationMs), into = subjectOnScreen(b.scene, 0);
      if (out && into) {
        const jump = Math.hypot((out.x - into.x) * 16, (out.y - into.y) * 9) / Math.hypot(16, 9);
        const matchMarked = composition.markers.some(marker => marker.kind === "cue" && /match/i.test(marker.label) && Math.abs(marker.atMs - cutMs) <= 250);
        if (matchMarked && (jump > 0.03 || Math.abs(out.size - into.size) / Math.max(out.size, into.size) > 0.08))
          add("ADV_MATCH_CUT_DRIFT", path, `The match cut into "${b.segment.id}" drifts ${(jump * 100).toFixed(0)}% of the frame and ${(Math.abs(out.size - into.size) * 100).toFixed(0)}% in scale; align the subject's position and size across the cut.`, cutMs);
        else if (!matchMarked && jump > 0.35)
          add("ADV_EYE_TRACE_JUMP", path, `The subject jumps ${(jump * 100).toFixed(0)}% of the frame diagonal across the cut into "${b.segment.id}"; the eye has to hunt. Frame B's subject near A's last position.`, cutMs);
      }
      const travelA = cameraTravel(a.scene), travelB = cameraTravel(b.scene);
      const sectioned = composition.markers.some(marker => marker.kind === "section" && Math.abs(marker.atMs - cutMs) <= 250);
      if (!sectioned && Math.abs(travelA) > 40 && Math.abs(travelB) > 40 && Math.sign(travelA) !== Math.sign(travelB))
        add("ADV_DIRECTION_FLIP", path, `Camera travel reverses across the cut into "${b.segment.id}"; keep screen direction, or mark a new section.`, cutMs);
    }
    if (beats.length) {
      const nearest = beats.reduce((best, beat) => Math.abs(beat - cutMs) < Math.abs(best - cutMs) ? beat : best, Infinity);
      if (Math.abs(nearest - cutMs) > tolerance) add("ADV_OFFBEAT_CUT", path, `The cut into "${b.segment.id}" lands ${Math.round(Math.abs(nearest - cutMs))}ms off the nearest beat; run velora compose snap --composition <file> --to beats.`, cutMs);
    }
  }
  return { advisories, requiresVisualReview: true, pacing };
}
