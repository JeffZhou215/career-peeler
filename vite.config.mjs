import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// background.js/content.js/genericAutofill/*.js/lib/core.js are deliberately left as plain,
// unbundled scripts -- see vite.config.js's header comment in the plan doc for why. background.js
// uses importScripts("lib/core.js"), a classic (non-module) service-worker API that throws if Vite/
// CRXJS-style tooling bundles the worker as type:"module" (which is required for any ESM-processed
// entry) -- so these files must never be treated as Vite build inputs, only copied through verbatim.
const STATIC_COPY_ENTRIES = [
  "background.js",
  "content.js",
  "genericAutofill",
  "lib",
  "icons",
  "manifest.json",
  "PRIVACY.md"
];

function copyStaticExtensionFiles() {
  return {
    name: "copy-static-extension-files",
    apply: "build",
    closeBundle() {
      const outDir = path.join(__dirname, "dist");

      for (const entry of STATIC_COPY_ENTRIES) {
        fs.cpSync(path.join(__dirname, entry), path.join(outDir, entry), { recursive: true });
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), copyStaticExtensionFiles()],
  build: {
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, "sidepanel.html")
      },
      output: {
        // Stable, unhashed filenames -- this output is loaded directly as an unpacked extension
        // (not served with cache-busting semantics), and stable names make dist/ easier to inspect.
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
