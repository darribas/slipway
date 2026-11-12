// `slipway` for a-Shell on iPad / iPhone.
//
//   jsc ~/Documents/bin/slipway-ashell.js render deck.qmd
//
// a-Shell's `jsc` evaluates this script inside the terminal's WKWebView,
// synchronously, and gives it file access through a `jsc` object whose calls
// are blocking round-trips to the app. That web view has WebAssembly, so the
// whole pipeline runs right here — Slipway's JS stages and pandoc.wasm — with
// the synchronous variants of core's API. (Established by the Phase 4.2
// spikes, run on an iPad; see PHASES.md.)
//
// Three properties of that host shape this file:
//   - every run shares one page, so the bundle is an IIFE (no top-level
//     declarations to collide on the second run) …
//   - … and whatever is stored on globalThis survives until `jsc --reset`:
//     the instantiated pandoc is kept there, so only the first render in a
//     window pays for reading and compiling the 58 MB module;
//   - a script cannot set the command's exit status. Errors are printed to
//     stderr; the status is always 0.

import {
  buildPrintVariant,
  buildRenderInputsSync,
  createPandocInstanceSync,
  renderDeckSync,
} from "@slipway/core";
import type { PandocInstanceSync, ProjectFSSync } from "@slipway/core";

import pkg from "../../package.json";
import { UsageError, USAGE, parseRenderArgs } from "../args";
import type { RenderArgs } from "../args";
import { base64ToBytes } from "./base64";
import { basename, dirname, relativeTo, resolvePath, stripExtension } from "./posix";

/** The object a-Shell's page provides (wasm.html). Paths may be relative to the shell's cwd. */
declare const jsc: {
  readFile(path: string): string;
  readFileBase64(path: string): string;
  writeFile(path: string, content: string): number;
  listFiles(dir: string): string[];
  isFile(path: string): boolean;
  isDirectory(path: string): boolean;
  getFileSize(path: string): number;
};
declare function prompt(message: string): string | null;

const out = (line: string) => console.log(line);
const err = (line: string) => console.error(line + "\n");

const env: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? (process.env as Record<string, string | undefined>) : {};

/** The shell's current directory (a-Shell answers this through the same bridge). */
function currentDirectory(): string {
  try {
    const cwd = prompt("jsc\npickDirectory\n");
    if (cwd && cwd.startsWith("/")) return cwd;
  } catch {
    /* fall through */
  }
  return env.PWD || ".";
}

function skip(name: string): boolean {
  return name === "" || name === "node_modules" || name.startsWith(".");
}

/** The project folder, read through jsc. Same ignore rule and order as every other surface. */
function jscProjectFS(root: string): ProjectFSSync {
  const walk = (rel: string, found: string[]): string[] => {
    for (const name of jsc.listFiles(rel ? `${root}/${rel}` : root)) {
      if (skip(name)) continue;
      const path = rel ? `${rel}/${name}` : name;
      if (jsc.isDirectory(`${root}/${path}`)) walk(path, found);
      else found.push(path);
    }
    return found;
  };
  return {
    listFiles: () => walk("", []).sort(),
    readText: (path) => jsc.readFile(`${root}/${path}`),
    readBytes: (path) => base64ToBytes(jsc.readFileBase64(`${root}/${path}`)),
  };
}

/** --root, else nearest ancestor with _quarto.yml, else cwd if the deck is under it, else the deck's folder. */
function findProjectRoot(deck: string, cwd: string, explicit: string | undefined): string {
  if (explicit) return resolvePath(cwd, explicit, env.HOME);
  for (let dir = dirname(deck); ; dir = dirname(dir)) {
    if (jsc.isFile(`${dir}/_quarto.yml`) || jsc.isFile(`${dir}/_quarto.yaml`)) return dir;
    if (dir === "/" || dir === ".") break;
  }
  return relativeTo(cwd, deck) ? cwd : dirname(deck);
}

interface Cached {
  version: string;
  wasmPath: string;
  wasmSize: number;
  pandoc: PandocInstanceSync;
}
const CACHE_KEY = "__slipwayPandoc";

