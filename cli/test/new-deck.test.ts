// new-deck.sh — the a-Shell (and desktop) starter-folder script.
//
//   - its per-theme file lists match themes/<name>/ exactly, so a theme
//     change that forgets the script fails here, not on someone's iPad;
//   - run for real under `sh` (dash on Linux, as in a-Shell) against this
//     checkout via SLIPWAY_BASE=file://…, it produces a folder whose starter
//     deck and showcase render cleanly — fonts and images inlined.

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterAll, describe, expect, test } from "vitest";

import { EXIT_OK, main } from "../src/cli";
import { THEMES_DIR, themeNames } from "../../themes/install.mjs";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../new-deck.sh");
const REPO = resolve(HERE, "../..");
const require = createRequire(import.meta.url);
const WASM = resolve(dirname(require.resolve("pandoc-wasm")), "pandoc.wasm");

const scratch: string[] = [];
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slipway-new-deck-"));
  scratch.push(dir);
  return dir;
}

function filesUnder(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel))) {
    const p = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, p)).isDirectory()) out.push(...filesUnder(dir, p));
    else out.push(p);
  }
  return out;
}

/** The FONTS list of one `case` branch of the script. */
function scriptFonts(theme: string): string[] {
  const src = readFileSync(SCRIPT, "utf8");
  const m = src.match(new RegExp(`\\n  ${theme}\\)\\n    FONTS="([^"]*)"`));
  if (!m) throw new Error(`no FONTS list for ${theme} in new-deck.sh`);
  return m[1].split("\n").map((s) => s.trim()).filter(Boolean);
}

async function newDeck(cwd: string, ...args: string[]) {
  return run("sh", [SCRIPT, ...args], {
    cwd,
    env: { ...process.env, SLIPWAY_BASE: pathToFileURL(REPO).href },
  });
}

async function render(deck: string, cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = await main(["render", deck], {
    cwd,
    wasmPath: WASM,
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  return { code, stdout, stderr, html: code === EXIT_OK ? readFileSync(join(cwd, deck.replace(/\.qmd$/, ".html")), "utf8") : "" };
}

describe("new-deck.sh file lists", () => {
  test("offers exactly the bundled themes", () => {
    const src = readFileSync(SCRIPT, "utf8");
    const offered = [...src.matchAll(/\n  ([a-z]+)\)\n    FONTS=/g)].map((m) => m[1]).sort();
    expect(offered).toEqual(themeNames());
  });

  for (const theme of themeNames()) {
    test(`${theme}: fetches every font and licence in themes/${theme}/fonts/, and nothing else`, () => {
      const onDisk = filesUnder(join(THEMES_DIR, theme)).filter((p) => p.startsWith("fonts/")).sort();
      expect(scriptFonts(theme).sort()).toEqual(onDisk);
    });
  }
});

describe("new-deck.sh, run under sh", () => {
  for (const theme of themeNames()) {
    test(`${theme}: sets up a folder whose decks render offline`, async () => {
      const cwd = tempDir();
      const { stdout } = await newDeck(cwd, "talk", theme);
      expect(stdout).toContain("Done.");
      const dir = join(cwd, "talk");
      expect(existsSync(join(dir, `assets/${theme}.scss`))).toBe(true);
      for (const f of scriptFonts(theme)) expect(existsSync(join(dir, "assets", f)), f).toBe(true);

      const starter = await render("deck.qmd", dir);
      expect(starter.code, starter.stderr).toBe(EXIT_OK);
      expect(starter.html).toContain("data:font/");

      if (existsSync(join(dir, "showcase.qmd"))) {
        expect(readFileSync(join(dir, "showcase.qmd"), "utf8")).not.toContain("../assets/");
        const showcase = await render("showcase.qmd", dir);
        expect(showcase.code, showcase.stderr).toBe(EXIT_OK);
        // Images referenced by the showcase come out inlined.
        expect(showcase.html).not.toMatch(/data-src="assets\//);
      }
    }, 120_000);
  }

  test("defaults to Travelogue and ships its showcase", async () => {
    const cwd = tempDir();
    await newDeck(cwd, "talk");
    expect(existsSync(join(cwd, "talk/assets/travelogue.scss"))).toBe(true);
    expect(existsSync(join(cwd, "talk/showcase.qmd"))).toBe(true);
    expect(existsSync(join(cwd, "talk/assets/travelogue-plate.svg"))).toBe(true);
  }, 60_000);

  test("refuses an existing folder and an unknown theme, without touching anything", async () => {
    const cwd = tempDir();
    await newDeck(cwd, "talk");
    await expect(newDeck(cwd, "talk")).rejects.toMatchObject({ stdout: expect.stringContaining("already exists") });
    await expect(newDeck(cwd, "other", "nope")).rejects.toMatchObject({ stdout: expect.stringContaining("unknown theme") });
    expect(existsSync(join(cwd, "other"))).toBe(false);
  }, 60_000);

  test("prints usage without a folder name", async () => {
    await expect(newDeck(tempDir())).rejects.toMatchObject({ stdout: expect.stringContaining("usage:") });
  });
});
