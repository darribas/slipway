# Slipway for VS Code

Preview and export Quarto-flavoured reveal.js decks (`.qmd`) inside VS Code.
The deck is rendered locally by the same engine as the
[Slipway PWA](https://darribas.github.io/slipway/) and the `slipway` CLI —
pandoc compiled to WebAssembly, Dart Sass, reveal.js and KaTeX, all bundled —
so the same deck gives the same HTML everywhere.

It is a **web extension**: it runs in VS Code for the Web (including Blink
Code on iPad) as well as in desktop VS Code. Document authoring only: no code
execution, no Lua filters, no cross-references.

## Install

There is no Marketplace listing.

**VS Code for the Web / Blink Code** — run **Developer: Install Extension
From Location…** from the Command Palette and enter:

```
https://darribas.github.io/slipway/vscode/
```

VS Code for the Web loads the extension from that address every time it
starts, so there is nothing to update by hand: a new release is picked up on
the next launch.

**Desktop VS Code** — download `slipway-<version>.vsix` from the project's
[GitHub Releases](https://github.com/darribas/slipway/releases) and run
**Extensions: Install from VSIX…**. To update, install the newer `.vsix`.

## Offline

The extension loads its renderer (`pandoc.wasm`, about 56 MB) once, when it
activates — you will see "Slipway: loading renderer…". After that it needs no
connection: rendering, previewing and exporting all work offline, and
switching away from the preview and back keeps it alive.

What does need a connection is *starting* VS Code for the Web itself, which
fetches the editor and every extension on launch. So on an iPad: open Blink
Code and a deck while online, then go offline. Reloading the window while
offline will not bring the extension back.

## Use

Open a `.qmd` file and press the preview button in the editor title bar, or
run a command from the palette:

| Command | What it does |
| --- | --- |
| **Slipway: Open Preview to the Side** | Render the deck and show it beside the editor |
| **Slipway: Open Preview** | The same, in the current editor group |
| **Slipway: Render** | Re-render now |
| **Slipway: Export HTML** | Write the deck as one self-contained `.html` file next to the source (also in the editor and Explorer context menus) |
| **Slipway: Export Print HTML** | Write `<name>.print.html`, which opens the browser's print dialog laid out one slide per page — for saving as PDF |
| **Slipway: Toggle Cursor Sync** | Turn "preview follows the editor cursor" on or off |

By default the preview re-renders when you save the deck or any other file in
its project (the theme, an include, the bibliography). Errors and warnings
from the render appear in the Problems panel; the last good render stays on
screen. Details go to the **Slipway** output channel.

### Project files

The deck's `theme:` and `bibliography:`, its images, fonts and
`{{< include >}}` files are looked up in the workspace folder that contains
the deck (or `slipway.projectRoot`). Paths are resolved forgivingly, as in
the app: `theme: ../assets/imago.scss` finds `assets/imago.scss` in the
project. Hidden folders and `node_modules` are ignored.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `slipway.renderOn` | `"save"` | `"save"`, `"manual"` (only on **Slipway: Render**) or `"type"` (while typing, debounced) |
| `slipway.debounceMs` | `1000` | Quiet time before a `"type"` render. A render takes about 1.5 s |
| `slipway.syncCursor` | `true` | Move the preview to the slide under the editor cursor |
| `slipway.exportPath` | `${fileDirname}/${fileBasenameNoExtension}.html` | Where **Export HTML** writes. Also understands `${fileBasename}`, `${fileExtname}`, `${workspaceFolder}` |
| `slipway.projectRoot` | `""` | Folder to search for project files; empty means the deck's workspace folder |

## Develop

```sh
cd core && npm ci            # the shared renderer (a file: dependency)
cd ../vscode && npm ci
npm test                     # typecheck, bundle, unit + bundle tests
cd test-web && npm ci && npm test   # the bundle inside real VS Code for the Web
```
