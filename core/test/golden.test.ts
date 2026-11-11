// Golden-output test: every fixture deck must render to exactly the HTML
// recorded in test/goldens/goldens.json. This is the guard for the Phase 4
// shared core — the PWA, the CLI and the VS Code extension must all produce
// the same bytes for the same deck, and each of them checks its own output
// against this same goldens.json.
//
// The rendered HTML is several MB per deck (reveal.js + KaTeX fonts are
// inlined), so the goldens are stored as SHA-256 + byte length rather than
// as the documents themselves.
//
// Intentional output change? Regenerate with:
//   UPDATE_GOLDENS=1 npm test
// and commit the updated goldens.json alongside the change that caused it.
// On a mismatch the actual HTML is written to test/goldens/.actual/ so it
// can be diffed against a render from the previous commit.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, test } from "vitest";

import { buildPrintVariant, buildRenderInputsSync, createPandocInstanceSync, renderDeck, renderDeckSync } from "../src/index";
import { loadPandoc, pandocWasmPath } from "./helpers/pandoc";
import { dirProjectFSSync, loadProjectInputs } from "./helpers/project";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = resolve(HERE, "../../app/src/templates/slipway-demo");
const IMAGO = resolve(HERE, "fixtures/imago-workshop");
const GOLDENS = resolve(HERE, "goldens/goldens.json");
const ACTUAL_DIR = resolve(HERE, "goldens/.actual");
const UPDATE = !!process.env.UPDATE_GOLDENS;

const pandoc = await loadPandoc();

interface Golden { sha256: string; bytes: number }
const recorded: Record<string, Golden> = existsSync(GOLDENS)
  ? JSON.parse(readFileSync(GOLDENS, "utf8"))
  : {};
const seen: Record<string, Golden> = {};

function check(name: string, html: string): void {
  const buf = Buffer.from(html, "utf8");
  const actual: Golden = {
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
  seen[name] = actual;
  if (UPDATE) return;
  if (JSON.stringify(recorded[name]) !== JSON.stringify(actual)) {
    mkdirSync(ACTUAL_DIR, { recursive: true });
    writeFileSync(resolve(ACTUAL_DIR, `${name}.html`), buf);
  }
  expect(actual, `golden mismatch for "${name}" (actual HTML in test/goldens/.actual/)`).toEqual(recorded[name]);
}

const JOURNAL_PROBE = `---
title: Journal probe
format:
  revealjs:
    theme: assets/journal.scss
    controls: false
---

# A serif heading

Body text in ET Book, with math $e^{i\\pi} + 1 = 0$.

## Second slide

- one
- two
`;

const DECKS: Array<{ name: string; load: () => ReturnType<typeof loadProjectInputs> }> = [
  { name: "demo-slide", load: () => loadProjectInputs(DEMO, "demos/slide.qmd") },
  { name: "demo-imago-showcase", load: () => loadProjectInputs(DEMO, "demos/imago-showcase.qmd") },
  { name: "imago-workshop", load: () => loadProjectInputs(IMAGO, "slide.qmd") },
  { name: "journal-probe", load: () => loadProjectInputs(DEMO, "probe.qmd", { "probe.qmd": JOURNAL_PROBE }) },
];

describe("golden outputs", () => {
  for (const deck of DECKS) {
    test(`${deck.name} renders to the recorded HTML`, async () => {
      const { html } = await renderDeck(pandoc, await deck.load());
      check(deck.name, html);
      // The print variant is derived purely from the rendered HTML; lock it
      // down for one deck.
      if (deck.name === "demo-slide") check("demo-slide.print", buildPrintVariant(html));
    }, 60_000);
  }

  test("the synchronous path (buildRenderInputsSync + renderDeckSync) gives the same bytes", async () => {
    // What the a-Shell adapter uses. Checked against the same goldens as
    // the async path, for the deck with includes + bibliography and the one
    // with fonts and an image.
    const pandocSync = createPandocInstanceSync(readFileSync(pandocWasmPath()));
    for (const [name, root, deck] of [
      ["demo-slide", DEMO, "demos/slide.qmd"],
      ["demo-imago-showcase", DEMO, "demos/imago-showcase.qmd"],
      ["imago-workshop", IMAGO, "slide.qmd"],
    ] as const) {
      const result = renderDeckSync(pandocSync, buildRenderInputsSync(deck, dirProjectFSSync(root)));
      expect(result.ok).toBe(true);
      const buf = Buffer.from(result.html, "utf8");
      expect({ sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length }, name).toEqual(recorded[name]);
    }
  }, 120_000);

  afterAll(() => {
    if (UPDATE) writeFileSync(GOLDENS, JSON.stringify(seen, null, 2) + "\n");
  });
});
