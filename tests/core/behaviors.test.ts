import { describe, expect, it } from "vitest";
import {
  BEHAVIOR_CATALOG, BEHAVIOR_INTENSITIES, MotionClipSchema, MotionSchema, applyEdits, buildBehavior, buildShotClip, buildStaggeredBehavior,
  evaluateMotion, resolveBehaviorParams, reviewAuthoring, SHOT_KINDS,
} from "../../src/core";

const targetFor = (id: string) => (BEHAVIOR_CATALOG.find(entry => entry.id === id)!.target === "surface" ? { surface: "headline" } : { animatable: "hero-counter" });
const recipe = () => ({ version: 1, id: "s", title: "S", definition: { width: 1400, height: 980, scene: { camera: { perspective: 1800 }, nodes: [{ id: "headline" }] }, motion: { durationMs: 6000, speed: 1, tracks: [] } } });

describe("behaviors library", () => {
  it("every behavior × intensity compiles to a valid clip with provenance", () => {
    for (const spec of BEHAVIOR_CATALOG) for (const intensity of BEHAVIOR_INTENSITIES) {
      const clip = buildBehavior(spec.id, { intensity }, targetFor(spec.id));
      expect(MotionClipSchema.safeParse(clip).success, `${spec.id} ${intensity}`).toBe(true);
      expect(clip.source).toMatchObject({ behavior: spec.id, version: 1, params: { intensity } });
      const motion = MotionSchema.parse({ durationMs: 6000, speed: 1, tracks: [], clips: [clip] });
      for (const t of [0, 300, 900, 4000]) expect(evaluateMotion(motion, t).issues).toEqual([]);
    }
  });
  it("defaults to subtle, and intensity scales distances and durations", () => {
    const subtle = resolveBehaviorParams(BEHAVIOR_CATALOG.find(entry => entry.id === "fade-up")!, {});
    const dramatic = resolveBehaviorParams(BEHAVIOR_CATALOG.find(entry => entry.id === "fade-up")!, { intensity: "dramatic" });
    expect(subtle.intensity).toBe("subtle");
    expect(dramatic.distance).toBe((subtle.distance as number) * 2);
    expect(dramatic.durationMs).toBeGreaterThan(subtle.durationMs);
  });
  it("enter behaviors end at the layer's own values: offsets (add mode) reach 0, opacity reaches 1", () => {
    const clip = buildBehavior("rise", {}, { surface: "headline" });
    expect(clip.mode).toBeUndefined();
    expect(clip.clips?.[0]).toMatchObject({ id: "rise-headline-offset", mode: "add" });
    const motion = MotionSchema.parse({ durationMs: 6000, speed: 1, tracks: [], clips: [clip] });
    expect(evaluateMotion(motion, 5000).additive?.surfaces?.headline).toMatchObject({ y: 0, blur: 0 });
    expect(evaluateMotion(motion, 5000).surfaces.headline).toMatchObject({ opacity: 1 });
    expect(evaluateMotion(motion, 0).additive?.surfaces?.headline).toMatchObject({ y: 40, blur: 4 });
    expect(evaluateMotion(motion, 0).surfaces.headline).toMatchObject({ opacity: 0 });
    // Pure offsets stay one add-mode clip.
    expect(buildBehavior("glow", {}, { surface: "headline" }).mode).toBe("add");
  });
  it("generated keyframes are stable (golden)", () => {
    expect(buildBehavior("fade-up", {}, { surface: "headline" })).toMatchInlineSnapshot(`
      {
        "clips": [
          {
            "id": "fade-up-headline-offset",
            "mode": "add",
            "startMs": 0,
            "tracks": [
              {
                "keyframes": [
                  {
                    "easing": "cubic.out",
                    "timeMs": 0,
                    "value": 24,
                  },
                  {
                    "easing": "cinematic",
                    "timeMs": 600,
                    "value": 0,
                  },
                ],
                "property": "y",
                "target": {
                  "id": "headline",
                  "kind": "surface",
                },
              },
            ],
          },
        ],
        "id": "fade-up-headline",
        "label": "Fade up",
        "source": {
          "behavior": "fade-up",
          "params": {
            "distance": 24,
            "durationMs": 600,
            "intensity": "subtle",
          },
          "version": 1,
        },
        "startMs": 0,
        "tracks": [
          {
            "keyframes": [
              {
                "easing": "cubic.out",
                "timeMs": 0,
                "value": 0,
              },
              {
                "easing": "cinematic",
                "timeMs": 600,
                "value": 1,
              },
            ],
            "property": "opacity",
            "target": {
              "id": "headline",
              "kind": "surface",
            },
          },
        ],
      }
    `);
    expect(buildBehavior("counter-up", { to: 1280 }, { animatable: "hero-counter" }).tracks?.[0]).toMatchObject({ target: { kind: "channel", id: "hero-counter.value" }, keyframes: [{ value: 0 }, { value: 1280 }] });
    expect(buildBehavior("typewriter", { to: 7 }, { animatable: "headline" }).tracks?.[0]).toMatchObject({ target: { kind: "channel", id: "headline.chars" }, keyframes: [{ value: 0 }, { value: 7 }] });
    expect(buildBehavior("reveal", {}, { animatable: "headline" }).tracks?.[0]).toMatchObject({ target: { kind: "channel", id: "headline.reveal.progress" }, keyframes: [{ value: 0 }, { value: 1 }] });
  });
  it("provenance round-trips through clip.set and is dropped by a hand edit", () => {
    const clip = buildBehavior("fade-up", { startMs: 500 }, { surface: "headline" });
    const applied = applyEdits(recipe(), [{ op: "clip.set", clip }]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const stored = (applied.recipe as ReturnType<typeof recipe>).definition.motion as unknown as { clips: { source?: unknown }[] };
    expect(stored.clips[0].source).toEqual(clip.source);
    const edited = applyEdits(applied.recipe, [{ op: "key.set", track: { target: { kind: "surface", id: "headline" }, property: "y", clip: clip.id }, atMs: 0, value: 30 }]);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(((edited.recipe as ReturnType<typeof recipe>).definition.motion as unknown as { clips: { source?: unknown }[] }).clips[0].source).toBeUndefined();
    // The inverse restores the provenance exactly.
    const undone = applyEdits(edited.recipe, edited.inverse);
    expect(undone.ok && JSON.stringify(undone.recipe)).toBe(JSON.stringify(applied.recipe));
    // Re-applying the same behavior regenerates the clip in place (one op).
    const again = applyEdits(applied.recipe, [{ op: "clip.set", clip: buildBehavior("fade-up", { startMs: 500, intensity: "dramatic" }, { surface: "headline" }) }]);
    expect(again.ok && ((again.recipe as ReturnType<typeof recipe>).definition.motion as unknown as { clips: unknown[] }).clips.length).toBe(1);
  });
  it("staggered behaviors compile to one stagger clip over the members", () => {
    const clip = buildStaggeredBehavior("fade-up", {}, ["a", "b", "c", "d", "e"], { eachMs: 120, order: "center-out" });
    expect(clip.members).toEqual(["a", "b", "c", "d", "e"]);
    expect(clip.stagger).toEqual({ eachMs: 120, order: "center-out" });
    expect(MotionClipSchema.safeParse(clip).success).toBe(true);
    const cascade = buildStaggeredBehavior("cascade", {}, ["a", "b", "c"], { eachMs: 90 });
    expect(cascade.stagger?.eachMs).toBe(90);
  });
  it("never produces camera-overshoot (or any camera) advisories at subtle", () => {
    for (const spec of BEHAVIOR_CATALOG) {
      if (spec.target !== "surface") continue;
      const clip = buildBehavior(spec.id, {}, { surface: "headline" });
      const review = reviewAuthoring({ scene: { camera: { perspective: 1800 }, nodes: [{ id: "headline" }] } as never, motion: { durationMs: 6000, speed: 1, tracks: [], clips: [clip] } as never });
      expect([...review.issues, ...review.advice].filter(entry => /camera/i.test(entry.code + entry.message)), spec.id).toEqual([]);
    }
  });
  it("refuses unknown behaviors and wrong target kinds", () => {
    expect(() => buildBehavior("nope", {}, { surface: "a" })).toThrow(/Unknown behavior/);
    expect(() => buildBehavior("counter-up", {}, { surface: "a" })).toThrow(/animatable/);
  });
});

describe("camera-move library", () => {
  it("every SHOT_KINDS move compiles to a camera clip with shot provenance and a verdict", () => {
    for (const kind of SHOT_KINDS) {
      const result = buildShotClip({ kind }, { subject: { width: 800, height: 520, center: [-100, -70, 0] }, frame: { width: 1400, height: 980 }, sceneSpeed: 1 });
      expect(MotionClipSchema.safeParse(result.clip).success, kind).toBe(true);
      expect(result.clip.source).toMatchObject({ shot: kind, version: 1 });
      expect(typeof result.verdict.ok).toBe("boolean");
      expect(result.verdict.inFrame).toBe(result.report.minSubjectVisible);
    }
  });
  it("re-centers the move on the layer: the camera looks at the layer as the designed shot looks at the origin", () => {
    const centered = buildShotClip({ kind: "push-in" }, { subject: { width: 800, height: 520 }, frame: { width: 1920, height: 1080 } });
    const moved = buildShotClip({ kind: "push-in" }, { subject: { width: 800, height: 520, center: [200, 50, 0] }, frame: { width: 1920, height: 1080 } });
    const x = (clip: typeof centered.clip) => (clip.tracks as { target: { kind: string }; property: string; keyframes: { value: number }[] }[]).find(track => track.target.kind === "camera" && track.property === "x")!.keyframes[0].value;
    expect(x(moved.clip)).not.toBe(x(centered.clip));
    expect(moved.verdict).toEqual(centered.verdict);
  });
});
