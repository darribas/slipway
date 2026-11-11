// Bundle the extension for both extension hosts (Web Worker in VS Code for
// the Web, Node on desktop) into one file, dist/extension.js, and put
// pandoc.wasm next to it.
//
// platform: "browser" is deliberate even though desktop loads the same
// bundle through `main`: it makes esbuild refuse any Node built-in import
// (`fs`, `node:path`, …) anywhere in the dependency graph, which is exactly
// the guarantee a web extension needs. Core's generated assets module
// (reveal.js, KaTeX, print CSS) is inlined, so after activation the extension
// needs nothing from the network.

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "dist/extension.js");
const require = createRequire(resolve(ROOT, "package.json"));

const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));
const noNodeBuiltins = {
  name: "no-node-builtins",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const bare = args.path.replace(/^node:/, "");
      if (args.path.startsWith("node:") || BUILTINS.has(bare) || BUILTINS.has(bare.split("/")[0])) {
        return {
          errors: [{
            text: `Node built-in "${args.path}" imported by ${args.importer} — a web extension cannot use Node built-ins`,
          }],
        };
      }
      return null;
    });
  },
};

mkdirSync(dirname(OUT), { recursive: true });

await build({
  entryPoints: [resolve(ROOT, "src/extension.ts")],
  outfile: OUT,
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["vscode"],
  plugins: [noNodeBuiltins],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});

const wasmSrc = resolve(dirname(require.resolve("pandoc-wasm")), "pandoc.wasm");
copyFileSync(wasmSrc, resolve(ROOT, "dist/pandoc.wasm"));

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);
console.log(`build: dist/extension.js (${mb(OUT)} MB) + dist/pandoc.wasm (${mb(resolve(ROOT, "dist/pandoc.wasm"))} MB)`);
