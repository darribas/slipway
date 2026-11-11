// Slipway for VS Code — a web extension (also loaded by desktop VS Code).
// Renders .qmd decks with @slipway/core and shows them in a webview.

import * as vscode from "vscode";

import { buildPrintVariant, slideAtLine, slideMap } from "@slipway/core";

import { basename, expandExportPath, isIgnoredProjectPath, printVariantPath } from "./paths";
import { projectPathOf, projectRootFor } from "./project";
import { PreviewManager, VIEW_TYPE } from "./preview";
import type { RenderEvent } from "./preview";
import { Renderer } from "./renderer";
import type { SlidePosition } from "./webview";

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

  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastSynced = new Map<string, SlidePosition>();
  const diagnostics = vscode.languages.createDiagnosticCollection("slipway");

  const renderMode = (uri: vscode.Uri) => vscode.workspace.getConfiguration("slipway", uri).get<string>("renderOn", "save");

  /** Decks with an open preview whose project contains `file` (ignoring hidden folders etc.). */
  const decksAffectedBy = (file: vscode.Uri): vscode.Uri[] =>
    previews
      .previewsAffectedBy(file)
      .filter((preview) => {
        const rel = projectPathOf(preview.root, file);
        return !(rel && isIgnoredProjectPath(rel));
      })
      .map((preview) => preview.deck);

  /**
   * Problems for a deck: render failures as errors, pandoc / Sass warnings as
   * warnings. Neither pandoc nor the pipeline report source lines, so they
   * sit on line 1. Informational notes stay in the output channel.
   */
  const publishDiagnostics = (event: RenderEvent) => {
    const top = new vscode.Range(0, 0, 0, 1);
    const items: vscode.Diagnostic[] = [];
    const add = (message: string, severity: vscode.DiagnosticSeverity) => {
      const d = new vscode.Diagnostic(top, message, severity);
      d.source = "slipway";
      items.push(d);
    };
    if (!event.ok) add(event.error ?? "render failed", vscode.DiagnosticSeverity.Error);
    for (const d of event.result?.diagnostics ?? []) {
      if (d.severity === "warning") add(d.message, vscode.DiagnosticSeverity.Warning);
    }
    diagnostics.set(event.deck, items);
  };

  /**
   * Render a deck and write the HTML next to it (or wherever
   * slipway.exportPath says). Always a fresh render, so the file reflects the
   * project as it is now, preview open or not.
   */
  const exportDeck = async (arg: unknown, print: boolean): Promise<vscode.Uri | undefined> => {
    const deck = needDeck(arg);
    if (!deck) return undefined;
    const name = basename(deck.path);
    try {
      const result = await renderer.render(deck, projectRootFor(deck));
      publishDiagnostics({ deck, ok: result.ok, result, error: result.stderr.trim() || undefined });
      if (!result.ok) throw new Error(result.stderr.trim() || "pandoc produced no output");
      const template = vscode.workspace.getConfiguration("slipway", deck).get<string>("exportPath", "");
      const folder = vscode.workspace.getWorkspaceFolder(deck);
      let path = expandExportPath(template, deck.path, folder?.uri.path ?? null);
      if (print) path = printVariantPath(path);
      const target = deck.with({ path });
      const html = print ? buildPrintVariant(result.html) : result.html;
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(html));
      log(`${name}: exported ${print ? "print " : ""}HTML to ${target.toString(true)} (${(html.length / 1024).toFixed(0)} kB)`);
      void vscode.window.showInformationMessage(`Slipway: exported ${basename(target.path)}`);
      return target;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${name}: export failed: ${message}`);
      void vscode.window.showErrorMessage(`Slipway: export failed — ${message.split("\n")[0]}`);
      return undefined;
    }
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
    vscode.commands.registerCommand("slipway.exportHtml", (arg?: unknown) => exportDeck(arg, false)),
    vscode.commands.registerCommand("slipway.exportPrintHtml", (arg?: unknown) => exportDeck(arg, true)),
    vscode.commands.registerCommand("slipway.toggleSync", async () => {
      const config = vscode.workspace.getConfiguration("slipway");
      const next = !config.get<boolean>("syncCursor", true);
      await config.update("syncCursor", next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Slipway: cursor sync ${next ? "on" : "off"}`, 3000);
    }),

    // --- render triggers ------------------------------------------------------
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (renderMode(doc.uri) !== "save") return;
      for (const deck of decksAffectedBy(doc.uri)) void previews.render(deck);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const uri = event.document.uri;
      if (event.contentChanges.length === 0 || renderMode(uri) !== "type") return;
      const decks = decksAffectedBy(uri);
      if (decks.length === 0) return;
      const delay = Math.max(200, vscode.workspace.getConfiguration("slipway", uri).get<number>("debounceMs", 1000));
      for (const deck of decks) {
        const key = deck.toString();
        clearTimeout(typingTimers.get(key));
        typingTimers.set(key, setTimeout(() => {
          typingTimers.delete(key);
          void previews.render(deck);
        }, delay));
      }
    }),

    // --- editor cursor → slide --------------------------------------------------
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const doc = event.textEditor.document;
      if (!isDeck(doc) || !previews.get(doc.uri)) return;
      if (!vscode.workspace.getConfiguration("slipway", doc.uri).get<boolean>("syncCursor", true)) return;
      const line = event.selections[0]?.active.line ?? 0;
      const span = slideAtLine(slideMap(doc.getText(), renderer.includes.get(doc.uri.toString())), line);
      if (!span) return;
      const key = doc.uri.toString();
      const last = lastSynced.get(key);
      if (last && last.h === span.h && last.v === span.v) return;
      lastSynced.set(key, { h: span.h, v: span.v });
      previews.goto(doc.uri, { h: span.h, v: span.v });
    }),

    // --- diagnostics ------------------------------------------------------------
    diagnostics,
    previews.onDidRender((event) => publishDiagnostics(event)),

    // --- previews survive a window reload ---------------------------------------
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
        const saved = state as { deck?: unknown; h?: unknown; v?: unknown } | undefined;
        if (!saved || typeof saved.deck !== "string") {
          panel.dispose(); // nothing to restore it from
          return;
        }
        const deck = vscode.Uri.parse(saved.deck);
        const position = typeof saved.h === "number" && typeof saved.v === "number" ? { h: saved.h, v: saved.v } : null;
        previews.adopt(deck, panel, position);
        await previews.render(deck);
      },
    }),
    { dispose: () => typingTimers.forEach((timer) => clearTimeout(timer)) },
  );

  return {
    pandocLoadMs: renderer.loadMs,
    renderCount: () => previews.renderCount,
    onDidRender: previews.onDidRender,
    lastHtml: (deck) => previews.get(deck)?.html ?? null,
  };
}

export function deactivate(): void {}
