// Bundle the CLI into one file, dist/slipway.mjs, and put pandoc.wasm next to
// it. The bundle has no runtime dependencies: @slipway/core (TypeScript
// source), Dart Sass, yaml and the WASI shim are all inlined, so the npm
// tarball installs without touching a registry.

import { chmodSync, copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "dist/slipway.mjs");
const require = createRequire(resolve(ROOT, "package.json"));

mkdirSync(dirname(OUT), { recursive: true });

await build({
  entryPoints: [resolve(ROOT, "src/bin.ts")],
  outfile: OUT,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Dart Sass's Node build is CommonJS inside and calls require() for Node
  // built-ins; an ESM bundle has no require, so provide one.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __slipwayCreateRequire } from 'node:module';",
      "const require = __slipwayCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  legalComments: "none",
  logLevel: "warning",
});
chmodSync(OUT, 0o755);

// The a-Shell adapter: one self-contained script for `jsc` (a WKWebView).
// IIFE, because every jsc run shares the page's global scope. Not part of
// the npm tarball; published next to pandoc.wasm on the Pages site.
const ASHELL = resolve(ROOT, "dist/slipway-ashell.js");
await build({
  entryPoints: [resolve(ROOT, "src/ashell/main.ts")],
  outfile: ASHELL,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "safari15",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
});

// pandoc-wasm's `exports` only exposes its entry point; the wasm sits next to it.
const wasmSrc = resolve(dirname(require.resolve("pandoc-wasm")), "pandoc.wasm");
copyFileSync(wasmSrc, resolve(ROOT, "dist/pandoc.wasm"));

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);
console.log(`build: dist/slipway.mjs (${mb(OUT)} MB) + dist/slipway-ashell.js (${mb(ASHELL)} MB) + dist/pandoc.wasm (${mb(resolve(ROOT, "dist/pandoc.wasm"))} MB)`);
