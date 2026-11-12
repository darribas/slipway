// CLI tests. Two layers:
//   - main() called in-process (fast, covers argument handling, exit codes,
//     project-root detection and golden output);
//   - the built artifact (dist/slipway.mjs + dist/pandoc.wasm, produced by
//     the pretest build) run as a real subprocess, and the npm tarball's
//     file list.
//
// Every render happens in a temp copy of the fixture so nothing is written
// into the repository.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, describe, expect, test } from "vitest";

import { EXIT_OK, EXIT_RENDER_ERROR, EXIT_USAGE, main } from "../src/cli";
import { findProjectRoot, isInside, toProjectPath } from "../src/root";
import pkg from "../package.json";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, "..");
const DEMO = resolve(HERE, "../../app/src/templates/slipway-demo");
const IMAGO = resolve(HERE, "../../core/test/fixtures/imago-workshop");
const GOLDENS: Record<string, { sha256: string; bytes: number }> = JSON.parse(
  readFileSync(resolve(HERE, "../../core/test/goldens/goldens.json"), "utf8"),
);
const require = createRequire(import.meta.url);
const WASM = resolve(dirname(require.resolve("pandoc-wasm")), "pandoc.wasm");
const BUNDLE = resolve(CLI_ROOT, "dist/slipway.mjs");

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const scratch: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slipway-cli-"));
  scratch.push(dir);
  return dir;
}
function tempCopy(src: string): string {
  const dir = tempDir();
  cpSync(src, dir, { recursive: true });
  return dir;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    cwd,
    wasmPath: WASM,
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  return { code, stdout, stderr };
}

describe("slipway render — same HTML as the PWA", () => {
  test("demo deck matches core's golden; default output sits next to the deck", async () => {
    const proj = tempCopy(DEMO);
    const { code, stdout } = await cli(["render", "demos/slide.qmd"], proj);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toBe(`Output created: ${join("demos", "slide.html")}\n`);
    expect(sha(join(proj, "demos/slide.html"))).toBe(GOLDENS["demo-slide"].sha256);
  }, 60_000);

  test("Imago showcase (theme + fonts via ../assets) matches core's golden", async () => {
    const proj = tempCopy(DEMO);
    // Run from inside demos/ with no _quarto.yml: cwd would be too narrow a
    // root to find ../assets, so pass --root explicitly.
    const { code } = await cli(["render", "imago-showcase.qmd", "--root", ".."], join(proj, "demos"));
    expect(code).toBe(EXIT_OK);
    expect(sha(join(proj, "demos/imago-showcase.html"))).toBe(GOLDENS["demo-imago-showcase"].sha256);
  }, 60_000);

  test("imago-workshop fixture (local PNG) matches core's golden, with -o", async () => {
    const proj = tempCopy(IMAGO);
    const out = join(tempDir(), "out.html");
    const { code, stdout } = await cli(["render", "slide.qmd", "-o", out], proj);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toBe(`Output created: ${out}\n`); // outside cwd → absolute
    expect(sha(out)).toBe(GOLDENS["imago-workshop"].sha256);
    expect(existsSync(join(proj, "slide.html"))).toBe(false);
  }, 60_000);

  test("--print writes the print variant", async () => {
    const proj = tempCopy(DEMO);
    const { code } = await cli(["render", "demos/slide.qmd", "--print", "--output=print.html"], proj);
    expect(code).toBe(EXIT_OK);
    expect(sha(join(proj, "print.html"))).toBe(GOLDENS["demo-slide.print"].sha256);
  }, 60_000);

  test("a _quarto.yml above the deck marks the project root", async () => {
    const proj = tempCopy(DEMO);
    writeFileSync(join(proj, "_quarto.yml"), "project:\n  title: demo\n");
    // cwd is demos/ — without _quarto.yml the showcase could not see ../assets.
    const { code } = await cli(["render", "imago-showcase.qmd"], join(proj, "demos"));
    expect(code).toBe(EXIT_OK);
    expect(sha(join(proj, "demos/imago-showcase.html"))).toBe(GOLDENS["demo-imago-showcase"].sha256);
  }, 60_000);
});

