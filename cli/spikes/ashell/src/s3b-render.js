// SPIKE S3b — a full render inside a-Shell's `jsc`, pandoc.wasm included.
//
//   jsc s3b-render.js          (run it twice: the second run should reuse
//                               the pandoc instance kept on the web view)
//
// Only meaningful if S3 reported WebAssembly. Loads ./pandoc.wasm (58 MB)
// through jsc.readFileBase64, compiles and instantiates it synchronously,
// renders the fixture deck end to end, writes s3b-out.html and compares its
// SHA-256 with the golden the PWA and the desktop CLI produce.

import { finalizeRender, prepareRender } from "@slipway/core";

import { base64ToBytes, probe, reporter, sha256Hex, utf8, workDir, writeTextVerified } from "./common.js";
import { loadFixtureInputs } from "./fixture.js";
import { createPandocInstanceSync } from "./pandoc-sync.js";

const { say, save } = reporter("s3b");
const dir = workDir();
const total = Date.now();

say("=== Slipway a-Shell spike S3b: full render under jsc ===");
say(`when: ${new Date().toISOString()}`);
say(`work dir: ${dir}`);
say("");

say("--- did S2's async call resolve after that script returned? ---");
try {
  say(jsc.isFile(dir + "/s2-async.txt") ? "  yes: " + jsc.readFile(dir + "/s2-async.txt") : "  NO (s2-async.txt was never written)");
} catch (e) { say("  could not check: " + e); }
say("");

say("--- pandoc.wasm ---");
let pandoc = globalThis.__slipwaySpikePandoc || null;
if (pandoc) {
  say("REUSED the pandoc instance cached on the web view by an earlier run (no load, no compile)");
} else {
  let b64 = null;
  let bytes = null;
  probe(say, "jsc.readFileBase64(pandoc.wasm)", () => {
    const path = dir + "/pandoc.wasm";
    if (!jsc.isFile(path)) throw new Error("pandoc.wasm is not in " + dir + " — see the instructions");
    b64 = jsc.readFileBase64(path);
    return (b64.length / 1048576).toFixed(1) + " MB of base64";
  });
  if (b64) {
    probe(say, "decode base64 → bytes", () => {
      bytes = base64ToBytes(b64);
      b64 = null; // let the 78 MB string go
      if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error("not a wasm module");
      return (bytes.length / 1048576).toFixed(1) + " MB";
    });
  }
  if (bytes) {
    probe(say, "compile + instantiate + Haskell runtime init (synchronous)", () => {
      pandoc = createPandocInstanceSync(bytes, (line) => say("    " + line));
      bytes = null;
      globalThis.__slipwaySpikePandoc = pandoc;
      const t = pandoc.timings;
      return `compile ${t.compileMs} ms, instantiate ${t.instantiateMs} ms, hs_init ${t.haskellInitMs} ms`;
    });
  }
}
say("");

if (pandoc) {
  say("--- render ---");
  let job = null;
  let out = null;
  probe(say, "prepareRender", () => { job = prepareRender(loadFixtureInputs(dir)); });
  if (job) {
    probe(say, "pandoc.convert (first call in this run)", () => {
      out = pandoc.convert(job.options, job.stdin, job.files);
      if (!out.stdout) throw new Error("no output; stderr: " + out.stderr);
      return `${out.stdout.length} chars of HTML, ${out.warnings.length} pandoc messages`;
    });
    probe(say, "pandoc.convert (again, warm)", () => {
      pandoc.convert(job.options, job.stdin, job.files);
    });
  }
  if (out && out.stdout) {
    let html = null;
    probe(say, "finalizeRender → golden HTML", () => {
      const result = finalizeRender(job, out);
      const actual = sha256Hex(utf8(result.html));
      if (actual !== __GOLDEN_SHA256__) {
        throw new Error(`html sha256 ${actual} (${result.html.length} chars), expected ${__GOLDEN_SHA256__}`);
      }
      html = result.html;
      return `IDENTICAL to the golden (${result.html.length} chars)`;
    });
    if (html) probe(say, "write s3b-out.html", () => writeTextVerified(dir + "/s3b-out.html", html));
  }
} else {
  say("pandoc is not available in this run — nothing rendered.");
}
say("");
say(`total: ${Date.now() - total} ms`);
say("=== S3b done. Run it once more to time the cached-instance path, then send the three report-*.txt files. ===");
save(dir);
