// Run the extension in real VS Code for the Web, headless.
//
//   cd vscode && npm ci && npm run build      (the extension itself)
//   cd test-web && npm ci && npm test
//
// @vscode/test-web downloads a VS Code web build and serves it locally with
// the extension loaded from ../ (its package.json + dist/), exactly the
// files GitHub Pages serves. The workspace is a copy of the demo project,
// mounted as a *virtual* file system (vscode-test-web://mount/), so this
// also exercises the non-`file:` paths Blink Code's blink-fs will take.

import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { runTests } from "@vscode/test-web";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = resolve(HERE, "..");
const DEMO = resolve(HERE, "../../app/src/templates/slipway-demo");
const goldens = JSON.parse(readFileSync(resolve(HERE, "../../core/test/goldens/goldens.json"), "utf8"));

// The suite runs inside the web extension host (a Web Worker): bundle it for
// the browser, with `vscode` left for the host to provide.
await build({
  entryPoints: [resolve(HERE, "suite/index.ts")],
  outfile: resolve(HERE, "dist/suite.js"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  external: ["vscode"],
  define: {
    __GOLDEN_DEMO_SLIDE__: JSON.stringify(goldens["demo-slide"].sha256),
    __GOLDEN_IMAGO_SHOWCASE__: JSON.stringify(goldens["demo-imago-showcase"].sha256),
  },
  logLevel: "warning",
});

const workspace = mkdtempSync(join(tmpdir(), "slipway-test-web-"));
cpSync(DEMO, workspace, { recursive: true });

try {
  await runTests({
    browserType: "chromium",
    headless: true,
    extensionDevelopmentPath: EXTENSION,
    extensionTestsPath: resolve(HERE, "dist/suite.js"),
    folderPath: workspace,
    quality: "stable",
    printServerLog: false,
  });
  console.log("test-web: all tests passed");
} catch (err) {
  console.error("test-web: FAILED");
  console.error(err);
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
