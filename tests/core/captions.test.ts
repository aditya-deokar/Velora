import { describe, expect, it } from "vitest";
import { checkCaptions, formatSrt, parseCaptions } from "../../src/core/captions";

const srt = `1
00:00:01,000 --> 00:00:03,500
Hello <b>world</b>

2
00:00:04,000 --> 00:00:06,000
Second cue
`;
const vtt = `WEBVTT

NOTE a comment block

cue-1
00:00:01.000 --> 00:00:03.000
Hello world
`;

describe("caption ingest", () => {
  it("parses SRT with tag stripping and VTT with ids and notes", () => {
    const a = parseCaptions(srt, "srt");
    expect("cues" in a && a.cues).toEqual([
      { startMs: 1000, endMs: 3500, text: "Hello world" },
      { startMs: 4000, endMs: 6000, text: "Second cue" },
    ]);
    const b = parseCaptions(vtt, "vtt");
    expect("cues" in b && b.cues).toEqual([{ startMs: 1000, endMs: 3000, text: "Hello world" }]);
  });
  it("rejects malformed blocks with block-accurate paths", () => {
    expect(parseCaptions("1\nno timing here\n\n", "srt")).toMatchObject({ issues: [{ code: "ERR_CAPTION_INVALID", path: "captions.cues.0" }] });
    expect(parseCaptions("1\n00:00:99,000 --> 00:00:01,000\nText\n", "srt")).toMatchObject({ issues: [{ code: "ERR_CAPTION_INVALID" }] });
    expect(parseCaptions("1\n00:00:05,000 --> 00:00:01,000\nText\n", "srt")).toMatchObject({ issues: [{ code: "ERR_CAPTION_INVALID" }] });
    expect(parseCaptions("1\n00:00:01,000 --> 00:00:02,000\n\n", "srt")).toMatchObject({ issues: [{ code: "ERR_CAPTION_INVALID" }] });
    expect(parseCaptions("no header\n", "vtt")).toMatchObject({ issues: [{ code: "ERR_CAPTION_INVALID", path: "captions.header" }] });
    expect(parseCaptions("", "srt")).toMatchObject({ issues: [{ code: "ERR_CAPTION_INVALID", path: "captions" }] });
  });
  it("round-trips cues through SRT for the burn filter", () => {
    const parsed = parseCaptions(srt, "srt");
    expect("cues" in parsed).toBe(true);
    if (!("cues" in parsed)) throw new Error("unreachable");
    expect(formatSrt(parsed.cues)).toBe("1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond cue\n");
    const again = parseCaptions(formatSrt(parsed.cues), "srt");
    expect(again).toEqual(parsed);
  });
});

describe("caption checks", () => {
  const cues = [
    { startMs: 0, endMs: 2000, text: "Short" },
    { startMs: 1500, endMs: 3000, text: "Overlaps the first" },
    { startMs: 4000, endMs: 4500, text: "This cue packs far too many characters into half a second of screen time" },
    { startMs: 9000, endMs: 20000, text: "Beyond the span" },
  ];
  it("names overlaps, range and reading-speed violations per cue", () => {
    const issues = checkCaptions(cues, 10000);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(["ERR_CAPTION_OVERLAP", "ERR_CAPTION_TIMING"]));
    expect(issues.find((i) => i.code === "ERR_CAPTION_OVERLAP")?.path).toBe("captions.cues.1");
    expect(issues.some((i) => i.path === "captions.cues.3")).toBe(true);
  });
  it("passes clean cue sheets", () => {
    expect(checkCaptions([{ startMs: 0, endMs: 2000, text: "Hello" }], 10000)).toEqual([]);
  });
});
