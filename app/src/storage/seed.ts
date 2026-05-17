// First-run seed: copy the bundled imago workshop template into OPFS so the
// app has something to render the first time it's opened.
//
// Text files use ?raw so Vite inlines the raw source into the JS bundle — we
// must keep the SCSS unprocessed so our render pipeline can recompile it
// after the user edits it. The PNG uses ?url so it stays a separate asset.

import slideQmd from "../templates/imago-workshop/slide.qmd?raw";
import imagoScss from "../templates/imago-workshop/imago.scss?raw";
import referencesBib from "../templates/imago-workshop/references.bib?raw";
import attentionPngUrl from "../templates/imago-workshop/attention_paper.png?url";

import { exists, writeBytes, writeText } from "./storage";

const SEED_MARKER = ".seeded";

export async function seedIfEmpty(): Promise<boolean> {
  if (await exists(SEED_MARKER)) return false;

  const pngResp = await fetch(attentionPngUrl);
  if (!pngResp.ok) throw new Error(`Seed PNG fetch failed: ${pngResp.status}`);
  const png = new Uint8Array(await pngResp.arrayBuffer());

  await writeText("slide.qmd", slideQmd);
  await writeText("assets/imago.scss", imagoScss);
  await writeText("assets/references.bib", referencesBib);
  await writeBytes("assets/attention_paper.png", png);
  await writeText(SEED_MARKER, new Date().toISOString());
  return true;
}
