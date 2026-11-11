# slipway (CLI)

Render a Quarto-flavoured reveal.js deck (`.qmd`) to **one self-contained
HTML file**, fully offline. It is the same renderer as the
[Slipway PWA](https://darribas.github.io/slipway/): the same deck gives
byte-identical HTML in both.

No code execution, no Lua filters, no cross-references — document authoring
only, same scope as the app.

## Install

Needs Node.js 20 or newer. There is no registry package; install the tarball
straight from the project site:

```sh
npm install -g https://darribas.github.io/slipway/cli/slipway-cli-0.1.0.tgz
```

The tarball is about 16 MB (it carries `pandoc.wasm`, 56 MB unpacked) and has
no dependencies, so nothing else is downloaded. To update, run the same
command with the new version number (the current one is shown at
<https://darribas.github.io/slipway/cli/>); to remove,
`npm uninstall -g slipway-cli`. Every version's tarball is also attached to
the project's [GitHub Releases](https://github.com/darribas/slipway/releases)
(tags `cli-v*`).

## Use

```sh
slipway render deck.qmd                 # writes deck.html next to deck.qmd
slipway render deck.qmd -o out.html
slipway render slides/deck.qmd --root . # project root = current folder
slipway render deck.qmd --print         # print variant, for "Save as PDF"
slipway --version
```

From Vim: `:!slipway render %`

### Project root

The deck's `theme:` and `bibliography:`, its images, fonts and
`{{< include >}}` files are looked up in the *project root*:

1. `--root <dir>` if given; otherwise
2. the nearest folder above the deck that contains `_quarto.yml`; otherwise
3. the current directory, if the deck is somewhere under it; otherwise
4. the deck's own folder.

Paths are resolved forgivingly, exactly as in the app: `theme:
../assets/imago.scss` finds `assets/imago.scss` in the root, and a bare file
name is enough when it is unambiguous. Hidden folders and `node_modules` are
ignored.

### Output, warnings, exit codes

- stdout carries one line, `Output created: <path>`.
- Warnings (a missing citation, deprecated Sass) go to stderr; add
  `--verbose` to also see pandoc's informational notes.
- Exit code `0` rendered, `1` pandoc or Sass error (nothing is written),
  `2` usage error or file not found.

## Develop

```sh
cd core && npm ci      # the shared renderer (a file: dependency)
cd ../cli && npm ci
npm test               # builds dist/, then runs the tests
npm pack               # slipway-cli-<version>.tgz
```
