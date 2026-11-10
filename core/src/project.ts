// Resolve a deck into the bundle of files the renderer needs, reading the
// project through a small file-system interface each surface implements
// (IndexedDB in the PWA, workspace.fs in the VS Code extension, node:fs in
// the CLI). Keeping the resolution rules here is what makes
// `theme: ../assets/imago.scss` behave identically everywhere.

import { extractDeclarations } from "./frontmatter";
import { resolveDeclaredPath } from "./path-resolve";
import type { RenderInputs } from "./types";

export interface ProjectFS {
  /**
   * Every file in the project, as POSIX paths relative to the project root.
   * The order matters when a deck declares no theme / bibliography (the
   * first .scss / .css / .bib wins) and when two assets share a basename
   * (the last one wins), so implementations should return a sorted list.
   */
  listFiles(): Promise<string[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

// Binary assets the renderer inlines as data URIs: images (rewritten into
// the markdown) and fonts (rewritten into the compiled theme CSS).
const BINARY_ASSET_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg",
  "woff2", "woff", "ttf", "otf",
]);
const INCLUDE_EXTENSIONS = new Set(["qmd", "md", "markdown"]);

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Resolve a deck path into the bundle of files needed for rendering: the .qmd
 * itself, the project's theme stylesheet (.scss preferred; .css accepted as
 * already-compiled), the bib, and all image/font assets. Path resolution is
 * intentionally forgiving — YAML's relative paths (`../assets/foo.png`) are
 * flattened against the project at render time.
 */
export async function buildRenderInputs(qmdPath: string, fs: ProjectFS): Promise<RenderInputs> {
  const qmd = await fs.readText(qmdPath);
  const all = await fs.listFiles();
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
  const stylesheet = themePath ? await fs.readText(themePath) : "";
  const stylesheetIsPrecompiled = themePath?.toLowerCase().endsWith(".css") ?? false;

  // Bibliography resolution follows the same pattern.
  let bibPath: string | null = null;
  if (declared.bib) bibPath = resolveDeclaredPath(declared.bib, all);
  if (!bibPath) bibPath = pickFirst(all, (p) => p.toLowerCase().endsWith(".bib"));
  const bib = bibPath ? await fs.readText(bibPath) : null;

  // Both asset kinds are keyed by basename to match the renderer's lookup.
  const assets = new Map<string, Uint8Array>();
  for (const p of all) {
    if (BINARY_ASSET_EXTENSIONS.has(extOf(p))) {
      const basename = p.split("/").pop()!;
      assets.set(basename, await fs.readBytes(p));
    }
  }

  // {{< include … >}} candidates: every .qmd / .md in the project except the
  // deck itself. Keyed by both project path and basename so shortcode args
  // like `_snippet.qmd` and `includes/_snippet.qmd` both resolve. When two
  // files share a basename the first one wins on the basename key (the
  // explicit-path key still uniquely resolves either).
  const includes = new Map<string, string>();
  for (const p of all) {
    if (INCLUDE_EXTENSIONS.has(extOf(p)) && p !== qmdPath) {
      const text = await fs.readText(p);
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
