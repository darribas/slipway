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

import { js as katexJs, css as katexCss } from "virtual:katex-inlined";
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
  // Insert before the LAST `</body>`. A naive first-match regex can land
  // inside an inlined plugin script that happens to contain `</body>` as a
  // string literal (reveal.js's notes plugin embeds `"</body>\n</html>"`
  // when constructing the speaker-view popup), which splits the plugin in
  // half and breaks the whole bundle.
  const lastBody = html.lastIndexOf("</body>");
  if (lastBody < 0) return html + script;
  return html.slice(0, lastBody) + script + "\n" + html.slice(lastBody);
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
 * Replace the two CDN KaTeX tags pandoc emits with fully self-contained
 * inline blocks. Pandoc uses `@latest` which resolves unpredictably and
 * fails entirely when offline; this pins to the bundled version and
 * eliminates the network dependency.
 *
 * The CSS variant produced by katexInlinePlugin already has all fonts
 * embedded as data URIs, so the deck renders math correctly in the
 * sandboxed srcdoc iframe (null origin, no relative URL resolution).
 */
export function inlineKatexAssets(html: string): string {
  // Replace <script src="https://cdn.jsdelivr.net/npm/katex@.../katex.min.js">
  html = html.replace(
    /<script\b[^>]*src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/katex[^"']*\/katex\.min\.js["'][^>]*><\/script>/g,
    () => `<script data-from="slipway:katex-js">\n${katexJs}\n</script>`,
  );
  // Replace <link href="https://cdn.jsdelivr.net/npm/katex@.../katex.min.css" ...>
  html = html.replace(
    /<link\b[^>]*href=["']https:\/\/cdn\.jsdelivr\.net\/npm\/katex[^"']*\/katex\.min\.css["'][^>]*\/?>/g,
    () => `<style data-from="slipway:katex-css">\n${katexCss}\n</style>`,
  );
  return html;
}

/**
 * Inject a tiny polyfill that makes localStorage, sessionStorage, and
 * history.pushState/replaceState safe inside a sandboxed iframe.
 *
 * The app preview iframe uses `sandbox="allow-scripts allow-popups"` without
 * `allow-same-origin`, which gives it a null origin. Accessing localStorage or
 * sessionStorage (and calling history.replaceState) from a null origin throws a
 * SecurityError. reveal.js's notes plugin reads localStorage on every keydown
 * event; if that throws uncaught, the entire Reveal keyboard handler dies —
 * which is why slide navigation stops after fragments run out on a slide.
 *
 * The polyfill runs synchronously before any other script so all subsequent
 * code (reveal.js, plugins) sees safe storage objects.
 */
export function injectSandboxCompat(html: string): string {
  const script = `<script data-from="slipway:sandbox-compat">
(function(){
  function memStorage(){
    var s={};
    return{
      getItem:function(k){return Object.prototype.hasOwnProperty.call(s,k)?s[k]:null},
      setItem:function(k,v){s[k]=String(v)},
      removeItem:function(k){delete s[k]},
      clear:function(){s={}},
      key:function(i){return Object.keys(s)[i]??null},
      get length(){return Object.keys(s).length}
    };
  }
  ['localStorage','sessionStorage'].forEach(function(name){
    try{window[name].setItem('__t','1');window[name].removeItem('__t');}
    catch(e){
      try{Object.defineProperty(window,name,{configurable:true,value:memStorage()});}catch(e2){}
    }
  });
  ['replaceState','pushState'].forEach(function(method){
    var orig=history[method].bind(history);
    history[method]=function(){try{orig.apply(history,arguments);}catch(e){}};
  });
})();
<\/script>`;
  // Insert right after the opening <body> tag so it executes before reveal.js.
  return html.replace(/<body>/, "<body>\n" + script);
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
