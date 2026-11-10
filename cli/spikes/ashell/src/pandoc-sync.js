// SPIKE CODE (Phase 4.2) — a synchronous variant of core's pandoc-core.js.
//
// a-Shell's `jsc` evaluates a script with WKWebView.evaluateJavaScript and
// reports back when that one synchronous evaluation finishes, so nothing in
// the render may be async: WebAssembly.instantiate() (a promise) is replaced
// by `new WebAssembly.Module` + `new WebAssembly.Instance`, exactly as
// a-Shell's own `wasm` command does in the same web view, and convert() takes
// only strings / Uint8Arrays (no Blob, so no `await blob.arrayBuffer()`).
//
// If the spike passes, this becomes `createPandocInstanceSync` in core (4.3).

import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from "@bjorn3/browser_wasi_shim";

export function createPandocInstanceSync(wasmBytes, log = () => {}) {
  const args = ["pandoc.wasm", "+RTS", "-H64m", "-RTS"];
  const fileSystem = new Map();
  const fds = [
    new OpenFile(new File(new Uint8Array(), { readonly: true })),
    ConsoleStdout.lineBuffered((msg) => log(`[WASI stdout] ${msg}`)),
    ConsoleStdout.lineBuffered((msg) => log(`[WASI stderr] ${msg}`)),
    new PreopenDirectory("/", fileSystem),
  ];
  const wasi = new WASI(args, [], fds, { debug: false });

  const timings = {};
  let t = Date.now();
  const module = new WebAssembly.Module(wasmBytes);
  timings.compileMs = Date.now() - t;
  t = Date.now();
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi.wasiImport });
  timings.instantiateMs = Date.now() - t;

  t = Date.now();
  wasi.initialize(instance);
  instance.exports.__wasm_call_ctors();
  const view = () => new DataView(instance.exports.memory.buffer);
  const enc = new TextEncoder();
  const argc_ptr = instance.exports.malloc(4);
  view().setUint32(argc_ptr, args.length, true);
  const argv = instance.exports.malloc(4 * (args.length + 1));
  for (let i = 0; i < args.length; ++i) {
    const arg = instance.exports.malloc(args[i].length + 1);
    enc.encodeInto(args[i], new Uint8Array(instance.exports.memory.buffer, arg, args[i].length));
    view().setUint8(arg + args[i].length, 0);
    view().setUint32(argv + 4 * i, arg, true);
  }
  view().setUint32(argv + 4 * args.length, 0, true);
  const argv_ptr = instance.exports.malloc(4);
  view().setUint32(argv_ptr, argv, true);
  instance.exports.hs_init_with_rtsopts(argc_ptr, argv_ptr);
  timings.haskellInitMs = Date.now() - t;

  function convert(options, stdin, files) {
    const optsBytes = enc.encode(JSON.stringify(options));
    const opts_ptr = instance.exports.malloc(optsBytes.length);
    new Uint8Array(instance.exports.memory.buffer, opts_ptr, optsBytes.length).set(optsBytes);

    fileSystem.clear();
    const in_file = new File(stdin ? enc.encode(stdin) : new Uint8Array(), { readonly: true });
    const out_file = new File(new Uint8Array(), { readonly: false });
    const err_file = new File(new Uint8Array(), { readonly: false });
    const warnings_file = new File(new Uint8Array(), { readonly: false });
    fileSystem.set("stdin", in_file);
    fileSystem.set("stdout", out_file);
    fileSystem.set("stderr", err_file);
    fileSystem.set("warnings", warnings_file);
    for (const name in files) {
      const data = files[name];
      fileSystem.set(name, new File(typeof data === "string" ? enc.encode(data) : data, { readonly: true }));
    }

    instance.exports.convert(opts_ptr, optsBytes.length);

    const dec = new TextDecoder("utf-8");
    let warnings = [];
    const rawWarnings = dec.decode(warnings_file.data);
    if (rawWarnings) {
      try { warnings = JSON.parse(rawWarnings); } catch (e) { /* leave empty */ }
    }
    return { stdout: dec.decode(out_file.data), stderr: dec.decode(err_file.data), warnings };
  }

  return { convert, timings };
}
