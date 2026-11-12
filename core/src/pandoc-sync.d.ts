import type { PandocOutput } from "./types";

export interface PandocInstanceSync {
  convert: (
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, string | Uint8Array>,
  ) => PandocOutput;
  /** How long each start-up stage took, in ms. */
  timings: { compileMs: number; instantiateMs: number; haskellInitMs: number };
}

export function createPandocInstanceSync(
  wasm: ArrayBuffer | Uint8Array,
  log?: (line: string) => void,
): PandocInstanceSync;
