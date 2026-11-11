// A small in-memory stand-in for the `vscode` module, enough to load the
// built extension bundle (dist/extension.js) in Node and drive it: commands,
// a workspace over a real folder on disk, text documents, webview panels.
//
// It is NOT VS Code. It checks the extension's own logic — activation,
// project resolution, render triggers, what lands in the webview and on
// disk. Real-host behaviour (the Web Worker extension host, virtual file
// systems, the webview sandbox) is covered by the @vscode/test-web suite in
// CI and by the manual iPad checklist.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { URI, Utils } from "vscode-uri";

// vscode.Uri has a static joinPath; vscode-uri keeps it on Utils.
const Uri = Object.assign(URI, { joinPath: Utils.joinPath });

type Listener<T> = (e: T) => unknown;

class EventEmitter<T> {
  private listeners = new Set<Listener<T>>();
  event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(e: T) {
    for (const l of [...this.listeners]) l(e);
  }
  dispose() {
    this.listeners.clear();
  }
}

export interface FakeDocument {
  uri: URI;
  languageId: string;
  isDirty: boolean;
  getText(): string;
  lineCount: number;
}

export interface FakePanel {
  viewType: string;
  title: string;
  active: boolean;
  visible: boolean;
  options: Record<string, unknown>;
  webview: {
    html: string;
    posted: unknown[];
    postMessage(m: unknown): Promise<boolean>;
    onDidReceiveMessage: (l: Listener<unknown>) => { dispose(): void };
  };
  /** Test hook: simulate a message from the webview's bridge script. */
  receive(m: unknown): void;
  reveal(): void;
  dispose(): void;
  onDidDispose: (l: Listener<void>) => { dispose(): void };
  onDidChangeViewState: (l: Listener<unknown>) => { dispose(): void };
}

