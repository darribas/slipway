// Test helper: load pandoc.wasm from the pandoc-wasm package on disk and hand
// it to core's own createPandocInstance — the same glue every surface uses,
// rather than pandoc-wasm's Node entry point.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { createPandocInstance } from "../../src/index";
import type { PandocInstance } from "../../src/index";

const require = createRequire(import.meta.url);

export function pandocWasmPath(): string {
  // pandoc-wasm's `exports` hides everything but the entry point, so resolve
  // that and walk to the wasm sitting next to it.
  return resolve(dirname(require.resolve("pandoc-wasm")), "pandoc.wasm");
}

let cached: Promise<PandocInstance> | null = null;

export function loadPandoc(): Promise<PandocInstance> {
  if (!cached) cached = readFile(pandocWasmPath()).then((bytes) => createPandocInstance(bytes));
  return cached;
}
