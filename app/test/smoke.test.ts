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
import { extractDeclarations } from "../src/core/frontmatter";
import { resolveDeclaredPath } from "../src/core/path-resolve";
import type { PandocInstance, RenderInputs } from "../src/core/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO    = resolve(HERE, "../src/templates/slipway-demo");
const IMAGO   = resolve(HERE, "fixtures/imago-workshop");

async function loadDemoInputs(): Promise<RenderInputs> {
  const [qmd, scss, bib] = await Promise.all([
    readFile(resolve(DEMO, "slide.qmd"),       "utf8"),
    readFile(resolve(DEMO, "theme.scss"),       "utf8"),
    readFile(resolve(DEMO, "references.bib"),   "utf8"),
  ]);
  return {
    qmd,
    stylesheet: scss,
    stylesheetIsPrecompiled: false,
    bib,
    assets: new Map(),
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

  test("accepts a pre-compiled .css stylesheet as-is", async () => {
    const inputs: RenderInputs = {
      qmd: "---\ntitle: CSS probe\n---\n\n# Hi\n",
      stylesheet: ".reveal { --probe-marker: rgb(123,45,67); }",
      stylesheetIsPrecompiled: true,
      bib: null,
      assets: new Map(),
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
    };
    const { html } = await renderDeck(pandoc, inputs);
    expect(html).toMatch(/class="[^"]*\bnotes\b/);
  }, 30_000);
});
