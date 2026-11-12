// ProjectFS over node:fs — the CLI's view of a project folder.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProjectFS } from "@slipway/core";

/**
 * Directories never treated as part of a project: dependency trees and
 * anything hidden (.git, .quarto, .venv, …). The renderer reads every image,
 * font and markdown file in the project, so these would only add noise
 * (and, for node_modules, a lot of it).
 */
function skipDir(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(rel ? join(root, rel) : root, { withFileTypes: true });
  for (const entry of entries) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!skipDir(entry.name)) await walk(root, path, out);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push(path);
    }
  }
}

export function nodeProjectFS(root: string): ProjectFS {
  const abs = (path: string) => join(root, ...path.split("/"));
  return {
    // Sorted by code unit, like the PWA's IndexedDB listing: the order
    // decides fallbacks in buildRenderInputs, so it must match everywhere.
    listFiles: async () => {
      const out: string[] = [];
      await walk(root, "", out);
      return out.sort();
    },
    readText: (path) => readFile(abs(path), "utf8"),
    readBytes: async (path) => new Uint8Array(await readFile(abs(path))),
  };
}
