// Smoke tests for the render pipeline.
//
// Primary suite: the slipway-demo template (the app's default seed deck,
// bundled into the app). It exercises SCSS compilation, citations,
// incremental lists, two-column layouts, math, code blocks, and reveal.js
// config override — enough to catch any regression in the render pipeline
// before it reaches main.
//
// The imago-workshop deck under test/fixtures/ is a test-only fixture
// (not shipped with the app) kept for a secondary round of assertions
// that cover features the demo deck doesn't (local PNG inlining, external
// URLs left intact, Imago-specific class names).

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";
import { convert } from "pandoc-wasm";

import { renderDeck } from "../src/core/render";
import { buildPrintVariant } from "../src/core/print";
import { extractDeclarations } from "../src/core/frontmatter";
import { resolveDeclaredPath, rebaseChildPath } from "../src/core/path-resolve";
import type { PandocInstance, RenderInputs } from "../src/core/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO    = resolve(HERE, "../src/templates/slipway-demo");
const IMAGO   = resolve(HERE, "fixtures/imago-workshop");
const FIGTREE = resolve(DEMO, "assets/fonts/figtree");

async function loadDemoInputs(): Promise<RenderInputs> {
  const [qmd, scss, bib, snippet] = await Promise.all([
    readFile(resolve(DEMO, "demos/slide.qmd"),  "utf8"),
    readFile(resolve(DEMO, "theme.scss"),       "utf8"),
    readFile(resolve(DEMO, "references.bib"),   "utf8"),
    readFile(resolve(DEMO, "demos/_snippet.qmd"), "utf8"),
  ]);
  return {
    qmd,
    stylesheet: scss,
    stylesheetIsPrecompiled: false,
    bib,
    assets: new Map(),
    includes: new Map([["_snippet.qmd", snippet]]),
  };
}

async function loadImagoInputs(): Promise<RenderInputs> {
  const [qmd, scss, bib, png] = await Promise.all([
    readFile(resolve(IMAGO, "slide.qmd"),          "utf8"),
    readFile(resolve(IMAGO, "imago.scss"),          "utf8"),
    readFile(resolve(IMAGO, "references.bib"),      "utf8"),
    readFile(resolve(IMAGO, "attention_paper.png")),
  ]);
  return {
    qmd,
    stylesheet: scss,
    stylesheetIsPrecompiled: false,
    bib,
    assets: new Map([["attention_paper.png", new Uint8Array(png)]]),
    includes: new Map(),
  };
}

// The seeded Imago theme: self-hosted Figtree fonts referenced from
// assets/imago.scss. Mirrors what buildRenderInputs() assembles at runtime —
// font files keyed by basename in the assets map.
async function loadSeededImagoInputs(): Promise<RenderInputs> {
  const fontFiles = [
    "figtree-latin-wght-normal.woff2",
    "figtree-latin-wght-italic.woff2",
    "figtree-latin-ext-wght-normal.woff2",
    "figtree-latin-ext-wght-italic.woff2",
  ];
  const [scss, ...fonts] = await Promise.all([
    readFile(resolve(DEMO, "assets/imago.scss"), "utf8"),
    ...fontFiles.map((f) => readFile(resolve(FIGTREE, f))),
  ]);
  const assets = new Map<string, Uint8Array>();
  fontFiles.forEach((name, i) => assets.set(name, new Uint8Array(fonts[i])));
  return {
    qmd: "---\ntitle: Imago probe\n---\n\n# Heading {.dark}\n\nBody text in [Figtree]{.orange}.\n",
    stylesheet: scss,
    stylesheetIsPrecompiled: false,
    bib: null,
    assets,
    includes: new Map(),
  };
}

// The seeded Journal theme: self-hosted ET Book (woff) referenced from
// assets/journal.scss.
async function loadSeededJournalInputs(): Promise<RenderInputs> {
  const ET = resolve(DEMO, "assets/fonts/et-book");
  const fontPaths: Record<string, string> = {
    "et-book-roman-line-figures.woff": "et-book-roman-line-figures/et-book-roman-line-figures.woff",
    "et-book-display-italic-old-style-figures.woff": "et-book-display-italic-old-style-figures/et-book-display-italic-old-style-figures.woff",
    "et-book-bold-line-figures.woff": "et-book-bold-line-figures/et-book-bold-line-figures.woff",
    "et-book-roman-old-style-figures.woff": "et-book-roman-old-style-figures/et-book-roman-old-style-figures.woff",
  };
  const scss = await readFile(resolve(DEMO, "assets/journal.scss"), "utf8");
  const assets = new Map<string, Uint8Array>();
  for (const [basename, rel] of Object.entries(fontPaths)) {
    assets.set(basename, new Uint8Array(await readFile(resolve(ET, rel))));
  }
  return {
    qmd: "---\ntitle: Journal probe\n---\n\n# A serif heading\n\nBody text in ET Book.\n",
    stylesheet: scss,
    stylesheetIsPrecompiled: false,
    bib: null,
    assets,
    includes: new Map(),
  };
}

