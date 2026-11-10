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

// Minimal interface for whatever drives pandoc: each surface loads
// pandoc.wasm its own way and hands the renderer one of these (normally the
// result of createPandocInstance()). Input files are text or raw bytes; the
// output maps hold host-specific values (Blobs in a browser) that the
// renderer never reads, hence `unknown`.
export interface PandocInstance {
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
}
