// Shared types for the rendering pipeline and project model.

export type FileMap = Map<string, string | Uint8Array>;

export interface ProjectFile {
  path: string; // POSIX path relative to project root
  data: string | Uint8Array;
}

export interface RenderInputs {
  qmd: string;
  stylesheet: string; // raw text (SCSS or CSS); empty if no theme present
  stylesheetIsPrecompiled: boolean; // true for .css, false for .scss
  bib: string | null; // raw BibTeX (may be null)
  assets: Map<string, Uint8Array>; // basename -> bytes (PNGs, JPGs, etc.)
  // Files available for {{< include path >}} resolution. Keyed by both the
  // project-relative path and the basename so the shortcode's argument can be
  // either form (preprocess.ts's expandIncludes tries basename first, then
  // path). Empty when the project has no .qmd/.md siblings to include.
  includes: Map<string, string>;
}

export interface RenderResult {
  html: string;
  warnings: string[];
  stderr: string;
  durationMs: number;
}

// Minimal interface for whatever drives pandoc. Lives in types.ts (rather
// than pandoc.ts) so render.ts can be imported from a node-only test
// context without pulling in the Vite-only virtual:pandoc-wasm-url module.
export interface PandocInstance {
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
}
