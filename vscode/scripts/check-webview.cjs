// Manual check: does the preview document actually work in a real browser
// under its Content-Security-Policy, with no network?
//
// Renders the demo deck with the CLI, wraps it with buildWebviewHtml()
// (src/webview.ts) and loads it in headless Chromium with a stub
// acquireVsCodeApi() and every network request refused. Verifies: no CSP
// violations, reveal.js boots, the start position is restored, slide changes
// are posted to the host, and a `goto` message moves the deck.
//
// Not part of `npm test` (needs a Playwright + Chromium install). From vscode/:
//   (cd ../cli && npm run build)
//   NODE_PATH=$(npm root -g) node scripts/check-webview.cjs

const { execFileSync } = require("node:child_process");
const { cpSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const esbuild = require("esbuild");
const { chromium } = require("playwright");

(async () => {
  const tmp = mkdtempSync(join(tmpdir(), "slipway-webview-"));
  cpSync(resolve(__dirname, "../../app/src/templates/slipway-demo"), tmp, { recursive: true });
  execFileSync(process.execPath, [resolve(__dirname, "../../cli/dist/slipway.mjs"), "render", "demos/slide.qmd"], { cwd: tmp });
  const deck = readFileSync(join(tmp, "demos/slide.html"), "utf8");

  esbuild.buildSync({ entryPoints: [resolve(__dirname, "../src/webview.ts")], outfile: join(tmp, "webview.cjs"), bundle: true, format: "cjs", platform: "node" });
  const { buildWebviewHtml } = require(join(tmp, "webview.cjs"));
  const html = buildWebviewHtml(deck, { h: 2, v: 1 });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://slipway.test/")) return route.fulfill({ contentType: "text/html", body: html });
    requests.push(url);
    return route.abort();
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__posted = [];
    window.__violations = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__posted.push(m), setState() {}, getState() {} });
    document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(e.violatedDirective + " " + e.blockedURI));
  });
  await page.goto("http://slipway.test/deck.html");
  await page.waitForFunction(() => window.__posted.some((m) => m.type === "ready"), null, { timeout: 30000 });

  const checks = [];
  const check = (name, ok, detail = "") => checks.push([ok, name, detail]);

  const ready = await page.evaluate(() => window.__posted.find((m) => m.type === "ready"));
  check("reveal.js boots under the CSP", ready.total > 1, `${ready.total} slides`);
  check("start position restored", ready.h === 2 && ready.v === 1, `at ${ready.h}.${ready.v}`);

  await page.evaluate(() => Reveal.next());
  await page.waitForTimeout(200);
  const changed = await page.evaluate(() => window.__posted.filter((m) => m.type === "slideChanged").pop());
  check("slideChanged posted on navigation", !!changed && (changed.h !== 2 || changed.v !== 1), JSON.stringify(changed));

  await page.evaluate(() => window.postMessage({ type: "goto", h: 5, v: 1 }, "*"));
  await page.waitForTimeout(200);
  const at = await page.evaluate(() => Reveal.getIndices());
  check("goto message moves the deck", at.h === 5 && at.v === 1, `at ${at.h}.${at.v}`);

  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === "loaded").length; });
  check("data: fonts load (KaTeX)", fonts > 0, `${fonts} faces loaded`);
  const math = await page.evaluate(() => document.querySelectorAll(".katex").length);
  check("math is typeset", math > 0, `${math} KaTeX nodes`);
  const themed = await page.evaluate(() => !!document.querySelector('style[data-from="theme.css"]') && getComputedStyle(document.querySelector(".reveal")).fontFamily);
  check("theme stylesheet applied", !!themed, String(themed).slice(0, 60));

  // reveal.js's white.css starts with `@import url(./fonts/source-sans-pro/…css)`,
  // a relative URL that cannot resolve once the stylesheet is inlined (it
  // fails the same way in the PWA's srcdoc iframe). The CSP refusing it is
  // the wanted behaviour — no request leaves the webview — so it is the one
  // violation allowed here.
  const all = await page.evaluate(() => window.__violations);
  const violations = all.filter((v) => !/^style-src-elem .*\/fonts\/source-sans-pro\/source-sans-pro\.css$/.test(v));
  check("no CSP violations (beyond reveal's dead font @import)", violations.length === 0, violations.slice(0, 3).join("; ") || `${all.length} expected`);
  check("no network requests attempted", requests.length === 0, requests.slice(0, 3).join("; "));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join("; "));

  for (const [ok, name, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ": " + detail : ""}`);
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
  if (checks.some(([ok]) => !ok)) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
