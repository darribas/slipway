// Catalog of bundled themes — the SCSS and accompanying fonts/licences that
// ship inside the Slipway app. seed.ts uses this to populate (and top up)
// the project on launch; zip.ts uses it to self-heal exports so a project
// that's missing one of these files still gets a portable zip.
//
// Each theme is described by its SCSS path and the additional asset paths
// the SCSS needs at render time (`@font-face` woff/woff2 + the licence text).
// Asset bytes are decoded lazily — base64 for binaries — so importing this
// module is cheap even if the caller only needs the catalog.

import imagoScss     from "../templates/slipway-demo/assets/imago.scss?raw";
import journalScss   from "../templates/slipway-demo/assets/journal.scss?raw";
import oflFigtree    from "../templates/slipway-demo/assets/fonts/figtree/OFL.txt?raw";
import licenseEtBook from "../templates/slipway-demo/assets/fonts/et-book/LICENSE.txt?raw";
import seedFonts     from "virtual:seed-fonts";

export interface BundledFile {
  /** Project-relative path the file lives at. */
  path: string;
  /** Lazy reader — returns the file's bytes when called. */
  read: () => Uint8Array;
}

export interface BundledTheme {
  /** The SCSS file's project path (e.g. "assets/imago.scss"). */
  scss: BundledFile;
  /** The accompanying assets the SCSS references at render time (fonts + licence). */
  assets: BundledFile[];
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function textFile(path: string, source: string): BundledFile {
  return { path, read: () => new TextEncoder().encode(source) };
}

function fontFile(path: string, b64: string): BundledFile {
  return { path, read: () => base64ToBytes(b64) };
}

// Pick out the bundled font binaries whose project paths sit under
// `assets/fonts/<dirSegment>/…`. Matches by path so a single seed-fonts
// virtual module can carry every theme's fonts side by side.
function fontsUnder(dirSegment: string): BundledFile[] {
  const prefix = `assets/fonts/${dirSegment}/`;
  return Object.entries(seedFonts)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, b64]) => fontFile(path, b64));
}

export const IMAGO: BundledTheme = {
  scss: textFile("assets/imago.scss", imagoScss),
  assets: [
    textFile("assets/fonts/figtree/OFL.txt", oflFigtree),
    ...fontsUnder("figtree"),
  ],
};

export const JOURNAL: BundledTheme = {
  scss: textFile("assets/journal.scss", journalScss),
  assets: [
    textFile("assets/fonts/et-book/LICENSE.txt", licenseEtBook),
    ...fontsUnder("et-book"),
  ],
};

export const BUNDLED_THEMES: ReadonlyArray<BundledTheme> = [IMAGO, JOURNAL];

/** Every bundled file across all themes: SCSS + fonts + licences. */
export function allBundledFiles(): BundledFile[] {
  const out: BundledFile[] = [];
  for (const theme of BUNDLED_THEMES) {
    out.push(theme.scss, ...theme.assets);
  }
  return out;
}
