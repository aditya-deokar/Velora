import { z } from "zod";

/** SOURCE OF TRUTH: CaptionCueSchema, SRT/VTT ingest and cue checks.
 * WHAT: canonical subtitle cues parsed from .srt/.vtt plus pure validation.
 * WHY: agents author accessible captions that burn in deterministically at export.
 * WHERE: compositions reference caption files; captions validate/check verify them.
 * No transcription or translation lives here: ingest only parses authored files.
 */
export const MAX_CAPTION_CUES = 2048;
export const CAPTION_READING_CPS = 20;
export const CaptionCueSchema = z.strictObject({
  startMs: z.number().finite().nonnegative().max(120_000),
  endMs: z.number().finite().positive().max(120_000),
  text: z.string().trim().min(1).max(500),
  style: z.string().max(128).optional(),
}).superRefine((cue, ctx) => {
  if (cue.endMs <= cue.startMs)
    ctx.addIssue({ code: "custom", path: ["endMs"], message: "Cue end must be after cue start." });
});
export type CaptionCue = z.output<typeof CaptionCueSchema>;
export const CaptionFileSchema = z.strictObject({
  cues: z.array(CaptionCueSchema).min(1).max(MAX_CAPTION_CUES),
});
export type CaptionFile = z.output<typeof CaptionFileSchema>;
export type CaptionIssue = { code: string; path: string; message: string };

function parseTimestamp(value: string): number | undefined {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim());
  if (!match) return undefined;
  const [, h, m, s, ms] = match;
  return Number(h) * 3600000 + Number(m) * 60000 + Number(s) * 1000 + Number(ms.padEnd(3, "0").slice(0, 3));
}
// Parse authored SRT or VTT text into canonical cues. Malformed blocks become
// ERR_CAPTION_INVALID issues with block-accurate paths, never exceptions.
export function parseCaptions(text: string, kind: "srt" | "vtt"): { cues: CaptionCue[] } | { issues: CaptionIssue[] } {
  const issues: CaptionIssue[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  if (kind === "vtt") {
    while (index < lines.length && lines[index].trim() === "") index++;
    if (!lines[index]?.startsWith("WEBVTT")) return { issues: [{ code: "ERR_CAPTION_INVALID", path: "captions.header", message: "VTT files must start with a WEBVTT header." }] };
    index++;
  }
  const cues: CaptionCue[] = [];
  let block = 0;
  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === "") index++;
    if (index >= lines.length) break;
    block++;
    const path = `captions.cues.${cues.length}`;
    // VTT metadata blocks carry no cues.
    if (kind === "vtt" && (/^NOTE(?:\s|$)/.test(lines[index]) || lines[index].trim() === "STYLE" || lines[index].trim() === "REGION")) {
      while (index < lines.length && lines[index].trim() !== "") index++;
      block--;
      continue;
    }
    let timing = lines[index].trim();
    // SRT blocks start with a numeric counter; VTT blocks may carry a cue id.
    if (kind === "srt" && /^\d+$/.test(timing)) {
      index++;
      timing = (lines[index] ?? "").trim();
    } else if (kind === "vtt" && !timing.includes("-->") && lines[index + 1]?.includes("-->")) {
      index++;
      timing = lines[index].trim();
    }
    const arrow = timing.split("-->");
    if (arrow.length !== 2) {
      issues.push({ code: "ERR_CAPTION_INVALID", path, message: `Block ${block} has no start --> end timing.` });
      index++;
      continue;
    }
    const startMs = parseTimestamp(arrow[0]);
    const endPart = arrow[1].trim().split(/\s+/);
    const endMs = parseTimestamp(endPart[0]);
    if (startMs === undefined || endMs === undefined) {
      issues.push({ code: "ERR_CAPTION_INVALID", path, message: `Block ${block} has an unreadable timestamp. Use HH:MM:SS,mmm.` });
      index++;
      continue;
    }
    index++;
    const words: string[] = [];
    while (index < lines.length && lines[index].trim() !== "") {
      const clean = lines[index].replace(/<[^>]*>/g, "").trim();
      if (clean) words.push(clean);
      index++;
    }
    const parsed = CaptionCueSchema.safeParse({ startMs, endMs, text: words.join(" ") });
    if (!parsed.success)
      issues.push(...parsed.error.issues.map((issue) => ({ code: "ERR_CAPTION_INVALID", path: `${path}.${issue.path.join(".")}`, message: issue.message })));
    else cues.push(parsed.data);
  }
  if (!cues.length && !issues.length) return { issues: [{ code: "ERR_CAPTION_INVALID", path: "captions", message: "No cues found." }] };
  if (cues.length > MAX_CAPTION_CUES) return { issues: [{ code: "ERR_CAPTION_INVALID", path: "captions", message: `Too many cues: ${cues.length} over the ${MAX_CAPTION_CUES} limit.` }] };
  return issues.length ? { issues } : { cues };
}
// Serialize canonical cues back to SRT for the burn-in filter, which reads
// SRT natively. VTT sources always pass through the parser first, so only
// validated cues reach FFmpeg.
export function formatSrt(cues: readonly CaptionCue[]): string {
  const stamp = (ms: number): string => {
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000), x = Math.floor(ms % 1000);
    const pad = (n: number, w: number) => String(n).padStart(w, "0");
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(x, 3)}`;
  };
  return cues.map((cue, i) => `${i + 1}\n${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\n${cue.text}`).join("\n\n") + "\n";
}
// Technical cue checks against the timeline span: overlaps, out-of-range
// cues and reading speed. Cue-indexed paths name the exact block to fix.
export function checkCaptions(cues: readonly CaptionCue[], durationMs: number): CaptionIssue[] {
  const issues: CaptionIssue[] = [];
  const ordered = [...cues].sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < ordered.length; i++) {
    const cue = ordered[i];
    const path = `captions.cues.${cues.indexOf(cue)}`;
    if (cue.endMs > durationMs)
      issues.push({ code: "ERR_CAPTION_TIMING", path, message: `Cue ends at ${cue.endMs}ms but the timeline spans ${durationMs}ms.` });
    const seconds = (cue.endMs - cue.startMs) / 1000;
    if (seconds > 0 && cue.text.length / seconds > CAPTION_READING_CPS)
      issues.push({ code: "ERR_CAPTION_TIMING", path, message: `Cue reads at ${Math.round(cue.text.length / seconds)} chars/sec over the ${CAPTION_READING_CPS} budget. Split it.` });
    if (i > 0 && cue.startMs < ordered[i - 1].endMs)
      issues.push({ code: "ERR_CAPTION_OVERLAP", path, message: `Cue starts at ${cue.startMs}ms before the previous cue ends at ${ordered[i - 1].endMs}ms.` });
  }
  return issues;
}
