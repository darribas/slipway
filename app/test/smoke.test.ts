// Phase 1 smoke test: drive the production render pipeline (render.ts)
// against the bundled imago workshop template and assert on the output.
//
// This is the regression net for Phase 2's UI work. If a refactor of the
// pane layout, file tree, or anything else silently breaks the renderer
// (preprocessing, SCSS compilation, pandoc invocation), this test catches
// it before the change reaches main.
//
// Mirrors the spirit of phase0/smoke.js — same workshop deck, same
// assertions — but drives app/src/core/render.ts directly so we're
// exercising the *current* code path, not the frozen Phase 0 inline copy.

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
const TEMPLATE = resolve(HERE, "../src/templates/imago-workshop");

async function loadInputs(): Promise<RenderInputs> {
  const [qmd, scss, bib, png] = await Promise.all([
    readFile(resolve(TEMPLATE, "slide.qmd"), "utf8"),
    readFile(resolve(TEMPLATE, "imago.scss"), "utf8"),
    readFile(resolve(TEMPLATE, "references.bib"), "utf8"),
    readFile(resolve(TEMPLATE, "attention_paper.png")),
  ]);
  return {
    qmd,
    stylesheet: scss,
    stylesheetIsPrecompiled: false,
    bib,
    assets: new Map([["attention_paper.png", new Uint8Array(png)]]),
  };
}

// pandoc-wasm's exported `convert` is shaped exactly like PandocInstance.convert,
// so we can use it directly as the renderer's pandoc dependency.
const pandoc: PandocInstance = { convert: convert as PandocInstance["convert"] };

