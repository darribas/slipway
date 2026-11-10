// slideMap() is a line scanner that has to agree with how pandoc actually
// lays out a revealjs deck. Rather than hand-writing expected indices, most
// tests here render the deck with real pandoc, read the <section> structure
// out of the HTML, and require slideMap to produce the same (h, v) sequence.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { preprocessDeck, slideAtIndex, slideAtLine, slideMap } from "../src/index";
import { loadPandoc } from "./helpers/pandoc";
import { loadProjectInputs } from "./helpers/project";
import { htmlSlideIndices } from "./helpers/slides";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = resolve(HERE, "../../app/src/templates/slipway-demo");
const IMAGO = resolve(HERE, "fixtures/imago-workshop");

const pandoc = await loadPandoc();

async function pandocSlides(qmd: string, includes = new Map<string, string>()): Promise<string[]> {
  const { qmd: expanded } = preprocessDeck(qmd, { includes });
  const { stdout } = await pandoc.convert(
    { from: "markdown", to: "revealjs", standalone: true, "slide-level": 2 },
    expanded,
    {},
  );
  return htmlSlideIndices(stdout);
}

const indices = (qmd: string, includes?: Map<string, string>) =>
  slideMap(qmd, includes).map((s) => `${s.h}.${s.v}`);

describe("slideMap agrees with pandoc on the fixture decks", () => {
  for (const [name, root, path] of [
    ["demo slide.qmd", DEMO, "demos/slide.qmd"],
    ["imago showcase", DEMO, "demos/imago-showcase.qmd"],
    ["imago workshop", IMAGO, "slide.qmd"],
  ] as const) {
    test(name, async () => {
      const inputs = await loadProjectInputs(root, path);
      expect(indices(inputs.qmd, inputs.includes)).toEqual(await pandocSlides(inputs.qmd, inputs.includes));
    }, 30_000);
  }
});

const CASES: Record<string, string> = {
  "title + h1 groups with nested h2": "---\ntitle: T\n---\n\n# A\n\n## A1\n\ntext\n\n## A2\n\n# B\n\n## B1\n",
  "no frontmatter": "# A\n\ntext\n\n## A1\n\n# B\n",
  "frontmatter without a title": "---\nauthor: Me\n---\n\n# A\n\n## A1\n",
  "h2 slides before any h1": "---\ntitle: T\n---\n\n## One\n\n## Two\n\n# Section\n\n## Three\n",
  "only h2 slides": "## One\n\na\n\n## Two\n\nb\n\n## Three\n",
  "content before the first heading": "---\ntitle: T\n---\n\nLoose paragraph.\n\n# A\n\n## A1\n",
  "content on an h1 title slide": "# A\n\nIntro text on the section slide.\n\n## A1\n\n# B\n\nMore.\n",
  "horizontal rules split slides": "---\ntitle: T\n---\n\n## One\n\na\n\n---\n\nb\n\n---\n\nc\n\n# Sec\n\nx\n\n---\n\ny\n",
  "rule directly before a heading": "## One\n\na\n\n---\n\n## Two\n\nb\n",
  "other rule spellings": "## One\n\na\n\n***\n\nb\n\n_ _ _\n\nc\n\n- - -\n\nd\n",
  "h3 and deeper stay inside the slide": "# A\n\n## A1\n\n### Sub\n\ntext\n\n#### Deeper\n\n## A2\n",
  "headings inside fenced code are ignored": "## One\n\n```markdown\n# Not a slide\n\n## Nor this\n\n---\n```\n\n~~~\n# still code\n~~~\n\n## Two\n",
  "longer fence is not closed by a shorter one": "## One\n\n````\n```\n# inside\n```\n````\n\n## Two\n",
  "headings inside fenced divs are ignored": "## One\n\n::: {.columns}\n::: {.column}\n\n## Inside a column\n\n:::\n:::\n\n## Two\n",
  "hash inside a paragraph is not a heading": "## One\n\nSome text\n# not a heading\nmore\n\n## Two\n",
  "setext headings": "Section\n=======\n\nSlide\n-----\n\ntext\n\nAnother\n-------\n",
  "heading with attributes": "# A {.dark}\n\n## A1 {background-color=\"#000\"}\n\n## A2 {.scrollable}\n",
  "html comments are ignored": "## One\n\n<!--\n# hidden\n\n## hidden too\n-->\n\n## Two\n",
  "empty heading": "## One\n\n##\n\ntext\n\n## Three\n",
  "speaker notes and incremental divs": "## One\n\n::: {.incremental}\n- a\n- b\n:::\n\n::: notes\nSpeaker text.\n\n### a small heading\n:::\n\n## Two\n",
};

describe("slideMap agrees with pandoc on synthetic decks", () => {
  for (const [name, qmd] of Object.entries(CASES)) {
    test(name, async () => {
      expect(indices(qmd)).toEqual(await pandocSlides(qmd));
    }, 30_000);
  }
});

describe("slideMap line spans", () => {
  const qmd = [
    "---",            // 0
    "title: T",       // 1
    "---",            // 2
    "",               // 3
    "# A",            // 4
    "",               // 5
    "## A1",          // 6
    "",               // 7
    "text",           // 8
    "",               // 9
    "## A2",          // 10
    "more",           // 11
    "",               // 12
  ].join("\n");

  test("spans are contiguous, 0-based and inclusive", () => {
    expect(slideMap(qmd)).toEqual([
      { h: 0, v: 0, startLine: 0, endLine: 3 },
      { h: 1, v: 0, startLine: 4, endLine: 5 },
      { h: 1, v: 1, startLine: 6, endLine: 9 },
      { h: 1, v: 2, startLine: 10, endLine: 12 },
    ]);
  });

  test("slideAtLine finds the slide under a cursor line", () => {
    const spans = slideMap(qmd);
    expect(slideAtLine(spans, 0)).toMatchObject({ h: 0, v: 0 });
    expect(slideAtLine(spans, 5)).toMatchObject({ h: 1, v: 0 });
    expect(slideAtLine(spans, 8)).toMatchObject({ h: 1, v: 1 });
    expect(slideAtLine(spans, 999)).toMatchObject({ h: 1, v: 2 });
    expect(slideAtLine([], 3)).toBeNull();
  });

  test("slideAtIndex finds the source span for a reveal position", () => {
    const spans = slideMap(qmd);
    expect(slideAtIndex(spans, 1, 1)).toMatchObject({ startLine: 6 });
    // Unknown vertical index falls back to the top of that horizontal stack.
    expect(slideAtIndex(spans, 1, 9)).toMatchObject({ startLine: 4 });
    expect(slideAtIndex(spans, 9, 0)).toBeNull();
  });

  test("slides from an include all map to the shortcode's line", async () => {
    const deck = "---\ntitle: T\n---\n\n# A\n\n{{< include _part.qmd >}}\n\n## After\n";
    const includes = new Map([["_part.qmd", "## From include 1\n\nx\n\n## From include 2\n\ny\n"]]);
    const spans = slideMap(deck, includes);
    expect(spans.map((s) => `${s.h}.${s.v}`)).toEqual(await pandocSlides(deck, includes));
    expect(spans.map((s) => s.startLine)).toEqual([0, 4, 6, 6, 8]);
    // Without the includes map the shortcode is just content on the "A" slide.
    expect(slideMap(deck).map((s) => s.startLine)).toEqual([0, 4, 8]);
  });

  test("CRLF line endings don't hide headings", () => {
    expect(slideMap("# A\r\n\r\n## B\r\n").map((s) => `${s.h}.${s.v}`)).toEqual(["0.0", "0.1"]);
  });
});
