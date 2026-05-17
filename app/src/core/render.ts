import { compileScss } from "./sass";
import { preprocessDeck } from "./preprocess";
import { inlineRevealAssets } from "./inline-assets";
import type { PandocInstance, RenderInputs, RenderResult } from "./types";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

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
    }[ext] ?? "application/octet-stream"
  );
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function renderDeck(
  pandoc: PandocInstance,
  inputs: RenderInputs,
): Promise<RenderResult> {
  const t0 = performance.now();

  // Compile SCSS once per render. Phase 2 can memoise on hash.
  const css = compileScss(inputs.scss);

  // Build the asset-URI map for image inlining (only image-typed assets).
  const assetUris = new Map<string, string>();
  for (const [name, bytes] of inputs.assets) {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (IMAGE_EXTENSIONS.has(ext)) {
      assetUris.set(name, bytesToDataUri(bytes, mimeFor(name)));
    }
  }

  const { qmd } = preprocessDeck(inputs.qmd, { assetUris });

  const pandocFiles: Record<string, string | Blob> = {};
  if (css) pandocFiles["theme.css"] = css;
  if (inputs.bib) pandocFiles["references.bib"] = inputs.bib;

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

  const result = await pandoc.convert(options, qmd, pandocFiles);

  const warnings: string[] = [];
  for (const w of result.warnings) {
    if (typeof w === "string") warnings.push(w);
    else if (w && typeof w === "object" && "pretty" in w) warnings.push(String((w as { pretty: unknown }).pretty));
    else warnings.push(JSON.stringify(w));
  }

  // Inline reveal.js core + plugins so the rendered deck has no external
  // dependencies. App becomes fully offline-capable (the Phase 3 goal) and
  // the deck stops being at the mercy of unpkg resolving `^5` at fetch time.
  const html = inlineRevealAssets(result.stdout);

  return {
    html,
    warnings,
    stderr: result.stderr,
    durationMs: performance.now() - t0,
  };
}
