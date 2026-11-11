// Slipway for VS Code — a web extension (also loaded by desktop VS Code).
// Renders .qmd decks with @slipway/core and shows them in a webview.

import * as vscode from "vscode";

import { isIgnoredProjectPath } from "./paths";
import { projectPathOf } from "./project";
import { PreviewManager } from "./preview";
import type { RenderEvent } from "./preview";
import { Renderer } from "./renderer";

/** What `extensions.getExtension("darribas.slipway").exports` offers (used by tests). */
export interface SlipwayApi {
  /** Milliseconds activation spent loading and instantiating pandoc.wasm. */
  readonly pandocLoadMs: number;
  /** Render attempts so far. */
  renderCount(): number;
  /** Fires after every render attempt. */
  onDidRender: vscode.Event<RenderEvent>;
  /** The last successfully rendered HTML for a deck with an open preview. */
  lastHtml(deck: vscode.Uri): string | null;
}

function isDeck(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
  return !!doc && (doc.languageId === "quarto" || doc.uri.path.toLowerCase().endsWith(".qmd"));
}

export async function activate(context: vscode.ExtensionContext): Promise<SlipwayApi> {
  const output = vscode.window.createOutputChannel("Slipway");
  const log = (line: string) => output.appendLine(line);
  context.subscriptions.push(output);

  // Load pandoc now, not on first use: once activate() has returned, the
  // extension must work with no network at all.
  const renderer = new Renderer(context.extensionUri);
  context.subscriptions.push(renderer);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Slipway: loading renderer…" },
    () => renderer.load(),
  );
  log(`renderer loaded in ${renderer.loadMs} ms (pandoc.wasm ${(renderer.wasmBytes / 1048576).toFixed(1)} MB, ${vscode.env.uiKind === vscode.UIKind.Web ? "web" : "desktop"} host)`);

  const previews = new PreviewManager(renderer, log);
  context.subscriptions.push(previews);

  /** The deck a command applies to: an explicit Uri, the focused preview's, or the active editor's. */
  const targetDeck = (arg?: unknown): vscode.Uri | undefined => {
    if (arg instanceof vscode.Uri) return arg;
    const fromPreview = previews.activeDeck();
    if (fromPreview) return fromPreview;
    const doc = vscode.window.activeTextEditor?.document;
    return isDeck(doc) ? doc.uri : undefined;
  };
  const needDeck = (arg?: unknown): vscode.Uri | undefined => {
    const deck = targetDeck(arg);
    if (!deck) void vscode.window.showInformationMessage("Slipway: open a .qmd deck first.");
    return deck;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("slipway.previewToSide", async (arg?: unknown) => {
      const deck = needDeck(arg);
      if (deck) await previews.open(deck, vscode.ViewColumn.Beside);
    }),
    vscode.commands.registerCommand("slipway.preview", async (arg?: unknown) => {
      const deck = needDeck(arg);
      if (deck) await previews.open(deck, vscode.ViewColumn.Active);
    }),
    vscode.commands.registerCommand("slipway.render", async (arg?: unknown) => {
      const deck = needDeck(arg);
      if (!deck) return;
      if (previews.get(deck)) await previews.render(deck);
      else await previews.open(deck, vscode.ViewColumn.Beside);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const mode = vscode.workspace.getConfiguration("slipway", doc.uri).get<string>("renderOn", "save");
      if (mode !== "save") return;
      for (const preview of previews.previewsAffectedBy(doc.uri)) {
        const rel = projectPathOf(preview.root, doc.uri);
        if (rel && isIgnoredProjectPath(rel)) continue;
        void previews.render(preview.deck);
      }
    }),
  );

  return {
    pandocLoadMs: renderer.loadMs,
    renderCount: () => previews.renderCount,
    onDidRender: previews.onDidRender,
    lastHtml: (deck) => previews.get(deck)?.html ?? null,
  };
}

export function deactivate(): void {}
