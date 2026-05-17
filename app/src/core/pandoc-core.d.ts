// Type declarations for the vendored pandoc-core.js (see header of that file).

export function createPandocInstance(wasm: ArrayBuffer): Promise<{
  convert: (
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, string | Blob>,
  ) => Promise<{
    stdout: string;
    stderr: string;
    warnings: unknown[];
    files: Record<string, string | Blob>;
    mediaFiles: Record<string, Blob>;
  }>;
  query: (options: Record<string, unknown>) => Record<string, unknown>;
  pandoc: (
    args: string,
    inData: string | Blob,
    resources?: Array<{ filename: string; contents: string | Blob }>,
  ) => Promise<{ out: string | Blob; mediaFiles: Map<string, string | Blob> }>;
}>;
