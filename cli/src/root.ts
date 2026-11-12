// Decide which folder is "the project" for a deck.

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** True when `child` is `parent` or lives somewhere beneath it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Project root for a deck, in order of preference:
 *   1. an explicit --root;
 *   2. the nearest ancestor of the deck that contains `_quarto.yml`;
 *   3. the current directory, if the deck is under it;
 *   4. the deck's own folder.
 */
export function findProjectRoot(deckAbs: string, cwd: string, explicitRoot?: string): string {
  if (explicitRoot) return resolve(cwd, explicitRoot);

  let dir = dirname(deckAbs);
  for (;;) {
    if (existsSync(join(dir, "_quarto.yml")) || existsSync(join(dir, "_quarto.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (isInside(cwd, deckAbs)) return cwd;
  return dirname(deckAbs);
}

/** POSIX path of `fileAbs` relative to `root` (what ProjectFS speaks). */
export function toProjectPath(root: string, fileAbs: string): string {
  return relative(root, fileAbs).split(sep).join("/");
}
