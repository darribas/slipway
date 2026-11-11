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
