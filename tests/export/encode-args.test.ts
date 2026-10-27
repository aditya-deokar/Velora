import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExportVideoSchema, VideoRenderSchema, resolveFinishing, shutterSamples, SUPPORTED_EXPORT_FPS } from "../../src/core/export";
import { frameAt, timeAtFrame } from "../../src/core/timeline";
import { encodeFrameBuffers, probeEncoders, videoEncodeArgs } from "../../src/export/services";
import { encodePng } from "../../src/export/compositor";

const base = { fps: 30, width: 320, height: 180, frames: 10 };
const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const tagged = (args: string[]) => BT709.every((item, index) => index % 2 === 1 || value(args, item) === BT709[index + 1]);

describe("encoder arguments", () => {
  it("converts to limited-range BT.709 and tags every opaque codec", () => {
    for (const codec of ["h264", "hevc", "vp9", "av1", "prores4444"] as const) {
      const args = videoEncodeArgs({ ...base, codec }, "out.x");
      expect(value(args, "-vf"), codec).toContain("scale=in_range=pc:out_range=tv:out_color_matrix=bt709");
      expect(tagged(args), codec).toBe(true);
      expect(value(args, "-frames:v")).toBe("10");
      expect(args.at(-2)).toBe("-n");
    }
  });
  it("maps quality presets to encoder effort", () => {
    const draft = resolveFinishing({ quality: "draft" }, { width: 1920, height: 1080 });
    const master = resolveFinishing({ quality: "master" }, { width: 1920, height: 1080 });
    const h264 = (finishing: typeof draft) => videoEncodeArgs({ ...base, codec: "h264", quality: finishing.quality, x264: finishing.x264, crf: finishing.crf }, "o.mp4");
    expect([value(h264(draft), "-preset"), value(h264(draft), "-crf")]).toEqual(["veryfast", "26"]);
    expect([value(h264(master), "-preset"), value(h264(master), "-crf")]).toEqual(["slower", "14"]);
    expect(value(h264(master), "-profile:v")).toBe("high");
    expect(value(videoEncodeArgs({ ...base, codec: "vp9", quality: "master" }, "o.webm"), "-crf")).toBe("24");
    expect(value(videoEncodeArgs({ ...base, codec: "hevc" }, "o.mp4"), "-tag:v")).toBe("hvc1");
  });
  it("keeps alpha only for alpha codecs and pads with transparent black", () => {
    const vp9 = videoEncodeArgs({ ...base, codec: "vp9", transparent: true }, "o.webm");
    expect(value(vp9, "-pix_fmt")).toBe("yuva420p");
    expect(value(vp9, "-auto-alt-ref")).toBe("0");
    expect(value(vp9, "-vf")).toContain("color=black@0");
    expect(value(videoEncodeArgs({ ...base, codec: "prores4444", transparent: true }, "o.mov"), "-pix_fmt")).toBe("yuva444p10le");
    expect(value(videoEncodeArgs({ ...base, codec: "prores4444" }, "o.mov"), "-pix_fmt")).toBe("yuv444p10le");
  });
  it("builds a two-pass palette GIF at its own frame rate and width cap", () => {
    const args = videoEncodeArgs({ ...base, width: 1920, height: 1080, codec: "gif", gifFps: 12 }, "o.gif");
    expect(value(args, "-vf")).toContain("fps=12,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a");
    expect(args).not.toContain("-frames:v");
    expect(value(args, "-loop")).toBe("0");
  });
});