describe("imago workshop deck", () => {
  test("renders end-to-end through renderDeck()", async () => {
    const inputs = await loadInputs();
    const result = await renderDeck(pandoc, inputs);

    expect(result.html.length).toBeGreaterThan(50_000);
    expect(result.stderr).toBe("");
    expect(result.html).toMatch(/<title>/);
  }, 30_000);

  test("includes reveal.js + the compiled imago theme", async () => {
    const { html } = await renderDeck(pandoc, await loadInputs());
    expect(html).toMatch(/reveal\.js/);
    // The theme.css used to be a dangling <link> pointing at the WASI VFS
    // path, so the iframe could never resolve it. Post-pandoc we now inline
    // the compiled CSS as a <style data-from="theme.css"> block. Assert both
    // the wrapper and recognisable imago palette colours from the SCSS so we
    // catch silent regressions of the inlining pass.
    expect(html).toContain('data-from="theme.css"');
    expect(html.toLowerCase()).toContain("#24226f"); // imago navy
    expect(html).toContain("Figtree"); // imago font family
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

  test("inlines reveal.js — no external <link>/<script> refs left in the deck", async () => {
    const { html } = await renderDeck(pandoc, await loadInputs());
    // The two things that actually trigger network fetches are <link href="…">
    // and <script src="…"> pointing at external URLs. The post-inline data-from
    // attribute keeps the original URL for traceability and is fine.
    const externalLinks = html.match(/<link\b[^>]*href=["']https?:\/\/[^"']+["'][^>]*>/g) ?? [];
    const externalScripts = html.match(/<script\b[^>]*src=["']https?:\/\/[^"']+["'][^>]*>/g) ?? [];
    // KaTeX is still loaded from a CDN in the template; we haven't inlined it
    // (workshop deck has no math). Filter those out before asserting.
    const remaining = [...externalLinks, ...externalScripts].filter((t) => !/katex/i.test(t));
    expect(remaining).toEqual([]);
    // Presence of the data-from stamp confirms the substitution actually ran
    // (rather than pandoc's template having changed format under us).
    expect(html).toContain('data-from="https://unpkg.com/reveal.js@^5/dist/reveal.js"');
  }, 30_000);

  test("applies imago slide-class styling and column layouts", async () => {
    const { html } = await renderDeck(pandoc, await loadInputs());
    expect(html).toMatch(/class="[^"]*\bdark\b/); // .dark slide class survives
    expect(html).toMatch(/class="[^"]*\bcolumns\b/); // ::: {.columns} fenced div
    expect(html).toMatch(/class="[^"]*\bhlg\b/); // .hlg utility class on spans
  }, 30_000);

  test("renders citations, footnotes, and the bibliography", async () => {
    const { html } = await renderDeck(pandoc, await loadInputs());
    expect(html).toMatch(/footnote/i);
    expect(html).toContain('id="refs"');
    expect(html).toMatch(/csl-(entry|bib)/);
  }, 30_000);

  test("inlines local PNG assets as data URIs", async () => {
    const { html } = await renderDeck(pandoc, await loadInputs());
    expect(html).toContain("data:image/png;base64,");
  }, 30_000);

  test("leaves external image URLs intact", async () => {
    const { html } = await renderDeck(pandoc, await loadInputs());
    expect(html).toContain("upload.wikimedia.org");
  }, 30_000);

  test("renders ::: {.incremental} as reveal.js fragments", async () => {
    const { html } = await renderDeck(pandoc, await loadInputs());
    expect(html).toMatch(/class="[^"]*\bfragment\b/);
  }, 30_000);

  test("user's format.revealjs options reach the deck via Reveal.configure()", async () => {
    // The workshop deck has `controls-layout: 'bottom-right'`, `center: false`,
    // `navigation-mode: linear` under format.revealjs. The first comes through
    // pandoc's template natively; the latter two are boolean/keyword values
    // that pandoc's $if$ skips when false — so we have to apply them via
    // Reveal.configure() post-init. Assert the override script is present
    // and carries the booleans the user set.
    const { html } = await renderDeck(pandoc, await loadInputs());
    expect(html).toContain('data-from="slipway:user-reveal-config"');
    expect(html).toContain('"center":false');
    expect(html).toContain('"navigationMode":"linear"');
    expect(html).toContain('"controlsLayout":"bottom-right"');
  }, 30_000);
});

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
    // The seed deck declares `theme: ../assets/imago.scss` because in the
    // real workshop the qmd lives in `slides/`. Our IDB is flat from the
    // project root, so the ../ has to be normalised away.
    expect(resolveDeclaredPath("../assets/imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("strips multiple leading ../", () => {
    expect(resolveDeclaredPath("../../assets/imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("strips leading ./", () => {
    expect(resolveDeclaredPath("./assets/imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("unambiguous basename fallback", () => {
    // User declared theme: imago.scss with no directory; we find it anyway.
    expect(resolveDeclaredPath("imago.scss", tree)).toBe("assets/imago.scss");
  });

  test("ambiguous basename returns null (caller decides)", () => {
    expect(resolveDeclaredPath("dark.scss", [...tree, "alt/dark.scss"])).toBeNull();
  });

  test("unknown file returns null", () => {
    expect(resolveDeclaredPath("nope.scss", tree)).toBeNull();
  });

  test("exact match preferred over basename", () => {
    // `themes/dark.scss` and `assets/dark.scss` both exist; declared path
    // matches one of them — use that, don't trigger the ambiguous-basename
    // fallback.
    const t = [...tree, "assets/dark.scss"];
    expect(resolveDeclaredPath("themes/dark.scss", t)).toBe("themes/dark.scss");
  });
});

describe("synthetic features the workshop deck doesn't exercise", () => {
  test("KaTeX assets are injected when math is present", async () => {
    const inputs: RenderInputs = {
      qmd: "---\ntitle: Math probe\n---\n\n# Math\n\n$E = mc^2$\n",
      scss: "",
      bib: null,
      assets: new Map(),
    };
    const { html } = await renderDeck(pandoc, inputs);
    expect(html).toMatch(/katex/i);
  }, 30_000);

  test('"::: notes" fenced div becomes <aside class="notes">', async () => {
    const inputs: RenderInputs = {
      qmd: "---\ntitle: Notes probe\n---\n\n# Notes\n\nVisible.\n\n::: notes\n\nSpeaker-only.\n\n:::\n",
      scss: "",
      bib: null,
      assets: new Map(),
    };
    const { html } = await renderDeck(pandoc, inputs);
    expect(html).toMatch(/class="[^"]*\bnotes\b/);
  }, 30_000);
});
