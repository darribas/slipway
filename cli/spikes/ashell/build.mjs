// Build the a-Shell spike kit: three self-contained scripts for `jsc`, the
// fixture deck, and one tarball to download on the iPad.
//
//   cd cli && node spikes/ashell/build.mjs
//
// Output: spikes/ashell/dist/ (git-ignored) and
//         spikes/ashell/slipway-ashell-spike.tar.gz (committed, so it can be
//         fetched from raw.githubusercontent.com while the spike is open).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../..");
const DEMO = resolve(CLI, "../app/src/templates/slipway-demo");
const DIST = resolve(HERE, "dist");
const KIT = resolve(DIST, "slipway-spike");
const require = createRequire(resolve(CLI, "package.json"));
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(resolve(KIT, "deck/demos"), { recursive: true });

// 1. Fixture deck: the PWA's seed deck, minus what slide.qmd doesn't use.
for (const rel of ["demos/slide.qmd", "demos/_snippet.qmd", "theme.scss", "references.bib"]) {
  cpSync(resolve(DEMO, rel), resolve(KIT, "deck", rel));
}

// 2. Render it here with the real pipeline, to learn the golden hash, the
//    pandoc job hash, and pandoc's stdout (canned for S2).
const coreBundle = resolve(DIST, "core-node.mjs");
await build({
  entryPoints: [resolve(CLI, "../core/src/index.ts")],
  outfile: coreBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
const core = await import(pathToFileURL(coreBundle).href);
const read = (rel) => readFileSync(resolve(KIT, "deck", rel), "utf8");
const snippet = read("demos/_snippet.qmd");
const inputs = {
  qmd: read("demos/slide.qmd"),
  stylesheet: read("theme.scss"),
  stylesheetIsPrecompiled: false,
  bib: read("references.bib"),
  assets: new Map(),
  includes: new Map([["demos/_snippet.qmd", snippet], ["_snippet.qmd", snippet]]),
};
const job = core.prepareRender(inputs);
const wasm = readFileSync(resolve(dirname(require.resolve("pandoc-wasm")), "pandoc.wasm"));
const pandoc = await core.createPandocInstance(wasm);
const out = await pandoc.convert(job.options, job.stdin, job.files);
const html = core.finalizeRender(job, out).html;
const goldenSha = sha(html);
const jobSha = sha(JSON.stringify([job.options, job.stdin, job.files]));
const recorded = JSON.parse(readFileSync(resolve(CLI, "../core/test/goldens/goldens.json"), "utf8"))["demo-slide"].sha256;
if (goldenSha !== recorded) throw new Error(`fixture render ${goldenSha} != core golden ${recorded}`);
writeFileSync(resolve(KIT, "deck/canned-pandoc-stdout.html"), out.stdout);
rmSync(coreBundle);

// 3. The three scripts, each one self-contained IIFE. Top-level `const`s in
//    a jsc script would collide on a second run (every run shares the web
//    view's global scope), so the IIFE wrapper matters.
for (const name of ["s3-wasm", "s2-stages", "s3b-render"]) {
  await build({
    entryPoints: [resolve(HERE, `src/${name}.js`)],
    outfile: resolve(KIT, `${name}.js`),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "safari15",
    minify: true,
    legalComments: "none",
    define: {
      __GOLDEN_SHA256__: JSON.stringify(goldenSha),
      __JOB_SHA256__: JSON.stringify(jobSha),
    },
    logLevel: "warning",
  });
}

// 4. One tarball. Fixed mtime/owner so rebuilding without changes gives the
//    same bytes (and git sees no diff).
const tarball = resolve(HERE, "slipway-ashell-spike.tar.gz");
execFileSync("tar", [
  "--sort=name", "--mtime=2026-01-01 00:00:00", "--owner=0", "--group=0", "--numeric-owner",
  "-cf", resolve(DIST, "kit.tar"), "-C", DIST, "slipway-spike",
]);
execFileSync("gzip", ["-n", "-9", "-f", resolve(DIST, "kit.tar")]);
cpSync(resolve(DIST, "kit.tar.gz"), tarball);
rmSync(resolve(DIST, "kit.tar.gz"));

const kb = (p) => (readFileSync(p).length / 1024).toFixed(0) + " kB";
console.log(`spike kit: golden ${goldenSha.slice(0, 12)}…, job ${jobSha.slice(0, 12)}…`);
for (const name of ["s3-wasm", "s2-stages", "s3b-render"]) console.log(`  ${name}.js  ${kb(resolve(KIT, name + ".js"))}`);
console.log(`  slipway-ashell-spike.tar.gz  ${kb(tarball)}`);
