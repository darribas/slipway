# Quarto reveal.js PWA — Project Spec

A Progressive Web App for building Quarto-flavoured reveal.js slide decks fully locally on iPad, including offline (plane-friendly). No code execution — pure document authoring with custom theming and full Quarto-style feature parity for the EMBED2Social-style feature set.

-----

## Concept

The app provides a single-page, offline-capable authoring environment that takes `.qmd` files with YAML frontmatter and renders them to reveal.js HTML entirely client-side. The intended user is the slide author working on a custom imago/journal theme; the intended hardware is an iPad with a keyboard attached.

The pipeline replaces Quarto's Deno orchestrator with browser-resident pieces:

```
project files (OPFS)
  → SCSS compilation (Dart Sass WASM)
  → Quarto-style preprocessing (custom: shortcodes like {{< include >}})
  → pandoc-wasm (--to revealjs --standalone --citeproc, theme CSS in VFS)
  → reveal.js HTML
  → iframe preview
```

-----

## Tech stack

- **Pandoc 3.9 WASM** (official `wasm32-wasi` build with JS bridge) — `qmd → reveal.js HTML`
- **Dart Sass** (JS/WASM port) — compiles `imago.scss`, `journal.scss`, etc. in-browser
- **KaTeX** (bundled) — math rendering, offline
- **Reveal.js core** + plugins: Menu (default on), Search, Chalkboard (available, opt-in per deck via YAML)
- **CodeMirror 6** + `@replit/codemirror-vim` for the editor
- **Service Worker** for offline asset caching and update flow
- **IndexedDB** for project storage *(originally OPFS in the spec; OPFS turned out to be unreliable in iOS Safari's regular browser tabs — see `PHASES.md` Phase 1 post-release fixes)*
- **Web App Manifest** with `display: standalone` for Add-to-Home-Screen install

-----

## Data model

Single active project at a time, stored in OPFS. A project is a directory tree containing `.qmd` files (each renderable as an independent deck), a shared `assets/` folder, `references.bib` (optional), `theme.scss` (e.g. `imago.scss`), and any other user files. Each `.qmd` carries full reveal.js config in its YAML frontmatter — no `_quarto.yml` required.

### Project lifecycle

- **Import**: from `.zip` via `<input type=file>`, or "New from template" using bundled templates (imago light, imago dark, journal, workshop scaffold).
- **Auto-archive on switch**: before overwriting the active project, save it as a zip in OPFS. Keep the last 3 archived zips; prune oldest.
- **Export**: download project as `.zip` via blob download. A persistent "Send to Files" button in the chrome pushes the latest zip to the Files app via the Share Sheet.
- **Auto-save**: debounced 2 seconds after last keystroke, writes to OPFS.

-----

## UX

### Three pane modes

- **Write** — file tree + editor (no preview). For keyboard-driven authoring sessions.
- **Review** — editor + preview side-by-side (file tree collapsible).
- **Present** — preview fullscreen via Fullscreen API. Two sub-modes selectable at present time:
  - *Plain fullscreen* (reveal.js's own native presentation)
  - *Presenter view* (current slide + next + speaker notes + timer in a single in-app pane)

Splitters draggable between panes. Each mode reachable by keyboard shortcut.

### Editor

CodeMirror 6, vim bindings always-on. Syntax highlighting for Markdown, YAML frontmatter, fenced divs.

- `Cmd+R` — render
- `Cmd+S` — manual save (autosave runs silently in background regardless)

### Render trigger

Explicit button only — no auto-render on idle. A small coloured dot appears on the render button when edits have occurred since the last render (stale-preview indicator).

### Image insertion

All three flows supported, all auto-save the image to `assets/` with timestamp filename (`YYYYMMDD-HHMMSS.png`) and insert the markdown reference at the cursor:

- **Paste from clipboard** (long-press → Copy in Photos, then paste in editor)
- **Files picker** (image file picker dialog)
- **Drag-and-drop** (from Photos via Split View)

### File management

Full project editing — create/delete/rename `.qmd`, `.scss`, `.bib`, folders, anything. File tree handles all operations.

-----

## Quarto-flavoured features

### Supported natively by pandoc (free)

- Fenced div two-column layouts (`:::: {.columns} ::: {.column}`)
- Slide attributes (`{background-color="..."}`, `{.smaller}`, `{.center}`, etc.)
- Bibliography via `@citation-key` + `--citeproc` + `.bib` in YAML
- Incremental lists, fragments
- Speaker notes via `::: notes`
- YAML title slide (with author, subtitle)
- KaTeX math (`$...$`, `$$...$$`)
- Code block highlighting (no execution)

### Custom reimplementation

- `{{< include file.qmd >}}` shortcode → pre-processing pass before pandoc handoff (string substitution)
- Cross-references (`@fig-label`): TBD. Either compile `pandoc-crossref` to WASM if buildable, or fall back to vanilla pandoc IDs

### Not supported (out of scope for v1)

- Lua filters from Quarto extensions — inventory which are load-bearing in your existing decks before building
- Code execution (Python/R) — by design

-----

## Defaults

- **Citation style**: `chicago-author-date` (override via `.csl` file in project)
- **Slide aspect ratio**: 16:9 (overridable per-deck via YAML)
- **Code highlighting style**: `github`
- **App light/dark chrome**: follows `prefers-color-scheme` (slide preview follows the deck's own theme regardless)
- **Asset folder convention**: `assets/`
- **Pasted image filename**: `YYYYMMDD-HHMMSS.png`
- **Autosave debounce**: 2 seconds
- **Backup retention**: last 3 auto-archive zips in OPFS

-----

## Storage & persistence

- OPFS as primary store.
- `navigator.storage.persist()` requested on first launch to prevent OPFS eviction under storage pressure.
- "Ready offline" banner appears when the Service Worker has cached all critical assets — the cue that you can take it on the plane.

-----

## Updates

Service Worker pattern. On launch (when online), the SW checks for new app shell + asset versions, downloads in background.

**Notify-style application**: a banner appears when an update is ready ("New version available — reload to apply"), user chooses when to reload. Updates include new `pandoc.wasm` versions, so the user controls when rendering behaviour might change.

-----

## PDF export

Dedicated "Export PDF" button. Re-renders the deck with reveal.js's `?print-pdf` query flag (built-in to reveal.js, no extra deps), opens it for Safari's print sheet → Save as PDF. Zero added bundle weight.

-----

## Out of scope (deferred)

- Multi-project switcher UI
- Code execution (Python/R)
- Auto-render on idle
- Silent auto-update
- Multi-window presenter mode (reveal.js's `window.open` pattern — hostile to Safari PWAs)
- Native-wrapper-required features (silent writes to arbitrary Files locations, background sync to a watched folder)
- Git/version-control integration (zip roundtrip handles the plane case; isomorphic-git is a future sugar if useful)

-----

## Implementation phases

**Phase 0 — Validation prototype** (a few hours)

A single static HTML page that loads `pandoc-wasm` from CDN, has a known-good imago-themed `.qmd` hardcoded as a string, compiles `imago.scss` inline, renders to an iframe. Goal: confirm pandoc's reveal.js output is close enough to Quarto's that the rest is worth building.

**Phase 1 — MVP** (one weekend)

CodeMirror editor (no vim yet), OPFS storage, import/export zips, button-triggered render, single Review pane mode. Renders existing EMBED2Social-style decks end-to-end.

**Phase 2 — Full UX** (next weekend)

Three pane modes, vim bindings, file tree manager, image insertion flows (all three), stale-preview indicator.

**Phase 3 — Polish & PWA** (third weekend)

Service Worker + offline, Web App Manifest, PDF export, presenter view, plugin support (Menu/Search/Chalkboard), KaTeX, templates, app icon, hosting decision.

-----

## Open items

- **App name** and icon
- **Journal theme spec**: pending — share the SCSS when ready
- **Quarto extension inventory**: list of extensions your current decks depend on, to identify any load-bearing Lua filters that would block faithful reproduction
- **pandoc-crossref WASM**: needs investigation for cross-reference support

-----

## Resolved decisions

- **Hosting**: GitHub Pages, deployed by GitHub Actions from `app/dist/` on every push to `main`. Served at `darribas.github.io/slipway/` and (via the account-level custom domain) `darribas.org/slipway/`. See `.github/workflows/deploy.yml`.
