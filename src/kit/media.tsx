import { useEffect, useRef, type CSSProperties } from "react";
import { useCaptureSettle, useSceneTime } from "../react";

/** SOURCE OF TRUTH: VideoClip, ImageLayer.
 * WHAT: a video asset seeked to scene time on every frame (screen replacement on a 3D plane) and a
 * decoded image layer; both settle before capture (seeked / decoded) so exports never grab a stale frame.
 * WHY: real screen recordings drop onto cinematic planes without their own clock: the scene drives
 * currentTime, playback never runs.
 * WHERE: inside a Surface; `src` is a URL the host serves (for example an import of an asset).
 */
export function VideoClip({ src, width, height, startMs = 0, offsetMs = 0, rate = 1, loop = false, fit = "cover", style }: { src: string; width: number; height: number; startMs?: number; offsetMs?: number; rate?: number; loop?: boolean; fit?: CSSProperties["objectFit"]; style?: CSSProperties }) {
  const time = useSceneTime();
  const video = useRef<HTMLVideoElement>(null);
  const target = Math.max(0, (time - startMs) * rate + offsetMs) / 1000;
  const seekTo = (element: HTMLVideoElement) => {
    const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : undefined;
    const wanted = duration === undefined ? target : loop ? target % duration : Math.min(target, Math.max(0, duration - 0.001));
    if (Math.abs(element.currentTime - wanted) > 0.0005) element.currentTime = wanted;
    return wanted;
  };
  useEffect(() => { if (video.current && video.current.readyState >= 1) seekTo(video.current); });
  // Capture waits for metadata, the seek and a decoded frame at the new time.
  useCaptureSettle(() => {
    const element = video.current;
    if (!element) return;
    return new Promise<void>(resolve => {
      const done = () => { element.removeEventListener("seeked", done); resolve(); };
      const run = () => {
        const wanted = seekTo(element);
        if (!element.seeking && Math.abs(element.currentTime - wanted) <= 0.0005 && element.readyState >= 2) return resolve();
        element.addEventListener("seeked", done);
        setTimeout(done, 3000);
      };
      if (element.readyState >= 1) run();
      else element.addEventListener("loadedmetadata", run, { once: true });
    });
  });
  return <video data-velora-video="" ref={video} src={src} muted playsInline preload="auto" width={width} height={height}
    onLoadedMetadata={event => seekTo(event.currentTarget)}
    style={{ display: "block", width, height, objectFit: fit, background: "#000", ...style }}/>;
}
export function ImageLayer({ src, width, height, alt = "", fit = "cover", style }: { src: string; width: number; height: number; alt?: string; fit?: CSSProperties["objectFit"]; style?: CSSProperties }) {
  const image = useRef<HTMLImageElement>(null);
  useCaptureSettle(() => image.current?.decode().catch(() => undefined));
  return <img data-velora-image="" ref={image} src={src} alt={alt} width={width} height={height} decoding="sync" style={{ display: "block", width, height, objectFit: fit, ...style }}/>;
}
