import React from "react";
import { createRoot } from "react-dom/client";
import { Scene, Surface } from "../../src/react";
import { matrixFor, transformToCss, TransformSchema, type MotionInput } from "../../src/core";
// DOMMatrix parity probe for the browser spec.
(window as unknown as { velora: object }).velora = { matrixFor, transformToCss, TransformSchema };

// Motion v3 pixel fixture: ?case=pivot|skew|accent|grade&t=<ms> renders one canonical frame.
const params = new URLSearchParams(location.search);
const timeMs = Number(params.get("t") ?? 0);
const kase = params.get("case") ?? "pivot";
const linear = (from: number, to: number) => [{ timeMs: 0, value: from, easing: "linear" as const }, { timeMs: 1000, value: to }];
const blend = (from: string, to: string) => [{ timeMs: 0, value: from, easing: "linear" as const }, { timeMs: 1000, value: to }];
const motions: Record<string, MotionInput> = {
  pivot: { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "surface", id: "box" }, property: "rotateZ", keyframes: linear(0, 90) }] },
  skew: { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "surface", id: "box" }, property: "skewX", keyframes: linear(0, 30) }] },
  accent: { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "style", id: "box" }, property: "--accent", keyframes: blend("#000000", "#ff0000") }] },
  grade: { durationMs: 1000, speed: 1, tracks: [{ target: { kind: "surface", id: "box" }, property: "grayscale", keyframes: linear(0, 1) }] },
};
// The host component reads the animated variable like any CSS: no Velora API inside it.
function HostCard() {
  return <div style={{ width: 200, height: 100, background: "var(--accent, #0000ff)" }} />;
}
function Frame() {
  return (
    <Scene style={{ width: 800, height: 400 }} motion={motions[kase]} timeMs={timeMs} focus={{ maxBlur: 0 }}>
      <Surface id="box" transform={kase === "pivot" ? { originX: 0, originY: 0 } : {}} style={{ position: "absolute", left: 300, top: 150, width: 200, height: 100 }}>
        {kase === "accent" ? <HostCard /> : <div style={{ width: 200, height: 100, background: kase === "grade" ? "rgb(0, 200, 0)" : "rgb(255, 0, 0)" }} />}
      </Surface>
    </Scene>
  );
}
createRoot(document.getElementById("root")!).render(<Frame />);
