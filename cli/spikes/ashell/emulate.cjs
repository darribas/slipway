// Local stand-in for a-Shell's `jsc`, to shake out the spike scripts before
// they go to the iPad. NOT a substitute for the device run.
//
// What it reproduces (from a-Shell's wasm.html and SceneDelegate.swift):
//   - the script is evaluated in a web page's global scope, synchronously;
//   - `jsc.readFile` & co. are synchronous `prompt("jsc\n<op>\n<args…>")`
//     calls answered by the native side — here, by a Playwright dialog
//     handler doing the same file operations with node:fs;
//   - console.log prints to the terminal.
// What it does not reproduce: WebKit (this is Chromium), iPadOS memory
// limits, a-Shell's sandbox and its real command set.
//
// Usage (needs a Playwright install with Chromium on NODE_PATH):
//   node spikes/ashell/build.mjs
//   NODE_PATH=$(npm root -g) node spikes/ashell/emulate.cjs <workdir> <script.js> [more scripts…]

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const JSC_OBJECT = `
  window.jsc = {
    readFile: (p) => prompt("jsc\\nreadFile\\n" + p),
    readFileBase64: (p) => prompt("jsc\\nreadFileBase64\\n" + p),
    writeFile: (p, c) => { const r = prompt("jsc\\nwriteFile\\n" + p + "\\n" + c); const e = r.split("\\n"); if (Number(e[0]) == -1) throw new Error(e[1]); return Number(r); },
    writeFileBase64: (p, c) => { const r = prompt("jsc\\nwriteFileBase64\\n" + p + "\\n" + c); const e = r.split("\\n"); if (Number(e[0]) == -1) throw new Error(e[1]); return Number(r); },
    listFiles: (d) => prompt("jsc\\nlistFiles\\n" + d).split("\\n"),
    isFile: (p) => Number(prompt("jsc\\nisFile\\n" + p)) == 1,
    isDirectory: (p) => Number(prompt("jsc\\nisDirectory\\n" + p)) == 1,
    deleteFile: (p) => { const r = prompt("jsc\\ndelete\\n" + p); const e = r.split("\\n"); if (Number(e[0]) == -1) throw new Error(e[1]); return Number(r); },
    getFileSize: (p) => { const r = prompt("jsc\\nfileSize\\n" + p); const e = r.split("\\n"); if (Number(e[0]) < 0) throw new Error(e[1]); return Number(r); },
    system: (c) => prompt("jsc\\nsystem\\n" + c),
  };
`;

function native(message, cwd) {
  const parts = message.split("\n");
  if (parts[0] !== "jsc") return "-1";
  const op = parts[1];
  const p = parts[2] !== undefined ? path.resolve(cwd, parts[2]) : cwd;
  try {
    switch (op) {
      case "readFile": return fs.readFileSync(p, "utf8");
      case "readFileBase64": return fs.readFileSync(p).toString("base64");
      case "writeFile": fs.writeFileSync(p, message.slice(parts[0].length + 1 + parts[1].length + 1 + parts[2].length + 1)); return "0";
      case "writeFileBase64": fs.writeFileSync(p, Buffer.from(parts[3], "base64")); return "0";
      case "listFiles": return fs.readdirSync(p).map((n) => n + "\n").join("");
      case "isFile": return fs.existsSync(p) && fs.statSync(p).isFile() ? "1" : "0";
      case "isDirectory": return fs.existsSync(p) && fs.statSync(p).isDirectory() ? "1" : "0";
      case "delete": fs.rmSync(p); return "0";
      case "fileSize": return String(fs.statSync(p).size);
      case "pickDirectory": return cwd;
      case "system":
        try { execSync(parts.slice(2).join("\n"), { cwd, stdio: "inherit", shell: "/bin/sh" }); return "0"; }
        catch (e) { return String(e.status ?? 1); }
      default: return "-1";
    }
  } catch (e) {
    // a-Shell answers a failed read with the error text, and failed writes with "-1\n<error>".
    return op.startsWith("read") ? String(e.message) : "-1\n" + e.message;
  }
}

(async () => {
  const [workdir, ...scripts] = process.argv.slice(2);
  if (!workdir || scripts.length === 0) {
    console.error("usage: emulate.cjs <workdir> <script.js> [more scripts…]");
    process.exit(2);
  }
  const cwd = path.resolve(workdir);
  // Chromium refuses synchronous compilation of large modules on the main
  // thread (WebKit, which a-Shell uses, does not); lift that for the emulation.
  const browser = await chromium.launch({ args: ["--enable-features=WebAssemblyUnlimitedSyncCompilation"] });
  const page = await browser.newPage();
  page.on("console", (msg) => console.log(msg.text()));
  page.on("pageerror", (err) => console.log("[page error] " + err.message));
  page.on("dialog", (dialog) => dialog.accept(native(dialog.message(), cwd)));
  await page.goto("about:blank");
  await page.evaluate(JSC_OBJECT);
  for (const script of scripts) {
    console.log(`\n$ jsc ${path.basename(script)}`);
    const source = fs.readFileSync(script, "utf8");
    // Like a-Shell: prepend process.argv / env, evaluate, print a failure.
    const argv = JSON.stringify(["jsc", path.basename(script)]);
    try {
      await page.evaluate(`var process = process ?? {}; process.argv = ${argv}; process.env = {};\n${source}`);
    } catch (e) {
      console.log("jsc: Error in file " + path.basename(script) + ": " + String(e.message).split("\n")[0]);
    }
    await page.waitForTimeout(300); // let queued timers fire, as idle time between commands would
  }
  await browser.close();
})();
