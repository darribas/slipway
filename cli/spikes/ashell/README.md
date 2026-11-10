# a-Shell spike kit (Phase 4.2)

Throw-away research code for issue #41, increment 4.2: can `slipway render`
run fully offline inside [a-Shell](https://github.com/holzschu/a-shell) on
iPad? Nothing here ships. Delete this folder once the route is decided and
4.3 is built (or shelved).

## What is being tested

a-Shell's `jsc` command evaluates a script **inside the terminal's
WKWebView** (not through the JavaScriptCore API), synchronously, with file
access through a `jsc.*` object whose calls are synchronous `prompt()`
messages to the native side. That is the same web view a-Shell's own `wasm`
command compiles WebAssembly in. So the candidate design for the a-Shell
adapter is: one bundled script that runs the *whole* pipeline in `jsc` —
Slipway's JS stages **and** `pandoc.wasm` — with no external `pandoc`
command.

| Script | Spike | Question |
| --- | --- | --- |
| `s3-wasm.js` | S3 (+ host half of S2) | Is `WebAssembly` there, does a synchronous compile work, which globals exist, do `jsc.readFile` / `writeFile` / `readFileBase64` / `system` behave, do promise/timer callbacks run after the script returns? |
| `s2-stages.js` | S2 | Do `prepareRender` (Dart Sass) and `finalizeRender` run, and give the golden HTML when fed pandoc's canned output? |
| `s3b-render.js` | S3 → full route | Load the 58 MB `pandoc.wasm`, compile it synchronously, render the fixture deck end to end, compare with the golden. Second run: is the instance cached on the web view reused? |

Each script prints `PASS` / `FAIL` lines with timings and saves them to
`report-<name>.txt`.

## Running it on the iPad

See the step-by-step comment on issue #41. In short:

```sh
cd ~/Documents
curl -L -o spike.tar.gz https://raw.githubusercontent.com/darribas/slipway/claude/nifty-ritchie-fs79py/cli/spikes/ashell/slipway-ashell-spike.tar.gz
tar xzf spike.tar.gz && cd slipway-spike
jsc s3-wasm.js
jsc s2-stages.js
curl -L -o pandoc-wasm.tgz https://registry.npmjs.org/pandoc-wasm/-/pandoc-wasm-1.0.1.tgz
tar xzf pandoc-wasm.tgz package/src/pandoc.wasm && mv package/src/pandoc.wasm .
jsc s3b-render.js
jsc s3b-render.js
cat report-s3.txt report-s2.txt report-s3b.txt
```

## Building and emulating

```sh
cd cli
node spikes/ashell/build.mjs        # → dist/ and slipway-ashell-spike.tar.gz
# optional, needs a Playwright + Chromium install:
NODE_PATH=$(npm root -g) node spikes/ashell/emulate.cjs <unpacked kit dir> s3-wasm.js s2-stages.js s3b-render.js
```

`emulate.cjs` stands in for a-Shell: a headless Chromium page with the same
`jsc` object, whose `prompt()` messages are answered from Node. It is good
for catching mistakes in the scripts; it says nothing about WebKit, iPadOS
memory limits or a-Shell's command set — only the device run does.

The tarball is committed (2.3 MB) so it can be downloaded from
`raw.githubusercontent.com` while the spike is open; the build is
reproducible (fixed mtimes), so rebuilding without source changes leaves it
byte-identical.
