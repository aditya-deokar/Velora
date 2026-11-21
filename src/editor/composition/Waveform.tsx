import { memo, useMemo } from "react";
import type { MediaPeaks } from "../../core";

export const Waveform = memo(function Waveform({ media, offsetMs, durationMs }: { media: MediaPeaks; offsetMs: number; durationMs: number }) {
  const path = useMemo(() => {
    const bytes = atob(media.peaks);
    const start = Math.floor(offsetMs / media.bucketMs);
    const count = Math.max(1, Math.ceil(durationMs / media.bucketMs));
    const columns = Math.min(640, count);
    let path = "";
    for (let x = 0; x < columns; x++) {
      const from = start + Math.floor(x * count / columns), to = start + Math.floor((x + 1) * count / columns);
      let low = 255, high = 0;
      for (let i = from; i < to && i * 2 + 1 < bytes.length; i++) {
        low = Math.min(low, bytes.charCodeAt(i * 2));
        high = Math.max(high, bytes.charCodeAt(i * 2 + 1));
      }
      if (low <= high) path += `M${Math.round(x * 640 / columns)} ${255 - high}V${255 - low}`;
    }
    return path;
  }, [media, offsetMs, durationMs]);
  return <svg className="vc-waveform" data-waveform="" viewBox="0 0 640 255" preserveAspectRatio="none" aria-hidden="true">
    <path d={path} stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
  </svg>;
});
