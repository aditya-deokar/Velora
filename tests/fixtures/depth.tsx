import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Scene, Surface, createSceneInspector, useSceneCapture } from "../../src/react";
import { RouteFrame } from "../../src/kit/RouteFrame";
import { readDepthSnapshot } from "../../src/react/depth/snapshot";
import { classifyDepth } from "../../src/core/depth";
import { buildRackFocus } from "../../src/core/shots";
import { framingDistance, lensPreset } from "../../src/core/lens";
import { STAGE_PRESETS } from "../../src/core/stage";
import { applyEdits } from "../../src/core/edit";
import { dashboard, opticsBoard } from "./depth-dashboard";

const params = new URLSearchParams(location.search);
const framed = params.has("iframe"), performanceFixture = params.has("performance");
const rack = params.has("rack");
const compression = params.get("compression");
const inspector = createSceneInspector();
const depth = { subject: { mode: "auto" as const, ...(rack ? { intensity: "dramatic" as const, light: { sheen: 0 } } : {}) } };
const pose = { perspective: Number(params.get("perspective") ?? 1450), rotateX: Number(params.get("pitch") ?? 0) };
const perfDashboard = `<main style="position:relative;width:640px;height:420px;background:#182c41">${Array.from({ length: 48 }, (_, i) =>
  `<div data-velora-tier="card" style="position:absolute;left:${i % 8 * 80 + 4}px;top:${Math.floor(i / 8) * 70 + 4}px;width:72px;height:62px;border-radius:8px;background:#277abb"></div>`).join("")}</main>`;
const hostHtml = { __html: performanceFixture ? perfDashboard : rack ? opticsBoard : dashboard };
const circle = { width: 640, height: 420 };
const cinemaLens = lensPreset("200mm-telephoto", { frameHeight: circle.height, stage: STAGE_PRESETS["laptop-14"] });
const z = framingDistance(cinemaLens.perspective, circle, circle, 0.78);
const focusDistance = cinemaLens.perspective + z;
const clip = buildRackFocus({ from: { depth: focusDistance - 192 }, to: { depth: focusDistance - 48 }, atMs: 0, durationMs: 1000,
  breathing: { amount: cinemaLens.breathing, direction: "in" } });
const rackMotion = { durationMs: 1000, speed: 1, tracks: [], clips: [clip] };
const focus = rack ? { ...cinemaLens.focus, fStop: 1.4, distance: focusDistance }
  : params.has("focus") ? { maxBlur: 12, distance: 600 } : { maxBlur: 0 };
const compressionRecipe = { version: 1, id: "compression", title: "Compression", definition: { ...circle, scene: {
  camera: { perspective: 420, z: 210, x: -220, y: -170, rotateX: 21, rotateY: 27 }, nodes: [{ id: "subject" }],
} } };
const heldLens = compression === "tele" ? applyEdits(compressionRecipe, [{ op: "lens.apply", preset: "200mm-telephoto" }]) : undefined;
const compressionCamera = heldLens?.ok ? (heldLens.recipe as typeof compressionRecipe).definition.scene.camera : compressionRecipe.definition.scene.camera;
function Capture({ seek }: { seek(ms: number): void }) {
  useSceneCapture({ durationMs: 1000, seek });
  return null;
}
function Fixture() {
  const [active, setActive] = useState(!params.has("flat"));
  const [time, setTime] = useState(0);
  const [capture, setCapture] = useState(true);
  useLayoutEffect(() => {
    Object.assign(window, { depthFixture: {
      active: (value: boolean) => flushSync(() => setActive(value)),
      capture: (value: boolean) => flushSync(() => setCapture(value)),
      seek: (ms: number) => flushSync(() => setTime(ms)),
      read: () => inspector.snapshot(),
      classify: () => {
        const container = document.createElement("div");
        container.style.cssText = "position:absolute;left:-2000px;width:1500px;height:1000px";
        container.innerHTML = `<div style="display:flex;flex-wrap:wrap">${"<div style='width:30px;height:30px'>tile</div>".repeat(1999)}</div>`;
        document.body.append(container);
        const { snapshot } = readDepthSnapshot(container, depth.subject);
        const start = performance.now();
        for (let i = 0; i < 15; i++) classifyDepth(snapshot, depth.subject);
        const ms = (performance.now() - start) / 15;
        container.remove();
        return { ms, nodes: snapshot.nodes.length };
      },
    } });
  }, []);
  if (compression) return <Scene camera={compressionCamera} focus={{ maxBlur: 0 }} style={circle}>
    <Surface id="subject" style={{ position: "absolute", left: 295, top: 180, width: 50, height: 60 }}>
      <div style={{ position: "relative", width: 50, height: 60, background: "#488bc2" }}>
        {[[0, 0], [50, 0], [50, 60], [0, 60]].map(([left, top], index) => <i key={index} data-optics-corner="" style={{ position: "absolute", left, top }} />)}
      </div>
    </Surface>
  </Scene>;
  return <div id="depth-viewport" data-velora-capture="scene">
    <Scene inspector={performanceFixture ? undefined : inspector} depth={active ? depth : undefined} camera={rack ? { perspective: cinemaLens.perspective, z } : { ...pose, rotateY: time / 25 - 20 }}
      focus={focus} style={circle} {...(rack ? { motion: rackMotion, timeMs: time } : {})}>
      <Surface id="subject" style={circle}>{framed
        ? <RouteFrame route={`/tests/fixtures/depth-route.html${rack ? "?optics" : ""}`} {...circle}/>
        : <div id="host-dashboard" dangerouslySetInnerHTML={hostHtml}/>}</Surface>
    </Scene>
    {capture && <Capture seek={setTime}/>}
  </div>;
}
createRoot(document.querySelector("#root")!).render(<Fixture/>);
