// The built extension bundle (dist/extension.js — the exact file VS Code
// loads) driven through a fake `vscode` module. See fake-vscode.ts for what
// this does and does not prove.

import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createFakeVscode } from "./fake-vscode";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = resolve(HERE, "..");
const DEMO = resolve(HERE, "../../app/src/templates/slipway-demo");
const GOLDENS: Record<string, { sha256: string }> = JSON.parse(
  readFileSync(resolve(HERE, "../../core/test/goldens/goldens.json"), "utf8"),
);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");

const workspace = mkdtempSync(join(tmpdir(), "slipway-vscode-"));
cpSync(DEMO, workspace, { recursive: true });
const { vscode, host } = createFakeVscode(workspace, EXT_ROOT);

interface Api {
  pandocLoadMs: number;
  renderCount(): number;
  onDidRender(listener: (e: { ok: boolean; error?: string }) => void): { dispose(): void };
  lastHtml(deck: unknown): string | null;
}
let api: Api;

/** Resolves with the next render event. */
function nextRender(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((done) => {
    const sub = api.onDidRender((e) => {
      sub.dispose();
      done(e);
    });
  });
}
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeAll(async () => {
  // dist/extension.js does require("vscode"); hand it the fake.
  const originalLoad = Module._load;
  Module._load = function (request: string, ...rest: unknown[]) {
    return request === "vscode" ? vscode : originalLoad.call(this, request, ...rest);
  };
  const extension = require(resolve(EXT_ROOT, "dist/extension.js"));
  api = await extension.activate(host.context);
}, 60_000);

afterAll(() => {
  for (const d of host.context.subscriptions) d.dispose();
  rmSync(workspace, { recursive: true, force: true });
});

describe("activation", () => {
  test("loads pandoc.wasm from the extension's own dist/ folder, once, during activate()", () => {
    const wasmReads = host.fsReads.filter((u) => u.endsWith("/dist/pandoc.wasm"));
    expect(wasmReads).toHaveLength(1);
    expect(wasmReads[0]).toContain(EXT_ROOT.split("\\").join("/"));
    expect(api.pandocLoadMs).toBeGreaterThan(0);
    expect(host.outputLines.join("\n")).toMatch(/renderer loaded in \d+ ms/);
  });

  test("registers the commands the manifest contributes", () => {
    const manifest = JSON.parse(readFileSync(resolve(EXT_ROOT, "package.json"), "utf8"));
    const contributed: string[] = manifest.contributes.commands.map((c: { command: string }) => c.command);
    expect(contributed.length).toBeGreaterThan(0);
    for (const id of contributed) expect(host.commands.has(id), id).toBe(true);
  });
});

