// Executable entry point. Bundled by scripts/build.mjs to dist/slipway.mjs,
// with pandoc.wasm copied next to it.

import { fileURLToPath } from "node:url";

import { main } from "./cli";

// pandoc-core logs anything pandoc writes to its WASI stdout/stderr through
// console.log / console.warn. Keep our stdout clean (it only ever carries the
// "Output created" line) by sending both to stderr.
console.log = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");
console.warn = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");

main(process.argv.slice(2), {
  cwd: process.cwd(),
  wasmPath: process.env.SLIPWAY_PANDOC_WASM || fileURLToPath(new URL("./pandoc.wasm", import.meta.url)),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`slipway: unexpected error: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  },
);
