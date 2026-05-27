// First-run seed: copy the bundled slipway-demo template into IDB so the
// app has something to render the first time it's opened.
//
// All files are text, so ?raw imports are used throughout — Vite inlines the
// source into the JS bundle and the render pipeline can recompile the SCSS
// after the user edits it.

import slideQmd      from "../templates/slipway-demo/slide.qmd?raw";
import snippetQmd    from "../templates/slipway-demo/_snippet.qmd?raw";
import themeScss     from "../templates/slipway-demo/theme.scss?raw";
import referencesBib from "../templates/slipway-demo/references.bib?raw";

import { exists, writeText } from "./storage";

const SEED_MARKER = ".seeded";

export async function seedIfEmpty(): Promise<boolean> {
  if (await exists(SEED_MARKER)) return false;

  await writeText("slide.qmd", slideQmd);
  await writeText("_snippet.qmd", snippetQmd);
  await writeText("assets/theme.scss", themeScss);
  await writeText("assets/references.bib", referencesBib);
  await writeText(SEED_MARKER, new Date().toISOString());
  return true;
}