describe("preview", () => {
  test("previewToSide opens one scripted, context-retaining panel and renders the golden HTML", async () => {
    const doc = host.openDocument("demos/slide.qmd");
    await vscode.commands.executeCommand("slipway.previewToSide");
    expect(host.panels).toHaveLength(1);
    const panel = host.panels[0];
    expect(panel.viewType).toBe("slipway.preview");
    expect(panel.title).toBe("Preview slide.qmd");
    expect(panel.options).toMatchObject({ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    // What the extension rendered is byte-identical to the PWA and the CLI.
    expect(sha(api.lastHtml(doc.uri)!)).toBe(GOLDENS["demo-slide"].sha256);
    // The webview shows that deck plus the CSP and the bridge.
    expect(panel.webview.html).toContain('http-equiv="Content-Security-Policy"');
    expect(panel.webview.html).toContain('data-from="slipway:vscode-bridge"');
    expect(panel.webview.html.length).toBeGreaterThan(api.lastHtml(doc.uri)!.length);
  }, 60_000);

  test("running the command again reuses the panel", async () => {
    const before = api.renderCount();
    await vscode.commands.executeCommand("slipway.previewToSide");
    expect(host.panels).toHaveLength(1);
    expect(api.renderCount()).toBe(before + 1);
  }, 60_000);

  test("a theme reached through ../assets resolves against the workspace folder", async () => {
    const doc = host.openDocument("demos/imago-showcase.qmd");
    await vscode.commands.executeCommand("slipway.preview");
    expect(host.panels).toHaveLength(2);
    expect(sha(api.lastHtml(doc.uri)!)).toBe(GOLDENS["demo-imago-showcase"].sha256);
    host.panels[1].dispose();
    expect(host.panels).toHaveLength(1);
    expect(api.lastHtml(doc.uri)).toBeNull();
  }, 60_000);
});

describe("render triggers", () => {
  test("saving the deck triggers exactly one render, with the new content", async () => {
    const doc = host.documents.find((d) => d.uri.path.endsWith("demos/slide.qmd"))!;
    const before = api.renderCount();
    host.edit(doc, doc.getText().replace('title: "Slipway"', 'title: "Edited on save"'));
    await settle();
    expect(api.renderCount()).toBe(before); // typing alone renders nothing
    const rendered = nextRender();
    host.save(doc);
    expect((await rendered).ok).toBe(true);
    await settle();
    expect(api.renderCount()).toBe(before + 1);
    expect(host.panels[0].webview.html).toContain("Edited on save");
  }, 60_000);

  test("saving another file in the project (the theme) re-renders the deck once", async () => {
    const theme = host.openDocument("theme.scss");
    const before = api.renderCount();
    host.edit(theme, theme.getText() + "\n.reveal .slipway-test-marker { color: rgb(1, 2, 3); }\n");
    const rendered = nextRender();
    host.save(theme);
    expect((await rendered).ok).toBe(true);
    await settle();
    expect(api.renderCount()).toBe(before + 1);
    expect(host.panels[0].webview.html).toContain("slipway-test-marker");
  }, 60_000);

  test("a burst of saves while rendering collapses into one follow-up render", async () => {
    const doc = host.documents.find((d) => d.uri.path.endsWith("demos/slide.qmd"))!;
    const before = api.renderCount();
    host.save(doc);
    host.save(doc);
    host.save(doc);
    host.save(doc);
    await nextRender();
    await nextRender();
    await settle();
    expect(api.renderCount()).toBe(before + 2);
  }, 60_000);

  test("renderOn: manual ignores saves; Slipway: Render renders the unsaved buffer", async () => {
    host.config.renderOn = "manual";
    const doc = host.documents.find((d) => d.uri.path.endsWith("demos/slide.qmd"))!;
    const before = api.renderCount();
    host.save(doc);
    await settle();
    expect(api.renderCount()).toBe(before);
    host.edit(doc, doc.getText().replace("Edited on save", "Unsaved buffer"));
    host.focusPanel(host.panels[0]); // the command runs from the preview's title bar
    await vscode.commands.executeCommand("slipway.render");
    expect(api.renderCount()).toBe(before + 1);
    expect(host.panels[0].webview.html).toContain("Unsaved buffer");
    host.focusPanel(null);
    delete host.config.renderOn;
  }, 60_000);
});

describe("failures keep the last good render", () => {
  test("a Sass error leaves the preview as it was and reports the failure", async () => {
    const theme = host.documents.find((d) => d.uri.path.endsWith("/theme.scss"))!;
    const good = host.panels[0].webview.html;
    const original = theme.getText();
    host.edit(theme, original + "\n.broken { color: $no-such-variable; }\n");
    const rendered = nextRender();
    host.save(theme);
    const event = await rendered;
    expect(event.ok).toBe(false);
    expect(event.error).toMatch(/Undefined variable/);
    expect(host.panels[0].webview.html).toBe(good);
    // Fix it again for the tests that follow.
    host.edit(theme, original);
    const fixed = nextRender();
    host.save(theme);
    expect((await fixed).ok).toBe(true);
  }, 60_000);
});

describe("slide position", () => {
  test("the slide the presenter is on is restored after a re-render", async () => {
    const doc = host.documents.find((d) => d.uri.path.endsWith("demos/slide.qmd"))!;
    host.panels[0].receive({ type: "slideChanged", h: 4, v: 2 });
    const rendered = nextRender();
    host.save(doc);
    await rendered;
    expect(host.panels[0].webview.html).toContain('var start = {"h":4,"v":2};');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Increment 4.5: export, cursor sync, diagnostics, type trigger, serializer
// ---------------------------------------------------------------------------

describe("export", () => {
  test("Export HTML writes a self-contained file next to the deck, with no asset URLs", async () => {
    const doc = host.openDocument("demos/imago-showcase.qmd");
    await vscode.commands.executeCommand("slipway.exportHtml");
    const out = readFileSync(join(workspace, "demos/imago-showcase.html"), "utf8");
    expect(sha(out)).toBe(GOLDENS["demo-imago-showcase"].sha256);
    // Nothing the browser would have to fetch: no external scripts or
    // stylesheets, no http(s) url() in CSS. (Plain links in slide text, and
    // images the deck itself links to, are the author's content.)
    expect(out).not.toMatch(/<script[^>]+src=["']https?:/i);
    expect(out).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:/i);
    expect(out).not.toMatch(/<link[^>]+href=["']https?:[^>]+rel=["']stylesheet/i);
    expect(out).not.toMatch(/url\(\s*["']?https?:/i);
    expect(out).not.toMatch(/@import\s+["']https?:/i);
    expect(host.messages.join("\n")).toContain("exported imago-showcase.html");
    expect(doc.uri.path).toContain("imago-showcase.qmd");
  }, 60_000);

  test("exporting does not open a preview or count as a preview render", async () => {
    const before = api.renderCount();
    const panels = host.panels.length;
    await vscode.commands.executeCommand("slipway.exportHtml");
    expect(api.renderCount()).toBe(before);
    expect(host.panels).toHaveLength(panels);
  }, 60_000);

  test("slipway.exportPath is honoured; the explorer context menu passes the deck's Uri", async () => {
    host.config.exportPath = "${workspaceFolder}/out/${fileBasenameNoExtension}.html";
    const deck = vscode.Uri.file(join(workspace, "demos/slide.qmd"));
    await vscode.commands.executeCommand("slipway.exportHtml", deck);
    expect(readFileSync(join(workspace, "out/slide.html"), "utf8")).toContain('class="reveal"');
    delete host.config.exportPath;
  }, 60_000);

  test("Export Print HTML writes the print variant beside it", async () => {
    host.openDocument("demos/imago-showcase.qmd");
    await vscode.commands.executeCommand("slipway.exportPrintHtml");
    const out = readFileSync(join(workspace, "demos/imago-showcase.print.html"), "utf8");
    expect(out).toContain('view: "print",');
    expect(out).toContain('data-from="slipway:auto-print"');
  }, 60_000);

  test("a failed export writes nothing and says so", async () => {
    const theme = host.documents.find((d) => d.uri.path.endsWith("/theme.scss"))!;
    const original = theme.getText();
    host.config.renderOn = "manual";
    host.edit(theme, original + "\n.broken { color: $still-undefined; }\n");
    host.config.exportPath = "failed/${fileBasenameNoExtension}.html";
    host.messages.length = 0;
    await vscode.commands.executeCommand("slipway.exportHtml", vscode.Uri.file(join(workspace, "demos/slide.qmd")));
    expect(() => readFileSync(join(workspace, "demos/failed/slide.html"))).toThrow();
    expect(host.messages.join("\n")).toMatch(/export failed/);
    host.edit(theme, original);
    delete host.config.exportPath;
    delete host.config.renderOn;
  }, 60_000);
});

describe("cursor sync", () => {
  const deckDoc = () => host.documents.find((d) => d.uri.path.endsWith("demos/slide.qmd"))!;
  const gotos = () => host.panels[0].webview.posted.filter((m) => (m as { type: string }).type === "goto");

  test("moving the cursor into another slide sends one goto with that slide's indices", async () => {
    const doc = deckDoc();
    // Make sure the preview shows the current buffer.
    host.focusPanel(host.panels[0]);
    await vscode.commands.executeCommand("slipway.render");
    host.focusPanel(null);
    const lines = doc.getText().split("\n");
    const h1s = lines.map((l, i) => (/^# /.test(l) ? i : -1)).filter((i) => i >= 0);
    expect(h1s.length).toBeGreaterThan(2);
    host.panels[0].webview.posted.length = 0;

    host.moveCursor(doc, h1s[1] + 1); // inside the second level-1 section
    expect(gotos()).toEqual([{ type: "goto", h: 2, v: 0 }]); // h=0 is the title slide
    host.moveCursor(doc, h1s[1]); // same slide: nothing new is sent
    expect(gotos()).toHaveLength(1);
    host.moveCursor(doc, 1); // the frontmatter → title slide
    expect(gotos()[1]).toEqual({ type: "goto", h: 0, v: 0 });
  }, 60_000);

  test("Toggle Cursor Sync turns following off and on again", async () => {
    const doc = deckDoc();
    const h1 = doc.getText().split("\n").findIndex((l) => /^# /.test(l));
    await vscode.commands.executeCommand("slipway.toggleSync");
    expect(host.config.syncCursor).toBe(false);
    host.panels[0].webview.posted.length = 0;
    host.moveCursor(doc, h1);
    expect(gotos()).toHaveLength(0);
    await vscode.commands.executeCommand("slipway.toggleSync");
    expect(host.config.syncCursor).toBe(true);
    host.moveCursor(doc, 0);
    host.moveCursor(doc, h1);
    expect(gotos().length).toBeGreaterThan(0);
    delete host.config.syncCursor;
  });

  test("a deck without a preview is left alone", () => {
    const other = host.openDocument("demos/imago-showcase.qmd");
    expect(() => host.moveCursor(other, 30)).not.toThrow();
  });
});

describe("diagnostics", () => {
  const deckDoc = () => host.documents.find((d) => d.uri.path.endsWith("demos/slide.qmd"))!;
  const problems = () => (host.diagnostics.get(deckDoc().uri.toString()) ?? []) as Array<{ message: string; severity: number; source?: string }>;

  test("a render error becomes an Error on the deck; a clean render clears it", async () => {
    const theme = host.documents.find((d) => d.uri.path.endsWith("/theme.scss"))!;
    const original = theme.getText();
    host.edit(theme, original + "\n.broken { color: $nope; }\n");
    let rendered = nextRender();
    host.save(theme);
    await rendered;
    expect(problems()).toHaveLength(1);
    expect(problems()[0]).toMatchObject({ severity: vscode.DiagnosticSeverity.Error, source: "slipway" });
    expect(problems()[0].message).toMatch(/Undefined variable/);

    host.edit(theme, original);
    rendered = nextRender();
    host.save(theme);
    await rendered;
    expect(problems()).toHaveLength(0);
  }, 60_000);

  test("a pandoc warning (missing citation) becomes a Warning; info notes do not", async () => {
    const doc = deckDoc();
    const original = doc.getText();
    host.edit(doc, original + "\n## Cites\n\nSee [@no-such-key].\n");
    const rendered = nextRender();
    host.save(doc);
    expect((await rendered).ok).toBe(true);
    const list = problems();
    expect(list.some((d) => d.severity === vscode.DiagnosticSeverity.Warning && /no-such-key/.test(d.message))).toBe(true);
    expect(list.some((d) => /Loaded references\.bib/.test(d.message))).toBe(false);
    host.edit(doc, original);
    const again = nextRender();
    host.save(doc);
    await again;
    expect(problems()).toHaveLength(0);
  }, 60_000);
});

describe("renderOn: type", () => {
  test("typing renders once after the debounce, not once per keystroke", async () => {
    host.config.renderOn = "type";
    host.config.debounceMs = 250;
    const doc = host.documents.find((d) => d.uri.path.endsWith("demos/slide.qmd"))!;
    const original = doc.getText();
    const before = api.renderCount();
    const rendered = nextRender();
    for (const word of ["a", "ab", "abc", "abcd"]) host.edit(doc, original + `\n## Typed ${word}\n`);
    expect(api.renderCount()).toBe(before); // still debouncing
    expect((await rendered).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(api.renderCount()).toBe(before + 1);
    expect(host.panels[0].webview.html).toContain("Typed abcd");
    // Saving in this mode does not add a second render.
    host.save(doc);
    await new Promise((r) => setTimeout(r, 400));
    expect(api.renderCount()).toBe(before + 1);
    delete host.config.renderOn;
    delete host.config.debounceMs;
    host.edit(doc, original);
    host.save(doc);
  }, 60_000);
});

describe("panel serializer", () => {
  test("a serialized panel is re-adopted, rendered, and returns to its slide", async () => {
    const serializer = host.serializers.get("slipway.preview");
    expect(serializer).toBeDefined();
    const deck = vscode.Uri.file(join(workspace, "demos/imago-showcase.qmd"));
    const panel = host.makePanel("slipway.preview", "Preview imago-showcase.qmd", {});
    await serializer!.deserializeWebviewPanel(panel, { deck: deck.toString(), h: 3, v: 0 });
    expect(panel.webview.html).toContain('var start = {"h":3,"v":0};');
    expect(panel.webview.html).toContain(JSON.stringify(deck.toString()));
    expect((panel.webview as unknown as { options: unknown }).options).toMatchObject({ enableScripts: true });
    expect(api.lastHtml(deck)).not.toBeNull();
    panel.dispose();
  }, 60_000);

  test("a panel with no usable state is closed rather than left blank", async () => {
    const serializer = host.serializers.get("slipway.preview")!;
    const before = host.panels.length;
    const panel = host.makePanel("slipway.preview", "Preview ?", {});
    await serializer.deserializeWebviewPanel(panel, undefined);
    expect(host.panels).toHaveLength(before);
  });
});
