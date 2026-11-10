// Test helper: assemble RenderInputs for a deck from a directory on disk,
// following the same resolution rules the PWA applies to its IndexedDB
// project (storage/project.ts → buildRenderInputs). Paths are POSIX,
// relative to `root`, listed in sorted order like storage.listFiles().

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { extractDeclarations, resolveDeclaredPath } from "../../src/index";
import type { RenderInputs } from "../../src/index";

const BINARY = ["png", "jpg", "jpeg", "gif", "webp", "svg", "woff2", "woff", "ttf", "otf"];

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(root, p)));
    else out.push(p);
  }
  return out;
}

const ext = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";

/**
 * `overlay` adds (or replaces) text files on top of what is on disk, so a
 * test can render a synthetic deck against a real project folder.
 */
export async function loadProjectInputs(
  root: string,
  qmdPath: string,
  overlay: Record<string, string> = {},
): Promise<RenderInputs> {
  const onDisk = await walk(root);
  const all = [...new Set([...onDisk, ...Object.keys(overlay)])].sort();
  const readText = async (p: string) => overlay[p] ?? (await readFile(join(root, p), "utf8"));

  const qmd = await readText(qmdPath);
  const declared = extractDeclarations(qmd);

  let themePath: string | null = null;
  if (declared.theme) themePath = resolveDeclaredPath(declared.theme, all);
  if (!themePath) themePath = all.find((p) => ext(p) === "scss") ?? null;
  if (!themePath) themePath = all.find((p) => ext(p) === "css") ?? null;
  const stylesheet = themePath ? await readText(themePath) : "";
  const stylesheetIsPrecompiled = themePath ? ext(themePath) === "css" : false;

  let bibPath: string | null = null;
  if (declared.bib) bibPath = resolveDeclaredPath(declared.bib, all);
  if (!bibPath) bibPath = all.find((p) => ext(p) === "bib") ?? null;
  const bib = bibPath ? await readText(bibPath) : null;

  const assets = new Map<string, Uint8Array>();
  const includes = new Map<string, string>();
  for (const p of all) {
    const basename = p.split("/").pop()!;
    if (BINARY.includes(ext(p))) {
      assets.set(basename, new Uint8Array(await readFile(join(root, p))));
    } else if (["qmd", "md", "markdown"].includes(ext(p)) && p !== qmdPath) {
      const text = await readText(p);
      includes.set(p, text);
      if (!includes.has(basename)) includes.set(basename, text);
    }
  }

  return { qmd, stylesheet, stylesheetIsPrecompiled, bib, assets, includes };
}
