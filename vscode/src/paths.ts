// Pure path helpers (no `vscode` import, so they are unit-testable in Node).
// Everything is a POSIX path string — what vscode.Uri.path holds on every
// file-system provider, local or virtual.

/**
 * Path of `filePath` relative to the folder `rootPath`, or null when the
 * file is not inside it. Both are absolute POSIX paths.
 */
export function relativeTo(rootPath: string, filePath: string): string | null {
  const root = rootPath.endsWith("/") ? rootPath : rootPath + "/";
  if (!filePath.startsWith(root)) return null;
  const rel = filePath.slice(root.length);
  return rel === "" ? null : rel;
}

/**
 * Files Slipway never treats as part of a project: anything under
 * node_modules or under a hidden folder (.git, .quarto, .venv, …), and
 * hidden files themselves. Same rule as the CLI's directory walker, so both
 * surfaces see the same project and render the same HTML.
 */
export function isIgnoredProjectPath(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment === "node_modules" || segment.startsWith("."));
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i);
}

/** Collapse `.` and `..` segments of an absolute POSIX path. */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return "/" + out.join("/");
}

/**
 * Expand the `slipway.exportPath` template for a deck into an absolute POSIX
 * path. Supports the usual VS Code variables that make sense here:
 * `${fileDirname}`, `${fileBasename}`, `${fileBasenameNoExtension}`,
 * `${fileExtname}` and `${workspaceFolder}`. A relative result is taken
 * relative to the deck's folder.
 */
export function expandExportPath(template: string, deckPath: string, workspaceFolderPath: string | null): string {
  const base = basename(deckPath);
  const ext = extname(deckPath);
  const vars: Record<string, string> = {
    fileDirname: dirname(deckPath),
    fileBasename: base,
    fileBasenameNoExtension: ext ? base.slice(0, -ext.length) : base,
    fileExtname: ext,
    workspaceFolder: workspaceFolderPath ?? dirname(deckPath),
  };
  const expanded = (template.trim() || "${fileDirname}/${fileBasenameNoExtension}.html").replace(
    /\$\{(\w+)\}/g,
    (match, name: string) => (name in vars ? vars[name] : match),
  );
  return normalize(expanded.startsWith("/") ? expanded : dirname(deckPath) + "/" + expanded);
}

/** `deck.html` → `deck.print.html` (any other name just gains `.print.html`). */
export function printVariantPath(htmlPath: string): string {
  return /\.html?$/i.test(htmlPath) ? htmlPath.replace(/(\.html?)$/i, ".print$1") : htmlPath + ".print.html";
}

/**
 * Does a change to project file `changedPath` call for re-rendering a deck
 * whose source is `deckSource`? (Both paths are project-relative.)
 *
 * Themes, bibliographies, images and fonts are resolved forgivingly across
 * the whole project, so any of those may matter. Another markdown file only
 * matters if the deck pulls it in with `{{< include >}}` — otherwise saving
 * one deck would needlessly re-render every other open deck in the folder.
 */
export function affectsDeck(changedPath: string, deckPath: string, deckSource: string | undefined): boolean {
  if (changedPath === deckPath) return true;
  if (isIgnoredProjectPath(changedPath)) return false;
  const ext = extname(changedPath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return false; // exports, not inputs
  if (ext !== ".qmd" && ext !== ".md" && ext !== ".markdown") return true;
  if (deckSource === undefined) return true; // not rendered yet: be safe
  const name = basename(changedPath);
  for (const match of deckSource.matchAll(/\{\{<\s*include\s+([^\s>]+)\s*>\}\}/g)) {
    if (match[1] === changedPath || basename(match[1]) === name) return true;
  }
  return false;
}
