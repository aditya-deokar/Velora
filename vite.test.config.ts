import { defineConfig, mergeConfig } from 'vite';
import config from './vite.config';
// Browser-only fixtures never enter the product's production build.
export default mergeConfig(config,defineConfig({publicDir:'tests/preview/public',build:{outDir:'.test-dist',rollupOptions:{input:{app:'index.html',focus:'tests/fixtures/focus.html',motion:'tests/fixtures/motion.html',motionV3:'tests/fixtures/motion-v3.html',preview:'tests/preview/fixture.html'}}}}));
