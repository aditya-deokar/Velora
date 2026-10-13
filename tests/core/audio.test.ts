import { describe, expect, it } from "vitest";
import { AUDIO_DRIFT_BUDGET_MS, AudioTrackSchema, audioDurationOk, audioPlacement } from "../../src/core/audio";

describe("audio tracks", () => {
  it("validates track shapes and ranges", () => {
    expect(AudioTrackSchema.safeParse({ id: "music", assetId: "track", startMs: 0 }).success).toBe(true);
    const parsed = AudioTrackSchema.safeParse({ id: "music", assetId: "track", startMs: 1500, gain: 0.8, fadeInMs: 200, fadeOutMs: 500 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.offsetMs).toBe(0);
      expect(parsed.data.gain).toBe(0.8);
    }
    for (const bad of [
      { id: "music", assetId: "track", startMs: -1 },
      { id: "music", assetId: "track", startMs: 0, gain: 2.5 },
      { id: "music", assetId: "track", startMs: 0, fadeInMs: -5 },
      { id: "x", assetId: "track", startMs: 0, duckUnder: { trackId: "x", amount: 0.5 } },
      { id: "x", assetId: "track", startMs: 0, duckUnder: { trackId: "y", amount: 2 } },
    ]) expect(AudioTrackSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it("snaps placement to the frame grid and reports both", () => {
    expect(audioPlacement({ startMs: 100 }, 30)).toEqual({ startMs: 100, frame: 3 });
    const snapped = audioPlacement({ startMs: 50 }, 30);
    expect(snapped.frame).toBe(2);
    expect(snapped.startMs).toBeCloseTo(66.6667, 3);
    expect(() => audioPlacement({ startMs: 0 }, 0)).toThrow();
  });
  it("bounds fades by audio length and pins the drift budget", () => {
    expect(audioDurationOk({ fadeInMs: 200, fadeOutMs: 300 }, 1000)).toBe(true);
    expect(audioDurationOk({ fadeInMs: 600, fadeOutMs: 500 }, 1000)).toBe(false);
    expect(AUDIO_DRIFT_BUDGET_MS).toBe(40);
  });
});