describe("warnings and exit codes", () => {
  test("pandoc warnings go to stderr; info notes only with --verbose", async () => {
    const proj = tempDir();
    writeFileSync(join(proj, "deck.qmd"), "---\ntitle: T\nbibliography: refs.bib\n---\n\n# Hi\n\nSee [@nope].\n");
    writeFileSync(join(proj, "refs.bib"), "@misc{a, title={T}}\n");
    const quiet = await cli(["render", "deck.qmd"], proj);
    expect(quiet.code).toBe(EXIT_OK);
    expect(quiet.stderr).toContain("warning: Citeproc: citation nope not found");
    expect(quiet.stderr).not.toContain("Loaded references.bib");
    expect(quiet.stdout).toBe("Output created: deck.html\n");
    const verbose = await cli(["render", "deck.qmd", "--verbose"], proj);
    expect(verbose.stderr).toContain("info: Loaded references.bib");
  }, 60_000);

  test("a pandoc error exits 1 and writes nothing", async () => {
    const proj = tempDir();
    writeFileSync(join(proj, "deck.qmd"), "---\ntitle: T\n---\n\n# Hi\n");
    writeFileSync(join(proj, "refs.bib"), "@misc{broken, title={T");
    const { code, stderr, stdout } = await cli(["render", "deck.qmd"], proj);
    expect(code).toBe(EXIT_RENDER_ERROR);
    expect(stderr).toContain("Error reading bibliography");
    expect(stdout).toBe("");
    expect(existsSync(join(proj, "deck.html"))).toBe(false);
  }, 60_000);

  test("a Sass error exits 1 and writes nothing", async () => {
    const proj = tempDir();
    writeFileSync(join(proj, "deck.qmd"), "---\ntitle: T\n---\n\n# Hi\n");
    writeFileSync(join(proj, "theme.scss"), ".reveal { color: $undefined-variable; }\n");
    const { code, stderr } = await cli(["render", "deck.qmd"], proj);
    expect(code).toBe(EXIT_RENDER_ERROR);
    expect(stderr).toMatch(/error: .*Undefined variable/s);
    expect(existsSync(join(proj, "deck.html"))).toBe(false);
  }, 60_000);

  test("usage errors and missing files exit 2", async () => {
    const proj = tempDir();
    writeFileSync(join(proj, "deck.qmd"), "# Hi\n");
    const elsewhere = tempDir();
    for (const argv of [
      ["render"],
      ["render", "missing.qmd"],
      ["render", "deck.qmd", "extra.qmd"],
      ["render", "deck.qmd", "--bogus"],
      ["render", "deck.qmd", "-o"],
      ["render", "deck.qmd", "--root", "no-such-dir"],
      ["render", "deck.qmd", "--root", elsewhere], // deck outside the root
      ["frobnicate"],
      [],
    ]) {
      const { code } = await cli(argv, proj);
      expect(code, argv.join(" ")).toBe(EXIT_USAGE);
    }
    expect(existsSync(join(proj, "deck.html"))).toBe(false);
  });

  test("--version and --help exit 0", async () => {
    const version = await cli(["--version"], tempDir());
    expect(version).toMatchObject({ code: EXIT_OK, stdout: `${pkg.version}\n` });
    const help = await cli(["--help"], tempDir());
    expect(help.code).toBe(EXIT_OK);
    expect(help.stdout).toContain("slipway render <deck.qmd>");
  });
});

