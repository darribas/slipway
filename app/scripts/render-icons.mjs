// Generate raster icons from the master SVG.
//
//   apple-touch-icon: 180×180, square (iOS rounds it on Home Screen)
//   pwa-192:          192×192, square (Android adaptive icon)
//   pwa-512:          512×512, square (PWA splash on Android, large any-purpose)
//
// PNGs are generated from a *square* version of the design — no rx on the
// background — so iOS / Android can apply their own platform mask without
// fighting our rounding. The standalone-browser favicon uses the rounded
// icon.svg directly.
//
// Run from app/:
//   node scripts/render-icons.mjs
//
// Requires playwright to be installed (it's a devDep). The script writes
// directly into public/ which Vite copies through to dist/ at build time.

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "public");

// Square-bleed version of icon.svg — same content, no corner radius. Kept
// inline to keep all icon authoritative-source in one file (icon.svg + this
// script).
const squareSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#B8D6EE"/>
  <path d="M0 56 L64 38 L64 64 L0 64 Z" fill="#F0D5B5"/>
  <rect x="18" y="22" width="28" height="20" rx="2"
        fill="none" stroke="#3a4a52" stroke-width="2.5"/>
</svg>`;

const targets = [
  { size: 180, name: "icon-180.png" }, // apple-touch-icon
  { size: 192, name: "icon-192.png" }, // PWA manifest, Android
  { size: 512, name: "icon-512.png" }, // PWA manifest, large
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { size, name } of targets) {
  const html = `<!doctype html><meta charset=utf-8>
  <style>html,body{margin:0;background:transparent}</style>
  <div style="width:${size}px;height:${size}px;line-height:0">${squareSvg
    .replace(/<svg/, `<svg width="${size}" height="${size}"`)}</div>`;
  await page.setContent(html, { waitUntil: "load" });
  const png = await page.locator("div").screenshot({ omitBackground: true });
  await writeFile(resolve(outDir, name), png);
  // eslint-disable-next-line no-console
  console.log(`  wrote ${name} (${(png.length / 1024).toFixed(1)} KB)`);
}

await browser.close();
