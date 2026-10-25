import React from "react";
import { createRoot } from "react-dom/client";
import { Scene, Surface } from "../../src/react";
import type { MotionInput } from "../../src/core";

// Motion v2 pixel fixture: ?shot=dolly|wipe&t=<ms> renders one canonical frame.
const params = new URLSearchParams(location.search);
const timeMs = Number(params.get("t") ?? 0);
const linear = (from: number, to: number) => [{ timeMs: 0, value: from, easing: "linear" as const }, { timeMs: 1000, value: to }];
const shots: Record<string, MotionInput> = {
  // Perspective widens while the subject stays on the projection plane: its size holds, the background stretches away.
  dolly: { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "camera" }, property: "perspective", keyframes: linear(3600, 1200) }] },
  // A true inset mask: the right edge closes from 100% to 0%.
  wipe: { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "surface", id: "panel" }, property: "clipRight", keyframes: linear(100, 0) }] },
};
const shot = params.get("shot") ?? "dolly";
function Frame() {
  return (
    <Scene style={{ width: 800, height: 400 }} motion={shots[shot]} timeMs={timeMs} focus={{ maxBlur: 0 }}>
      {shot === "dolly" ? (<>
        <Surface id="background" transform={{ z: -600 }} style={{ position: "absolute", left: 100, top: 50, width: 600, height: 300 }}>
          <div style={{ width: 600, height: 300, background: "rgb(0, 0, 255)" }} />
        </Surface>
        <Surface id="subject" style={{ position: "absolute", left: 350, top: 150, width: 100, height: 100 }}>
          <div style={{ width: 100, height: 100, background: "rgb(255, 0, 0)" }} />
        </Surface>
      </>) : (
        <Surface id="panel" style={{ position: "absolute", left: 200, top: 100, width: 400, height: 200 }}>
          <div style={{ width: 400, height: 200, background: "rgb(0, 255, 0)" }} />
        </Surface>
      )}
    </Scene>
  );
}
createRoot(document.getElementById("root")!).render(<Frame />);
