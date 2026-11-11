// Preview panels: one WebviewPanel per deck, re-rendered on demand.

import * as vscode from "vscode";

import type { RenderResult } from "@slipway/core";

import { basename } from "./paths";
import { projectPathOf, projectRootFor } from "./project";
import type { Renderer } from "./renderer";
import { buildWebviewHtml, placeholderHtml } from "./webview";
import type { HostMessage, PreviewMessage, SlidePosition } from "./webview";

export const VIEW_TYPE = "slipway.preview";

export interface RenderEvent {
  deck: vscode.Uri;
  ok: boolean;
  result?: RenderResult;
  error?: string;
}

interface Preview {
  deck: vscode.Uri;
  root: vscode.Uri;
  panel: vscode.WebviewPanel;
  /** Where the presenter is; carried across re-renders. */
  position: SlidePosition | null;
  /** The last successful render (what Export HTML writes). */
  html: string | null;
  rendering: boolean;
  /** A render was requested while one was running: run once more after it. */
  again: boolean;
}

export class PreviewManager implements vscode.Disposable {
  private readonly previews = new Map<string, Preview>();
  private readonly didRender = new vscode.EventEmitter<RenderEvent>();
  /** Fires after every render attempt, successful or not. */
  readonly onDidRender = this.didRender.event;
  renderCount = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly log: (line: string) => void,
  ) {}

  get(deck: vscode.Uri): Preview | undefined {
    return this.previews.get(deck.toString());
  }

  /** The deck shown in the focused preview panel, if a preview has focus. */
  activeDeck(): vscode.Uri | undefined {
    for (const preview of this.previews.values()) if (preview.panel.active) return preview.deck;
    return undefined;
  }

  all(): Preview[] {
    return [...this.previews.values()];
  }

  /** Open (or reveal) the preview for a deck and render it. */
  open(deck: vscode.Uri, column: vscode.ViewColumn): Promise<void> {
    const existing = this.get(deck);
    if (existing) {
      existing.panel.reveal(column, true);
      return this.render(deck);
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      `Preview ${basename(deck.path)}`,
      { viewColumn: column, preserveFocus: true },
      // The deck is one self-contained document: scripts on, no local
      // resources. retainContextWhenHidden keeps reveal.js (and the slide
      // the presenter is on) alive while the tab is in the background.
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    this.adopt(deck, panel, null);
    return this.render(deck);
  }

  /** Wire up a panel (new, or handed back by VS Code after a reload). */
  adopt(deck: vscode.Uri, panel: vscode.WebviewPanel, position: SlidePosition | null): void {
    const preview: Preview = {
      deck,
      root: projectRootFor(deck),
      panel,
      position,
      html: null,
      rendering: false,
      again: false,
    };
    this.previews.set(deck.toString(), preview);
    panel.webview.html = placeholderHtml("Slipway: rendering…");
    panel.webview.onDidReceiveMessage((message: PreviewMessage) => {
      if (message && (message.type === "slideChanged" || message.type === "ready")) {
        preview.position = { h: message.h, v: message.v };
      }
    });
    panel.onDidDispose(() => {
      if (this.previews.get(deck.toString()) === preview) this.previews.delete(deck.toString());
    });
  }

  /** Tell a preview to show slide (h, v). */
  goto(deck: vscode.Uri, position: SlidePosition): void {
    const preview = this.get(deck);
    if (!preview || !preview.html) return;
    const message: HostMessage = { type: "goto", h: position.h, v: position.v };
    void preview.panel.webview.postMessage(message);
  }

  /**
   * Render a deck into its preview. Requests arriving while a render is in
   * flight collapse into a single follow-up render.
   */
  async render(deck: vscode.Uri): Promise<void> {
    const preview = this.get(deck);
    if (!preview) return;
    if (preview.rendering) {
      preview.again = true;
      return;
    }
    preview.rendering = true;
    try {
      do {
        preview.again = false;
        await this.renderOnce(preview);
      } while (preview.again);
    } finally {
      preview.rendering = false;
    }
  }

  private async renderOnce(preview: Preview): Promise<void> {
    const name = basename(preview.deck.path);
    this.renderCount += 1;
    preview.root = projectRootFor(preview.deck);
    try {
      const result = await this.renderer.render(preview.deck, preview.root);
      for (const d of result.diagnostics) this.log(`${name}: ${d.severity}: ${d.message}`);
      if (result.stderr.trim()) this.log(`${name}: ${result.stderr.trim()}`);
      if (!result.ok) {
        // Keep the last good render on screen.
        if (!preview.html) preview.panel.webview.html = placeholderHtml("Slipway: render failed — see the Slipway output channel.");
        this.didRender.fire({ deck: preview.deck, ok: false, result, error: result.stderr.trim() || "pandoc produced no output" });
        return;
      }
      preview.html = result.html;
      preview.panel.webview.html = buildWebviewHtml(result.html, preview.position);
      this.log(`${name}: rendered in ${Math.round(result.durationMs)} ms (${(result.html.length / 1024).toFixed(0)} kB)`);
      vscode.window.setStatusBarMessage(`Slipway: rendered ${name} in ${(result.durationMs / 1000).toFixed(1)} s`, 4000);
      this.didRender.fire({ deck: preview.deck, ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`${name}: error: ${message}`);
      if (!preview.html) preview.panel.webview.html = placeholderHtml("Slipway: render failed — see the Slipway output channel.");
      this.didRender.fire({ deck: preview.deck, ok: false, error: message });
    }
  }

  /** Previews whose project contains `file` (so saving a theme re-renders its decks). */
  previewsAffectedBy(file: vscode.Uri): Preview[] {
    return this.all().filter(
      (p) => p.deck.toString() === file.toString() || projectPathOf(p.root, file) !== null,
    );
  }

  dispose(): void {
    for (const preview of this.all()) preview.panel.dispose();
    this.previews.clear();
    this.didRender.dispose();
  }
}
