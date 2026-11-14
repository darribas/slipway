# Bundled themes

One self-contained folder per theme. A folder's contents are exactly what
lands in a project's `assets/`:

```
themes/imago/imago.scss              →  assets/imago.scss
themes/imago/fonts/figtree/…         →  assets/fonts/figtree/…
```

so decks select a theme with `theme: ../assets/<name>.scss`, in Slipway and
under `quarto render` alike.

| Theme        | Fonts (licence)                       |
|--------------|---------------------------------------|
| `imago`      | Figtree (OFL)                         |
| `journal`    | ET Book (MIT)                         |
| `travelogue` | Fraunces, Courier Prime (OFL)         |

Fonts are self-hosted so themes render offline — no network `@import`.

## Who reads these files

- **The PWA** bundles them: `app/src/storage/bundled-themes.ts` (`?raw`
  imports of the SCSS and licences) and the `virtual:seed-fonts` plugin in
  `app/vite.config.ts` (every font under `themes/*/fonts/`). Seed, top-up and
  export self-heal all go through that catalog.
- **`cli/new-deck.sh`** fetches a theme's files into a new deck folder
  (a-Shell or any shell); its per-theme file lists are checked against these
  folders by `cli/test/new-deck.test.ts`.
- **Tests** in every package build the demo template as a complete project
  with `demoProject()` from `install.mjs` (template + themes in `assets/`).

## Adding a theme

1. `themes/<name>/<name>.scss` and `themes/<name>/fonts/<family>/` with the
   font files and their licence. Font families must not clash with another
   theme's (`app/test` checks no two themes share an asset path).
2. Add it to `BUNDLED_THEMES` in `app/src/storage/bundled-themes.ts`, and bump
   `BUNDLED_VERSION` in `app/src/storage/seed.ts` so existing installs get it.
3. A showcase deck under the demo template's `demos/` and a golden in
   `core/test/golden.test.ts`.
4. A `case` branch in `cli/new-deck.sh` listing its font files (and its
   showcase). `cli/test/new-deck.test.ts` fails until the lists match.
