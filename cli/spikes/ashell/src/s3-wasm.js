// SPIKE S3 (+ the host half of S2) — what does a-Shell's `jsc` give a script?
//
//   jsc s3-wasm.js
//
// Answers, in order: is WebAssembly there and does a synchronous
// compile + instantiate work; which globals exist; do the jsc.* file calls
// round-trip text and binary; does jsc.system block and return an exit code;
// and what happens to promise / timer callbacks after the script returns.

import { base64ToBytes, probe, reporter, sha256Hex, workDir, writeTextVerified } from "./common.js";

const { say, save } = reporter("s3");
const dir = workDir();

say("=== Slipway a-Shell spike S3: jsc environment ===");
say(`when: ${new Date().toISOString()}`);
say(`userAgent: ${typeof navigator !== "undefined" ? navigator.userAgent : "(no navigator)"}`);
say(`location: ${typeof location !== "undefined" ? location.href : "(no location)"}`);
say(`work dir: ${dir}`);
say(`process.argv: ${typeof process !== "undefined" ? JSON.stringify(process.argv) : "(no process)"}`);
say("");

say("--- globals ---");
for (const name of [
  "WebAssembly", "TextEncoder", "TextDecoder", "btoa", "atob", "performance", "setTimeout",
  "Promise", "Blob", "crypto", "fetch", "XMLHttpRequest", "Worker", "structuredClone",
  "globalThis", "self", "window", "jsc", "prompt", "print", "println", "process", "Buffer", "require",
]) {
  let type;
  try { type = typeof globalThis[name]; } catch (e) { type = "throws: " + e; }
  say(`${type === "undefined" ? "  -  " : "  ok "} ${name}: ${type}`);
}
say("");

say("--- WebAssembly ---");
// (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const ADD = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);
const hasWasm = probe(say, "typeof WebAssembly === 'object'", () => {
  if (typeof WebAssembly !== "object") throw new Error("typeof WebAssembly is " + typeof WebAssembly);
});
if (hasWasm) {
  probe(say, "synchronous new WebAssembly.Module + Instance, add(2, 3)", () => {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(ADD), {});
    const result = instance.exports.add(2, 3);
    if (result !== 5) throw new Error("add(2, 3) returned " + result);
    return result;
  });
  probe(say, "WebAssembly.Memory can grow to 512 MB", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    memory.grow(8191); // 8192 pages * 64 KiB = 512 MiB
    return (memory.buffer.byteLength / 1048576) + " MiB";
  });
}
say("");

say("--- jsc file bridge ---");
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
probe(say, "writeFile / readFile round-trip (UTF-8, newlines, non-ASCII)", () => {
  const text = "line one\nlínea dos — ✓\n\ttabbed \"quoted\" \\backslash\n";
  jsc.writeFile(dir + "/s3-text.txt", text);
  const back = jsc.readFile(dir + "/s3-text.txt");
  if (back !== text) throw new Error("mismatch: got " + JSON.stringify(back));
  return text.length + " chars";
});
probe(say, "writeFileBase64 / readFileBase64 round-trip (PNG bytes)", () => {
  jsc.writeFileBase64(dir + "/s3-pixel.png", PNG_B64);
  const back = jsc.readFileBase64(dir + "/s3-pixel.png");
  if (back.replace(/\s/g, "") !== PNG_B64) throw new Error("mismatch: got " + back.slice(0, 60));
  const bytes = base64ToBytes(back.replace(/\s/g, ""));
  if (bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) throw new Error("decoded bytes are not a PNG");
  return bytes.length + " bytes, sha256 " + sha256Hex(bytes).slice(0, 16) + "…";
});
probe(say, "relative path resolves against the shell's current directory", () => {
  const back = jsc.readFile("s3-text.txt");
  if (back.indexOf("line one") !== 0) throw new Error("got " + JSON.stringify(String(back).slice(0, 80)));
});
probe(say, "listFiles / isFile / isDirectory / getFileSize", () => {
  const names = jsc.listFiles(dir).filter((n) => n !== "");
  if (names.indexOf("s3-text.txt") < 0) throw new Error("s3-text.txt not listed: " + names.join(","));
  if (!jsc.isFile(dir + "/s3-text.txt")) throw new Error("isFile false for a file");
  if (!jsc.isDirectory(dir)) throw new Error("isDirectory false for the work dir");
  if (jsc.isFile(dir + "/no-such-file")) throw new Error("isFile true for a missing file");
  return names.length + " entries; s3-pixel.png is " + jsc.getFileSize(dir + "/s3-pixel.png") + " bytes";
});
probe(say, "readFile of a missing file (what comes back?)", () => {
  return JSON.stringify(String(jsc.readFile(dir + "/no-such-file.txt")).slice(0, 120));
});
probe(say, "a 2 MB string can be written and read back intact", () => {
  let big = "";
  const chunk = "0123456789abcdef".repeat(64); // 1 KiB
  for (let i = 0; i < 2048; i++) big += chunk;
  return writeTextVerified(dir + "/s3-big.txt", big);
});
say("");

say("--- jsc.system ---");
probe(say, "system('true') returns 0", () => {
  const code = jsc.system("true");
  if (String(code) !== "0") throw new Error("returned " + JSON.stringify(code));
  return JSON.stringify(code);
});
probe(say, "system('false') returns non-zero", () => {
  const code = jsc.system("false");
  if (String(code) === "0") throw new Error("returned 0");
  return JSON.stringify(code);
});
probe(say, "system blocks until the command is done (sleep 1)", () => {
  const t = Date.now();
  jsc.system("sleep 1");
  const ms = Date.now() - t;
  if (ms < 900) throw new Error("returned after " + ms + " ms");
  return ms + " ms";
});
probe(say, "system can redirect output to a file we then read", () => {
  jsc.system("echo from-the-shell > " + dir + "/s3-shell.txt");
  const back = String(jsc.readFile(dir + "/s3-shell.txt")).trim();
  if (back !== "from-the-shell") throw new Error("got " + JSON.stringify(back));
});
say("");

say("--- async after return (checked by the next script) ---");
try { jsc.deleteFile(dir + "/s3-microtask.txt"); } catch (e) { /* not there */ }
try { jsc.deleteFile(dir + "/s3-timeout.txt"); } catch (e) { /* not there */ }
try {
  Promise.resolve().then(() => jsc.writeFile(dir + "/s3-microtask.txt", "ran"));
  say("queued: a promise callback that writes s3-microtask.txt");
} catch (e) { say("could not queue a promise callback: " + e); }
try {
  setTimeout(() => jsc.writeFile(dir + "/s3-timeout.txt", "ran"), 50);
  say("queued: a 50 ms timer that writes s3-timeout.txt");
} catch (e) { say("could not queue a timer: " + e); }
say("");
say("=== S3 done. Next: jsc s2-stages.js ===");
save(dir);
