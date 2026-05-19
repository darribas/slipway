// Extract resource declarations (theme, bibliography) from a .qmd's YAML
// frontmatter. Separate from preprocess.ts because the render pipeline needs
// to ask "what files does this deck want?" *before* deciding which files to
// load — preprocess.ts mutates the YAML to strip those keys, which is a
// later concern.
//
// Handles both the Quarto layouts the spec covers:
//   theme: foo.scss
// and
//   format:
//     revealjs:
//       theme: foo.scss

import YAML from "yaml";

export interface Declarations {
  theme: string | null;
  bib: string | null;
}

export function extractDeclarations(qmd: string): Declarations {
  const fm = qmd.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return { theme: null, bib: null };
  try {
    const doc = YAML.parseDocument(fm[1]);
    const root = doc.contents;
    if (!root || !YAML.isMap(root)) return { theme: null, bib: null };
    return {
      theme: stringOrNull(findInFormatBlock(root, "theme")),
      bib: stringOrNull(root.get("bibliography")),
    };
  } catch {
    return { theme: null, bib: null };
  }
}

function findInFormatBlock(root: YAML.YAMLMap, key: string): unknown {
  const direct = root.get(key);
  if (direct != null) return direct;
  const format = root.get("format");
  if (format && YAML.isMap(format)) {
    const revealjs = format.get("revealjs");
    if (revealjs && YAML.isMap(revealjs)) return revealjs.get(key);
  }
  return null;
}

function stringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}
