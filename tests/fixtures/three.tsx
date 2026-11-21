import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { createRoot } from "react-dom/client";
import { useRef } from "react";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Vector3, type Mesh } from "three";
import { Surface, type PreviewDefinitionInput } from "../../src";
import { SceneLibrary, ScenePreview } from "../../src/preview";
import { Animated, ThreeSurface, useAnimatable3D, useSceneClock } from "../../src/three";
import ProductOrbit from "../../local-project/src/velora/scenes/product-orbit";
import orbitRecipe from "../../local-project/src/velora/scenes/product-orbit.scene.json";

const query = new URLSearchParams(location.search);
const track = (id: string, from: number, to: number) => ({
  target: { kind: "channel" as const, id }, property: "value" as const,
  keyframes: [{ timeMs: 0, value: from, easing: "linear" as const }, { timeMs: 2000, value: to }],
});
const definition: PreviewDefinitionInput = {
  width: 640, height: 360,
  scene: {
    camera: { perspective: 650 }, focus: { maxBlur: 0 },
    nodes: [{ id: "world" }, { id: "marker" }],
    constraints: query.has("anchor") ? [{ kind: "lookAt", target: { three: "hero-mesh" } }] : [],
  },
  motion: { durationMs: 2000, speed: 1, tracks: [
    { target: { kind: "camera" }, property: "x", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 2000, value: 100 }] },
    track("three:hero-mesh.position.x", 0, 50),
    track("three:hero-mesh.rotation.y", 0, 55),
  ] },
};
const recipe = { id: "mesh", version: 1, title: "3D editor", definition };
const probe: Array<{ t: number; seconds: number; seed: number; absolute: number; material: string; x: number; markerX: number; markerY: number }> = [];
Object.assign(window, { threeFrames: probe });

function Hero() {
  const hero = useRef<Mesh>(null);
  const marker = useRef<Mesh>(null);
  // Intentionally observe R3F's raw timestamp here to pin the installed API, never to animate.
  const clock = useSceneClock();
  const camera = useThree(state => state.camera);
  useAnimatable3D(marker, "marker");
  useFrame(state => {
    const point = marker.current!.getWorldPosition(new Vector3()).project(camera);
    probe.push({ ...clock, absolute: state.clock.elapsedTime, x: hero.current!.position.x,
      material: hero.current!.name, markerX: (point.x + 1) / 2, markerY: (1 - point.y) / 2 });
  });
  return <>
    <Animated id="hero-mesh"><mesh ref={hero} name="Hero mesh">
      <boxGeometry args={[98, 98, 98]}/><meshStandardMaterial color="#32c5e8"/>
    </mesh></Animated>
    <mesh ref={marker} name="Projection marker" position={[120, -22, 0]}>
      <sphereGeometry args={[3, 12, 12]}/><meshBasicMaterial color="#ff00ff"/>
    </mesh>
  </>;
}

function BrokenModel() {
  useLoader(GLTFLoader, "/missing-product.glb");
  return null;
}
function MeshScene() {
  return <>
    <ThreeSurface id="world" camera="velora" seed={99}>
      <ambientLight intensity={2}/>
      <directionalLight intensity={2} position={[0, 200, 200]}/>
      {query.has("broken") ? <BrokenModel/> : <Hero/>}
    </ThreeSurface>
    <Surface id="marker" style={{ position: "absolute", left: 438, top: 200, width: 4, height: 4 }}
      content={<div data-marker style={{ width: 4, height: 4 }}/>} />
  </>;
}
const saved = query.get("definition");
const root = createRoot(document.getElementById("root")!);
if (query.has("orbit")) {
  root.render(query.has("velora-edit")
    ? <SceneLibrary sources={{ "src/velora/scenes/product-orbit.scene.json": orbitRecipe }}
        bindings={{ "src/velora/scenes/product-orbit.tsx": ProductOrbit }}/>
    : <ScenePreview title="Product orbit" definition={orbitRecipe.definition as PreviewDefinitionInput}><ProductOrbit/></ScenePreview>);
} else if (query.has("velora-edit")) {
  root.render(<SceneLibrary sources={{ "src/velora/scenes/mesh.scene.json": recipe }} bindings={{ "src/velora/scenes/mesh.tsx": MeshScene }}/>);
} else {
  root.render(<ScenePreview definition={saved ? JSON.parse(saved) : definition}><MeshScene/></ScenePreview>);
}
