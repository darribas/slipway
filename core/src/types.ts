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

// The pandoc invocation prepareRender() decides on, plus what finalizeRender()
// needs to finish the job. `options` / `stdin` / `files` are exactly the
// arguments of PandocInstance.convert(); `options` is also a valid pandoc
// defaults file once serialised (the keys are pandoc's own option names).
export interface PandocJob {
  options: Record<string, unknown>;
  stdin: string;
  /** Files pandoc must be able to read by name: theme.css, references.bib. */
  files: Record<string, string | Uint8Array>;
  ctx: {
    /** Compiled theme CSS with fonts inlined ("" when the deck has no theme). */
    css: string;
    /** The deck's format.revealjs.* options, applied post-init. */
    revealOverrides: Record<string, unknown>;
    /** Warnings raised before pandoc ran. */
    warnings: string[];
    /** Start timestamp (ms) for RenderResult.durationMs. */
    t0: number;
  };
}

/** What a pandoc run hands back to finalizeRender(). */
export interface PandocOutput {
  stdout: string;
  stderr: string;
  warnings: unknown[];
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
