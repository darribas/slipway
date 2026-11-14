// Resolve a deck into the bundle of files the renderer needs, reading the
// project through a small file-system interface each surface implements
// (IndexedDB in the PWA, workspace.fs in the VS Code extension, node:fs in
// the CLI). Keeping the resolution rules here is what makes
// `theme: ../assets/imago.scss` behave identically everywhere.

import { extractDeclarations } from "./frontmatter";
import { resolveDeclaredPath } from "./path-resolve";
import type { RenderInputs } from "./types";

export interface ProjectFS {
  /**
   * Every file in the project, as POSIX paths relative to the project root.
   * The order matters when a deck declares no theme / bibliography (the
   * first .scss / .css / .bib wins) and when an image is referenced by a
   * basename two files share (the last one wins), so implementations should
   * return a sorted list.
   */
  listFiles(): Promise<string[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

// Binary assets the renderer inlines as data URIs: images (rewritten into
// the markdown) and fonts (rewritten into the compiled theme CSS).
const BINARY_ASSET_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg",
  "woff2", "woff", "ttf", "otf",
]);
const INCLUDE_EXTENSIONS = new Set(["qmd", "md", "markdown"]);

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** POSIX path of project file `to`, relative to project folder `fromDir` ("" = root). */
export function relativeTo(fromDir: string, to: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const target = to.split("/");
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common++;
  return [...Array(from.length - common).fill(".."), ...target.slice(common)].join("/");
}

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/** A synchronous ProjectFS, for hosts whose file access is blocking (a-Shell's jsc). */
export interface ProjectFSSync {
  listFiles(): string[];
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
}

/** Which project files a deck needs — the resolution rules, with no I/O. */
interface RenderPlan {
  /** The deck's own project path; images may be referenced relative to it. */
  qmdPath: string;
  themePath: string | null;
  bibPath: string | null;
  /** Binary assets (images, fonts), in list order. */
  assetPaths: string[];
  /** {{< include >}} candidates, in list order. */
  includePaths: string[];
}

function planRenderInputs(qmdPath: string, qmd: string, all: string[]): RenderPlan {
  const declared = extractDeclarations(qmd);

  // Theme resolution. Honour the YAML's `theme:` declaration when present
  // (with path resolution that tolerates `../` segments and basename
  // shorthand), so a project with multiple .scss files renders predictably.
  // Fall back to "first .scss" then "first .css" only when nothing's
  // declared or the declared path can't be resolved.
  let themePath: string | null = null;
  if (declared.theme) themePath = resolveDeclaredPath(declared.theme, all);
  if (!themePath) themePath = pickFirst(all, (p) => p.toLowerCase().endsWith(".scss"));
  if (!themePath) themePath = pickFirst(all, (p) => p.toLowerCase().endsWith(".css"));

  // Bibliography resolution follows the same pattern.
  let bibPath: string | null = null;
  if (declared.bib) bibPath = resolveDeclaredPath(declared.bib, all);
  if (!bibPath) bibPath = pickFirst(all, (p) => p.toLowerCase().endsWith(".bib"));

  return {
    qmdPath,
    themePath,
    bibPath,
    assetPaths: all.filter((p) => BINARY_ASSET_EXTENSIONS.has(extOf(p))),
    // Every .qmd / .md in the project except the deck itself.
    includePaths: all.filter((p) => INCLUDE_EXTENSIONS.has(extOf(p)) && p !== qmdPath),
  };
}

function assemble(
  qmd: string,
  plan: RenderPlan,
  stylesheet: string,
  bib: string | null,
  assetBytes: Uint8Array[],
  includeTexts: string[],
): RenderInputs {
  // Each asset is reachable under three keys, set from least to most specific
  // so the precise ones win when two keys coincide:
  //   1. its basename — the forgiving lookup decks and themes have always
  //      relied on (`plate.jpg`; font url()s match by basename too). When two
  //      files share a basename the later one wins this key.
  //   2. its project path (`assets/images/plate.jpg`).
  //   3. its path relative to the deck (`../assets/images/plate.jpg` from
  //      demos/), so an image reference resolves exactly as a browser or
  //      `quarto render` would resolve it.
  // The same bytes back every key; the renderer encodes each file once.
  const assets = new Map<string, Uint8Array>();
  plan.assetPaths.forEach((p, i) => assets.set(p.split("/").pop()!, assetBytes[i]));
  plan.assetPaths.forEach((p, i) => assets.set(p, assetBytes[i]));
  plan.assetPaths.forEach((p, i) => assets.set(relativeTo(dirOf(plan.qmdPath), p), assetBytes[i]));

  // Includes are keyed by both project path and basename so shortcode args
  // like `_snippet.qmd` and `includes/_snippet.qmd` both resolve. When two
  // files share a basename the first one wins on the basename key (the
  // explicit-path key still uniquely resolves either).
  const includes = new Map<string, string>();
  plan.includePaths.forEach((p, i) => {
    includes.set(p, includeTexts[i]);
    const basename = p.split("/").pop()!;
    if (!includes.has(basename)) includes.set(basename, includeTexts[i]);
  });

  return {
    qmd,
    stylesheet,
    stylesheetIsPrecompiled: plan.themePath?.toLowerCase().endsWith(".css") ?? false,
    bib,
    assets,
    includes,
  };
}

/**
 * Resolve a deck path into the bundle of files needed for rendering: the .qmd
 * itself, the project's theme stylesheet (.scss preferred; .css accepted as
 * already-compiled), the bib, and all image/font assets. Path resolution is
 * intentionally forgiving — YAML's relative paths (`../assets/foo.png`) are
 * flattened against the project at render time.
 */
export async function buildRenderInputs(qmdPath: string, fs: ProjectFS): Promise<RenderInputs> {
  const qmd = await fs.readText(qmdPath);
  const plan = planRenderInputs(qmdPath, qmd, await fs.listFiles());
  const stylesheet = plan.themePath ? await fs.readText(plan.themePath) : "";
  const bib = plan.bibPath ? await fs.readText(plan.bibPath) : null;
  const assetBytes: Uint8Array[] = [];
  for (const p of plan.assetPaths) assetBytes.push(await fs.readBytes(p));
  const includeTexts: string[] = [];
  for (const p of plan.includePaths) includeTexts.push(await fs.readText(p));
  return assemble(qmd, plan, stylesheet, bib, assetBytes, includeTexts);
}

/** buildRenderInputs for a synchronous file system. Same rules, same result. */
export function buildRenderInputsSync(qmdPath: string, fs: ProjectFSSync): RenderInputs {
  const qmd = fs.readText(qmdPath);
  const plan = planRenderInputs(qmdPath, qmd, fs.listFiles());
  return assemble(
    qmd,
    plan,
    plan.themePath ? fs.readText(plan.themePath) : "",
    plan.bibPath ? fs.readText(plan.bibPath) : null,
    plan.assetPaths.map((p) => fs.readBytes(p)),
    plan.includePaths.map((p) => fs.readText(p)),
  );
}

function pickFirst<T>(arr: T[], pred: (v: T) => boolean): T | null {
  for (const v of arr) if (pred(v)) return v;
  return null;
}