export function createFakeVscode(workspaceRoot: string, extensionRoot: string) {
  const config: Record<string, unknown> = {};
  const documents: FakeDocument[] = [];
  const panels: FakePanel[] = [];
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const serializers = new Map<string, { deserializeWebviewPanel(panel: FakePanel, state: unknown): Promise<void> }>();
  const didSave = new EventEmitter<FakeDocument>();
  const didChange = new EventEmitter<{ document: FakeDocument }>();
  const didChangeSelection = new EventEmitter<unknown>();
  const diagnostics = new Map<string, unknown[]>();
  const messages: string[] = [];
  const outputLines: string[] = [];
  const fsReads: string[] = [];
  let activeTextEditor: { document: FakeDocument; selection: unknown } | undefined;

  const rootUri = URI.file(workspaceRoot);

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }

  function makePanel(viewType: string, title: string, options: Record<string, unknown>): FakePanel {
    const received = new EventEmitter<unknown>();
    const disposed = new EventEmitter<void>();
    const viewState = new EventEmitter<unknown>();
    const panel: FakePanel = {
      viewType,
      title,
      active: false,
      visible: true,
      options,
      webview: {
        html: "",
        posted: [],
        postMessage: async (m) => (panel.webview.posted.push(m), true),
        onDidReceiveMessage: received.event,
      },
      receive: (m) => received.fire(m),
      reveal: () => {},
      dispose: () => {
        const i = panels.indexOf(panel);
        if (i >= 0) panels.splice(i, 1);
        disposed.fire();
      },
      onDidDispose: disposed.event,
      onDidChangeViewState: viewState.event,
    };
    panels.push(panel);
    return panel;
  }

  const vscode = {
    Uri,
    EventEmitter,
    RelativePattern: class {
      constructor(public base: unknown, public pattern: string) {}
    },
    Range: class {
      constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) {}
    },
    Diagnostic: class {
      source?: string;
      constructor(public range: unknown, public message: string, public severity: number) {}
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    UIKind: { Desktop: 1, Web: 2 },
    env: { uiKind: 1 },
    workspace: {
      fs: {
        readFile: async (uri: URI) => {
          fsReads.push(uri.toString());
          return new Uint8Array(readFileSync(uri.fsPath));
        },
        writeFile: async (uri: URI, bytes: Uint8Array) => {
          mkdirSync(dirname(uri.fsPath), { recursive: true });
          writeFileSync(uri.fsPath, bytes);
        },
        readDirectory: async (uri: URI) =>
          readdirSync(uri.fsPath).map((name) => [name, statSync(join(uri.fsPath, name)).isDirectory() ? 2 : 1] as [string, number]),
        stat: async (uri: URI) => {
          if (!existsSync(uri.fsPath)) throw new Error("FileNotFound");
          return { type: statSync(uri.fsPath).isDirectory() ? 2 : 1 };
        },
      },
      findFiles: async (pattern: { base: URI | { uri: URI } }) => {
        const base = "uri" in pattern.base ? pattern.base.uri : pattern.base;
        return walk(base.fsPath)
          .filter((p) => !/[\\/](node_modules|\.git)[\\/]/.test(p))
          .map((p) => URI.file(p));
      },
      getWorkspaceFolder: (uri: URI) =>
        uri.path.startsWith(rootUri.path + "/") ? { uri: rootUri, name: "ws", index: 0 } : undefined,
      getConfiguration: (_section: string) => ({
        get: <T>(key: string, fallback: T): T => (key in config ? (config[key] as T) : fallback),
      }),
      get textDocuments() {
        return documents;
      },
      onDidSaveTextDocument: didSave.event,
      onDidChangeTextDocument: didChange.event,
      createFileSystemWatcher: () => ({
        onDidCreate: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        onDidChange: () => ({ dispose() {} }),
        dispose() {},
      }),
    },
    window: {
      get activeTextEditor() {
        return activeTextEditor;
      },
      createOutputChannel: () => ({ appendLine: (l: string) => outputLines.push(l), dispose() {} }),
      withProgress: async (_opts: unknown, task: () => Promise<unknown>) => task(),
      createWebviewPanel: (viewType: string, title: string, _show: unknown, options: Record<string, unknown>) =>
        makePanel(viewType, title, options),
      registerWebviewPanelSerializer: (viewType: string, serializer: never) => {
        serializers.set(viewType, serializer);
        return { dispose() {} };
      },
      setStatusBarMessage: () => ({ dispose() {} }),
      showInformationMessage: async (m: string) => void messages.push(m),
      showWarningMessage: async (m: string) => void messages.push(m),
      showErrorMessage: async (m: string) => void messages.push(m),
      onDidChangeTextEditorSelection: didChangeSelection.event,
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri: URI, items: unknown[]) => void diagnostics.set(uri.toString(), items),
        delete: (uri: URI) => void diagnostics.delete(uri.toString()),
        clear: () => diagnostics.clear(),
        dispose() {},
      }),
    },
    commands: {
      registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
        commands.set(id, fn);
        return { dispose: () => commands.delete(id) };
      },
      executeCommand: async (id: string, ...args: unknown[]) => {
        const fn = commands.get(id);
        if (!fn) throw new Error(`command not found: ${id}`);
        return fn(...args);
      },
    },
  };

  /** Test-side controls. */
  const host = {
    config,
    panels,
    documents,
    diagnostics,
    messages,
    outputLines,
    fsReads,
    commands,
    serializers,
    makePanel,
    context: { extensionUri: URI.file(extensionRoot), subscriptions: [] as Array<{ dispose(): unknown }> },
    /** Open a file as a text document and make it the active editor. */
    openDocument(relPath: string): FakeDocument {
      const uri = URI.file(join(workspaceRoot, relPath));
      let text = readFileSync(uri.fsPath, "utf8");
      const doc: FakeDocument & { setText(t: string): void } = {
        uri,
        languageId: relPath.endsWith(".qmd") ? "quarto" : "plaintext",
        isDirty: false,
        getText: () => text,
        get lineCount() {
          return text.split("\n").length;
        },
        setText(t: string) {
          text = t;
          doc.isDirty = true;
          didChange.fire({ document: doc });
        },
      };
      documents.push(doc);
      activeTextEditor = { document: doc, selection: { active: { line: 0, character: 0 } } };
      return doc;
    },
    /** Edit a document's buffer without saving. */
    edit(doc: FakeDocument, text: string) {
      (doc as FakeDocument & { setText(t: string): void }).setText(text);
    },
    /** Save a document: write the buffer to disk and fire onDidSave. */
    save(doc: FakeDocument) {
      writeFileSync(doc.uri.fsPath, doc.getText());
      doc.isDirty = false;
      didSave.fire(doc);
    },
    /** Move the cursor in the active editor. */
    moveCursor(doc: FakeDocument, line: number) {
      activeTextEditor = { document: doc, selection: { active: { line, character: 0 } } };
      didChangeSelection.fire({ textEditor: activeTextEditor, selections: [activeTextEditor.selection] });
    },
    focusPanel(panel: FakePanel | null) {
      for (const p of panels) p.active = p === panel;
    },
  };

  return { vscode, host };
}
