import type { CSSProperties, ReactNode } from "react";
import { useChannel } from "../react";

/** ScrollFrame: scrolls a tall component inside a fixed viewport from a channel track.
 * WHAT: a clipped viewport whose content translates by the channel value (pixels).
 * WHY: component-mode scroll-through shots replay exactly from the scene clock.
 * WHERE: template bindings wrap --component subjects for scroll-through.
 */
export function ScrollFrame({ channel, width, height, children, style }: { channel: string; width: number; height: number; children?: ReactNode; style?: CSSProperties }) {
  const offset = useChannel(channel, 0);
  return (
    <div style={{ width, height, overflow: "hidden", position: "relative", ...style }}>
      <div style={{ transform: `translateY(${-offset}px)`, width }}>{children}</div>
    </div>
  );
}
