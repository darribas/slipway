// Bundled themes, one self-contained folder each:
//
//   themes/<name>/<name>.scss          the theme
//   themes/<name>/fonts/<family>/…     its self-hosted fonts + licence
//
// A theme folder's contents are exactly what lands in a project's assets/
// folder: themes/imago/imago.scss → assets/imago.scss, and
// themes/imago/fonts/figtree/… → assets/fonts/figtree/…. Decks keep pointing
// at `theme: ../assets/imago.scss`, as before.
//
// The app bundles these files (app/src/storage/bundled-themes.ts and the
// seed-fonts plugin in app/vite.config.ts). This module is the same mapping
// for tests and scripts, which need the demo template as a complete project:
// the template under app/ no longer carries theme files of its own.
//
// Plain Node ESM with no dependencies, so any package's tests (and CI
// scripts) can import it by relative path — there's no root workspace.

import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of this themes/ folder. */
export const THEMES_DIR = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the PWA's seed/demo template (core's main test fixture). */
export const DEMO_TEMPLATE = resolve(THEMES_DIR, "../app/src/templates/slipway-demo");

/** Names of the bundled themes (the sub-folders of themes/). */
export function themeNames() {
  return readdirSync(THEMES_DIR)
    .filter((n) => statSync(join(THEMES_DIR, n)).isDirectory())
    .sort();
}

/** Copy every bundled theme into `<projectDir>/assets/`. */
export function installThemes(projectDir) {
  for (const name of themeNames()) {
    cpSync(join(THEMES_DIR, name), join(projectDir, "assets"), { recursive: true });
  }
  return projectDir;
}

let demoDir = null;

/**
 * The demo template with the bundled themes installed: a temp folder laid out
 * exactly like a freshly seeded project. Built once per process.
 */
export function demoProject() {
  if (!demoDir) {
    demoDir = mkdtempSync(join(tmpdir(), "slipway-demo-"));
    cpSync(DEMO_TEMPLATE, demoDir, { recursive: true });
    installThemes(demoDir);
    const dir = demoDir;
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  }
  return demoDir;
}
