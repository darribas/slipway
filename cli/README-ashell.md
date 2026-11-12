# slipway in a-Shell (iPad / iPhone)

Render Quarto-flavoured reveal.js decks (`.qmd`) to one self-contained HTML
file, fully offline, inside [a-Shell](https://holzschu.github.io/a-Shell_iOS/).
Same renderer and same HTML as the Slipway app, the desktop `slipway` command
and the VS Code extension.

This page is published at
<https://darribas.github.io/slipway/cli/README.md>. The install below saves a
copy next to the command, so you can read it later offline with
`cat ~/Documents/bin/slipway-README.md`.

## Install

Online, in the full a-Shell app (not a-Shell mini). About 57 MB in total:

```sh
mkdir -p ~/Documents/bin
cd ~/Documents/bin
curl -L -O https://darribas.github.io/slipway/cli/slipway-ashell.js
curl -L -O https://darribas.github.io/slipway/cli/pandoc.wasm
curl -L -o slipway-README.md https://darribas.github.io/slipway/cli/README.md
cd ~/Documents
```

Check it:

```sh
jsc ~/Documents/bin/slipway-ashell.js --version
```

### Optional: a short `slipway` command

Add an alias to the file a-Shell runs at the start of every window:

```sh
echo "alias slipway='jsc ~/Documents/bin/slipway-ashell.js'" >> ~/Documents/.profile
```

Open a new window (or run `source ~/Documents/.profile`), then `slipway --version`.
If your a-Shell reports that `alias` is not found, skip this and use the full
`jsc ~/Documents/bin/slipway-ashell.js …` form below.

## Use

```sh
slipway render deck.qmd                  # writes deck.html next to deck.qmd
slipway render deck.qmd -o out.html
slipway render slides/deck.qmd --root .  # project root = current folder
slipway render deck.qmd --print          # print variant, for "Save as PDF" in Safari
slipway render deck.qmd --verbose        # also show informational notes
slipway --help
```

(Without the alias, replace `slipway` with `jsc ~/Documents/bin/slipway-ashell.js`.)

From Vim: `:!slipway render %`

Open the resulting `.html` from the Files app in Safari to present it. It
needs no connection.

### Where it looks for the theme, bibliography, images and includes

In the *project root*: `--root <dir>` if given; otherwise the nearest folder
above the deck containing `_quarto.yml`; otherwise the current folder if the
deck is under it; otherwise the deck's own folder. Paths in the deck's YAML
are resolved forgivingly, as in the app (`theme: ../assets/imago.scss` finds
`assets/imago.scss` in the root). Hidden folders and `node_modules` are
ignored.

So if a deck in `slides/` uses `../assets/…`, either run it from the project
folder (`slipway render slides/deck.qmd`) or pass `--root ..`.

## Good to know

- **The first render in a window is slow; the rest are fast.** The first one
  loads and compiles `pandoc.wasm`, which then stays loaded in that window
  (later renders take well under a second). Opening a new window, or
  `jsc --reset`, starts over.
- **`jsc --reset` frees the memory** pandoc holds, and also gets `jsc` going
  again if a render ever hangs.
- **The exit status is always 0** (a `jsc` script can't set one). A
  successful render prints `Output created: <file>`; anything else printed
  is a warning or an error, and on an error no file is written.
- `pandoc.wasm` has to sit next to `slipway-ashell.js`, or set
  `SLIPWAY_PANDOC_WASM` to its full path.
- Run it in an a-Shell window, not from a Shortcut or in the background.

## Update

Download the two files again (online):

```sh
cd ~/Documents/bin
curl -L -O https://darribas.github.io/slipway/cli/slipway-ashell.js
curl -L -O https://darribas.github.io/slipway/cli/pandoc.wasm
curl -L -o slipway-README.md https://darribas.github.io/slipway/cli/README.md
jsc --reset
cd ~/Documents
```

`slipway --version` shows what you have.

## Uninstall

```sh
jsc --reset
rm ~/Documents/bin/slipway-ashell.js ~/Documents/bin/pandoc.wasm ~/Documents/bin/slipway-README.md
```

If you added the alias, delete the `alias slipway=…` line from
`~/Documents/.profile` (for example with `vim ~/Documents/.profile`, then
`dd` on that line and `:wq`). Remove `~/Documents/bin` too if nothing else
lives there (`rmdir ~/Documents/bin`).
