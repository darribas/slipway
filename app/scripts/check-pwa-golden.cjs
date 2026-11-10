// Manual end-to-end check: does the *built PWA*, running in a real browser,
// render the seed deck to exactly the HTML recorded in core's goldens?
//
// Not part of `npm test` (it needs a Playwright + Chromium install, which is
// not a dependency of this package). Usage, from app/:
//
//   npm run build && npx vite preview --port 5198 &
//   NODE_PATH=$(npm root -g) node scripts/check-pwa-golden.cjs http://localhost:5198/
//
// Prints IDENTICAL / DIFFERENT and exits non-zero on a mismatch.

const { resolve } = require("node:path");
const { chromium } = require("playwright");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
(async () => {
  const goldens = JSON.parse(readFileSync(resolve(__dirname, "../../core/test/goldens/goldens.json"), "utf8"));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(process.argv[2]);
  const btn = page.locator("button", { hasText: /^Render/ }).first();
  await btn.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await btn.click();
  await page.waitForFunction(() => {
    const f = document.querySelector("iframe.slipway-preview-iframe");
    return f && f.srcdoc && f.srcdoc.length > 1000;
  }, null, { timeout: 120000 });
  const html = await page.evaluate(() => document.querySelector("iframe.slipway-preview-iframe").srcdoc);
  const sha = createHash("sha256").update(html, "utf8").digest("hex");
  console.log("PWA rendered bytes:", Buffer.byteLength(html), "sha256:", sha);
  console.log("golden demo-slide: ", goldens["demo-slide"].bytes, "sha256:", goldens["demo-slide"].sha256);
  const same = sha === goldens["demo-slide"].sha256;
  console.log(same ? "IDENTICAL" : "DIFFERENT");
  if (!same) process.exitCode = 1;
  // Does the deck actually run inside the sandboxed iframe?
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await page.waitForTimeout(1500);
  const ready = frame ? await frame.evaluate(() => !!(window.Reveal && Reveal.isReady()) && Reveal.getTotalSlides()) : "no frame";
  console.log("Reveal ready in preview iframe, total slides:", ready, "| page errors:", errors.length ? errors : "none");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
