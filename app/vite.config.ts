import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Bridge pandoc.wasm out of the pandoc-wasm package without going through its
// strict `exports` field. Dev mode serves the wasm via middleware at a stable
// URL; build mode emits it as a hashed asset and exposes the URL through a
// virtual module so app code stays free of build-vs-dev branching.
function pandocWasmPlugin(): Plugin {
  const wasmPath = resolve("node_modules/pandoc-wasm/src/pandoc.wasm");
  const VIRT_ID = "virtual:pandoc-wasm-url";
  const RESOLVED = "\0" + VIRT_ID;
  let isBuild = false;

  return {
    name: "slipway:pandoc-wasm",
    config(_userConfig, env) {
      isBuild = env.command === "build";
    },
    resolveId(id) {
      if (id === VIRT_ID) return RESOLVED;
      return null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      if (isBuild) {
        const ref = this.emitFile({
          type: "asset",
          name: "pandoc.wasm",
          source: readFileSync(wasmPath),
        });
        return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
      }
      return `export default "/pandoc.wasm";`;
    },
    configureServer(server) {
      server.middlewares.use("/pandoc.wasm", (_req, res) => {
        try {
          const stat = statSync(wasmPath);
          res.setHeader("Content-Type", "application/wasm");
          res.setHeader("Content-Length", String(stat.size));
          res.end(readFileSync(wasmPath));
        } catch (e) {
          res.statusCode = 404;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  // Relative base so the built app works at any path (GitHub Pages, /slipway/, etc).
  base: "./",
  plugins: [
    pandocWasmPlugin(),
    VitePWA({
      // Service worker is registered by the virtual module imported in main.ts.
      registerType: "autoUpdate",
      // Keep the hand-crafted manifest.webmanifest in public/ as-is.
      manifest: false,
      workbox: {
        // Include every file type the build emits.
        globPatterns: ["**/*.{js,css,html,wasm,png,svg,ico,webmanifest}"],
        // pandoc.wasm is ~56 MB; Workbox's default 2 MB cap would silently
        // exclude it from the precache, leaving rendering broken offline.
        maximumFileSizeToCacheInBytes: 100 * 1024 * 1024,
        // Cache-first for everything in the precache list (app shell + wasm).
        // Runtime requests (none expected in normal operation) fall through.
        navigateFallback: "index.html",
      },
    }),
  ],
  build: {
    target: "esnext",
    sourcemap: true,
    // Never inline assets — pandoc.wasm is huge and must stay as a separate file.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 60_000,
  },
  worker: {
    format: "es",
  },
  assetsInclude: ["**/*.qmd", "**/*.bib"],
});
