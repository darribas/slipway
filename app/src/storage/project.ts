import type { RenderInputs } from "../core/types";
import { listFiles, readBytes, readText, writeText } from "./opfs";

/**
 * The deck currently being edited. Stored in a module-level mutable so that
 * the editor, render button, and autosave debouncer all read the same value.
 */
let activeQmdPath: string | null = null;

export function setActiveQmd(path: string): void {
  activeQmdPath = path;
}

export function getActiveQmd(): string | null {
  return activeQmdPath;
}

export async function listQmds(): Promise<string[]> {
  const all = await listFiles();
  return all.filter((p) => p.toLowerCase().endsWith(".qmd"));
}

export async function readQmd(path: string): Promise<string> {
  return await readText(path);
}

export async function saveQmd(path: string, content: string): Promise<void> {
  await writeText(path, content);
}

/**
 * Resolve a deck path into the bundle of files needed for rendering: the .qmd
 * itself, any sibling theme SCSS, the bib referenced (or the first one found),
 * and all image assets in the project. Path resolution is intentionally
 * forgiving — the YAML's relative paths (`../assets/foo.png`) are flattened
 * against the project at render time.
 */
export async function buildRenderInputs(qmdPath: string): Promise<RenderInputs> {
  const qmd = await readText(qmdPath);
  const all = await listFiles();

  const scssPath = pickFirst(all, (p) => p.toLowerCase().endsWith(".scss"));
  const scss = scssPath ? await readText(scssPath) : "";

  const bibPath = pickFirst(all, (p) => p.toLowerCase().endsWith(".bib"));
  const bib = bibPath ? await readText(bibPath) : null;

  const assets = new Map<string, Uint8Array>();
  for (const p of all) {
    const ext = p.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      const basename = p.split("/").pop()!;
      assets.set(basename, await readBytes(p));
    }
  }

  return { qmd, scss, bib, assets };
}

function pickFirst<T>(arr: T[], pred: (v: T) => boolean): T | null {
  for (const v of arr) if (pred(v)) return v;
  return null;
}
