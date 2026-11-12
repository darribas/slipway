// The extension's view of a deck's project: which folder is the root, and a
// ProjectFS over vscode.workspace.fs so core resolves themes, bibliographies,
// images, fonts and includes exactly as the PWA and the CLI do.
//
// All I/O goes through workspace.fs with Uris — never assume `file:`. In VS
// Code for the Web the workspace is a virtual file system (e.g. Blink's
// blink-fs provider on iPad).

import * as vscode from "vscode";
import { Utils } from "vscode-uri";

import type { ProjectFS } from "@slipway/core";

import { isIgnoredProjectPath, relativeTo } from "./paths";

const MAX_FILES = 5000;

/**
 * Project root for a deck: the `slipway.projectRoot` setting if set, else
 * the workspace folder containing the deck, else the deck's own folder (a
 * single file opened without a folder).
 */
export function projectRootFor(deck: vscode.Uri): vscode.Uri {
  const folder = vscode.workspace.getWorkspaceFolder(deck);
  const configured = vscode.workspace.getConfiguration("slipway", deck).get<string>("projectRoot", "").trim();
  if (configured) {
    const root = /^[a-z][a-z0-9+.-]*:/i.test(configured)
      ? vscode.Uri.parse(configured)
      : configured.startsWith("/")
        ? deck.with({ path: configured })
        : vscode.Uri.joinPath(folder?.uri ?? Utils.dirname(deck), configured);
    // A root that doesn't contain the deck can't be right; fall through.
    if (root.scheme === deck.scheme && root.authority === deck.authority && relativeTo(root.path, deck.path)) {
      return root;
    }
  }
  return folder?.uri ?? Utils.dirname(deck);
}

/** A deck's path relative to its root — what core's buildRenderInputs takes. */
export function projectPathOf(root: vscode.Uri, file: vscode.Uri): string | null {
  if (root.scheme !== file.scheme || root.authority !== file.authority) return null;
  return relativeTo(root.path, file.path);
}

/**
 * The file list of one project root, cached. A FileSystemWatcher drops the
 * cache when files appear or disappear; because watchers are not guaranteed
 * to fire on virtual file systems, the cache is only trusted for `file:`
 * roots — everywhere else every render re-lists.
 */
export class ProjectIndex implements vscode.Disposable {
  private cached: Promise<string[]> | null = null;
  private readonly watcher: vscode.FileSystemWatcher;

  constructor(readonly root: vscode.Uri) {
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**/*"), false, true, false);
    this.watcher.onDidCreate(() => this.invalidate());
    this.watcher.onDidDelete(() => this.invalidate());
  }

  invalidate(): void {
    this.cached = null;
  }

  list(): Promise<string[]> {
    if (this.root.scheme !== "file") this.cached = null;
    if (!this.cached) {
      this.cached = this.scan().catch((err) => {
        this.cached = null;
        throw err;
      });
    }
    return this.cached;
  }

  private async scan(): Promise<string[]> {
    let paths: string[] = [];
    try {
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(this.root, "**/*"),
        "**/{node_modules,.git}/**",
        MAX_FILES,
      );
      paths = uris.map((u) => relativeTo(this.root.path, u.path)).filter((p): p is string => p !== null);
    } catch {
      // No search provider for this file system — fall back to walking it.
    }
    // findFiles needs a search provider, which a virtual file system may not
    // have; an empty answer for a folder we were asked to render a deck from
    // means "couldn't search", so walk the tree through workspace.fs instead.
    if (paths.length === 0) paths = await this.walk("");
    // Sorted by code unit, like the PWA's IndexedDB listing and the CLI.
    return paths.filter((p) => !isIgnoredProjectPath(p)).sort();
  }

  private async walk(rel: string, out: string[] = []): Promise<string[]> {
    const dir = rel ? vscode.Uri.joinPath(this.root, rel) : this.root;
    for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
      if (out.length >= MAX_FILES) break;
      const path = rel ? `${rel}/${name}` : name;
      if (isIgnoredProjectPath(name)) continue;
      if (type & vscode.FileType.Directory) await this.walk(path, out);
      else out.push(path);
    }
    return out;
  }

  dispose(): void {
    this.watcher.dispose();
  }
}

/**
 * ProjectFS for one render. Text files that are open in an editor are read
 * from the editor buffer, so a manual render shows what is on screen even
 * before it is saved (on save the two are the same).
 */
export function workspaceProjectFS(index: ProjectIndex): ProjectFS {
  const root = index.root;
  const openDocument = (path: string): vscode.TextDocument | undefined => {
    const target = vscode.Uri.joinPath(root, path).toString();
    return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === target);
  };
  return {
    listFiles: () => index.list(),
    readText: async (path) => {
      const doc = openDocument(path);
      if (doc) return doc.getText();
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, path));
      return new TextDecoder("utf-8").decode(bytes);
    },
    readBytes: (path) => Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, path))),
  };
}
