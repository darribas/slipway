import { readFileSync, readdirSync, statSync } from "node:fs";
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

// The renderer's third-party assets (reveal.js, its plugins and themes,
// KaTeX with inlined fonts, reveal's compiled print CSS) used to come from
// two more virtual-module plugins plus `?raw` imports. They are now a plain
// generated TS module — see scripts/gen-assets.mjs — so the renderer has no
// bundler-specific imports.

// Bundle the seed deck's binary font files (woff2/woff/ttf/otf under
// src/templates/slipway-demo/assets/fonts/) into a virtual module as base64,
// keyed by their project-relative path. seedIfEmpty() decodes these and writes
// them into IDB so a first-run project ships with the Imago/Journal fonts in
// place — no network fetch, works offline. The render pipeline then re-inlines
// them as data URIs at render time (see inlineFontUrls).
function seedFontsPlugin(): Plugin {
  const VIRT_ID = "virtual:seed-fonts";
  const RESOLVED = "\0" + VIRT_ID;
  const seedRoot = resolve("src/templates/slipway-demo");
  const fontsDir = resolve(seedRoot, "assets/fonts");
  const FONT_RE = /\.(woff2|woff|ttf|otf)$/i;

  function collect(dir: string, out: Map<string, string>): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // no fonts dir yet — emit an empty map
    }
    for (const name of entries) {
      const full = resolve(dir, name);
      if (statSync(full).isDirectory()) {
        collect(full, out);
      } else if (FONT_RE.test(name)) {
        const rel = full.slice(seedRoot.length + 1).split("\\").join("/");
        out.set(rel, readFileSync(full).toString("base64"));
      }
    }
  }

  function buildModule(): string {
    const map = new Map<string, string>();
    collect(fontsDir, map);
    const obj = Object.fromEntries(map);
    return `export default ${JSON.stringify(obj)};\n`;
  }

  return {
    name: "slipway:seed-fonts",
    resolveId(id) { return id === VIRT_ID ? RESOLVED : null; },
    load(id) { return id === RESOLVED ? buildModule() : null; },
  };
}

export default defineConfig({
  // Relative base so the built app works at any path (GitHub Pages, /slipway/, etc).
  base: "./",
  plugins: [
    pandocWasmPlugin(),
    seedFontsPlugin(),
    VitePWA({
      // Service worker is registered by the virtual module imported in main.ts.
      // "prompt" fires onNeedRefresh when a new SW is waiting, giving the app
      // a chance to show the update button before reloading. "autoUpdate" would
      // silently swap the SW with no user signal.
      registerType: "prompt",
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
        // The same Pages site also serves the VS Code extension (/vscode/)
        // and the CLI download (/cli/). They are not part of the app: never
        // answer a navigation there with the app shell.
        navigateFallbackDenylist: [/\/vscode\//, /\/cli\//],
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
  server: {
    // @slipway/core is a `file:../core` dependency: npm symlinks it, Vite
    // resolves the symlink to ../core/src, and the dev server refuses to
    // serve files outside the project root unless they are allow-listed.
    fs: { allow: [".", "../core"] },
  },
  assetsInclude: ["**/*.qmd", "**/*.bib"],
});
