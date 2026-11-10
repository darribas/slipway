import { compileScss } from "./sass";
import { preprocessDeck } from "./preprocess";
import { extractDeclarations } from "./frontmatter";
import { injectRevealConfigOverride, injectSandboxCompat, inlineFontUrls, inlineKatexAssets, inlineRevealAssets, inlineThemeCss } from "./inline-assets";
import { base64Encode, now } from "./host";
import type {
  PandocInstance,
  PandocJob,
  PandocOutput,
  RenderDiagnostic,
  RenderInputs,
  RenderResult,
} from "./types";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const FONT_EXTENSIONS = new Set(["woff2", "woff", "ttf", "otf"]);

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      woff2: "font/woff2",
      woff: "font/woff",
      ttf: "font/ttf",
      otf: "font/otf",
    }[ext] ?? "application/octet-stream"
  );
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${base64Encode(bytes)}`;
}

/**
 * Everything that happens before pandoc: compile the theme, turn image and
 * font assets into data URIs, preprocess the deck, and decide the exact
 * pandoc invocation. The returned job is what `pandoc.convert()` is called
 * with — or, where pandoc runs out of process (a-Shell), what gets written
 * to disk for a `pandoc --defaults` run.
 */
export function prepareRender(inputs: RenderInputs): PandocJob {
  const t0 = now();
  const diagnostics: RenderDiagnostic[] = [];

  // The stylesheet may be either Sass source (compile via Dart Sass) or
  // already-compiled CSS (use as-is). Empty string means no theme in the
  // project; skip the entire CSS plumbing in that case.
  let css = inputs.stylesheet
    ? inputs.stylesheetIsPrecompiled
      ? inputs.stylesheet
      : compileScss(inputs.stylesheet, diagnostics)
    : "";

  // Build the asset-URI maps: images get inlined into the markdown, fonts
  // get inlined into the compiled theme CSS. Both must become data URIs
  // because the deck renders in a null-origin sandboxed iframe where
  // relative URLs (and external CDN fetches) don't resolve.
  const assetUris = new Map<string, string>();
  const fontUris = new Map<string, string>();
  for (const [name, bytes] of inputs.assets) {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (IMAGE_EXTENSIONS.has(ext)) {
      assetUris.set(name, bytesToDataUri(bytes, mimeFor(name)));
    } else if (FONT_EXTENSIONS.has(ext)) {
      fontUris.set(name, bytesToDataUri(bytes, mimeFor(name)));
    }
  }

  // Embed self-hosted theme fonts as data URIs before the CSS is inlined.
  if (css) css = inlineFontUrls(css, fontUris);

  const { qmd } = preprocessDeck(inputs.qmd, { assetUris, includes: inputs.includes });

  const files: Record<string, string | Uint8Array> = {};
  if (css) files["theme.css"] = css;
  if (inputs.bib) files["references.bib"] = inputs.bib;

  const options: Record<string, unknown> = {
    from: "markdown",
    to: "revealjs",
    standalone: true,
    "slide-level": 2,
    "html-math-method": "katex",
    // theme=white loads reveal.js's white.css as the base, so an imago-style
    // SCSS file (which assumes a light base and overrides .dark/.light slide
    // variants) is no longer fighting the default black.css cascade.
    variables: { theme: "white" },
    ...(css ? { css: ["theme.css"] } : {}),
    ...(inputs.bib ? { citeproc: true, bibliography: "references.bib" } : {}),
  };

  return {
    options,
    stdin: qmd,
    files,
    ctx: {
      css,
      revealOverrides: extractDeclarations(inputs.qmd).revealjsOptions,
      diagnostics,
      t0,
    },
  };
}

/**
 * Everything that happens after pandoc: turn its standalone revealjs HTML
 * into a self-contained deck.
 */
export function finalizeRender(job: PandocJob, out: PandocOutput): RenderResult {
  // `warnings` is pandoc's messages only (what the PWA has always shown);
  // `diagnostics` adds the Sass messages collected before pandoc ran.
  const diagnostics: RenderDiagnostic[] = [...job.ctx.diagnostics];
  const warnings: string[] = [];
  for (const w of out.warnings) {
    let message: string;
    let severity: RenderDiagnostic["severity"] = "warning";
    if (typeof w === "string") message = w;
    else if (w && typeof w === "object" && "pretty" in w) {
      message = String((w as { pretty: unknown }).pretty);
      if ((w as { verbosity?: unknown }).verbosity === "INFO") severity = "info";
    } else message = JSON.stringify(w);
    diagnostics.push({ severity, message });
    warnings.push(message);
  }

  // Five post-pandoc passes:
  //   1. Sandbox-compat polyfill (localStorage/sessionStorage/history shims so
  //      reveal.js plugins don't crash inside the sandboxed iframe).
  //   2. Reveal.js core + plugins (eliminates external CDN deps).
  //   3. KaTeX JS + CSS with fonts inlined as data URIs (eliminates the
  //      jsdelivr CDN dep; fonts work in the null-origin sandboxed iframe).
  //   4. Our compiled theme.css (pandoc only emits a <link> pointing at the
  //      VFS path, which the iframe can't resolve — see inlineThemeCss).
  //   5. The user's `format.revealjs.*` options applied via Reveal.configure()
  //      after init, so boolean-false options like `controls: false` actually
  //      take effect (pandoc's template skips them).
  let html = injectSandboxCompat(out.stdout);
  html = inlineRevealAssets(html);
  html = inlineKatexAssets(html);
  html = inlineThemeCss(html, job.ctx.css);
  html = injectRevealConfigOverride(html, job.ctx.revealOverrides);

  return {
    html,
    warnings,
    diagnostics,
    stderr: out.stderr,
    ok: out.stdout.trim() !== "",
    durationMs: now() - job.ctx.t0,
  };
}

/** prepare → pandoc.convert → finalize, for hosts that run pandoc in-process. */
export async function renderDeck(
  pandoc: PandocInstance,
  inputs: RenderInputs,
): Promise<RenderResult> {
  const job = prepareRender(inputs);
  const out = await pandoc.convert(job.options, job.stdin, job.files);
  return finalizeRender(job, out);
}
