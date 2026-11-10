// Type declarations for the vendored pandoc-core.js (see header of that file).

export function createPandocInstance(wasm: ArrayBuffer | Uint8Array): Promise<{
  convert: (
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, string | Uint8Array>,
  ) => Promise<{
    stdout: string;
    stderr: string;
    warnings: unknown[];
    files: Record<string, unknown>;
    mediaFiles: Record<string, unknown>;
  }>;
  query: (options: Record<string, unknown>) => Record<string, unknown>;
}>;
