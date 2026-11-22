import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist/library",
    emptyOutDir: true,
    lib: { entry: { index: "src/index.ts", preview: "src/preview/index.tsx", kit: "src/kit/index.ts", three: "src/three/index.ts" }, formats: ["es"], fileName: (_format, name) => `${name}.js` },
    rollupOptions: {
      output: { banner: '"use client";', sourcemapExcludeSources: true },
      external: ["react", "react-dom", "react/jsx-runtime", "react-error-boundary", "zod", "@react-three/fiber", /^three(?:\/|$)/],
    },
    sourcemap: true,
  },
});
