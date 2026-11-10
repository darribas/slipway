// SPIKE S2 — do Slipway's JavaScript stages run under a-Shell's `jsc`?
//
//   jsc s2-stages.js
//
// Runs core's prepareRender (Dart Sass, preprocessing, the pandoc job) and
// finalizeRender (asset inlining) on the fixture deck. pandoc itself is not
// involved: finalizeRender is fed the HTML pandoc produced for this exact job
// on the build machine (deck/canned-pandoc-stdout.html), so the final SHA-256
// can be compared with the golden without WebAssembly.

import { buildRenderInputs, finalizeRender, prepareRender } from "@slipway/core";

import { probe, reporter, sha256Hex, utf8, workDir, writeTextVerified } from "./common.js";
import { jscProjectFS, loadFixtureInputs } from "./fixture.js";

const { say, save } = reporter("s2");
const dir = workDir();

say("=== Slipway a-Shell spike S2: JS stages under jsc ===");
say(`when: ${new Date().toISOString()}`);
say(`work dir: ${dir}`);
say("");

say("--- did S3's async callbacks run after that script returned? ---");
for (const [file, what] of [["s3-microtask.txt", "promise callback"], ["s3-timeout.txt", "50 ms timer"]]) {
  let ran = false;
  try { ran = jsc.isFile(dir + "/" + file); } catch (e) { /* treat as not run */ }
  say(`${ran ? "  yes" : "  NO "}  ${what} (${file})`);
}
say("");

say("--- render stages ---");
let inputs = null;
let job = null;
let html = null;
probe(say, "load the fixture deck through jsc.readFile", () => {
  inputs = loadFixtureInputs(dir);
  return `${inputs.qmd.length} chars of qmd, ${inputs.stylesheet.length} of SCSS`;
});
probe(say, "prepareRender (Dart Sass compile + preprocess)", () => {
  job = prepareRender(inputs);
  if (!job.ctx.css) throw new Error("no CSS came out of Sass");
  return `${job.ctx.css.length} chars of CSS, files: ${Object.keys(job.files).join(", ")}`;
});
probe(say, "prepareRender again (warm)", () => {
  prepareRender(inputs);
});
probe(say, "the pandoc job is the one the build machine produced", () => {
  const actual = sha256Hex(utf8(JSON.stringify([job.options, job.stdin, job.files])));
  if (actual !== __JOB_SHA256__) throw new Error(`job sha256 ${actual}, expected ${__JOB_SHA256__}`);
  return "sha256 match";
});
probe(say, "finalizeRender on the canned pandoc output → golden HTML", () => {
  const stdout = jsc.readFile(dir + "/deck/canned-pandoc-stdout.html");
  const result = finalizeRender(job, { stdout, stderr: "", warnings: [] });
  const actual = sha256Hex(utf8(result.html));
  if (actual !== __GOLDEN_SHA256__) {
    throw new Error(`html sha256 ${actual} (${result.html.length} chars), expected ${__GOLDEN_SHA256__}`);
  }
  html = result.html;
  return `IDENTICAL to the golden (${result.html.length} chars)`;
});
probe(say, "write s2-out.html", () => {
  if (!html) throw new Error("nothing to write");
  return writeTextVerified(dir + "/s2-out.html", html);
});
say("");

say("--- async API (core's buildRenderInputs is promise-based) ---");
try { jsc.deleteFile(dir + "/s2-async.txt"); } catch (e) { /* not there */ }
try {
  buildRenderInputs("demos/slide.qmd", jscProjectFS(dir + "/deck")).then(
    (asyncInputs) => {
      const same = asyncInputs.qmd === inputs.qmd && asyncInputs.stylesheet === inputs.stylesheet && asyncInputs.bib === inputs.bib;
      jsc.writeFile(dir + "/s2-async.txt", same ? "resolved, same inputs" : "resolved, DIFFERENT inputs");
      console.log("(async) buildRenderInputs resolved; same inputs as the sync path: " + same);
    },
    (err) => jsc.writeFile(dir + "/s2-async.txt", "rejected: " + err),
  );
  say("started buildRenderInputs(); the next script reports whether it ever resolved");
} catch (e) {
  say("FAIL  could not start buildRenderInputs: " + e);
}
say("");
say("=== S2 done. Next: jsc s3b-render.js ===");
save(dir);
