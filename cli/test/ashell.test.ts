// The a-Shell adapter, as built (dist/slipway-ashell.js), run the way a-Shell
// runs it: the script text evaluated in a shared global scope that offers
// `jsc` (blocking file calls), `prompt` and `process.argv`. Here that scope
// is a node:vm context and the `jsc` object is backed by node:fs with the
// return conventions of a-Shell's own bridge.
//
// This checks the adapter's logic and that its output matches the goldens.
// It is not WebKit and not an iPad: the Phase 4.2 spike run on a device is
// what established that the host really provides all this.

import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { afterAll, describe, expect, test } from "vitest";

import pkg from "../package.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../dist");
const SCRIPT = readFileSync(join(DIST, "slipway-ashell.js"), "utf8");
const DEMO = resolve(HERE, "../../app/src/templates/slipway-demo");
const IMAGO = resolve(HERE, "../../core/test/fixtures/imago-workshop");
const GOLDENS: Record<string, { sha256: string }> = JSON.parse(
  readFileSync(resolve(HERE, "../../core/test/goldens/goldens.json"), "utf8"),
);
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const scratch: string[] = [];
function tempCopy(src?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "slipway-ashell-"));
  scratch.push(dir);
  if (src) cpSync(src, dir, { recursive: true });
  return dir;
}
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** One a-Shell window: a persistent page whose globals survive between `jsc` runs. */
function ashellWindow(scriptDir = DIST) {
  let cwd = "/";
  let consoleCalls = 0;
  const abs = (p: string) => (p.startsWith("/") ? p : join(cwd, p));
  const reads: string[] = [];
  const jsc = {
    readFile: (p: string) => readFileSync(abs(p), "utf8"),
    readFileBase64: (p: string) => (reads.push(abs(p)), readFileSync(abs(p)).toString("base64")),
    writeFile: (p: string, content: string) => (writeFileSync(abs(p), content), 0),
    listFiles: (d: string) => [...readdirSync(abs(d)), ""], // a-Shell's list ends with an empty entry
    isFile: (p: string) => existsSync(abs(p)) && statSync(abs(p)).isFile(),
    isDirectory: (p: string) => existsSync(abs(p)) && statSync(abs(p)).isDirectory(),
    getFileSize: (p: string) => statSync(abs(p)).size,
  };
  const context = vm.createContext({
    jsc,
    prompt: (message: string) => (message.startsWith("jsc\npickDirectory") ? cwd : null),
    // a-Shell shows console output too, so a line sent there as well as in
    // the completion value is printed twice (4.3c): the script must not use it.
    console: { log: () => consoleCalls++, error: () => consoleCalls++, warn: () => consoleCalls++ },
    TextEncoder, TextDecoder, WebAssembly, Date,
    // a-Shell's page (reported by the device spike). Dart Sass reads
    // location.href when it formats a deprecation notice.
    location: { href: "https://localhost:8443/wasm.html" },
  });
  vm.runInContext("var self = globalThis; var window = globalThis;", context);
  return {
    reads,
    /** `cd dir && jsc slipway-ashell.js …args` */
    run(dir: string, ...args: string[]) {
      cwd = dir;
      consoleCalls = 0;
      const argv = JSON.stringify(["jsc", join(scriptDir, "slipway-ashell.js"), ...args]);
      // a-Shell prepends exactly this kind of preamble to the script text.
      const value: unknown = vm.runInContext(`var process = process ?? {}; process.argv = ${argv}; process.env = {};\n${SCRIPT}`, context);
      // a-Shell prints the completion value (and nothing from console), and
      // reports anything but a string or number as an error.
      expect(typeof value).toBe("string");
      expect(consoleCalls).toBe(0);
      const printed = value as string;
      return { printed, done: /(^|\n)Output created: [^\n]*$/.test(printed) };
    },
  };
}

