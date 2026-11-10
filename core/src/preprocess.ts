import YAML from "yaml";

export interface PreprocessOutput {
  qmd: string;
  bibPath: string | null;
  themePath: string | null;
}

// Strips directives we re-supply as pandoc options (theme, bibliography), expands
// {{< include >}} shortcodes against a provided file map, and inlines asset
// references as data URIs so the sandboxed iframe can render local images
// without --embed-resources (which fails for remote URLs under WASI).
export function preprocessDeck(
  qmd: string,
  options: {
    /** Map of basename → file contents for {{< include >}} resolution. */
    includes?: Map<string, string>;
    /** Map of asset basename → data URI for image-ref rewriting. */
    assetUris?: Map<string, string>;
  } = {},
): PreprocessOutput {
  let bibPath: string | null = null;
  let themePath: string | null = null;

  // 1. Expand {{< include >}} shortcodes (Phase 0 noted these but didn't resolve;
  //    now that we have OPFS-backed sibling files, do the substitution).
  qmd = expandIncludes(qmd, options.includes ?? new Map());

  // 2. Parse + rewrite YAML frontmatter using a real parser (Phase 0 used regex,
  //    which mangled the `format: revealjs:` block).
  const fmMatch = qmd.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    try {
      const yaml = YAML.parseDocument(fmMatch[1]);
      const root = yaml.contents as YAML.YAMLMap | null;
      if (root && YAML.isMap(root)) {
        const themeNode = findThemeInFormatBlock(root);
        if (themeNode) themePath = String(themeNode);
        const bibNode = root.get("bibliography");
        if (bibNode != null) bibPath = String(bibNode);
        // Strip directives we'll re-supply via pandoc options so they don't
        // collide. theme: ../assets/imago.scss would otherwise make pandoc try
        // to load <revealjs-url>/dist/theme/../assets/imago.scss.css.
        removeThemeFromFormatBlock(root);
        root.delete("bibliography");
      }
      qmd = qmd.replace(fmMatch[0], `---\n${yaml.toString().trimEnd()}\n---\n`);
    } catch {
      // Fall back to regex stripping if YAML is malformed — the user can still
      // render and see the parse error from pandoc.
      let yamlText = fmMatch[1].replace(/^\s*theme:.*\n?/gm, "");
      yamlText = yamlText.replace(/^\s*bibliography:.*\n?/gm, "");
      qmd = qmd.replace(fmMatch[0], `---\n${yamlText.trim()}\n---\n`);
    }
  }

  // 3. Rewrite image references to data URIs for any asset we've inlined.
  if (options.assetUris && options.assetUris.size > 0) {
    qmd = qmd.replace(
      /!\[([^\]]*)\]\(((?:\.\.\/)?(?:assets\/)?([^)\s]+))(\s+"[^"]*")?\)/g,
      (match, alt: string, _full: string, file: string, title: string | undefined) => {
        const uri = options.assetUris!.get(file);
        if (!uri) return match;
        return `![${alt}](${uri}${title ?? ""})`;
      },
    );
  }

  return { qmd, bibPath, themePath };
}

// Drop the `theme:` key whether it's a direct YAML top-level key, or nested
// under `format: revealjs:`. Returns the original value (or null).
function findThemeInFormatBlock(root: YAML.YAMLMap): unknown {
  const direct = root.get("theme");
  if (direct != null) return direct;
  const format = root.get("format");
  if (format && YAML.isMap(format)) {
    const revealjs = format.get("revealjs");
    if (revealjs && YAML.isMap(revealjs)) return revealjs.get("theme");
  }
  return null;
}

function removeThemeFromFormatBlock(root: YAML.YAMLMap): void {
  root.delete("theme");
  const format = root.get("format");
  if (format && YAML.isMap(format)) {
    const revealjs = format.get("revealjs");
    if (revealjs && YAML.isMap(revealjs)) revealjs.delete("theme");
  }
}

function expandIncludes(qmd: string, includes: Map<string, string>): string {
  // One-pass, non-recursive (Phase 1 keeps it simple; nested includes Phase 2+).
  return qmd.replace(/\{\{<\s*include\s+([^\s>]+)\s*>\}\}/g, (_m, path: string) => {
    const basename = path.split("/").pop() ?? path;
    return includes.get(basename) ?? includes.get(path) ?? `<!-- include ${path} not found -->`;
  });
}
