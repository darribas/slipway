// Inline external CDN references in a pandoc revealjs-standalone HTML
// document so the rendered deck has zero network dependencies.
//
// Pandoc 3.9's revealjs template emits hard-coded `<script>` / `<link>` tags
// pointing at unpkg.com/reveal.js@^5/...  That puts every render at the mercy
// of unpkg's resolution of `^5` AND breaks any offline use case. This pass
// replaces those URLs with `<style>` / `<script>` blocks holding the bundled
// reveal.js source — pinned to the version in package.json (currently
// reveal.js@5.2.1) and updated only when the dep is bumped.
//
// KaTeX (loaded from jsdelivr when html-math-method=katex) is a future
// extension: its font files are referenced relatively from inside the CSS,
// so inlining it correctly means data-URI'ing the fonts too. Out of scope
// here; the workshop deck has no math.

import resetCss from "reveal.js/dist/reset.css?raw";
import revealCss from "reveal.js/dist/reveal.css?raw";
import revealJs from "reveal.js/dist/reveal.js?raw";
import themeWhiteCss from "reveal.js/dist/theme/white.css?raw";
import themeBlackCss from "reveal.js/dist/theme/black.css?raw";
import notesJs from "reveal.js/plugin/notes/notes.js?raw";
import searchJs from "reveal.js/plugin/search/search.js?raw";
import zoomJs from "reveal.js/plugin/zoom/zoom.js?raw";

type AssetKind = "css" | "js";
interface Asset {
  kind: AssetKind;
  content: string;
}

// Map every unpkg URL pandoc's template can emit to its bundled equivalent.
// Pandoc resolves `theme=white` (which we pass) to white.css, but black is
// pandoc's default fallback if no theme is set — include both so a render
// without our theme override still inlines correctly.
const REVEAL_ASSETS: Record<string, Asset> = {
  "https://unpkg.com/reveal.js@^5/dist/reset.css": { kind: "css", content: resetCss },
  "https://unpkg.com/reveal.js@^5/dist/reveal.css": { kind: "css", content: revealCss },
  "https://unpkg.com/reveal.js@^5/dist/theme/white.css": { kind: "css", content: themeWhiteCss },
  "https://unpkg.com/reveal.js@^5/dist/theme/black.css": { kind: "css", content: themeBlackCss },
  "https://unpkg.com/reveal.js@^5/dist/reveal.js": { kind: "js", content: revealJs },
  "https://unpkg.com/reveal.js@^5/plugin/notes/notes.js": { kind: "js", content: notesJs },
  "https://unpkg.com/reveal.js@^5/plugin/search/search.js": { kind: "js", content: searchJs },
  "https://unpkg.com/reveal.js@^5/plugin/zoom/zoom.js": { kind: "js", content: zoomJs },
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inject a Reveal.configure() call that overrides whatever reveal.js options
 * pandoc's template chose to emit. This is the only reliable way to make
 * boolean-false options like `controls: false` actually take effect: pandoc's
 * template uses `$if(controls)$` to decide whether to emit the option, and
 * `$if$` treats boolean false as "not set" — so pandoc silently falls back
 * to reveal.js's default (which is true). Reveal.configure() runs after init
 * and unconditionally applies whatever we hand it.
 *
 * If `opts` is empty, the original HTML is returned unchanged.
 */
export function injectRevealConfigOverride(html: string, opts: Record<string, unknown>): string {
  if (!opts || Object.keys(opts).length === 0) return html;
  const literal = JSON.stringify(opts);
  const script = `<script data-from="slipway:user-reveal-config">
(function () {
  var opts = ${literal};
  function apply() { if (window.Reveal && Reveal.configure) Reveal.configure(opts); }
  if (window.Reveal && Reveal.isReady && Reveal.isReady()) apply();
  else if (window.Reveal && Reveal.addEventListener) Reveal.addEventListener('ready', apply);
  else document.addEventListener('DOMContentLoaded', function () {
    if (window.Reveal) {
      if (Reveal.isReady && Reveal.isReady()) apply();
      else Reveal.addEventListener('ready', apply);
    }
  });
})();
</script>`;
  // Insert before </body> if present; append otherwise.
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${script}\n</body>`)
    : html + script;
}

/**
 * Inline our compiled theme stylesheet into the rendered HTML.
 *
 * Pandoc emits `<link rel="stylesheet" href="theme.css">` in standalone
 * output when we pass `css: ["theme.css"]`, but the actual file lives in
 * pandoc's WASI VFS — *not* anywhere the iframe (srcdoc) can resolve. So
 * the link tag pointed nowhere and the theme silently failed to apply.
 * This pass swaps the link for an inline <style> block carrying the CSS
 * we compiled (or read directly when the source was already .css).
 */
export function inlineThemeCss(html: string, css: string): string {
  if (!css) return html;
  const re = /<link\b[^>]*href=["']theme\.css["'][^>]*\/?>/g;
  return html.replace(re, () =>
    `<style data-from="theme.css">\n${css}\n</style>`,
  );
}

/**
 * Replace every <link>/<script> in `html` that points at one of our known
 * reveal.js CDN URLs with an inline <style>/<script> block. Returns the
 * rewritten HTML; leaves unrecognised external references alone.
 */
export function inlineRevealAssets(html: string): string {
  for (const [url, asset] of Object.entries(REVEAL_ASSETS)) {
    const u = escapeRegex(url);
    if (asset.kind === "css") {
      // Match <link ... href="URL" ...> or <link ... href='URL' ...>, both
      // self-closing and the void form. Capture any extra attrs (e.g. id="theme")
      // and forward them onto the <style> so any inherited handling still works.
      const re = new RegExp(`<link\\b[^>]*href=["']${u}["'][^>]*/?>`, "g");
      html = html.replace(re, () =>
        `<style data-from="${url}">\n${asset.content}\n</style>`,
      );
    } else {
      const re = new RegExp(`<script\\b[^>]*src=["']${u}["'][^>]*></script>`, "g");
      html = html.replace(re, () =>
        `<script data-from="${url}">\n${asset.content}\n</script>`,
      );
    }
  }
  return html;
}
