import { segmentAt, localTime, type AudioTrack, type CaptionCue, type Timeline, type TimelineSegment } from "../core";

/** SOURCE OF TRUTH: playerFrame, audioStateAt, syncMedia, AUDIO_RESYNC_MS.
 * WHAT: pure cursor → (active segment, scene-local time, next segment to preload) mapping, the
 * deterministic gain/fade/media time of an audio track at a cursor, and drift-corrected media sync.
 * WHY: the composition player has one clock (the preview session cursor); audio elements follow it,
 * they never drive it, and every value is reproducible from the cursor alone.
 * WHERE: CompositionPlayer renders from these; tests drive them with fake media elements.
 */
export const AUDIO_RESYNC_MS = 50;
export type PlayerFrame = { segment?: TimelineSegment; localMs: number; next?: TimelineSegment };
export function playerFrame(timeline: Pick<Timeline, "segments" | "durationMs">, timeMs: number): PlayerFrame {
  const ordered = [...timeline.segments].sort((a, b) => a.startMs - b.startMs);
  // The final instant of the timeline still shows the last segment's end frame.
  const last = ordered[ordered.length - 1];
  const segment = segmentAt(timeline, timeMs) ?? (last && timeMs >= last.startMs + last.durationMs && timeMs <= timeline.durationMs && timeMs - (last.startMs + last.durationMs) < 1e-6 ? last : undefined);
  const next = ordered.find(candidate => candidate.startMs >= (segment ? segment.startMs + segment.durationMs : timeMs) && candidate !== segment);
  return { ...(segment ? { segment } : {}), localMs: segment ? Math.min(segment.durationMs, localTime(segment, timeMs)) : 0, ...(next ? { next } : {}) };
}
export type AudioState = { active: boolean; mediaMs: number; gain: number };
/** Track placement, linear fades and gain at a cursor; endMs is where the mix ends (composition end). */
export function audioStateAt(track: Pick<AudioTrack, "startMs" | "offsetMs" | "gain" | "fadeInMs" | "fadeOutMs">, timeMs: number, endMs: number): AudioState {
  const elapsed = timeMs - track.startMs;
  if (elapsed < 0 || timeMs >= endMs) return { active: false, mediaMs: track.offsetMs, gain: 0 };
  const fadeIn = track.fadeInMs > 0 ? Math.min(1, elapsed / track.fadeInMs) : 1;
  const fadeOut = track.fadeOutMs > 0 ? Math.min(1, (endMs - timeMs) / track.fadeOutMs) : 1;
  return { active: true, mediaMs: track.offsetMs + elapsed, gain: Math.max(0, Math.min(1, track.gain * fadeIn * fadeOut)) };
}
export type MediaLike = { currentTime: number; volume: number; paused: boolean; playbackRate: number; play(): Promise<void> | void; pause(): void };
/** Apply an audio state: resync only when drift exceeds the budget; audio plays only forward at 1x. */
export function syncMedia(media: MediaLike, state: AudioState, playing: boolean, rate: number): "resync" | "ok" {
  media.volume = state.gain > 1 ? 1 : state.gain;
  const audible = playing && rate === 1 && state.active;
  let result: "resync" | "ok" = "ok";
  if (Math.abs(media.currentTime * 1000 - state.mediaMs) > AUDIO_RESYNC_MS) { media.currentTime = state.mediaMs / 1000; result = "resync"; }
  if (audible && media.paused) void Promise.resolve(media.play()).catch(() => {});
  else if (!audible && !media.paused) media.pause();
  return result;
}
export function activeCue(cues: readonly CaptionCue[], timeMs: number): CaptionCue | undefined {
  return cues.find(cue => timeMs >= cue.startMs && timeMs < cue.endMs);
}
