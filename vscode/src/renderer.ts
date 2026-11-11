// Owns the pandoc instance and runs renders, one at a time.

import * as vscode from "vscode";

import { buildRenderInputs, createPandocInstance, renderDeck } from "@slipway/core";
import type { PandocInstance, RenderResult } from "@slipway/core";

import { ProjectIndex, projectPathOf, workspaceProjectFS } from "./project";

export class Renderer implements vscode.Disposable {
  private pandoc: PandocInstance | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly indexes = new Map<string, ProjectIndex>();
  /** How long loading + instantiating pandoc.wasm took, for the log. */
  loadMs = 0;
  wasmBytes = 0;
  /** The include map of each deck's most recent render (for slideMap). */
  readonly includes = new Map<string, Map<string, string>>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Read pandoc.wasm from the extension's own folder and instantiate it.
   * Called once, from activate(): after this resolves the extension needs
   * nothing more from the network — the 58 MB wasm is the only asset that is
   * not already inside the JS bundle.
   */
  async load(): Promise<void> {
    const t0 = Date.now();
    const uri = vscode.Uri.joinPath(this.extensionUri, "dist", "pandoc.wasm");
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (fsError) {
      // Some web hosts don't expose the extension's install location through
      // workspace.fs; the same file is then reachable over plain HTTP(S).
      if (uri.scheme !== "http" && uri.scheme !== "https") throw fsError;
      const response = await fetch(uri.toString(true));
      if (!response.ok) throw new Error(`could not load pandoc.wasm: HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    this.wasmBytes = bytes.byteLength;
    this.pandoc = await createPandocInstance(bytes);
    this.loadMs = Date.now() - t0;
  }

  indexFor(root: vscode.Uri): ProjectIndex {
    const key = root.toString();
    let index = this.indexes.get(key);
    if (!index) {
      index = new ProjectIndex(root);
      this.indexes.set(key, index);
    }
    return index;
  }

  /** Render `deck` within the project rooted at `root`. Renders never overlap. */
  render(deck: vscode.Uri, root: vscode.Uri): Promise<RenderResult> {
    const run = async (): Promise<RenderResult> => {
      if (!this.pandoc) throw new Error("the renderer is not loaded");
      const path = projectPathOf(root, deck);
      if (!path) throw new Error(`${deck.toString(true)} is not inside its project root ${root.toString(true)}`);
      const inputs = await buildRenderInputs(path, workspaceProjectFS(this.indexFor(root)));
      this.includes.set(deck.toString(), inputs.includes);
      return renderDeck(this.pandoc, inputs);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  dispose(): void {
    for (const index of this.indexes.values()) index.dispose();
    this.indexes.clear();
  }
}
