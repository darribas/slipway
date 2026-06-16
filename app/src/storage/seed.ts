// First-run seed: copy the bundled slipway-demo template into IDB so the
// app has something to render the first time it's opened.
//
// All files are text, so ?raw imports are used throughout — Vite inlines the
// source into the JS bundle and the render pipeline can recompile the SCSS
// after the user edits it.

import slideQmd      from "../templates/slipway-demo/slide.qmd?raw";
import snippetQmd    from "../templates/slipway-demo/_snippet.qmd?raw";
import themeScss     from "../templates/slipway-demo/theme.scss?raw";
import imagoScss     from "../templates/slipway-demo/assets/imago.scss?raw";
import journalScss   from "../templates/slipway-demo/assets/journal.scss?raw";
import oflFigtree    from "../templates/slipway-demo/assets/fonts/figtree/OFL.txt?raw";
import licenseEtBook from "../templates/slipway-demo/assets/fonts/et-book/LICENSE.txt?raw";
import referencesBib from "../templates/slipway-demo/references.bib?raw";
import seedFonts     from "virtual:seed-fonts";

import { exists, writeBytes, writeText } from "./storage";

const SEED_MARKER = ".seeded";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function seedIfEmpty(): Promise<boolean> {
  if (await exists(SEED_MARKER)) return false;

  await writeText("slide.qmd", slideQmd);
  await writeText("_snippet.qmd", snippetQmd);
  await writeText("assets/theme.scss", themeScss);
  // Bundled themes with self-hosted fonts + their licences, so the user can
  // switch to either with `theme: assets/imago.scss` / `theme: assets/journal.scss`
  // and render offline. The woff/woff2 files are written from the seed-fonts
  // virtual module below.
  await writeText("assets/imago.scss", imagoScss);
  await writeText("assets/journal.scss", journalScss);
  await writeText("assets/fonts/figtree/OFL.txt", oflFigtree);
  await writeText("assets/fonts/et-book/LICENSE.txt", licenseEtBook);
  for (const [path, b64] of Object.entries(seedFonts)) {
    await writeBytes(path, base64ToBytes(b64));
  }
  await writeText("assets/references.bib", referencesBib);
  await writeText(SEED_MARKER, new Date().toISOString());
  return true;
}
