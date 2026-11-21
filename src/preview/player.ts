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
  return { ...(segment ? { segment } : {}), localMs: segment ? localTime(segment, Math.min(segment.startMs + segment.durationMs, timeMs)) : 0, ...(next ? { next } : {}) };
}
export type AudioState = { active: boolean; mediaMs: number; gain: number };
/** Track placement, linear fades and gain at a cursor; endMs is where the mix ends (composition end). */
export function audioStateAt(track: Pick<AudioTrack, "startMs" | "offsetMs" | "gain" | "fadeInMs" | "fadeOutMs" | "durationMs">, timeMs: number, endMs: number): AudioState {
  const clipEnd = track.durationMs === undefined ? endMs : Math.min(endMs, track.startMs + track.durationMs);
  const elapsed = timeMs - track.startMs;
  if (elapsed < 0 || timeMs >= clipEnd) return { active: false, mediaMs: track.offsetMs, gain: 0 };
  const fadeIn = track.fadeInMs > 0 ? Math.min(1, elapsed / track.fadeInMs) : 1;
  const fadeEnd = track.durationMs === undefined ? endMs : track.startMs + track.durationMs;
  const fadeOut = track.fadeOutMs > 0 ? Math.min(1, (fadeEnd - timeMs) / track.fadeOutMs) : 1;
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
/**
 * CSS approximation of an overlap transition for one side (A outgoing, B incoming) at eased progress.
 * The export compositor blends in linear light; the player approximates in sRGB, so mid-transition frames
 * differ slightly (documented tolerance), while both endpoints match exactly.
 */
export function blendStyle(type: string, progress: number, side: "a" | "b", direction: "left" | "right" | "up" | "down" = "right"): Record<string, string | number> {
  const p = Math.max(0, Math.min(1, progress));
  const horizontal = direction === "left" || direction === "right", sign = direction === "right" || direction === "down" ? 1 : -1;
  const axis = (fraction: number) => horizontal ? `translateX(${(fraction * 100).toFixed(2)}%)` : `translateY(${(fraction * 100).toFixed(2)}%)`;
  switch (type) {
    case "dip-to-black": case "dip-to-white":
      return side === "a" ? { opacity: p < 0.5 ? 1 - p * 2 : 0 } : { opacity: p < 0.5 ? 0 : (p - 0.5) * 2 };
    case "wipe": {
      const edge = (p * 100).toFixed(2);
      const inset = horizontal ? (sign > 0 ? `inset(0 ${(100 - p * 100).toFixed(2)}% 0 0)` : `inset(0 0 0 ${(100 - p * 100).toFixed(2)}%)`) : (sign > 0 ? `inset(0 0 ${(100 - p * 100).toFixed(2)}% 0)` : `inset(${(100 - p * 100).toFixed(2)}% 0 0 0)`);
      return side === "b" ? { clipPath: inset, "--velora-wipe": edge } : {};
    }
    case "iris": return side === "b" ? { clipPath: `circle(${(p * 75).toFixed(2)}% at 50% 50%)` } : {};
    case "push": return side === "a" ? { transform: axis(sign * p) } : { transform: axis(sign * (p - 1)) };
    case "zoom": return side === "a" ? { transform: `scale(${(1 + 0.6 * p).toFixed(3)})`, opacity: 1 - p } : { opacity: p };
    case "whip": {
      const blur = Math.sin(Math.PI * p) * 24, travel = 1 / 3;
      return side === "a" ? { opacity: p < 0.5 ? 1 : 0, transform: axis(sign * p * 2 * travel), filter: `blur(${blur.toFixed(1)}px)` }
        : { opacity: p < 0.5 ? 0 : 1, transform: axis(-sign * (1 - p) * 2 * travel), filter: `blur(${blur.toFixed(1)}px)` };
    }
    default: return side === "a" ? {} : { opacity: p };
  }
}
