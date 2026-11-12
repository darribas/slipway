// Test helper: a ProjectFS over a directory on disk, so tests assemble
// RenderInputs through core's real buildRenderInputs(). Paths are POSIX,
// relative to `root`, sorted like the PWA's storage.listFiles().

import { readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildRenderInputs } from "../../src/index";
import type { ProjectFS, ProjectFSSync, RenderInputs } from "../../src/index";

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(root, p)));
    else out.push(p);
  }
  return out;
}

/**
 * `overlay` adds (or replaces) text files on top of what is on disk, so a
 * test can render a synthetic deck against a real project folder.
 */
export function dirProjectFS(root: string, overlay: Record<string, string> = {}): ProjectFS {
  return {
    listFiles: async () => [...new Set([...(await walk(root)), ...Object.keys(overlay)])].sort(),
    readText: async (p) => overlay[p] ?? (await readFile(join(root, p), "utf8")),
    readBytes: async (p) =>
      p in overlay ? new TextEncoder().encode(overlay[p]) : new Uint8Array(await readFile(join(root, p))),
  };
}

/** An in-memory ProjectFS for unit tests. */
export function memProjectFS(files: Record<string, string | Uint8Array>): ProjectFS {
  const get = (p: string) => {
    if (!(p in files)) throw new Error(`no such file: ${p}`);
    return files[p];
  };
  return {
    listFiles: async () => Object.keys(files).sort(),
    readText: async (p) => {
      const d = get(p);
      return typeof d === "string" ? d : new TextDecoder().decode(d);
    },
    readBytes: async (p) => {
      const d = get(p);
      return typeof d === "string" ? new TextEncoder().encode(d) : d;
    },
  };
}

export function loadProjectInputs(
  root: string,
  qmdPath: string,
  overlay: Record<string, string> = {},
): Promise<RenderInputs> {
  return buildRenderInputs(qmdPath, dirProjectFS(root, overlay));
}

/** The synchronous twin of dirProjectFS. */
export function dirProjectFSSync(root: string): ProjectFSSync {
  const walkSync = (rel: string, out: string[]): string[] => {
    for (const name of readdirSync(join(root, rel))) {
      const p = rel ? `${rel}/${name}` : name;
      if (statSync(join(root, p)).isDirectory()) walkSync(p, out);
      else out.push(p);
    }
    return out;
  };
  return {
    listFiles: () => walkSync("", []).sort(),
    readText: (p) => readFileSync(join(root, p), "utf8"),
    readBytes: (p) => new Uint8Array(readFileSync(join(root, p))),
  };
}
