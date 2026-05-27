import type { RenderInputs } from "../core/types";
import { extractDeclarations } from "../core/frontmatter";
import { resolveDeclaredPath } from "../core/path-resolve";
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
  const declared = extractDeclarations(qmd);

  // Theme resolution. Honour the YAML's `theme:` declaration when present
  // (with path resolution that tolerates `../` segments and basename
  // shorthand), so a project with multiple .scss files renders predictably.
  // Fall back to "first .scss" then "first .css" only when nothing's
  // declared or the declared path can't be resolved.
  let themePath: string | null = null;
  if (declared.theme) themePath = resolveDeclaredPath(declared.theme, all);
  if (!themePath) themePath = pickFirst(all, (p) => p.toLowerCase().endsWith(".scss"));
  if (!themePath) themePath = pickFirst(all, (p) => p.toLowerCase().endsWith(".css"));
  const stylesheet = themePath ? await readText(themePath) : "";
  const stylesheetIsPrecompiled = themePath?.toLowerCase().endsWith(".css") ?? false;

  // Bibliography resolution follows the same pattern.
  let bibPath: string | null = null;
  if (declared.bib) bibPath = resolveDeclaredPath(declared.bib, all);
  if (!bibPath) bibPath = pickFirst(all, (p) => p.toLowerCase().endsWith(".bib"));
  const bib = bibPath ? await readText(bibPath) : null;

  const assets = new Map<string, Uint8Array>();
  for (const p of all) {
    const ext = p.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      const basename = p.split("/").pop()!;
      assets.set(basename, await readBytes(p));
    }
  }

  // {{< include … >}} candidates: every .qmd / .md in the project except the
  // deck itself. Keyed by both project path and basename so shortcode args
  // like `_snippet.qmd` and `includes/_snippet.qmd` both resolve. When two
  // files share a basename the first one wins on the basename key (the
  // explicit-path key still uniquely resolves either).
  const includes = new Map<string, string>();
  for (const p of all) {
    const ext = p.split(".").pop()?.toLowerCase() ?? "";
    if ((ext === "qmd" || ext === "md" || ext === "markdown") && p !== qmdPath) {
      const text = await readText(p);
      includes.set(p, text);
      const basename = p.split("/").pop()!;
      if (!includes.has(basename)) includes.set(basename, text);
    }
  }

  return { qmd, stylesheet, stylesheetIsPrecompiled, bib, assets, includes };
}

function pickFirst<T>(arr: T[], pred: (v: T) => boolean): T | null {
  for (const v of arr) if (pred(v)) return v;
  return null;
}