const pandoc: PandocInstance = { convert: convert as PandocInstance["convert"] };

// ---------------------------------------------------------------------------
// Primary suite — slipway-demo template
// ---------------------------------------------------------------------------

describe("slipway-demo deck", () => {
  test("renders end-to-end through renderDeck()", async () => {
    const result = await renderDeck(pandoc, await loadDemoInputs());
    expect(result.html.length).toBeGreaterThan(50_000);
    expect(result.stderr).toBe("");
    expect(result.html).toMatch(/<title>/);
  }, 30_000);

  test("includes reveal.js + the compiled slipway theme", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    expect(html).toMatch(/reveal\.js/);
    expect(html).toContain('data-from="theme.css"');
    expect(html.toLowerCase()).toContain("#3a4a52"); // charcoal from theme.scss
    expect(html.toLowerCase()).toContain("#b8d6ee"); // sky from theme.scss
  }, 30_000);

  test("{{< include _snippet.qmd >}} expands inline into the rendered deck", async () => {
    // Regression guard for a Phase 1 latent bug: expandIncludes() existed but
    // buildRenderInputs never populated the includes map, so the demo's
    // include shortcode silently rendered as an invisible HTML comment.
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    expect(html).toContain("was included from");
    expect(html).not.toMatch(/include\s+_snippet\.qmd\s+not\s+found/);
  }, 30_000);

  test("seed theme.scss carries Quarto layer markers (round-trip compatibility)", async () => {
    // Real Quarto refuses any reveal.js theme SCSS without at least one layer
    // boundary (/*-- scss:defaults --*/, /*-- scss:rules --*/, etc.). Dart Sass
    // treats these as plain CSS comments so Slipway's render is unaffected, but
    // their presence is what lets a user `quarto render` an exported Slipway
    // project unchanged.
    const scss = await readFile(resolve(DEMO, "theme.scss"), "utf8");
    expect(scss).toMatch(/\/\*--\s*scss:defaults\s*--\*\//);
    expect(scss).toMatch(/\/\*--\s*scss:rules\s*--\*\//);
  });

  test("accepts a pre-compiled .css stylesheet as-is", async () => {
    const inputs: RenderInputs = {
      qmd: "---\ntitle: CSS probe\n---\n\n# Hi\n",
      stylesheet: ".reveal { --probe-marker: rgb(123,45,67); }",
      stylesheetIsPrecompiled: true,
      bib: null,
      assets: new Map(),
      includes: new Map(),
    };
    const { html } = await renderDeck(pandoc, inputs);
    expect(html).toContain('data-from="theme.css"');
    expect(html).toContain("--probe-marker: rgb(123,45,67)");
  }, 30_000);

  test("inlines reveal.js and KaTeX — no external CDN refs left in the deck", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    const externalLinks   = html.match(/<link\b[^>]*href=["']https?:\/\/[^"']+["'][^>]*>/g)   ?? [];
    const externalScripts = html.match(/<script\b[^>]*src=["']https?:\/\/[^"']+["'][^>]*>/g)  ?? [];
    expect([...externalLinks, ...externalScripts]).toEqual([]);
    expect(html).toContain('data-from="https://unpkg.com/reveal.js@^5/dist/reveal.js"');
    expect(html).toContain('data-from="slipway:katex-js"');
    expect(html).toContain('data-from="slipway:katex-css"');
  }, 30_000);

  test("KaTeX fonts are inlined as data URIs — no relative font URLs remain", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    // All font-face src entries must be data URIs; no url(fonts/...) should survive.
    expect(html).not.toMatch(/url\(fonts\/KaTeX_/);
    expect(html).toMatch(/url\(data:font\/woff2;base64,/);
  }, 30_000);

  test("renders columns, incremental lists, and citations", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    expect(html).toMatch(/class="[^"]*\bcolumns\b/);
    expect(html).toMatch(/class="[^"]*\bfragment\b/);
    expect(html).toContain('id="refs"');
    expect(html).toMatch(/csl-(entry|bib)/);
  }, 30_000);

  test("renders footnotes", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    expect(html).toMatch(/footnote/i);
  }, 30_000);

  test("renders math via KaTeX", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    expect(html).toMatch(/katex/i);
  }, 30_000);

  test("user's format.revealjs options reach the deck via Reveal.configure()", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    expect(html).toContain('data-from="slipway:user-reveal-config"');
    expect(html).toContain('"navigationMode":"linear"');
    expect(html).toContain('"controlsLayout":"bottom-right"');
    expect(html).toContain('"slideNumber":true');
  }, 30_000);

  test("override script lands after inlined plugin source, not inside it", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    const overrideIdx          = html.indexOf('data-from="slipway:user-reveal-config"');
    const lastInlinedRevealAsset = html.lastIndexOf('data-from="https://unpkg.com/reveal.js@^5');
    expect(overrideIdx).toBeGreaterThan(0);
    expect(lastInlinedRevealAsset).toBeGreaterThan(0);
    expect(overrideIdx).toBeGreaterThan(lastInlinedRevealAsset);
  }, 30_000);

  test("sandbox-compat polyfill is injected before reveal.js", async () => {
    const { html } = await renderDeck(pandoc, await loadDemoInputs());
    const compatIdx  = html.indexOf('data-from="slipway:sandbox-compat"');
    const revealIdx  = html.indexOf('data-from="https://unpkg.com/reveal.js@^5/dist/reveal.js"');
    expect(compatIdx).toBeGreaterThan(0);
    expect(revealIdx).toBeGreaterThan(0);
    // polyfill must appear before reveal.js so storage shims are in place first
    expect(compatIdx).toBeLessThan(revealIdx);
    // localStorage shim must be present
    expect(html).toContain("localStorage");
    // history shim must be present
    expect(html).toContain("replaceState");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Secondary suite — imago-workshop fixture (extra pipeline coverage)
// ---------------------------------------------------------------------------

describe("imago-workshop deck (pipeline regression)", () => {
  test("inlines local PNG assets as data URIs", async () => {
    const { html } = await renderDeck(pandoc, await loadImagoInputs());
    expect(html).toContain("data:image/png;base64,");
  }, 30_000);

  test("leaves external image URLs intact", async () => {
    const { html } = await renderDeck(pandoc, await loadImagoInputs());
    expect(html).toContain("upload.wikimedia.org");
  }, 30_000);

  test("applies imago theme and slide-class styling", async () => {
    const { html } = await renderDeck(pandoc, await loadImagoInputs());
    expect(html.toLowerCase()).toContain("#24226f"); // imago navy
    expect(html).toContain("Figtree");
    expect(html).toMatch(/class="[^"]*\bdark\b/);
    expect(html).toMatch(/class="[^"]*\bhlg\b/);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Seeded Imago theme — self-hosted fonts inlined offline
// ---------------------------------------------------------------------------

describe("seeded Imago theme", () => {
  test("self-hosts Figtree — no Google Fonts @import survives", async () => {
    const { html } = await renderDeck(pandoc, await loadSeededImagoInputs());
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).toContain("@font-face");
    expect(html).toContain("Figtree");
  }, 30_000);

  test("Figtree woff2 files are inlined as data URIs — no relative font URLs remain", async () => {
    const { html } = await renderDeck(pandoc, await loadSeededImagoInputs());
    // The compiled theme is inlined into a <style> in the null-origin iframe,
    // so every @font-face src must be a data URI (relative fonts/ paths can't resolve).
    expect(html).not.toMatch(/url\(['"]?fonts\/figtree/);
    expect(html).toMatch(/url\(data:font\/woff2;base64,/);
  }, 30_000);

  test("imago.scss carries Quarto layer markers (round-trip compatibility)", async () => {
    const scss = await readFile(resolve(DEMO, "assets/imago.scss"), "utf8");
    expect(scss).toMatch(/\/\*--\s*scss:defaults\s*--\*\//);
    expect(scss).toMatch(/\/\*--\s*scss:rules\s*--\*\//);
    // @font-face must use a path relative to the stylesheet so `quarto render`
    // resolves the bundled fonts on disk offline (no absolute / CDN URL).
    expect(scss).toMatch(/url\('fonts\/figtree\/figtree-[\w-]+\.woff2'\)/);
    expect(scss).not.toMatch(/fonts\.googleapis\.com/);
  });
});

// ---------------------------------------------------------------------------
// Seeded Journal theme — self-hosted ET Book inlined offline
// ---------------------------------------------------------------------------

describe("seeded Journal theme", () => {
  test("ET Book woff files are inlined as data URIs — no relative font URLs remain", async () => {
    const { html } = await renderDeck(pandoc, await loadSeededJournalInputs());
    expect(html).not.toMatch(/url\(["']?fonts\/et-book/);
    expect(html).toMatch(/url\(data:font\/woff;base64,/);
    expect(html).toContain("et-book");
  }, 30_000);

  test("journal.scss carries Quarto layer markers and woff-only @font-face", async () => {
    const scss = await readFile(resolve(DEMO, "assets/journal.scss"), "utf8");
    expect(scss).toMatch(/\/\*--\s*scss:defaults\s*--\*\//);
    expect(scss).toMatch(/\/\*--\s*scss:rules\s*--\*\//);
    expect(scss).toMatch(/url\("fonts\/et-book\/[\w/-]+\.woff"\)/);
    // Trimmed: no eot/ttf/svg fallbacks should remain to bloat the deck.
    expect(scss).not.toMatch(/\.(eot|ttf|svg)["?#]/);
  });
});

// ---------------------------------------------------------------------------
// Font-URL inlining (unit)
// ---------------------------------------------------------------------------

describe("inlineFontUrls", () => {
  test("rewrites matching url() refs to data URIs by basename", async () => {
    const { inlineFontUrls } = await import("../src/core/inline-assets");
    const css = `@font-face { src: url('fonts/figtree/x.woff2') format('woff2'); }`;
    const out = inlineFontUrls(css, new Map([["x.woff2", "data:font/woff2;base64,AAA"]]));
    expect(out).toContain("url(data:font/woff2;base64,AAA)");
    expect(out).not.toContain("fonts/figtree/x.woff2");
  });

  test("leaves unknown url() refs untouched", async () => {
    const { inlineFontUrls } = await import("../src/core/inline-assets");
    const css = `@font-face { src: url('fonts/other.woff2'); }`;
    expect(inlineFontUrls(css, new Map([["x.woff2", "data:font/woff2;base64,AAA"]]))).toBe(css);
  });

  test("no-op when there are no font assets", async () => {
    const { inlineFontUrls } = await import("../src/core/inline-assets");
    const css = `.reveal { color: red; }`;
    expect(inlineFontUrls(css, new Map())).toBe(css);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter extraction unit tests
// ---------------------------------------------------------------------------

describe("frontmatter declaration extraction", () => {
  test("top-level theme: and bibliography:", () => {
    const qmd = `---
title: A
theme: weird/path.scss
bibliography: refs.bib
---

# Hi
`;
    expect(extractDeclarations(qmd)).toEqual({
      theme: "weird/path.scss",
      bib: "refs.bib",
      revealjsOptions: {},
    });
  });

  test("nested format.revealjs.theme: + other options lift to camelCase", () => {
    const qmd = `---
title: A
format:
  revealjs:
    theme: imago.scss
    controls: false
    controls-layout: bottom-right
    navigation-mode: linear
    center: false
bibliography: refs.bib
---

# Hi
`;
    expect(extractDeclarations(qmd)).toEqual({
      theme: "imago.scss",
      bib: "refs.bib",
      revealjsOptions: {
        controls: false,
        controlsLayout: "bottom-right",
        navigationMode: "linear",
        center: false,
      },
    });
  });

  test("missing frontmatter is fine", () => {
    expect(extractDeclarations("# Hi\nbody\n")).toEqual({ theme: null, bib: null, revealjsOptions: {} });
  });

  test("malformed YAML doesn't throw", () => {
    expect(extractDeclarations("---\nthis: : : not yaml\n---\n")).toEqual({
      theme: null,
      bib: null,
      revealjsOptions: {},
    });
  });
});

// ---------------------------------------------------------------------------
// resolveDeclaredPath unit tests
// ---------------------------------------------------------------------------

describe("resolveDeclaredPath", () => {
  const tree = [
    "slide.qmd",
    "assets/imago.scss",
    "assets/references.bib",
    "themes/dark.scss",
    "themes/light.scss",
  ];

  test("exact match wins", () => {
    expect(resolveDeclaredPath("assets/imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("strips leading ../ to resolve the imago workshop case", () => {
    expect(resolveDeclaredPath("../assets/imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("strips multiple leading ../", () => {
    expect(resolveDeclaredPath("../../assets/imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("strips leading ./", () => {
    expect(resolveDeclaredPath("./assets/imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("unambiguous basename fallback", () => {
    expect(resolveDeclaredPath("imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("ambiguous basename returns null (caller decides)", () => {
    expect(resolveDeclaredPath("dark.scss", [...tree, "alt/dark.scss"])).toBeNull();
  });

  test("unknown file returns null", () => {
    expect(resolveDeclaredPath("nope.scss", tree)).toBeNull();
  });

  test("exact match preferred over basename", () => {
    const t = [...tree, "assets/dark.scss"];
    expect(resolveDeclaredPath("themes/dark.scss", t)).toBe("themes/dark.scss");
  });
});

describe("rebaseChildPath", () => {
  test("grafts the sub-path onto the new folder", () => {
    expect(rebaseChildPath("a", "b/c", "a/x/y.qmd")).toBe("b/c/x/y.qmd");
  });

  test("moving a root file's folder (single segment)", () => {
    expect(rebaseChildPath("demos", "archive/demos", "demos/slide.qmd")).toBe(
      "archive/demos/slide.qmd",
    );
  });

  test("leaves a path that isn't under oldDir untouched", () => {
    expect(rebaseChildPath("demos", "archive", "assets/theme.scss")).toBe("assets/theme.scss");
  });

  test("does not treat a sibling prefix as a child (demos vs demos-old)", () => {
    expect(rebaseChildPath("demos", "archive", "demos-old/slide.qmd")).toBe("demos-old/slide.qmd");
  });
});

// ---------------------------------------------------------------------------
// Synthetic probes for features not present in either bundled template
// ---------------------------------------------------------------------------

describe("synthetic feature probes", () => {
  test('"::: notes" fenced div becomes <aside class="notes">', async () => {
    const inputs: RenderInputs = {
      qmd: "---\ntitle: Notes probe\n---\n\n# Notes\n\nVisible.\n\n::: notes\n\nSpeaker-only.\n\n:::\n",
      stylesheet: "",
      stylesheetIsPrecompiled: false,
      bib: null,
      assets: new Map(),
      includes: new Map(),
    };
    const { html } = await renderDeck(pandoc, inputs);
    expect(html).toMatch(/class="[^"]*\bnotes\b/);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Export PDF — print variant transformations
// ---------------------------------------------------------------------------

describe("buildPrintVariant", () => {
  const baseline = `<!doctype html><html><head><title>t</title></head><body>
<div class="reveal"><div class="slides"><section>hi</section></div></div>
<script>Reveal.initialize({ controls: true, hash: true });</script>
</body></html>`;

  test("injects view: \"print\" into Reveal.initialize", () => {
    const out = buildPrintVariant(baseline);
    expect(out).toContain('view: "print",');
    // The original option must still be there — we prepend, not replace.
    expect(out).toContain("controls: true");
  });

  test("inlines reveal's print stylesheet and the auto-print script", () => {
    const out = buildPrintVariant(baseline);
    expect(out).toContain('data-from="slipway:reveal-print"');
    expect(out).toContain('data-from="slipway:auto-print"');
    expect(out).toContain("window.print()");
    // A selector that only the bundled print CSS supplies, so we know the
    // virtual module's content actually reached the output.
    expect(out).toContain("reveal-print");
  });

  test("places the print blocks before the last </body>", () => {
    const out = buildPrintVariant(baseline);
    const lastBody = out.lastIndexOf("</body>");
    expect(out.indexOf('data-from="slipway:reveal-print"')).toBeLessThan(lastBody);
    expect(out.indexOf('data-from="slipway:auto-print"')).toBeLessThan(lastBody);
  });

  test("forces landscape orientation via @page", () => {
    // iOS Safari ignores `@page { size: <px> }` but honors the keyword form;
    // increment 30.1 prepends an explicit `size: landscape` rule so a 16:9
    // deck fits one slide per page instead of letterboxing onto portrait A4.
    const out = buildPrintVariant(baseline);
    expect(out).toContain('data-from="slipway:print-page"');
    expect(out).toMatch(/@page\s*\{\s*size:\s*landscape/);
  });
});
