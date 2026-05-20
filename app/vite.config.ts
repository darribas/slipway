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

// Bundle KaTeX JS + CSS (with all fonts inlined as data URIs) into a virtual
// module so the render pipeline can inline them into every deck, giving full
// offline math rendering without any CDN dependency.
//
// Pandoc emits two CDN tags when html-math-method=katex:
//   <script src="https://cdn.jsdelivr.net/npm/katex@latest/dist/katex.min.js">
//   <link  href="https://cdn.jsdelivr.net/npm/katex@latest/dist/katex.min.css">
// inlineKatexAssets() in inline-assets.ts replaces both with inline blocks.
//
// The fonts: katex.min.css references them as url(fonts/NAME.woff2). Because
// the deck renders in a sandboxed srcdoc iframe (null origin), relative URLs
// don't resolve. We read every .woff2 at build time, base64-encode them, and
// substitute data URIs directly into the CSS. The woff/ttf fallbacks are then
// stripped — woff2 is universally supported and keeping dead relative URLs
// would just add noise.
function katexInlinePlugin(): Plugin {
  const VIRT_ID = "virtual:katex-inlined";
  const RESOLVED = "\0" + VIRT_ID;
  const katexDist = resolve("node_modules/katex/dist");

  let cachedModule: string | null = null;

  function buildModule(): string {
    if (cachedModule) return cachedModule;

    const js = readFileSync(resolve(katexDist, "katex.min.js"), "utf8");

    // Read and base64-encode every woff2 font file.
    const fontsDir = resolve(katexDist, "fonts");
    const fontMap = new Map<string, string>();
    for (const file of readdirSync(fontsDir)) {
      if (!file.endsWith(".woff2")) continue;
      const data = readFileSync(resolve(fontsDir, file));
      fontMap.set(file, data.toString("base64"));
    }

    // Replace url(fonts/NAME.woff2) with data URIs, then strip woff/ttf
    // fallback entries so no broken relative URLs remain.
    let css = readFileSync(resolve(katexDist, "katex.min.css"), "utf8");
    css = css.replace(/url\(fonts\/(KaTeX_[^)]+\.woff2)\)/g, (_match, file) => {
      const b64 = fontMap.get(file);
      return b64 ? `url(data:font/woff2;base64,${b64})` : _match;
    });
    // Strip ,url(fonts/...) format("woff") and format("truetype") fallbacks.
    css = css.replace(/,url\(fonts\/[^)]+\.(woff|ttf)\)\s*format\("[^"]+"\)/g, "");

    cachedModule = `export const js = ${JSON.stringify(js)};\nexport const css = ${JSON.stringify(css)};\n`;
    return cachedModule;
  }

  return {
    name: "slipway:katex-inline",
    resolveId(id) { return id === VIRT_ID ? RESOLVED : null; },
    load(id) { return id === RESOLVED ? buildModule() : null; },
  };
}

export default defineConfig({
  // Relative base so the built app works at any path (GitHub Pages, /slipway/, etc).
  base: "./",
  plugins: [
    pandocWasmPlugin(),
    katexInlinePlugin(),
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
