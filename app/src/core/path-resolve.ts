// Resolve a YAML-declared file path (theme, bibliography, etc.) against the
// flat list of paths actually stored in IDB.
//
// Real-world Quarto projects keep their .qmd in a subdirectory (e.g.,
// `slides/`) and reference shared assets via `../assets/foo.scss`. Our
// storage is a single flat namespace where the project root is the only
// context, so `../` segments need to be normalised away — but only as a
// fallback, since the user may have arranged files at exactly the declared
// path. Resolution tries three things in order, returning the first hit:
//
//   1. exact match (declared path appears verbatim in IDB)
//   2. exact match after stripping leading `./` and `../` segments
//   3. basename match (any file whose final segment matches), but only when
//      unambiguous; multiple candidates fall back to null so the caller can
//      decide what to do (typically: warn + use a globbed default)

export function resolveDeclaredPath(declared: string, allPaths: string[]): string | null {
  if (!declared) return null;

  // 1. Exact match.
  if (allPaths.includes(declared)) return declared;

  // 2. Strip leading `./` and `../` segments and try again.
  const normalised = stripLeadingTraversal(declared);
  if (normalised !== declared && allPaths.includes(normalised)) return normalised;

  // 3. Unambiguous basename fallback.
  const basename = (normalised || declared).split("/").pop() ?? "";
  if (!basename) return null;
  const matches = allPaths.filter((p) => p.split("/").pop() === basename);
  if (matches.length === 1) return matches[0];

  return null;
}

function stripLeadingTraversal(p: string): string {
  return p.replace(/^(\.\.?\/)+/, "");
}

/**
 * Recompute a descendant's path when its containing folder moves. Used by the
 * file tree's move/rename action: moving folder `oldDir` → `newDir` re-keys
 * every file under it. `child` must live under `oldDir` (i.e. start with
 * `oldDir + "/"`); the segment after `oldDir` is grafted onto `newDir`.
 *
 *   rebaseChildPath("a", "b/c", "a/x/y.qmd") === "b/c/x/y.qmd"
 */
export function rebaseChildPath(oldDir: string, newDir: string, child: string): string {
  const prefix = oldDir + "/";
  if (!child.startsWith(prefix)) return child;
  return newDir + "/" + child.slice(prefix.length);
}
