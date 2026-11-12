import { buildRenderInputs as coreBuildRenderInputs } from "@slipway/core";
import type { ProjectFS, RenderInputs } from "@slipway/core";
import { listFiles, readBytes, readText, writeText } from "./storage";

/**
 * Two active paths are tracked, deliberately separate:
 *
 *  - activeEditor: whatever text file is currently loaded in the editor. May
 *    be any text format (.qmd, .scss, .css, .bib, .yaml, …). Autosave writes
 *    here. Cleared when the file is deleted.
 *
 *  - activeQmd: the deck the Render button targets. Only set when a .qmd is
 *    opened in the editor. Persists even when the user navigates to a non-
 *    .qmd file (e.g., to tweak the theme), so they can hit Render and see
 *    the same deck again.
 */
let activeEditorPath: string | null = null;
let activeQmdPath: string | null = null;

export function setActiveEditor(path: string | null): void {
  activeEditorPath = path;
}

export function getActiveEditor(): string | null {
  return activeEditorPath;
}

export function setActiveQmd(path: string | null): void {
  activeQmdPath = path;
}

export function getActiveQmd(): string | null {
  return activeQmdPath;
}

export async function listQmds(): Promise<string[]> {
  const all = await listFiles();
  return all.filter((p) => p.toLowerCase().endsWith(".qmd"));
}

// Extensions we consider editable as plain text. Anything not on this list
// is treated as binary and the open is refused (rather than corrupting it
// by interpreting random bytes as UTF-8 in the editor).
const TEXT_EXTENSIONS = new Set([
  "qmd", "md", "markdown",
  "scss", "css", "sass",
  "bib", "csl",
  "yaml", "yml",
  "json",
  "txt",
  "svg",
  "html", "htm",
  "lua",
  "tex",
  "js", "ts", "mjs", "cjs",
]);

export function isTextFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

export async function readFile(path: string): Promise<string> {
  return await readText(path);
}

export async function saveFile(path: string, content: string): Promise<void> {
  await writeText(path, content);
}

// The PWA's project is the flat set of files in IndexedDB.
const idbProjectFS: ProjectFS = {
  listFiles: () => listFiles(),
  readText,
  readBytes,
};

/**
 * Resolve a deck path into the bundle of files needed for rendering. The
 * resolution rules live in @slipway/core (shared with the CLI and the VS
 * Code extension); this just points them at IndexedDB.
 */
export function buildRenderInputs(qmdPath: string): Promise<RenderInputs> {
  return coreBuildRenderInputs(qmdPath, idbProjectFS);
}