describe("slipway-ashell.js — same HTML as every other surface", () => {
  const window = ashellWindow();

  test("renders the demo deck to the golden HTML", () => {
    const proj = tempCopy(DEMO);
    const { printed } = window.run(proj, "render", "demos/slide.qmd");
    expect(printed).toMatch(/^slipway: loading pandoc.*\nOutput created: demos\/slide\.html$/s);
    expect(sha(join(proj, "demos/slide.html"))).toBe(GOLDENS["demo-slide"].sha256);
  }, 60_000);

  test("a second render in the same window reuses pandoc: no reload of the wasm", () => {
    const proj = tempCopy(DEMO);
    const wasmReads = () => window.reads.filter((p) => p.endsWith("pandoc.wasm")).length;
    const before = wasmReads();
    expect(before).toBe(1);
    const { printed } = window.run(join(proj, "demos"), "render", "imago-showcase.qmd", "--root", "..");
    expect(printed).toBe("Output created: imago-showcase.html");
    expect(wasmReads()).toBe(before);
    // Theme + fonts (binary, through readFileBase64) + bibliography via ../assets.
    expect(sha(join(proj, "demos/imago-showcase.html"))).toBe(GOLDENS["demo-imago-showcase"].sha256);
  }, 60_000);

  test("images, -o and --print", () => {
    const proj = tempCopy(IMAGO);
    expect(window.run(proj, "render", "slide.qmd", "-o", "out/../deck.html").printed).toBe("Output created: deck.html");
    expect(sha(join(proj, "deck.html"))).toBe(GOLDENS["imago-workshop"].sha256);
    const demo = tempCopy(DEMO);
    window.run(demo, "render", "demos/slide.qmd", "--print", "-o", "print.html");
    expect(sha(join(demo, "print.html"))).toBe(GOLDENS["demo-slide.print"].sha256);
  }, 60_000);

  test("_quarto.yml marks the root; hidden folders and node_modules are ignored", () => {
    const proj = tempCopy(DEMO);
    writeFileSync(join(proj, "_quarto.yml"), "");
    cpSync(join(proj, "theme.scss"), join(tempCopy(), "x.scss"));
    for (const dir of [".git", "node_modules"]) {
      cpSync(join(proj, "demos"), join(proj, dir), { recursive: true });
      writeFileSync(join(proj, dir, "a.scss"), ".x { color: $nope; }");
    }
    window.run(join(proj, "demos"), "render", "imago-showcase.qmd");
    expect(sha(join(proj, "demos/imago-showcase.html"))).toBe(GOLDENS["demo-imago-showcase"].sha256);
  }, 60_000);

  test("warnings and errors are printed; a failed render writes nothing", () => {
    const proj = tempCopy();
    writeFileSync(join(proj, "deck.qmd"), "---\ntitle: T\n---\n\n# Hi\n\nSee [@nope].\n");
    writeFileSync(join(proj, "refs.bib"), "@misc{a, title={T}}\n");
    const ok = window.run(proj, "render", "deck.qmd");
    expect(ok.done).toBe(true);
    expect(ok.printed).toContain("warning: Citeproc: citation nope not found");
    expect(ok.printed).not.toContain("Loaded references.bib");
    expect(window.run(proj, "render", "deck.qmd", "--verbose").printed).toContain("info: Loaded references.bib");

    rmSync(join(proj, "deck.html"));
    writeFileSync(join(proj, "theme.scss"), ".reveal { color: $undefined; }\n");
    const sass = window.run(proj, "render", "deck.qmd");
    expect(sass.done).toBe(false);
    expect(sass.printed).toMatch(/error: .*Undefined variable/s);
    rmSync(join(proj, "theme.scss"));
    writeFileSync(join(proj, "refs.bib"), "@misc{broken, title={T");
    const bib = window.run(proj, "render", "deck.qmd");
    expect(bib.done).toBe(false);
    expect(bib.printed).toContain("Error reading bibliography");
    expect(existsSync(join(proj, "deck.html"))).toBe(false);
  }, 60_000);

  test("usage errors, --version, --help", () => {
    const proj = tempCopy();
    writeFileSync(join(proj, "deck.qmd"), "# Hi\n");
    for (const args of [["render"], ["render", "missing.qmd"], ["render", "deck.qmd", "--bogus"], ["frobnicate"]]) {
      const { printed } = window.run(proj, ...args);
      expect(printed, args.join(" ")).toMatch(/^slipway: .*Try 'slipway --help'/s);
    }
    expect(existsSync(join(proj, "deck.html"))).toBe(false);
    // What a-Shell shows (it adds the final newline itself).
    expect(window.run(proj, "--version").printed).toBe(pkg.version);
    expect(window.run(proj, "render").printed).toMatch(/^slipway: .*\nTry 'slipway --help'\.$/s);
    expect(window.run(proj, "--help").printed).toContain("slipway render <deck.qmd>");
    expect(window.run(proj).printed).toContain("slipway render <deck.qmd>");
  });
});

describe("slipway-ashell.js — installation problems", () => {
  test("a clear message when pandoc.wasm is not next to the script", () => {
    const proj = tempCopy();
    writeFileSync(join(proj, "deck.qmd"), "# Hi\n");
    const { printed, done } = ashellWindow(tempCopy()).run(proj, "render", "deck.qmd");
    expect(done).toBe(false);
    expect(printed).toMatch(/error: pandoc\.wasm not found .*next to slipway-ashell\.js/s);
  });

  test("the bundle is one IIFE with nothing for a browser to fetch or import", () => {
    expect(SCRIPT.startsWith('"use strict";(()=>{') || SCRIPT.startsWith("(()=>{")).toBe(true);
    expect(SCRIPT).not.toMatch(/\bimport\s*\(|\brequire\s*\(\s*["']node:/);
  });
});
