import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Scene, Surface, createSceneInspector, useSceneCapture } from "../../src/react";
import { RouteFrame } from "../../src/kit/RouteFrame";
import { readDepthSnapshot } from "../../src/react/depth/snapshot";
import { classifyDepth } from "../../src/core/depth";
import { dashboard } from "./depth-dashboard";

const params = new URLSearchParams(location.search);
const framed = params.has("iframe"), performanceFixture = params.has("performance");
const inspector = createSceneInspector();
const depth = { subject: { mode: "auto" as const } };
const pose = { perspective: Number(params.get("perspective") ?? 1450), rotateX: Number(params.get("pitch") ?? 0) };
const perfDashboard = `<main style="position:relative;width:640px;height:420px;background:#182c41">${Array.from({ length: 48 }, (_, i) =>
  `<div data-velora-tier="card" style="position:absolute;left:${i % 8 * 80 + 4}px;top:${Math.floor(i / 8) * 70 + 4}px;width:72px;height:62px;border-radius:8px;background:#277abb"></div>`).join("")}</main>`;
const hostHtml = { __html: performanceFixture ? perfDashboard : dashboard };
const circle = { width: 640, height: 420 };
const focus = params.has("focus") ? { maxBlur: 12, distance: 600 } : { maxBlur: 0 };
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
  return <div id="depth-viewport" data-velora-capture="scene">
    <Scene inspector={performanceFixture ? undefined : inspector} depth={active ? depth : undefined} camera={{ ...pose, rotateY: time / 25 - 20 }} focus={focus} style={circle}>
      <Surface id="subject" style={circle}>{framed
        ? <RouteFrame route="/tests/fixtures/depth-route.html" {...circle}/>
        : <div id="host-dashboard" dangerouslySetInnerHTML={hostHtml}/>}</Surface>
    </Scene>
    {capture && <Capture seek={setTime}/>}
  </div>;
}
createRoot(document.querySelector("#root")!).render(<Fixture/>);
