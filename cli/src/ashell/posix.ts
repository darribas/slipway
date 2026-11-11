// POSIX path helpers for the a-Shell adapter (no node:path under jsc).

export function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else if (segment === ".." && absolute) continue;
    else out.push(segment);
  }
  return (absolute ? "/" : "") + out.join("/") || (absolute ? "/" : ".");
}

/** Resolve `path` against `cwd`, expanding a leading `~` with `home`. */
export function resolvePath(cwd: string, path: string, home?: string): string {
  if (home && (path === "~" || path.startsWith("~/"))) path = home + path.slice(1);
  return normalize(path.startsWith("/") ? path : cwd + "/" + path);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Path of `child` relative to the folder `parent`, or null if it is not inside it. */
export function relativeTo(parent: string, child: string): string | null {
  const root = parent.endsWith("/") ? parent : parent + "/";
  return child.startsWith(root) && child.length > root.length ? child.slice(root.length) : null;
}

export function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
}
