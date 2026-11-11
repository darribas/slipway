// Test suite that runs INSIDE VS Code for the Web's extension host (a Web
// Worker), next to the extension. No test framework: a list of async steps,
// run in order; the first failure rejects run() and fails the job.

import * as vscode from "vscode";

declare const __GOLDEN_DEMO_SLIDE__: string;
declare const __GOLDEN_IMAGO_SHOWCASE__: string;

interface RenderEvent {
  deck: vscode.Uri;
  ok: boolean;
  error?: string;
}
interface SlipwayApi {
  readonly pandocLoadMs: number;
  renderCount(): number;
  onDidRender: vscode.Event<RenderEvent>;
  lastHtml(deck: vscode.Uri): string | null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("assertion failed: " + message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nextRender(api: SlipwayApi, timeoutMs = 60_000): Promise<RenderEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error("timed out waiting for a render"));
    }, timeoutMs);
    const sub = api.onDidRender((event) => {
      clearTimeout(timer);
      sub.dispose();
      resolve(event);
    });
  });
}

function previewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes("slipway.preview"));
}

/**
 * From here on, anything in the extension host that tries to reach the
 * network fails loudly and is recorded.
 *
 * One exception, which is the test harness's and not the extension's: in
 * @vscode/test-web the workspace's virtual file system is itself an
 * extension in this same worker, serving files with fetch() from the local
 * test server under /static/mount. Those requests are the "disk" here, so
 * they pass; every other URL is refused.
 */
const blocked: string[] = [];
let mountReads = 0;
function cutTheNetwork(): void {
  const g = globalThis as Record<string, unknown>;
  const refuse = (what: string) => (...args: unknown[]) => {
    blocked.push(`${what}(${String(args[0]).slice(0, 120)})`);
    throw new Error(`network is cut for this test: ${what}`);
  };
  const realFetch = (g.fetch as typeof fetch).bind(globalThis);
  g.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url, "http://localhost").pathname.startsWith("/static/mount")) {
      mountReads += 1;
      return realFetch(input, init);
    }
    return refuse("fetch")(url);
  };
  g.importScripts = refuse("importScripts");
  g.XMLHttpRequest = class {
    constructor() {
      refuse("XMLHttpRequest")();
    }
  };
  g.WebSocket = class {
    constructor(url: string) {
      refuse("WebSocket")(url);
    }
  };
  g.EventSource = class {
    constructor(url: string) {
      refuse("EventSource")(url);
    }
  };
}

