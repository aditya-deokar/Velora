import { useMemo, useRef } from "react";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Mesh, MeshStandardMaterial } from "three";
import { Surface } from "@adityadeokar/velora";
import { ThreeSurface, useAnimatable3D, useGLTFClips } from "@adityadeokar/velora/three";

const modelUrl = new URL("./product-orbit.glb", import.meta.url).href;

function Product() {
  const asset = useLoader(GLTFLoader, modelUrl);
  const model = useMemo(() => {
    const scene = asset.scene.clone(true);
    const finish = scene.getObjectByName("Finish") as Mesh;
    finish.material = (finish.material as MeshStandardMaterial).clone();
    return { scene, finish, animations: asset.animations };
  }, [asset]);
  const finish = useRef(model.finish);
  useAnimatable3D(finish, "hero-mesh");
  useGLTFClips(model, "product");
  return <primitive object={model.scene}/>;
}

export default function ProductOrbit() {
  return <>
    <ThreeSurface id="product-world" camera="velora" pixelRatioCap={1}>
      <ambientLight intensity={1.25}/>
      <directionalLight color="#e1f6ff" position={[180, 240, 340]} intensity={3}/>
      <directionalLight color="#ffbc92" position={[-240, 10, -95]} intensity={2}/>
      <Product/>
    </ThreeSurface>
    <Surface id="product-caption" style={{ position: "absolute", left: 88, top: 282, width: 464, height: 50 }}
      content={<div style={{ color: "#f5f0e7", textAlign: "center", font: "600 27px Georgia, serif" }}>Forma · 01</div>}/>
  </>;
}
