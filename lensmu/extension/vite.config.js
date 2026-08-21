// VisionTranslate — Vite build config
//
// Builds the React popup. The webpage overlay is implemented by content.js
// and overlay.js directly, so there is intentionally no second React bundle.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

function popupConfig() {
  return defineConfig({
    plugins: [react()],
    // Relative paths so the extension can resolve assets from the HTML file.
    base: './',
    root: resolve(import.meta.dirname, "src/popup"),
    build: {
      outDir: resolve(import.meta.dirname, "dist/popup"),
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

export default popupConfig();
