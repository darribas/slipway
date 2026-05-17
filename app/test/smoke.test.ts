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
    scss,
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
    expect(html).toMatch(/<link[^>]*theme\.css/);
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
