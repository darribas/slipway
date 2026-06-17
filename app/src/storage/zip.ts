import { unzipSync, zipSync, strFromU8 } from "fflate";
import { BUNDLED_THEMES } from "./bundled-themes";
import { listFiles, readBytes, writeBytes, clearRoot } from "./storage";

const TEXT_EXTENSIONS = new Set([
  "qmd", "md", "txt", "scss", "css", "bib", "csl", "yaml", "yml", "json", "svg",
]);

function isText(name: string): boolean {
  return TEXT_EXTENSIONS.has(name.split(".").pop()?.toLowerCase() ?? "");
}

/**
 * Replace the current OPFS contents with the entries of the given zip file.
 * Skips directory entries (those with size 0 ending in /) and macOS metadata.
 */
export async function importZip(blob: Blob): Promise<{ filesWritten: number }> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const entries = unzipSync(buf, {
    filter: (file) =>
      file.size > 0 &&
      !file.name.startsWith("__MACOSX/") &&
      !file.name.endsWith("/.DS_Store") &&
      !file.name.endsWith(".DS_Store"),
  });
  await clearRoot();

  // If the zip has a single top-level directory wrapping everything, strip it
  // so the project root inside OPFS matches what the user authored.
  const names = Object.keys(entries);
  const topPrefix = sharedTopLevelDir(names);

  let count = 0;
  for (const [name, data] of Object.entries(entries)) {
    const path = topPrefix ? name.slice(topPrefix.length) : name;
    if (!path) continue;
    await writeBytes(path, data);
    count++;
  }
  return { filesWritten: count };
}

function sharedTopLevelDir(names: string[]): string {
  if (names.length === 0) return "";
  const firstSlash = names[0].indexOf("/");
  if (firstSlash <= 0) return "";
  const candidate = names[0].slice(0, firstSlash + 1);
  return names.every((n) => n.startsWith(candidate)) ? candidate : "";
}

/**
 * Bundle the current OPFS into a zip blob suitable for download.
 * If `renderedHtml` is supplied it is included as `rendered/index.html` — a
 * fully self-contained file (all assets inlined) that opens directly in any
 * browser without a server.
 *
 * Self-heals bundled themes: if the project keeps `assets/imago.scss` or
 * `assets/journal.scss` but is missing any of the font / licence files those
 * SCSS files reference (a deck imported from elsewhere without them, or the
 * user inadvertently deleted them), the bundled originals are added straight
 * into the zip so an exported project always renders under `quarto render`.
 * IDB is left untouched — only the export sees the augmentation.
 */
export async function exportZip(renderedHtml?: string | null): Promise<Blob> {
  const paths = await listFiles();
  const entries: Record<string, Uint8Array> = {};
  for (const path of paths) {
    entries[path] = await readBytes(path);
  }
  for (const theme of BUNDLED_THEMES) {
    if (!(theme.scss.path in entries)) continue;
    for (const asset of theme.assets) {
      if (!(asset.path in entries)) entries[asset.path] = asset.read();
    }
  }
  if (renderedHtml) {
    entries["rendered/index.html"] = new TextEncoder().encode(renderedHtml);
  }
  const zipped = zipSync(entries, { level: 6 });
  // ArrayBuffer copy to satisfy strict Blob types (zipped's underlying buffer
  // may be a SharedArrayBuffer view per fflate's typings).
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: "application/zip" });
}

/** Decode a text file from a zip entry, for read-without-writing scenarios. */
export function entryAsText(bytes: Uint8Array): string {
  return strFromU8(bytes);
}

export { isText };