export async function run(): Promise<void> {
  const log = (line: string) => console.log(`[slipway test-web] ${line}`);
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert(folder, "a workspace folder is open");
  log(`workspace: ${folder.uri.toString()}`);
  assert(folder.uri.scheme !== "file", "the workspace is a virtual file system, as in VS Code for the Web");

  // --- activation -----------------------------------------------------------
  const extension = vscode.extensions.getExtension<SlipwayApi>("darribas.slipway");
  assert(extension, "the extension is installed");
  const t0 = Date.now();
  const api = await extension.activate();
  log(`activated in ${Date.now() - t0} ms; pandoc.wasm loaded + instantiated in ${api.pandocLoadMs} ms`);
  assert(vscode.env.uiKind === vscode.UIKind.Web, "running in VS Code for the Web");
  assert(api.pandocLoadMs > 0, "pandoc.wasm was loaded during activation");
  const commands = await vscode.commands.getCommands(true);
  for (const id of ["slipway.previewToSide", "slipway.preview", "slipway.render"]) {
    assert(commands.includes(id), `command ${id} is registered`);
  }

  // Everything below must work with the extension host offline.
  cutTheNetwork();
  log("network cut for the extension host (workspace mount excepted)");

  // --- previewToSide opens a panel and renders the golden HTML ----------------
  const deck = vscode.Uri.joinPath(folder.uri, "demos/slide.qmd");
  const doc = await vscode.workspace.openTextDocument(deck);
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  assert(doc.languageId === "quarto", `.qmd opens as quarto (got ${doc.languageId})`);
  assert(previewTabs().length === 0, "no preview is open yet");
  await vscode.commands.executeCommand("slipway.previewToSide");
  assert(previewTabs().length === 1, "previewToSide opened one preview panel");
  const html = api.lastHtml(deck);
  assert(html, "the deck rendered");
  const hash = await sha256(html);
  assert(hash === __GOLDEN_DEMO_SLIDE__, `rendered HTML matches the golden (got ${hash}, ${html.length} chars)`);
  log(`previewToSide: rendered ${html.length} chars, identical to the golden`);

  // --- a deck whose theme + fonts live in ../assets ---------------------------
  const showcase = vscode.Uri.joinPath(folder.uri, "demos/imago-showcase.qmd");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(showcase), vscode.ViewColumn.One);
  await vscode.commands.executeCommand("slipway.previewToSide");
  const showcaseHtml = api.lastHtml(showcase);
  assert(showcaseHtml, "the showcase deck rendered");
  const showcaseHash = await sha256(showcaseHtml);
  assert(showcaseHash === __GOLDEN_IMAGO_SHOWCASE__, `showcase HTML matches the golden (got ${showcaseHash})`);
  assert(previewTabs().length === 2, "each deck has its own preview panel");
  log("imago showcase: theme, fonts and bibliography resolved through the virtual file system");

  // --- saving triggers exactly one render -------------------------------------
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  const before = api.renderCount();
  const edit = new vscode.WorkspaceEdit();
  edit.insert(deck, new vscode.Position(doc.lineCount, 0), "\n## Added by the test\n\nSaved from VS Code for the Web.\n");
  assert(await vscode.workspace.applyEdit(edit), "the edit applied");
  await sleep(500);
  assert(api.renderCount() === before, "editing without saving renders nothing (renderOn: save)");
  const rendered = nextRender(api);
  assert(await doc.save(), "the document saved");
  const event = await rendered;
  assert(event.ok, `the render after saving succeeded (${event.error ?? ""})`);
  await sleep(1500);
  assert(api.renderCount() === before + 1, `saving triggered exactly one render (got ${api.renderCount() - before})`);
  assert(api.lastHtml(deck)?.includes("Added by the test"), "the new render has the saved content");
  log("save: exactly one render, with the new content");

  // --- Slipway: Render re-renders on demand -----------------------------------
  const manual = nextRender(api);
  await vscode.commands.executeCommand("slipway.render", deck);
  assert((await manual).ok, "Slipway: Render succeeded");

  // --- Export HTML writes a self-contained file ---------------------------------
  await vscode.commands.executeCommand("slipway.exportHtml", showcase);
  const exported = vscode.Uri.joinPath(folder.uri, "demos/imago-showcase.html");
  const bytes = await vscode.workspace.fs.readFile(exported);
  const out = new TextDecoder().decode(bytes);
  assert((await sha256(out)) === __GOLDEN_IMAGO_SHOWCASE__, "the exported file is the golden HTML");
  assert(!/<script[^>]+src=["']https?:/i.test(out), "no external scripts in the export");
  assert(!/<link[^>]+href=["']https?:/i.test(out), "no external stylesheets in the export");
  assert(!/url\(\s*["']?https?:/i.test(out), "no http(s) url() in the export's CSS");
  log(`exportHtml: wrote ${bytes.byteLength} bytes, self-contained`);

  // --- cursor sync and the remaining commands exist -----------------------------
  for (const id of ["slipway.exportHtml", "slipway.exportPrintHtml", "slipway.toggleSync"]) {
    assert(commands.includes(id), `command ${id} is registered`);
  }

  assert(blocked.length === 0, `the extension made no network attempts after activation (saw: ${blocked.join(", ")})`);
  log(`no network attempts after activation (${mountReads} workspace-file reads went through the harness's mount)`);
}
