import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the site under /<repository>/: the deploy workflow passes `vite build --base`.
export default defineConfig({ plugins: [react()] });
