// Shared types for the rendering pipeline and project model.

export type FileMap = Map<string, string | Uint8Array>;

export interface ProjectFile {
  path: string; // POSIX path relative to project root
  data: string | Uint8Array;
}

export interface RenderInputs {
  qmd: string;
  scss: string; // raw SCSS text (may be empty)
  bib: string | null; // raw BibTeX (may be null)
  assets: Map<string, Uint8Array>; // basename -> bytes (PNGs, JPGs, etc.)
}

export interface RenderResult {
  html: string;
  warnings: string[];
  stderr: string;
  durationMs: number;
}
