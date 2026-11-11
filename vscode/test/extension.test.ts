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
