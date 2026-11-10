// App-only tests: storage, seed catalog, zip export, file tree. Everything
// about rendering lives in core/test/ (the PWA's renderer is @slipway/core).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { createPandocInstance, renderDeck } from "@slipway/core";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The PWA renders through @slipway/core and matches core's goldens
// ---------------------------------------------------------------------------

describe("PWA ↔ core", () => {
  test("the seed deck rendered via the app's dependency on @slipway/core matches core's golden", async () => {
    // Same inputs the PWA assembles for a freshly seeded project's
    // demos/slide.qmd (theme.scss, references.bib, the _snippet include; the
    // deck references no images and theme.scss no fonts).
    const DEMO = resolve(HERE, "../src/templates/slipway-demo");
    const read = (p: string) => readFileSync(resolve(DEMO, p), "utf8");
    const snippet = read("demos/_snippet.qmd");
    const showcase = read("demos/imago-showcase.qmd");
    const require = createRequire(import.meta.url);
    const wasm = readFileSync(resolve(dirname(require.resolve("pandoc-wasm")), "pandoc.wasm"));
    const pandoc = await createPandocInstance(wasm);
    const { html } = await renderDeck(pandoc, {
      qmd: read("demos/slide.qmd"),
      stylesheet: read("theme.scss"),
      stylesheetIsPrecompiled: false,
      bib: read("references.bib"),
      assets: new Map(),
      includes: new Map([
        ["demos/_snippet.qmd", snippet], ["_snippet.qmd", snippet],
        ["demos/imago-showcase.qmd", showcase], ["imago-showcase.qmd", showcase],
      ]),
    });
    const goldens = JSON.parse(readFileSync(resolve(HERE, "../../core/test/goldens/goldens.json"), "utf8"));
    expect(createHash("sha256").update(html, "utf8").digest("hex")).toBe(goldens["demo-slide"].sha256);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Bundled-theme catalog + self-healing export
// ---------------------------------------------------------------------------

describe("bundled-themes catalog", () => {
  // Note: Vite's SCSS preprocessor compiles `.scss?raw` to empty CSS inside
  // vitest (the ?raw query loses to the css plugin), so we don't assert on
  // SCSS byteLength here. The production build is verified by the existing
  // smoke tests above ("seed theme.scss carries Quarto layer markers" etc.)
  // and a `grep` of dist/assets confirms the content lands in the bundle.

  test("exposes Imago with assets/imago.scss + Figtree fonts + OFL licence", async () => {
    const { IMAGO } = await import("../src/storage/bundled-themes");
    expect(IMAGO.scss.path).toBe("assets/imago.scss");
    const paths = IMAGO.assets.map((a) => a.path);
    expect(paths).toContain("assets/fonts/figtree/OFL.txt");
    expect(paths).toContain("assets/fonts/figtree/figtree-latin-wght-normal.woff2");
    expect(paths).toContain("assets/fonts/figtree/figtree-latin-wght-italic.woff2");
    expect(paths).toContain("assets/fonts/figtree/figtree-latin-ext-wght-normal.woff2");
    expect(paths).toContain("assets/fonts/figtree/figtree-latin-ext-wght-italic.woff2");
    for (const asset of IMAGO.assets) {
      expect(asset.read().byteLength).toBeGreaterThan(0);
    }
  });

  test("exposes Journal with assets/journal.scss + ET Book fonts + MIT licence", async () => {
    const { JOURNAL } = await import("../src/storage/bundled-themes");
    expect(JOURNAL.scss.path).toBe("assets/journal.scss");
    const paths = JOURNAL.assets.map((a) => a.path);
    expect(paths).toContain("assets/fonts/et-book/LICENSE.txt");
    expect(paths).toContain("assets/fonts/et-book/et-book-roman-line-figures/et-book-roman-line-figures.woff");
    expect(paths).toContain("assets/fonts/et-book/et-book-bold-line-figures/et-book-bold-line-figures.woff");
    expect(paths).toContain("assets/fonts/et-book/et-book-roman-old-style-figures/et-book-roman-old-style-figures.woff");
    expect(paths).toContain("assets/fonts/et-book/et-book-display-italic-old-style-figures/et-book-display-italic-old-style-figures.woff");
    for (const asset of JOURNAL.assets) {
      expect(asset.read().byteLength).toBeGreaterThan(0);
    }
  });

  test("Figtree and ET Book asset paths don't overlap (one theme can be self-healed without dragging in the other)", async () => {
    const { IMAGO, JOURNAL } = await import("../src/storage/bundled-themes");
    const imago = new Set(IMAGO.assets.map((a) => a.path));
    for (const a of JOURNAL.assets) expect(imago.has(a.path)).toBe(false);
  });
});

describe("exportZip self-heals missing bundled-theme fonts", () => {
  // Self-healing is the fix for issue #37: a project that keeps a bundled
  // SCSS file but is missing the font files it references (e.g. a deck
  // imported from a foreign zip without fonts, or fonts inadvertently
  // deleted) should still produce an export that `quarto render` can render
  // offline.

  test("adds Figtree fonts and OFL.txt when assets/imago.scss is present but fonts aren't", async () => {
    // Reset the IDB module state before importing fake-indexeddb so the test
    // gets a clean store. fake-indexeddb/auto installs into globalThis.
    await import("fake-indexeddb/auto");
    // Bust the IDB connection cached at module scope: each test file gets a
    // fresh import graph in vitest, but if this describe block is re-run we
    // want a clean DB. Reset the global by removing the indexedDB db file.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("slipway");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });

    const storage = await import("../src/storage/storage");
    const { exportZip } = await import("../src/storage/zip");
    const { unzipSync } = await import("fflate");

    // Project: just a qmd that uses Imago, plus the SCSS itself — no fonts.
    await storage.writeText("slide.qmd", "---\ntitle: T\nformat: revealjs\n---\n# Hi\n");
    await storage.writeText("assets/imago.scss", "/* user-edited imago */");
    expect(await storage.exists("assets/fonts/figtree/figtree-latin-wght-normal.woff2")).toBe(false);

    const blob = await exportZip(null);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const entries = unzipSync(buf);
    const paths = Object.keys(entries);

    // User's SCSS edits are preserved — NOT overwritten by the bundled original.
    expect(new TextDecoder().decode(entries["assets/imago.scss"])).toBe("/* user-edited imago */");
    // Figtree fonts + OFL licence get added even though IDB didn't have them.
    expect(paths).toContain("assets/fonts/figtree/figtree-latin-wght-normal.woff2");
    expect(paths).toContain("assets/fonts/figtree/figtree-latin-wght-italic.woff2");
    expect(paths).toContain("assets/fonts/figtree/figtree-latin-ext-wght-normal.woff2");
    expect(paths).toContain("assets/fonts/figtree/figtree-latin-ext-wght-italic.woff2");
    expect(paths).toContain("assets/fonts/figtree/OFL.txt");
    // Journal fonts are NOT pulled in — only Imago is in this project.
    expect(paths.some((p) => p.includes("/et-book/"))).toBe(false);
    // IDB was not modified — fonts are added to the zip only.
    expect(await storage.exists("assets/fonts/figtree/figtree-latin-wght-normal.woff2")).toBe(false);

    await storage.clearRoot();
  });

  test("doesn't pull in bundled fonts when no bundled theme is in the project", async () => {
    await import("fake-indexeddb/auto");
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("slipway");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });

    const storage = await import("../src/storage/storage");
    const { exportZip } = await import("../src/storage/zip");
    const { unzipSync } = await import("fflate");

    await storage.writeText("slide.qmd", "---\ntitle: T\n---\n# Hi\n");
    await storage.writeText("assets/theme.scss", "/* user's own theme */");

    const blob = await exportZip(null);
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(entries).some((p) => p.includes("/figtree/"))).toBe(false);
    expect(Object.keys(entries).some((p) => p.includes("/et-book/"))).toBe(false);

    await storage.clearRoot();
  });
});

// ---------------------------------------------------------------------------
// Frontmatter extraction unit tests
// ---------------------------------------------------------------------------

describe("file tree buildTree", () => {
  test("empty folder (only .placeholder) still appears as a directory", async () => {
    const { buildTree } = await import("../src/ui/file-tree");
    const root = buildTree(["myfolder/.placeholder"]);
    const folder = root.children.get("myfolder");
    expect(folder?.isDir).toBe(true);
    expect(folder?.children.size).toBe(0); // placeholder hidden, folder kept
  });

  test("root dotfile markers are hidden entirely", async () => {
    const { buildTree } = await import("../src/ui/file-tree");
    const root = buildTree([".seeded", ".bundled-themes", "demos/slide.qmd"]);
    expect(root.children.has(".seeded")).toBe(false);
    expect(root.children.has(".bundled-themes")).toBe(false);
    expect(root.children.has("demos")).toBe(true);
  });

  test("nested files keep both folder and file nodes", async () => {
    const { buildTree } = await import("../src/ui/file-tree");
    const root = buildTree(["assets/theme.scss"]);
    const a = root.children.get("assets");
    expect(a?.isDir).toBe(true);
    expect(a?.children.get("theme.scss")?.isDir).toBe(false);
  });

  test("folder with a real file and a placeholder shows only the file", async () => {
    const { buildTree } = await import("../src/ui/file-tree");
    const root = buildTree(["demos/.placeholder", "demos/slide.qmd"]);
    const d = root.children.get("demos");
    expect([...d!.children.keys()]).toEqual(["slide.qmd"]);
  });
});