function findWasm(cwd: string): string {
  const script = typeof process !== "undefined" && process.argv && process.argv[1];
  const candidates = [
    env.SLIPWAY_PANDOC_WASM,
    script ? `${dirname(resolvePath(cwd, script, env.HOME))}/pandoc.wasm` : undefined,
    env.HOME ? `${env.HOME}/Documents/bin/pandoc.wasm` : undefined,
  ].filter((p): p is string => !!p);
  for (const path of candidates) if (jsc.isFile(path)) return path;
  throw new Error(
    `pandoc.wasm not found (looked in: ${candidates.join(", ")}). ` +
      "It must sit next to slipway-ashell.js — see the install steps.",
  );
}

function loadPandoc(cwd: string, verbose: boolean): PandocInstanceSync {
  const store = globalThis as unknown as Record<string, Cached | undefined>;
  const wasmPath = findWasm(cwd);
  const wasmSize = jsc.getFileSize(wasmPath);
  const cached = store[CACHE_KEY];
  if (cached && cached.version === pkg.version && cached.wasmPath === wasmPath && cached.wasmSize === wasmSize) {
    if (verbose) err("info: reusing the pandoc instance loaded earlier in this window");
    return cached.pandoc;
  }
  err("slipway: loading pandoc (only the first render in a window takes this long)…");
  const t0 = Date.now();
  let bytes: Uint8Array | null = base64ToBytes(jsc.readFileBase64(wasmPath));
  if (bytes.length !== wasmSize || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`${wasmPath} did not load intact (${bytes.length} of ${wasmSize} bytes)`);
  }
  const pandoc = createPandocInstanceSync(bytes, (line) => err(line));
  bytes = null;
  store[CACHE_KEY] = { version: pkg.version, wasmPath, wasmSize, pandoc };
  if (verbose) {
    const t = pandoc.timings;
    err(`info: pandoc loaded in ${Date.now() - t0} ms (compile ${t.compileMs}, instantiate ${t.instantiateMs}, runtime ${t.haskellInitMs})`);
  }
  return pandoc;
}

function render(args: RenderArgs): void {
  const cwd = currentDirectory();
  const deck = resolvePath(cwd, args.deck, env.HOME);
  if (!jsc.isFile(deck)) throw new UsageError(`deck not found: ${args.deck}`);
  const root = findProjectRoot(deck, cwd, args.root);
  if (!jsc.isDirectory(root)) throw new UsageError(`project root is not a directory: ${args.root ?? root}`);
  const deckPath = relativeTo(root, deck);
  if (!deckPath) throw new UsageError(`the deck is not inside the project root (${root})`);
  const target = args.output
    ? resolvePath(cwd, args.output, env.HOME)
    : `${dirname(deck)}/${stripExtension(basename(deck))}.html`;

  const inputs = buildRenderInputsSync(deckPath, jscProjectFS(root));
  const result = renderDeckSync(loadPandoc(cwd, args.verbose), inputs);
  for (const d of result.diagnostics) {
    if (d.severity === "warning") err(`warning: ${d.message}`);
    else if (args.verbose) err(`info: ${d.message}`);
  }
  if (result.stderr.trim()) err(result.stderr.trim());
  if (!result.ok) {
    if (!result.stderr.trim()) err("error: pandoc produced no output");
    return;
  }

  const html = args.print ? buildPrintVariant(result.html) : result.html;
  jsc.writeFile(target, html);
  // The content travels to the app as one message; make sure all of it landed.
  const expected = new TextEncoder().encode(html).length;
  const written = jsc.getFileSize(target);
  if (written !== expected) throw new Error(`${target} was not written intact (${written} of ${expected} bytes)`);
  out(`Output created: ${relativeTo(cwd, target) ?? target}`);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === "-h" || command === "--help" || command === "help") {
      out(USAGE.trimEnd());
    } else if (command === "-V" || command === "--version") {
      out(pkg.version);
    } else if (command === "render") {
      if (rest.includes("-h") || rest.includes("--help")) out(USAGE.trimEnd());
      else render(parseRenderArgs(rest));
    } else {
      throw new UsageError(`unknown command: ${command}`);
    }
  } catch (e) {
    if (e instanceof UsageError) err(`slipway: ${e.message}\nTry 'slipway --help'.`);
    else err(`error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// process.argv is ["jsc", "<this script>", …arguments].
main(typeof process !== "undefined" && process.argv ? process.argv.slice(2) : []);
