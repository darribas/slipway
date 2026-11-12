// Turn a rendered deck into the HTML a preview webview shows. Pure string
// work (no `vscode` import) so it can be unit-tested and exercised in a real
// browser outside VS Code.

/**
 * The deck is already fully self-contained (reveal.js, KaTeX, theme, fonts
 * and local images are inline), so the policy can deny everything by default
 * and allow only inline script/style and data: resources. `https:` stays
 * open for images and media so remote pictures a deck links to still load
 * when online.
 */
export const WEBVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: https:; font-src data:; media-src data: https:";

export interface SlidePosition {
  h: number;
  v: number;
}

/** Messages the preview posts to the extension. */
export type PreviewMessage =
  | { type: "ready"; h: number; v: number; total: number }
  | { type: "slideChanged"; h: number; v: number };

/** Messages the extension posts to the preview. */
export type HostMessage = { type: "goto"; h: number; v: number };

/**
 * The bridge between reveal.js in the webview and the extension:
 *   - restores the slide the previous render was on (a re-render replaces the
 *     whole document, so the position has to be carried across);
 *   - posts `slideChanged {h, v}` whenever the presenter moves;
 *   - obeys `goto {h, v}` from the extension (editor cursor → slide);
 *   - keeps `{deck, h, v}` in the webview's persisted state, which is what VS
 *     Code hands the panel serializer to bring a preview back after a window
 *     reload.
 */
function bridgeScript(start: SlidePosition | null, deck: string | null): string {
  return `<script data-from="slipway:vscode-bridge">
(function () {
  var vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  var start = ${JSON.stringify(start)};
  var deck = ${JSON.stringify(deck).replace(/</g, "\\u003c")};
  function post(message) {
    if (!vscode) return;
    if (deck) vscode.setState({ deck: deck, h: message.h, v: message.v });
    vscode.postMessage(message);
  }
  function wire() {
    if (start) { try { Reveal.slide(start.h, start.v); } catch (e) {} }
    var now = Reveal.getIndices();
    post({ type: 'ready', h: now.h || 0, v: now.v || 0, total: Reveal.getTotalSlides() });
    Reveal.on('slidechanged', function (event) {
      post({ type: 'slideChanged', h: event.indexh || 0, v: event.indexv || 0 });
    });
    window.addEventListener('message', function (event) {
      var message = event.data;
      if (message && message.type === 'goto') {
        var at = Reveal.getIndices();
        if (at.h !== message.h || (at.v || 0) !== message.v) Reveal.slide(message.h, message.v);
      }
    });
  }
  function whenReady() {
    if (!window.Reveal) return;
    if (Reveal.isReady && Reveal.isReady()) wire();
    else Reveal.on('ready', wire);
  }
  if (window.Reveal) whenReady();
  else window.addEventListener('DOMContentLoaded', whenReady);
})();
</script>`;
}

/**
 * Inject the Content-Security-Policy and the bridge into a rendered deck.
 * The deck HTML itself is untouched otherwise — what the preview shows is
 * what Export HTML writes, plus these two blocks.
 */
export function buildWebviewHtml(html: string, start: SlidePosition | null = null, deck: string | null = null): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${WEBVIEW_CSP}">`;
  // First <head> only — a replacement function, so `$` in the HTML is inert.
  let out = html.replace(/<head(\s[^>]*)?>/, (m) => `${m}\n  ${csp}`);
  if (out === html) out = csp + "\n" + html;

  // Before the LAST </body>: inlined reveal plugins contain "</body>" as a
  // string literal, so a first-match insert would land inside a script.
  const bridge = bridgeScript(start, deck);
  const lastBody = out.lastIndexOf("</body>");
  return lastBody < 0 ? out + bridge : out.slice(0, lastBody) + bridge + "\n" + out.slice(lastBody);
}

/** Shown in a preview panel before its first render lands (or if it fails). */
export function placeholderHtml(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{font:14px/1.5 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;opacity:.75}</style>
</head><body><p>${safe}</p></body></html>`;
}
