// VisionTranslate — Vite build config
//
// Two build targets (BUILD_TARGET env var):
//   popup   -> dist/popup/   (React popup UI)
//   overlay -> dist/         (single-file IIFE injected by content.js)

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const buildTarget = process.env.BUILD_TARGET || "popup";

function popupConfig() {
  return defineConfig({
    plugins: [react()],
    // Relative paths so the extension can resolve assets from the HTML file.
    base: './',
    root: resolve(__dirname, "src/popup"),
    build: {
      outDir: resolve(__dirname, "dist/popup"),
      emptyOutDir: true,
      // Stable file names (no hashes) because manifest.json refs them by name.
      rollupOptions: {
        output: {
          entryFileNames: "popup.js",
          chunkFileNames: "popup-[name].js",
          assetFileNames: "popup.[ext]",
        },
      },
      sourcemap: false,
    },
  });
}

function overlayConfig() {
  return defineConfig({
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, "dist"),
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, "src/content-overlay/index.jsx"),
        formats: ["iife"],
        fileName: () => "content-overlay.js",
        name: "VisionTranslateOverlay",
      },
      rollupOptions: {
        output: {
          // Content scripts can't load separate chunks.
          inlineDynamicImports: true,
          assetFileNames: "content-overlay.[ext]",
        },
      },
      cssCodeSplit: false,
      target: "es2020",
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });
}

export default buildTarget === "overlay" ? overlayConfig() : popupConfig();
