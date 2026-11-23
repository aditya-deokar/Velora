import { useState } from "react";
import { createRoot } from "react-dom/client";
import { buildOrbitRig, perspectiveForFocalLength, type MotionInput, type SceneConstraintInput } from "../../src/core";
import { Scene, Surface, useSceneCapture } from "../../src/react";

const target = { surface: "subject", anchor: "pricing-cta" };
const perspective = perspectiveForFocalLength(200, 400);
const rig = buildOrbitRig({ radius: 2900, fromDeg: -24, toDeg: 24, height: 160, perspective, durationMs: 1000, target });
const motion: MotionInput = { durationMs: 1000, speed: 1, tracks: [], clips: [rig.clip] };
const constraints: SceneConstraintInput[] = [rig.constraint, { kind: "focusFollow", target }];

function Fixture() {
  const [timeMs, seek] = useState(0);
  useSceneCapture({ durationMs: 1000, seek });
  return <div data-velora-capture="scene" style={{ width: 800, height: 400 }}>
    <Scene camera={{ perspective }} focus={{ focalLength: 420, fStop: 1.4 }} timeMs={timeMs} motion={motion} constraints={constraints}
      style={{ width: 800, height: 400, backgroundColor: "#17141c" }}>
      <Surface id="subject" style={{ position: "absolute", left: 270, top: 105, width: 260, height: 190 }}>
        <div data-layout style={{ position: "absolute", left: 20, top: 23, width: 195, height: 144, border: "3px solid #96939e", backgroundColor: "#22202a" }}>
          <button data-velora-anchor="pricing-cta" style={{ position: "absolute", left: 121, top: 76, width: 52, height: 28, padding: 0, border: 0, backgroundColor: "#000", color: "#fff", textAlign: "left" }}>
            Price<svg data-probe width="10" height="10" aria-hidden style={{ position: "absolute", top: "50%", left: "50%", margin: "-5px" }}>
              <circle cx="5" cy="5" r="0.5" fill="#0f0"/>
            </svg>
          </button>
        </div>
      </Surface>
    </Scene>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
