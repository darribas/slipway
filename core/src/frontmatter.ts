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
  /**
   * Every key under `format.revealjs.*` (excluding `theme:`, which is handled
   * separately above), with kebab-case keys converted to camelCase so they
   * match reveal.js's JS option names. Used by render.ts to inject a
   * Reveal.configure() override post-init — that's the only reliable way to
   * make boolean-false options (e.g., `controls: false`) actually apply,
   * because pandoc's revealjs template treats boolean false as "not set" and
   * silently falls back to reveal.js defaults.
   */
  revealjsOptions: Record<string, unknown>;
}

export function extractDeclarations(qmd: string): Declarations {
  const empty: Declarations = { theme: null, bib: null, revealjsOptions: {} };
  const fm = qmd.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return empty;
  try {
    const parsed = YAML.parse(fm[1]);
    if (!parsed || typeof parsed !== "object") return empty;
    const root = parsed as Record<string, unknown>;
    const formatRevealjs = (root.format as Record<string, unknown> | undefined)?.revealjs as
      | Record<string, unknown>
      | undefined;
    return {
      theme: stringOrNull(root.theme ?? formatRevealjs?.theme),
      bib: stringOrNull(root.bibliography),
      revealjsOptions: extractRevealjsOptions(formatRevealjs),
    };
  } catch {
    return empty;
  }
}

function extractRevealjsOptions(block: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!block) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (key === "theme") continue; // handled by the theme: extraction path
    out[kebabToCamel(key)] = value;
  }
  return out;
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function stringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}
