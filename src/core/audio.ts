import { z } from "zod";

/** SOURCE OF TRUTH: AudioTrackSchema, audio placement and mix policy.
 * WHAT: versioned audio track contracts plus pure placement/snapping helpers.
 * WHY: agents sync audio to the video frame clock without owning the mix.
 * WHERE: compositions declare tracks; export services mix with FFmpeg; audio check validates.
 * The DOM preview never plays mixed audio: preview runs the video clock and
 * reports audio as best-effort. FFmpeg owns the mix at export.
 */
export const AUDIO_DRIFT_BUDGET_MS = 40;
export const SUPPORTED_AUDIO_CODECS = Object.freeze(["aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le", "pcm_f32le", "wav", "m4a"] as const);
export const AudioTrackSchema = z.strictObject({
  id: z.string().min(1).max(128),
  assetId: z.string().min(1).max(128),
  // music beds drive beat analysis; voice and sfx are labels for mixing and review.
  kind: z.enum(["music", "voice", "sfx"]).optional(),
  startMs: z.number().finite().nonnegative().max(120_000),
  offsetMs: z.number().finite().nonnegative().max(120_000).default(0),
  gain: z.number().finite().min(0).max(2).default(1),
  fadeInMs: z.number().finite().nonnegative().max(30_000).default(0),
  fadeOutMs: z.number().finite().nonnegative().max(30_000).default(0),
  duckUnder: z.strictObject({ trackId: z.string().min(1), amount: z.number().finite().min(0).max(1) }).optional(),
}).superRefine((track, ctx) => {
  if (track.duckUnder && track.duckUnder.trackId === track.id)
    ctx.addIssue({ code: "custom", path: ["duckUnder", "trackId"], message: "A track cannot duck under itself." });
});
export type AudioTrack = z.output<typeof AudioTrackSchema>;
// Sample-accurate placement: the mix starts the track on its frame gridline
// and reports the snapped time, so manifests state what FFmpeg actually used.
export function audioPlacement(track: Pick<AudioTrack, "startMs">, fps: number): { startMs: number; frame: number } {
  if (!Number.isInteger(fps) || fps <= 0) throw new Error("Frame rate must be a positive integer.");
  const frame = Math.round((track.startMs * fps) / 1000);
  return { startMs: (frame * 1000) / fps, frame };
}
export function audioDurationOk(track: Pick<AudioTrack, "fadeInMs" | "fadeOutMs">, audioMs: number): boolean {
  return track.fadeInMs + track.fadeOutMs <= audioMs;
}
