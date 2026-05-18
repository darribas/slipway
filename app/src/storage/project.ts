import type { RenderInputs } from "../core/types";
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

/**
 * Resolve a deck path into the bundle of files needed for rendering: the .qmd
 * itself, the project's theme stylesheet (.scss preferred; .css accepted as
 * already-compiled), the bib, and all image assets. Path resolution is
 * intentionally forgiving — YAML's relative paths (`../assets/foo.png`) are
 * flattened against the project at render time.
 */
export async function buildRenderInputs(qmdPath: string): Promise<RenderInputs> {
  const qmd = await readText(qmdPath);
  const all = await listFiles();

  // Prefer .scss (so source edits are picked up); fall back to .css for
  // projects that ship pre-compiled themes. If both exist, .scss wins.
  const scssPath = pickFirst(all, (p) => p.toLowerCase().endsWith(".scss"));
  const cssPath = scssPath ? null : pickFirst(all, (p) => p.toLowerCase().endsWith(".css"));
  const themePath = scssPath ?? cssPath;
  const stylesheet = themePath ? await readText(themePath) : "";
  const stylesheetIsPrecompiled = themePath != null && themePath === cssPath;

  const bibPath = pickFirst(all, (p) => p.toLowerCase().endsWith(".bib"));
  const bib = bibPath ? await readText(bibPath) : null;

  const assets = new Map<string, Uint8Array>();
  for (const p of all) {
    const ext = p.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      const basename = p.split("/").pop()!;
      assets.set(basename, await readBytes(p));
    }
  }

  return { qmd, stylesheet, stylesheetIsPrecompiled, bib, assets };
}

function pickFirst<T>(arr: T[], pred: (v: T) => boolean): T | null {
  for (const v of arr) if (pred(v)) return v;
  return null;
}