describe("project root detection", () => {
  test("explicit root wins, relative to cwd", () => {
    expect(findProjectRoot("/p/slides/deck.qmd", "/p/slides", "..")).toBe(resolve("/p"));
  });

  test("nearest _quarto.yml ancestor, else cwd if the deck is under it, else the deck's folder", () => {
    const base = tempDir();
    mkdirSync(join(base, "proj/slides/deep"), { recursive: true });
    const deck = join(base, "proj/slides/deep/deck.qmd");
    writeFileSync(deck, "# Hi\n");
    // No _quarto.yml anywhere: cwd contains the deck → cwd.
    expect(findProjectRoot(deck, join(base, "proj"))).toBe(join(base, "proj"));
    // cwd unrelated → the deck's folder.
    expect(findProjectRoot(deck, tempDir())).toBe(join(base, "proj/slides/deep"));
    // _quarto.yml beats cwd, and the nearest one wins.
    writeFileSync(join(base, "proj/_quarto.yml"), "");
    expect(findProjectRoot(deck, join(base, "proj/slides/deep"))).toBe(join(base, "proj"));
    writeFileSync(join(base, "proj/slides/_quarto.yml"), "");
    expect(findProjectRoot(deck, join(base, "proj"))).toBe(join(base, "proj/slides"));
  });

  test("path helpers", () => {
    expect(isInside("/a/b", "/a/b/c/d.qmd")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/bc/d.qmd")).toBe(false);
    expect(isInside("/a/b", "/a/d.qmd")).toBe(false);
    expect(toProjectPath("/a/b", "/a/b/c/d.qmd")).toBe("c/d.qmd");
  });

  test("hidden folders and node_modules are not part of the project", async () => {
    const proj = tempDir();
    writeFileSync(join(proj, "deck.qmd"), "---\ntitle: T\n---\n\n# Hi\n");
    for (const dir of [".git", "node_modules/pkg", ".quarto"]) {
      mkdirSync(join(proj, dir), { recursive: true });
      // A broken stylesheet: if the walker picked it up as the fallback
      // theme, the render would fail.
      writeFileSync(join(proj, dir, "a.scss"), ".x { color: $nope; }");
    }
    const { code } = await cli(["render", "deck.qmd"], proj);
    expect(code).toBe(EXIT_OK);
  }, 60_000);
});

describe("built artifact", () => {
  test("dist/slipway.mjs renders the golden deck as a subprocess, offline", async () => {
    const proj = tempCopy(DEMO);
    const { stdout } = await run(process.execPath, [BUNDLE, "render", "demos/slide.qmd"], {
      cwd: proj,
      // Any network use would have to go through these; point them nowhere.
      env: { ...process.env, HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", NO_PROXY: "" },
    });
    expect(stdout).toBe(`Output created: ${join("demos", "slide.html")}\n`);
    expect(sha(join(proj, "demos/slide.html"))).toBe(GOLDENS["demo-slide"].sha256);
  }, 60_000);

  test("dist/slipway.mjs --version, and exit code 2 for a missing deck", async () => {
    const { stdout } = await run(process.execPath, [BUNDLE, "--version"]);
    expect(stdout.trim()).toBe(pkg.version);
    await expect(run(process.execPath, [BUNDLE, "render", "nope.qmd"], { cwd: tempDir() })).rejects.toMatchObject({
      code: EXIT_USAGE,
    });
  }, 30_000);

  test("the bundle has no bare-package imports left (installs without a registry)", () => {
    const src = readFileSync(BUNDLE, "utf8");
    const imports = [...src.matchAll(/^import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec, spec).toMatch(/^node:/);
    expect(pkg).not.toHaveProperty("dependencies");
  });

  test("the npm tarball ships exactly the bundle, the wasm, the README and the manifest", async () => {
    const { stdout } = await run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: CLI_ROOT });
    const files = (JSON.parse(stdout)[0].files as Array<{ path: string }>).map((f) => f.path).sort();
    expect(files).toEqual(["README.md", "dist/pandoc.wasm", "dist/slipway.mjs", "package.json"]);
  }, 60_000);
});
