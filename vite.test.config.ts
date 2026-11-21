import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from 'vite';
import config from './vite.config';
// Browser-only fixtures never enter the product's production build.
export default mergeConfig(config,defineConfig({publicDir:'tests/preview/public',resolve:{dedupe:["react","react-dom","@react-three/fiber","three"],alias:[
  {find:"@adityadeokar/velora/three",replacement:fileURLToPath(new URL("./src/three/index.ts",import.meta.url))},
  {find:/^@adityadeokar\/velora$/,replacement:fileURLToPath(new URL("./src/index.ts",import.meta.url))},
]},build:{outDir:'.test-dist',rollupOptions:{input:{app:'index.html',focus:'tests/fixtures/focus.html',motion:'tests/fixtures/motion.html',motionV3:'tests/fixtures/motion-v3.html',constraints:'tests/fixtures/constraints.html',preview:'tests/preview/fixture.html',three:'tests/fixtures/three.html',depth:'tests/fixtures/depth.html',depthRoute:'tests/fixtures/depth-route.html'}}}}));
