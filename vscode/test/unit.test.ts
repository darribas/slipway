// Unit tests for the extension's pure modules (no `vscode` involved).

import { describe, expect, test } from "vitest";

import { basename, dirname, isIgnoredProjectPath, relativeTo } from "../src/paths";
import { WEBVIEW_CSP, buildWebviewHtml, placeholderHtml } from "../src/webview";

describe("paths", () => {
  test("relativeTo", () => {
    expect(relativeTo("/ws", "/ws/slides/deck.qmd")).toBe("slides/deck.qmd");
    expect(relativeTo("/ws/", "/ws/deck.qmd")).toBe("deck.qmd");
    expect(relativeTo("/ws", "/ws")).toBeNull();
    expect(relativeTo("/ws", "/wsx/deck.qmd")).toBeNull(); // sibling prefix
    expect(relativeTo("/ws/a", "/ws/deck.qmd")).toBeNull();
  });

  test("isIgnoredProjectPath matches the CLI's walker", () => {
    for (const p of [".git/config", "node_modules/x/a.scss", "a/node_modules/b.css", ".quarto/x.md", "a/.hidden/b.png", ".DS_Store"]) {
      expect(isIgnoredProjectPath(p), p).toBe(true);
    }
    for (const p of ["deck.qmd", "assets/theme.scss", "my.notes/a.md", "node_modules.txt"]) {
      expect(isIgnoredProjectPath(p), p).toBe(false);
    }
  });

  test("basename / dirname", () => {
    expect(basename("/a/b/deck.qmd")).toBe("deck.qmd");
    expect(dirname("/a/b/deck.qmd")).toBe("/a/b");
    expect(dirname("/deck.qmd")).toBe("/");
  });
});

describe("buildWebviewHtml", () => {
  const deck = `<!DOCTYPE html>
<html lang>
<head>
  <meta charset="utf-8">
  <title>T</title>
</head>
<body>
<div class="reveal"><div class="slides"><section>hi</section></div></div>
<script>var notes = "</body>\\n</html>";</script>
<script>Reveal.initialize({});</script>
</body>
</html>`;

  test("puts the CSP first in <head>", () => {
    const out = buildWebviewHtml(deck);
    const head = out.indexOf("<head>");
    const csp = out.indexOf('http-equiv="Content-Security-Policy"');
    expect(csp).toBeGreaterThan(head);
    expect(csp).toBeLessThan(out.indexOf('<meta charset="utf-8">'));
    expect(out).toContain(`content="${WEBVIEW_CSP}"`);
  });

  test("the policy denies by default and allows only what a self-contained deck needs", () => {
    expect(WEBVIEW_CSP).toContain("default-src 'none'");
    expect(WEBVIEW_CSP).toContain("script-src 'unsafe-inline'");
    expect(WEBVIEW_CSP).toContain("style-src 'unsafe-inline'");
    expect(WEBVIEW_CSP).toContain("img-src data: https:");
    expect(WEBVIEW_CSP).toContain("font-src data:");
    expect(WEBVIEW_CSP).not.toContain("unsafe-eval");
    expect(WEBVIEW_CSP).not.toMatch(/script-src[^;]*https:/);
  });

  test("the bridge goes before the LAST </body>, not inside a script that mentions </body>", () => {
    const out = buildWebviewHtml(deck);
    const bridge = out.indexOf('data-from="slipway:vscode-bridge"');
    expect(bridge).toBeGreaterThan(out.indexOf("Reveal.initialize"));
    expect(bridge).toBeLessThan(out.lastIndexOf("</body>"));
    expect(out).toContain('var notes = "</body>\\n</html>";</script>');
  });

  test("carries the start position, or null", () => {
    expect(buildWebviewHtml(deck, { h: 3, v: 1 })).toContain('var start = {"h":3,"v":1};');
    expect(buildWebviewHtml(deck)).toContain("var start = null;");
  });

  test("leaves the deck itself untouched", () => {
    const out = buildWebviewHtml(deck, { h: 1, v: 0 });
    const stripped = out
      .replace(/\n  <meta http-equiv="Content-Security-Policy"[^>]*>/, "")
      .replace(/<script data-from="slipway:vscode-bridge">[\s\S]*?<\/script>\n/, "");
    expect(stripped).toBe(deck);
  });

  test("a `$&` in the deck is not treated as a replacement pattern", () => {
    const tricky = deck.replace("hi", () => "cost: $& and $1");
    expect(buildWebviewHtml(tricky)).toContain("cost: $& and $1");
  });

  test("placeholder escapes its message and allows no scripts", () => {
    const out = placeholderHtml("<b>x</b> & y");
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(out).toContain("default-src 'none'");
    expect(out).not.toContain("script-src");
  });
});
