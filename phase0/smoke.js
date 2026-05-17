/*
 * Phase 0 smoke test — Node-side mirror of index.html's pipeline.
 *
 * Runs the same SCSS-compile / preprocess / pandoc-convert sequence outside
 * a browser, asserts against the rendered HTML, and writes the full output
 * to sample-output.html. Useful when you want to validate the pipeline
 * without waiting for the ~56MB pandoc.wasm CDN fetch a browser triggers.
 *
 * Prerequisites:
 *   cd phase0 && npm init -y && npm pkg set type=module \
 *     && npm install pandoc-wasm@1.0.1 sass@1.83.0
 *
 * Run:
 *   node smoke.js
 *
 * Expected output: "12/12 checks passed".
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "pandoc-wasm";
import * as sass from "sass";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "assets");

function expandIncludes(qmd) {
  return qmd.replace(
    /\{\{<\s*include\s+([^\s>]+)\s*>\}\}/g,
    (_m, p) => `<!-- {{< include ${p} >}} skipped in Phase 0 -->`,
  );
}

function preprocessDeck(qmd, localAssetUris) {
  const fmMatch = qmd.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    let yaml = fmMatch[1];
    yaml = yaml.replace(/^\s*theme:.*\n?/gm, "");
    yaml = yaml.replace(/^\s*bibliography:.*\n?/gm, "");
    yaml = yaml.replace(/^format:\s*\n(?:[ \t]+.*\n?)+/gm, "");
    qmd = qmd.replace(fmMatch[0], `---\n${yaml.trim()}\n---\n`);
  }
  qmd = qmd.replace(
    /!\[([^\]]*)\]\(((?:\.\.\/)?assets\/([^)]+))\)/g,
    (m, alt, _full, file) => {
      const uri = localAssetUris.get(file);
      return uri ? `![${alt}](${uri})` : m;
    },
  );
  return qmd;
}

const t0 = performance.now();
const [qmd, scss, bib, png] = await Promise.all([
  readFile(`${ASSETS}/slide.qmd`, "utf8"),
  readFile(`${ASSETS}/imago.scss`, "utf8"),
  readFile(`${ASSETS}/references.bib`, "utf8"),
  readFile(`${ASSETS}/attention_paper.png`),
]);
console.log(
  `assets read in ${Math.round(performance.now() - t0)}ms — qmd=${qmd.length} scss=${scss.length} bib=${bib.length} png=${png.length}`,
);

const t1 = performance.now();
const css = sass.compileString(scss, { style: "expanded" }).css;
console.log(`sass → ${css.length} chars CSS in ${Math.round(performance.now() - t1)}ms`);

const pngUri = `data:image/png;base64,${png.toString("base64")}`;
const localAssetUris = new Map([["attention_paper.png", pngUri]]);

const expanded = expandIncludes(qmd);
const processed = preprocessDeck(expanded, localAssetUris);
console.log(
  `preprocessed: ${qmd.length} → ${processed.length} chars (png inlined: ${processed.includes("data:image/png;base64,")})`,
);

const t2 = performance.now();
const result = await convert(
  {
    from: "markdown",
    to: "revealjs",
    standalone: true,
    "slide-level": 2,
    citeproc: true,
    "html-math-method": "katex",
    css: ["theme.css"],
    bibliography: "references.bib",
  },
  processed,
  { "theme.css": css, "references.bib": bib },
);
console.log(
  `pandoc convert in ${Math.round(performance.now() - t2)}ms — stdout=${result.stdout.length} stderr=${result.stderr.length} warnings=${result.warnings.length}`,
);
if (result.stderr.trim()) console.log(`STDERR:\n${result.stderr}`);

const html = result.stdout;

const checks = [
  ["reveal.js loaded via CDN", html.includes("reveal.js")],
  ["our compiled CSS included as inline link", /<link[^>]*theme\.css/.test(html)],
  ["dark slide class present", /class="[^"]*\bdark\b/.test(html)],
  ["columns class present", /class="[^"]*\bcolumns\b/.test(html)],
  [
    "incremental fragments",
    /class="[^"]*\bfragment\b/.test(html) || /class="[^"]*\bincremental\b/.test(html),
  ],
  ["highlight class .hlg", /class="[^"]*\bhlg\b/.test(html)],
  ["footnote markers", /footnote/i.test(html)],
  [
    "bibliography rendered in #refs",
    html.includes('id="refs"') && /csl-(entry|bib)/.test(html),
  ],
  ["local PNG inlined as data URI", html.includes("data:image/png;base64,")],
  ["external Wikimedia URL left intact", html.includes("upload.wikimedia.org")],
];
console.log("\n=== Validation (on real workshop deck) ===");
let ok = 0,
  fail = 0;
for (const [name, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  pass ? ok++ : fail++;
}

const mini = `---
title: Probe
---

# Math

Given $E = mc^2$ and $$\\int_0^1 x\\,dx = \\tfrac{1}{2}$$

# Notes

Content visible to audience.

::: notes

Speaker-only content.

:::
`;
const miniResult = await convert(
  {
    from: "markdown",
    to: "revealjs",
    standalone: true,
    "html-math-method": "katex",
  },
  mini,
  {},
);
const probes = [
  ["KaTeX assets injected for $math$", /katex/i.test(miniResult.stdout)],
  [
    '"::: notes" → <aside class="notes">',
    /class="[^"]*\bnotes\b/.test(miniResult.stdout) ||
      /<aside[^>]*notes/i.test(miniResult.stdout),
  ],
];
console.log("\n=== Feature probe (synthetic mini-deck) ===");
for (const [name, pass] of probes) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  pass ? ok++ : fail++;
}
console.log(`\n${ok}/${ok + fail} checks passed`);

const outPath = join(dirname(fileURLToPath(import.meta.url)), "sample-output.html");
await writeFile(outPath, html);
console.log(`Pre-rendered deck written to ${outPath}`);

if (fail > 0) process.exit(1);
