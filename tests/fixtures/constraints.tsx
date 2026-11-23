import React from "react";
import { createRoot } from "react-dom/client";
import { Scene, Surface } from "../../src/react";
import { buildOrbitRig, type MotionInput } from "../../src/core";

// Constraint fixture: ?t=<ms> renders one frame of an orbit rig with follow focus around a portrait.
const timeMs = Number(new URLSearchParams(location.search).get("t") ?? 0);
const rig = buildOrbitRig({ radius: 900, fromDeg: -30, toDeg: 30, height: 120, perspective: 1400, durationMs: 2000, ease: "cinematic" });
const motion = { durationMs: 2000, speed: 1, tracks: [], clips: [rig.clip] } as unknown as MotionInput;
function Frame() {
  return (
    <Scene style={{ width: 800, height: 400 }} camera={{ perspective: 1400 }} focus={{ distance: 1400, fStop: 1.4, focalLength: 85, maxBlur: 8 }}
      constraints={[rig.constraint, { kind: "focusFollow", target: { surface: "subject" } }]} motion={motion} timeMs={timeMs}>
      <Surface id="subject" style={{ position: "absolute", left: 340, top: 140, width: 120, height: 120 }}>
        <div style={{ position: "relative", width: 120, height: 120, background: "rgb(255, 0, 0)" }}>
          {/* A 6 px marker at the subject center: its projection must land at frame center. */}
          <div style={{ position: "absolute", left: 57, top: 57, width: 6, height: 6, background: "rgb(0, 255, 0)" }} />
        </div>
      </Surface>
    </Scene>
  );
}
createRoot(document.getElementById("root")!).render(<Frame />);