describe("finishing contracts", () => {
  const request = { url: "http://127.0.0.1:5173/", output: "clip.mp4" };
  it("validates containers per codec and alpha per codec", () => {
    const ok = (input: object) => ExportVideoSchema.safeParse({ ...request, ...input }).success;
    expect(ok({})).toBe(true);
    expect(ok({ codec: "vp9", output: "clip.webm", transparent: true })).toBe(true);
    expect(ok({ codec: "prores4444", output: "clip.mov", transparent: true })).toBe(true);
    expect(ok({ codec: "gif", output: "clip.gif", gifFps: 15 })).toBe(true);
    expect(ok({ codec: "vp9" })).toBe(false);
    expect(ok({ transparent: true })).toBe(false);
    expect(ok({ gifFps: 15 })).toBe(false);
    expect(ok({ motionSamples: 8 })).toBe(false);
    expect(ok({ codec: "vp9", output: "clip.webm", captions: "c.srt" })).toBe(false);
    expect(ok({ output: "clip.avi" })).toBe(false);
    expect(VideoRenderSchema.safeParse({ composition: "a.composition.json", out: "a.webm", codec: "vp9", aspects: ["9:16", "1:1"], preset: "website-hero" }).success).toBe(true);
    expect(VideoRenderSchema.safeParse({ composition: "a.composition.json", out: "a.mp4", parallel: 9 }).success).toBe(false);
  });
  it("resolves presets, explicit overrides and the 3840 px supersample cap", () => {
    expect(resolveFinishing({}, { width: 1920, height: 1080 })).toMatchObject({ quality: "standard", codec: "h264", supersample: 1, motionBlur: 0, motionSamples: 0 });
    expect(resolveFinishing({ quality: "master" }, { width: 1920, height: 1080 })).toMatchObject({ supersample: 2, motionBlur: 180, motionSamples: 8 });
    expect(resolveFinishing({ quality: "master", motionBlur: 90, motionSamples: 4 }, { width: 1920, height: 1080 })).toMatchObject({ motionBlur: 90, motionSamples: 4 });
    expect(resolveFinishing({ quality: "master" }, { width: 3840, height: 2160 }).supersample).toBe(1);
    expect(resolveFinishing({ quality: "master", motionBlur: 0 }, { width: 1280, height: 720 })).toMatchObject({ motionBlur: 0, motionSamples: 0 });
    expect(resolveFinishing({ quality: "draft" }, { width: 1280, height: 720 }).supersample).toBe(0.5);
  });
  it("samples a trailing shutter", () => {
    expect(shutterSamples(1000, 24, 0, 8, 5000)).toEqual([1000]);
    expect(shutterSamples(0, 25, 360, 2, 5000)).toEqual([10, 30]);
  });
  it.each([24, 25, 50])("round-trips the %i fps frame grid with non-integer milliseconds", fps => {
    expect(SUPPORTED_EXPORT_FPS).toContain(fps);
    for (let frame = 0; frame < 500; frame++) expect(frameAt(timeAtFrame(frame, fps), fps)).toBe(frame);
    expect(timeAtFrame(1, fps)).toBeCloseTo(1000 / fps, 10);
  });
});

// Real encodes of synthetic frames: container, pixel format, color tags and alpha per codec.
describe("real encodes", () => {
  let root = "";
  let encoders: Awaited<ReturnType<typeof probeEncoders>>;
  beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "velora-codecs-")); encoders = await probeEncoders(); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  const frames = (alpha: boolean) => Array.from({ length: 12 }, (_, i) => {
    const pixels = Buffer.alloc(64 * 36 * 4);
    for (let p = 0; p < 64 * 36; p++) pixels.set([(p % 64) * 4, i * 20, 120, alpha && p % 64 < 32 ? 0 : 255], p * 4);
    return encodePng(64, 36, pixels);
  });
  const probe = (file: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" })).streams[0];
  it.each([
    ["h264", "clip.mp4", false, "yuv420p"], ["vp9", "alpha.webm", true, "yuva420p"], ["prores4444", "alpha.mov", true, "yuva444p10le"], ["hevc", "clip-hevc.mp4", false, "yuv420p"],
  ] as const)("%s writes %s", async (codec, name, transparent, pixFmt) => {
    if (!encoders?.[codec]) return;
    const file = path.join(root, name);
    await encodeFrameBuffers(frames(transparent), file, { fps: 24, width: 64, height: 36, cwd: root, codec, transparent });
    const stream = probe(file);
    // libvpx stores alpha as a side channel: ffprobe reports yuv420p plus an ALPHA_MODE tag.
    if (codec === "vp9") expect(stream.tags?.ALPHA_MODE ?? stream.tags?.alpha_mode).toBe("1");
    // ProRes 4444 decodes as yuva444p12le whatever the 10-bit source; the alpha plane is what matters.
    else if (codec === "prores4444") expect(stream.pix_fmt).toMatch(/^yuva444p1[02]le$/);
    else expect(stream.pix_fmt).toBe(pixFmt);
    expect(stream.color_space).toBe("bt709");
    expect(stream.color_primaries).toBe("bt709");
    expect(stream.color_transfer).toBe("bt709");
    expect(stream.r_frame_rate).toBe("24/1");
  }, 60_000);
  it("writes a small looping GIF", async () => {
    const file = path.join(root, "loop.gif");
    await encodeFrameBuffers(frames(false), file, { fps: 24, width: 64, height: 36, cwd: root, codec: "gif", gifFps: 12 });
    expect(probe(file).codec_name).toBe("gif");
    expect((await stat(file)).size).toBeLessThan(200_000);
  }, 60_000);
});
