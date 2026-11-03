import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildMuxFilter, escapeSubtitlesPath, mixPostAudioCaptions,
  parsePng, probeAudioFile, probeAvDrift,
} from "../../src/export/services";

let root: string;
function ffmpeg(...args: string[]) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}
function ffprobe(file: string) {
  return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" }).toString()).streams;
}
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "velora-mux-"));
  ffmpeg("-f", "lavfi", "-i", "testsrc=size=128x96:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(root, "silent.mp4"));
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", path.join(root, "tone.wav"));
  await writeFile(path.join(root, "subs.srt"), "1\n00:00:00,200 --> 00:00:01,800\nHello burn\n");
  await writeFile(path.join(root, "subs.vtt"), "WEBVTT\n\n00:00:00.200 --> 00:00:01.800\nHello burn\n");
  await writeFile(path.join(root, "notes.txt"), "not audio");
}, 120_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); }, 30_000);

describe("mux filter builder", () => {
  it("builds single, ensemble, ducked and captioned filters", () => {
    const single = buildMuxFilter([{ id: "a", file: "a.wav", startMs: 0, offsetMs: 0, gain: 1, fadeInMs: 0, fadeOutMs: 0, audioMs: 2000 }]);
    expect(single.audioFilter).toContain("adelay=0|0");
    expect(single.videoFilter).toBeNull();
    const duo = buildMuxFilter([
      { id: "m", file: "m.wav", startMs: 0, offsetMs: 0, gain: 1, fadeInMs: 100, fadeOutMs: 100, audioMs: 2000, duckUnderTrackId: "v" },
      { id: "v", file: "v.wav", startMs: 500, offsetMs: 0, gain: 0.9, fadeInMs: 0, fadeOutMs: 0, audioMs: 1500 },
    ]);
    expect(duo.audioFilter).toContain("sidechaincompress");
    expect(duo.audioFilter).toContain("amix=inputs=2");
    expect(duo.audioFilter).toContain("afade=t=in");
    const captioned = buildMuxFilter([], "C:/proj/subs.srt", "C:/proj/assets");
    expect(captioned.audioFilter).toBeNull();
    expect(captioned.videoFilter).toContain("subtitles=");
    expect(escapeSubtitlesPath("C:\\proj\\my subs/file.srt")).toBe("'C\\:/proj/my subs/file.srt'");
    expect(() => escapeSubtitlesPath("C:\\it's\\subs.srt")).toThrow(/quotes/);
    expect(() => escapeSubtitlesPath("/tmp/a';movie=x/subs.srt")).toThrow(/quotes/);
  });
  it("probes real audio files", async () => {
    const probe = await probeAudioFile(path.join(root, "tone.wav"));
    expect(probe.codec).toBe("pcm_s16le");
    expect(probe.durationMs).toBeGreaterThan(1500);
  }, 30_000);
});

describe("audio/caption post-pass", () => {
  it("mixes audio and burns captions with measured drift", async () => {
    const scope = { root, output: "mixed.mp4" };
    const result = await mixPostAudioCaptions(scope, "silent.mp4", { audio: "tone.wav", captions: "subs.srt" });
    expect(result.audio).toMatchObject({ file: "tone.wav", codec: "pcm_s16le" });
    expect(result.audio!.driftMs).toBeLessThanOrEqual(40);
    expect(result.captions).toMatchObject({ file: "subs.srt", cues: 1, burnIn: true });
    const streams = ffprobe(path.join(root, "mixed.mp4")).map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}:${s.codec_name}`);
    expect(streams).toContain("video:h264");
    expect(streams).toContain("audio:aac");
    // Burned captions change real pixels versus the silent master.
    const shot = (file: string, out: string) => ffmpeg("-ss", "1.0", "-i", path.join(root, file), "-frames:v", "1", path.join(root, out));
    shot("mixed.mp4", "burned.png");
    shot("silent.mp4", "plain.png");
    const [a, b] = await Promise.all([readFile(path.join(root, "burned.png")), readFile(path.join(root, "plain.png"))]);
    expect(a.equals(b)).toBe(false);
    expect(parsePng(a).width).toBe(128);
    const drift = await probeAvDrift(path.join(root, "mixed.mp4"));
    expect(drift.driftMs).not.toBeNull();
    expect(drift.driftMs!).toBeLessThanOrEqual(40);
  }, 180_000);
  it("converts VTT through the validated parser before burning", async () => {
    const result = await mixPostAudioCaptions({ root, output: "vtt.mp4" }, "silent.mp4", { captions: "subs.vtt" });
    expect(result.captions).toMatchObject({ file: "subs.vtt", cues: 1, burnIn: true });
    expect(result.audio).toBeUndefined();
  }, 180_000);
  it("fails closed on bad codecs, bad captions and existing outputs", async () => {
    await expect(mixPostAudioCaptions({ root, output: "bad-codec.mp4" }, "silent.mp4", { audio: "notes.txt" }))
      .rejects.toMatchObject({ code: "ERR_AUDIO_CODEC" });
    await writeFile(path.join(root, "bad.srt"), "1\nno timing\n\n");
    await expect(mixPostAudioCaptions({ root, output: "bad-cap.mp4" }, "silent.mp4", { captions: "bad.srt" }))
      .rejects.toMatchObject({ code: "ERR_CAPTION_INVALID" });
    await expect(mixPostAudioCaptions({ root, output: "mixed.mp4" }, "silent.mp4", { audio: "tone.wav" }))
      .rejects.toMatchObject({ code: "output-exists" });
  }, 180_000);
});
