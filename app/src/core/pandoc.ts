import { createPandocInstance } from "./pandoc-core.js";
import pandocWasmUrl from "virtual:pandoc-wasm-url";
import type { PandocInstance } from "./types";

export type { PandocInstance };

let cached: Promise<PandocInstance> | null = null;

export function getPandoc(onProgress?: (loaded: number, total: number) => void): Promise<PandocInstance> {
  if (!cached) cached = loadPandoc(onProgress);
  return cached;
}

async function loadPandoc(onProgress?: (loaded: number, total: number) => void): Promise<PandocInstance> {
  const resp = await fetch(pandocWasmUrl);
  if (!resp.ok) throw new Error(`pandoc.wasm fetch failed: ${resp.status}`);
  const total = Number(resp.headers.get("content-length")) || 0;
  let received = 0;
  const reader = resp.body!.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  const wasm = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    wasm.set(c, offset);
    offset += c.length;
  }
  return (await createPandocInstance(wasm.buffer)) as PandocInstance;
}
