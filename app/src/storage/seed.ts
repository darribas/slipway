// First-run seed: copy the bundled slipway-demo template into IDB so the
// app has something to render the first time it's opened.
//
// Text files use ?raw imports (Vite inlines the source into the JS bundle so
// the render pipeline can recompile SCSS after edits). Binary font files are
// base64-bundled through the virtual:seed-fonts module and decoded here.
//
// Two entry points:
//   - seedIfEmpty(): first-run only (gated on the .seeded marker). Writes the
//     whole template.
//   - topUpBundledThemes(): runs every launch. Non-destructively adds any
//     bundled theme files (imago/journal + their fonts + licences) that aren't
//     already present, so EXISTING installs receive themes shipped after they
//     first seeded — without clobbering the user's deck or edits.

import slideQmd      from "../templates/slipway-demo/slide.qmd?raw";
import snippetQmd    from "../templates/slipway-demo/_snippet.qmd?raw";
import themeScss     from "../templates/slipway-demo/theme.scss?raw";
import imagoScss     from "../templates/slipway-demo/assets/imago.scss?raw";
import journalScss   from "../templates/slipway-demo/assets/journal.scss?raw";
import oflFigtree    from "../templates/slipway-demo/assets/fonts/figtree/OFL.txt?raw";
import licenseEtBook from "../templates/slipway-demo/assets/fonts/et-book/LICENSE.txt?raw";
import referencesBib from "../templates/slipway-demo/references.bib?raw";
import seedFonts     from "virtual:seed-fonts";

import { exists, readText, writeBytes, writeText } from "./storage";

const SEED_MARKER = ".seeded";

// Marker recording which generation of bundled themes an install has received.
// Bump when a new bundled theme (or font) is added so topUpBundledThemes()
// runs its missing-file pass once more for existing installs. Deletions the
// user made before the bump stay deleted across that one bump; that's the
// intended trade — top-up never resurrects a file the user removed in the
// current generation.
const BUNDLED_MARKER = ".bundled-themes";
const BUNDLED_VERSION = "1";

// The text-format bundled theme files, keyed by project path. Fonts are added
// from the seed-fonts virtual module (binary) at write time.
const BUNDLED_TEXT_FILES: ReadonlyArray<readonly [string, string]> = [
  ["assets/imago.scss", imagoScss],
  ["assets/journal.scss", journalScss],
  ["assets/fonts/figtree/OFL.txt", oflFigtree],
  ["assets/fonts/et-book/LICENSE.txt", licenseEtBook],
];

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Write every bundled theme file that isn't already present. Returns the paths
// actually written. Never overwrites an existing file, so a user's edited
// imago.scss (or their own same-named file) is left untouched.
async function writeMissingBundledFiles(): Promise<string[]> {
  const written: string[] = [];
  for (const [path, content] of BUNDLED_TEXT_FILES) {
    if (!(await exists(path))) {
      await writeText(path, content);
      written.push(path);
    }
  }
  for (const [path, b64] of Object.entries(seedFonts)) {
    if (!(await exists(path))) {
      await writeBytes(path, base64ToBytes(b64));
      written.push(path);
    }
  }
  return written;
}

export async function seedIfEmpty(): Promise<boolean> {
  if (await exists(SEED_MARKER)) return false;

  await writeText("slide.qmd", slideQmd);
  await writeText("_snippet.qmd", snippetQmd);
  await writeText("assets/theme.scss", themeScss);
  await writeText("assets/references.bib", referencesBib);
  // Bundled themes + self-hosted fonts: switch with `theme: assets/imago.scss`
  // or `theme: assets/journal.scss` and render offline.
  await writeMissingBundledFiles();
  await writeText(BUNDLED_MARKER, BUNDLED_VERSION);
  await writeText(SEED_MARKER, new Date().toISOString());
  return true;
}

/**
 * Top up an already-seeded install with bundled theme files added since it
 * first seeded. Idempotent and non-destructive: gated on the .bundled-themes
 * version marker (so it does at most one missing-file pass per generation) and
 * only writes files that don't already exist. Returns the paths written (empty
 * when the install is already current). Safe to call on every launch, including
 * brand-new installs (seedIfEmpty has already set the marker, so this no-ops).
 */
export async function topUpBundledThemes(): Promise<string[]> {
  const current = (await exists(BUNDLED_MARKER)) ? await readText(BUNDLED_MARKER) : null;
  if (current === BUNDLED_VERSION) return [];
  const written = await writeMissingBundledFiles();
  await writeText(BUNDLED_MARKER, BUNDLED_VERSION);
  return written;
}
