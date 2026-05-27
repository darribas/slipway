# Development phases

Running log of what each phase shipped, what it proved, what was caught along the way, and what's deferred. New phases are appended at the bottom.

See [`SPEC.md`](./SPEC.md) for the unchanging project spec.

-----

## Phase 0 — Validation prototype

**Status:** ✓ shipped
**Commits:** `7d27dae`, `d9e1cbc`
**Tree:** [`phase0/`](./phase0/)

### Goal

Prove the core pipeline — Dart Sass + pandoc-wasm + a sandboxed iframe — can render a real Quarto-flavoured `.qmd` deck close enough to native Quarto output that Phases 1–3 are worth building.

### What's on the branch

```
phase0/
  index.html          single-file, build-step-free browser prototype
  smoke.js            Node-side mirror that asserts on rendered HTML
  sample-output.html  pre-rendered Imago deck for offline review
  assets/             slide.qmd, imago.scss, references.bib, attention_paper.png
```

Seeded with the actual Imago `embeddings_workshop` deck so validation is against production-shape content, not a synthetic exemplar.

### Stack picks

- **`pandoc-wasm@1.0.1`** (Pandoc 3.9, official `pandoc/pandoc-wasm` package by John MacFarlane, George Stagg, Johannes Wilm). Loaded via `core.js` from jsDelivr (not the bundler-only `index.browser.js`), with the wasm binary fetched separately so we get a progress hook on the ~56 MB download.
- **`@bjorn3/browser_wasi_shim@0.4.2`** via esm.sh (matches pandoc-wasm's pin).
- **`sass@1.83.0`** (JS-compiled Dart Sass) via esm.sh.
- **Reveal.js 5.x** loaded from the unpkg CDN by pandoc's default standalone template.

Alternatives considered and rejected: `tweag/pandoc-wasm` (superseded by the official package); building from `jgm/pandoc`'s `make pandoc.wasm` (reimplements the WASI glue the package already ships).

### Pipeline (validated end-to-end)

1. Compile `imago.scss` → CSS with Dart Sass.
2. Preprocess `.qmd`: strip `theme:` and `bibliography:` from YAML (re-supplied via pandoc options); rewrite local image refs to data URIs; expand `{{< include >}}` shortcodes (one-pass).
3. Run pandoc with `--from markdown --to revealjs --standalone --citeproc --html-math-method=katex`, theme CSS and bib delivered through the WASI VFS.
4. Inject the resulting HTML into a sandboxed iframe via `srcdoc`.

### Real bugs the smoke test caught

- **`katex: true` is not a valid option** — the pandoc-wasm JSON-options API uses `"html-math-method": "katex"`.
- **`highlight-style: "github"` is not built into pandoc** — it's a Quarto-supplied style. Built-ins are pygments / tango / espresso / zenburn / kate / monochrome / breezedark / haddock. Phase 0 dropped the explicit setting; Phase 1+ should bundle a GitHub theme JSON file.
- **`slide-level` defaults to 1 on decks that mix direct-content `#` slides with `##` subsections**, collapsing every `##` into its parent `#`. Quarto defaults to 2; the prototype now passes `"slide-level": 2` to match.

### Validation outcome

12/12 smoke-test checks pass (10 against the real workshop deck, 2 against a synthetic mini-deck that exercises math + speaker notes):

- reveal.js loaded; compiled theme CSS injected; dark slide class present; columns class present; incremental fragments; `.hlg` highlight class; footnote markers; bibliography rendered in `#refs`; local PNG inlined as data URI; external Wikimedia URL left intact; KaTeX assets injected for `$math$`; `::: notes` → `<aside class="notes">`.

Render time ~2 s after pandoc instantiation. Pandoc cold start ~5–8 s in a desktop browser.

### Known caveats (intentionally deferred)

- `{{< include >}}` shortcode is recognised and stamped out but doesn't actually splice content (no OPFS yet — Phase 1 wires real resolution).
- `--embed-resources` was rejected in favour of selective preprocessor-side data-URI inlining, because WASI pandoc can't fetch remote URLs (so it would otherwise blank out the Wikimedia images).
- The Sass `darken()` / `lighten()` calls in `imago.scss` are deprecated in modern Dart Sass; they still compile (with warnings) and produce correct CSS.

### Visual observations from rendered screenshots

Three things looked off in the first round of screenshots and were fixed in Phase 1:

1. **Imago theme only half-applied** — pandoc loaded `black.css` first, then `theme.css`, so the imago SCSS (designed assuming a `white.css` base) lost the cascade. Phase 1 passes `variables: { theme: "white" }` so imago.scss wins.
2. **Figtree font** doesn't load in the headless test sandbox (no network egress to `fonts.googleapis.com`). Loads fine in a real browser.
3. **YAML `format: revealjs:` block stripping was too aggressive** — Phase 0's regex pass dropped `navigation-mode`, `controls-layout`, `center: false` along with `theme:`. Phase 1 uses a real YAML parser to remove keys surgically.

### Seed assets (provided by user)

- `.qmd`: <https://github.com/Imago-SDRUK/embeddings_workshop/blob/main/slides/imago_embeddings_workshop.qmd>
- `.scss`: <https://github.com/Imago-SDRUK/embeddings_workshop/blob/main/assets/imago.scss>

-----

## Phase 1 — MVP (Vite + CodeMirror + OPFS + zip I/O + Review pane)

**Status:** ✓ shipped
**Commits:** `3858b9e`
**Tree:** [`app/`](./app/)

### Goal

Wrap the Phase 0 pipeline in a real authoring UI: edit `.qmd` in CodeMirror, files live in OPFS, import/export via zip, button-triggered render, single Review pane. Renders existing EMBED2Social-style decks end-to-end.

### What's on the branch

```
app/
  index.html, vite.config.ts, tsconfig.json, package.json
  src/
    main.ts                       wires editor ↔ render ↔ storage
    core/
      pandoc.ts                   loads pandoc.wasm with progress hook
      pandoc-core.js              vendored MIT glue from pandoc-wasm
      render.ts                   sass → preprocess → pandoc → HTML
      preprocess.ts               YAML-aware (uses `yaml` parser, not regex)
      sass.ts, types.ts
    storage/
      opfs.ts                     native OPFS read/write/list
      project.ts                  active deck model + render-input builder
      zip.ts                      import/export via fflate
      seed.ts                     first-run imago workshop template
    ui/
      editor.ts                   CodeMirror 6 + markdown + YAML + keymap
      preview.ts                  sandboxed iframe via srcdoc
      layout.ts                   toolbar + split pane + draggable splitter
      styles.css
    templates/imago-workshop/     bundled seed (qmd/scss/bib/png)
```

### Spec items shipped

- CodeMirror 6 editor with markdown + YAML highlighting (vim bindings deferred to Phase 2).
- OPFS storage; `navigator.storage.persist()` requested on first launch.
- Zip import + export via `fflate`. Import wipes OPFS and writes the entries, with shared-top-level-directory detection so zips of `mydeck/...` and zips of `slide.qmd, assets/...` both look the same on disk.
- Button-triggered render (`Cmd/Ctrl+R`), manual save (`Cmd/Ctrl+S`), 2 s debounced autosave.
- Single Review pane with a draggable splitter; stacks vertically below 700 px width.
- Stale-render indicator (orange dot on Render button after edits).
- "Present" button opens the rendered HTML in a new tab for full-screen presenting.
- First-run seed populates the imago workshop deck so the app boots into something real.

### Architecture decisions worth flagging

- **`pandoc-wasm` access** — the npm package's `exports` field blocks `pandoc-wasm/src/core.js` and `pandoc-wasm/src/pandoc.wasm?url` deep imports. Solved with a small Vite plugin (`vite.config.ts`) that exposes the wasm via `virtual:pandoc-wasm-url`: dev serves it through middleware, build emits a hashed asset. `core.js` is vendored verbatim with attribution (the JS glue is MIT, separate from pandoc.wasm's GPL). The vendoring keeps a download-progress hook the package's own browser entry doesn't expose.
- **YAML preprocessing is now a real parse** (the `yaml` package) instead of regex, so directives like `navigation-mode`, `controls-layout`, `center: false` survive. Fixes the over-aggressive stripping noted in Phase 0.
- **Pass `variables: { theme: "white" }`** so reveal.js loads `white.css` as the base; `imago.scss`'s `.dark`/`.light` overrides now win the cascade instead of fighting `black.css`. Fixes the muted-palette issue noted in Phase 0.
- **OPFS layer uses native FileSystem APIs** (no library). Safari 17+ and Chromium support it.
- **`fflate` chosen over `jszip`** for zip handling: ~10 KB, ESM-native, no worker required.

### Numbers

- Build: 4.0 MB JS (940 KB gzip), 58 MB pandoc.wasm (16 MB gzip), ~3 KB app CSS.
- End-to-end render of the imago workshop deck: ~1.8 s after pandoc is loaded.
- Pandoc cold start (download + instantiate): tens of seconds on first visit; cached thereafter.

### Local development

```
cd app && npm install
npm run dev                  # dev server with HMR
npm run build                # production build to app/dist/
npm run preview              # serve the production build
npm run typecheck            # tsc --noEmit only
```

### Out of scope (deferred to Phase 2+)

- Vim bindings.
- File tree manager (currently just a `<select>` dropdown of `.qmd` files in the project).
- Image insertion flows (paste / picker / drag-drop).
- Three pane modes (Write / Review / Present) — only Review pane in Phase 1.
- In-app presenter view (current slide + next + notes + timer). "Present" today is just "open the rendered HTML in a new tab".
- Service worker + offline, web app manifest, PDF export — all Phase 3.
- Plugin opt-in (Menu / Search / Chalkboard) per-deck via YAML — Phase 3.
- Bundled templates beyond the imago workshop seed (imago-light, imago-dark, journal, workshop scaffold) — Phase 3.

### Post-release fixes

- **iPad Safari hangs on "Seeding project…"** — root cause: `FileSystemFileHandle.createWritable()` (the async OPFS write API we used everywhere) only landed in Safari 18.4 (March 2025). On older Safari it throws, and `main()` had no `.catch`, so the rejection vanished and the status bar froze. Fix: `opfs.ts` now tries `createWritable` first, falls back to `createSyncAccessHandle` (supported on Safari main thread since 17.4, April 2024). `main.ts` got a top-level `.catch` that paints any startup error into the toolbar (or a full-page banner if the toolbar itself never mounted), and warning details from the render path are now exposed as a tooltip on the status text (long-press on iPad, hover on desktop) and logged to `console.warn`.
- **Sync-access-handle write failure on Safari** — first round of the above fix exposed a second Safari-specific issue: `sync.truncate(0)` followed by `sync.write()` on a brand-new file threw the generic `"The operation failed for an unknown reason"`. Reordered to write-then-truncate (write at offset 0, then truncate to exact byte length) which has been more reliable on iPadOS. The toolbar's status text would also truncate the error to "for an un…", so startup errors now render as a full-width dismissable banner that shows the message, a capability probe (UA, `createWritable` / `createSyncAccessHandle` / `persisted` flags), and the stack — with a Copy button so users can paste the diagnostics back. `writeBytes` also wraps thrown errors with the file path and byte count so we know exactly which write failed.
- **Main-thread `createSyncAccessHandle` is unreliable on iOS Safari 26.4 / iOS 18.7** — even when the API is exposed, `sync.write()` throws `"operation failed for an unknown transient reason"` on regular browser tabs, and the OPFS subsystem gets into a stuck state where subsequent file-handle creation also fails. First attempt: keep `createWritable` on the main thread (Chromium / Firefox / Safari 18.4+ fast path) and delegate to a worker for the createSyncAccessHandle fallback, trying multiple write-call shapes. Didn't help — see next entry.
- **Storage backend swapped from OPFS to IndexedDB** — second round of iPhone diagnostics revealed the actual failure was at `getFileHandle({create: true})` itself (the probe's `getHandle` error path), so neither write API ever gets a chance. iOS Safari in regular browser tabs (not Home-Screen-installed PWAs) appears to deny full storage to web apps and OPFS fails opaquely as a consequence (`persisted: false` even after `navigator.storage.persist()`). IDB has none of these constraints — it's been reliable on every browser including Safari for over a decade, supports binary data via `Uint8Array` values, and respects `navigator.storage.persist()`. `storage.ts` replaces `opfs.ts` (and `opfs-worker.ts` is gone); the public API is unchanged (`writeText` / `writeBytes` / `readText` / `readBytes` / `exists` / `remove` / `clearRoot` / `listFiles`) so no other module needed to be touched beyond import paths. Chromium e2e confirms no regression: render still finishes in ~1.5s.

-----

## Phase 2 — Full UX

**Status:** 🚧 mostly shipped — see Outstanding below
**Goal (per `SPEC.md`):** three pane modes (Write / Review / Present), vim bindings, file tree manager, image insertion flows (paste / picker / drag-drop). Plus, beyond the original spec: tabbed and flexibly resizable panes (VS Code / Jupyter Lab style) as the foundation the pane modes sit on top of.

**Shipped:** the Dockview tabbed/dockable layout, vim bindings, the file-tree manager, and all three image-insertion flows. **Outstanding:** the three *named* pane modes (Write / Review / Present) as discrete one-key views — the app ships a free Dockview layout instead — and the in-app presenter view (current slide + next + notes + timer); "Present" opens the rendered deck but without a presenter pane.

### Increment 1: Smoke test in CI

The regression net that gates everything else in Phase 2. Before any new UI work touches the renderer's neighbours (preprocessor, sass, asset inlining), the deck has to keep rendering correctly.

- `vitest` added as a devDep; `app/test/smoke.test.ts` drives `src/core/render.ts` directly against the bundled imago workshop template and asserts on the output. Mirrors the spirit of `phase0/smoke.js` but exercises the *current* code path, not the frozen Phase 0 inline copy.
- 9 assertions: end-to-end render produces ≥50KB of HTML with empty stderr; reveal.js + compiled theme.css present; `.dark` / `.columns` / `.hlg` classes survive; footnotes + bibliography in `#refs` + citeproc entries render; local PNGs inlined as data URIs; external Wikimedia URLs left intact; `::: {.incremental}` becomes reveal.js fragments. Two synthetic-mini-deck probes cover features the workshop doesn't exercise: KaTeX assets injection on `$math$`, `::: notes` → `<aside class="notes">`.
- `PandocInstance` interface moved from `core/pandoc.ts` (which has a Vite-only `virtual:pandoc-wasm-url` import) to `core/types.ts` so the test can import it in a node-only context without dragging the Vite virtual module into the test runner. `pandoc-wasm`'s `convert()` is shape-compatible with `PandocInstance.convert` and is used as the renderer's pandoc dependency in tests.
- New `.github/workflows/ci.yml` runs `npm test` + `npm run build` on every PR to main and on manual dispatch.
- The existing `deploy.yml` got a `npm test` step before `npm run build`, so a regression on a direct push to main also fails the deploy before publishing.

Runs in ~9s locally. CI should finish under a minute including the npm cache restore.

### Increment 2: Dockable pane layout (Dockview)

Foundation for the rest of Phase 2 — three pane modes, file tree, image insertion, presenter view — all sit on top of this. Hand-rolled split grid replaced with `dockview-core` (vanilla TS, ~80 KB gz). The editor and preview are now Dockview panels with tabs, drag-to-dock, drag-to-tab, and free splitting in any direction.

- `dockview-core@6.3.0` added as a dependency.
- `layout.ts` shrank: removed the bespoke split grid + pointer-driven splitter. The pane area is now just a host div that main.ts attaches a `DockviewComponent` to.
- `main.ts` builds the editor and preview into plain `HTMLDivElement` containers, then registers them with Dockview via the `createComponent` factory hook. Each `IContentRenderer` just exposes its pre-built container; Dockview moves it between groups during dock/tab/split operations and CodeMirror's `lineWrapping` handles the size changes.
- Initial layout: editor panel on the left, preview panel on the right (tab title tracks the active `.qmd`). Both panels are drag-rearrangeable; resize is built in. Smoke test still 9/9, browser e2e confirms render still produces 178 KB of HTML in ~1.5 s.
- Bundle cost: ~100 KB of Dockview CSS (9 KB gz) + ~250 KB JS (60 KB gz). Negligible next to the 58 MB pandoc.wasm.

Known cosmetic gap (deferred to a small polish increment): Dockview's theme is currently scoped to the pane host element and applied via `prefers-color-scheme`, but the cascade doesn't always win against Dockview's own default dark styling. Result: in light-mode environments the toolbar is light while the dock chrome stays dark. Functional but visually inconsistent.

### Increment 3: Inline reveal.js for offline-capable rendering

Pandoc 3.9's revealjs-standalone template hardcodes `unpkg.com/reveal.js@^5/...` for the deck's CSS, JS, and plugins. Two problems with that: (1) every render is at the mercy of unpkg's resolution of `^5` at fetch time, so reveal.js can silently change behaviour between visits; (2) the app stops working offline (the spec's plane-friendly goal) because the iframe still needs network to load the slide framework.

- `reveal.js@^5.2.1` added as a devDep (we resolved 5.2.0; matches pandoc 3.9's `^5/plugin/notes/notes.js`-style paths).
- New `core/inline-assets.ts` imports the 8 files pandoc's template references (`reset.css`, `reveal.css`, `theme/white.css`, `theme/black.css`, `reveal.js`, `plugin/notes/notes.js`, `plugin/search/search.js`, `plugin/zoom/zoom.js`) via Vite's `?raw` and exports `inlineRevealAssets(html)` which rewrites every matching `<link href="…">` / `<script src="…">` into an inline `<style>` / `<script>` block, preserving the original URL in a `data-from` attribute for traceability.
- `render.ts` runs the inliner on pandoc's output before returning it.
- Smoke test gets a new assertion: the rendered HTML must contain no external `<link>` / `<script>` references (KaTeX excluded — see deferred items). 10/10 passing.
- Verified end-to-end: the headless Chromium e2e, run inside this sandbox where unpkg is blocked, now shows the deck slide-by-slide with the navigation controls visible. Previously this hit `PAGE ERROR: Reveal is not defined` and rendered as a flat document.
- Bundle cost: ~265 KB of inlined reveal.js source baked into the JS chunk (~60 KB gz). Acceptable next to the 58 MB pandoc.wasm.
- Upgrade path: bump `reveal.js` in `package.json`, redeploy. Once the Service Worker arrives in Phase 3, this is the same "new version available — reload to apply" banner that'll surface pandoc.wasm updates.

### Increment 4: File tree manager

Replaces the toolbar's `<select>` dropdown with a proper file tree in a left-side Dockview panel. Full CRUD on project files: click to open, rename, delete; per-folder "New file" / "New folder"; project-root buttons at the top of the panel.

- New `ui/file-tree.ts` builds a hierarchical view from `listFiles()`'s flat path list and renders an indented tree with hover-revealed action buttons (visible-by-default on touch via `@media (hover: none)`). Folders track expand/collapse state across refreshes; the active file's ancestors auto-expand so it's always visible.
- `storage.ts` gains a `rename(oldPath, newPath)` helper that does a get/put/delete inside one IDB transaction and refuses overwriting an existing key.
- IDB has no real directories — empty folders are modelled with a `.placeholder` stub so the tree can show them; the placeholder (and any other dot-prefixed name like the `.seeded` marker) is filtered from the displayed list.
- File-tree actions wire through `main.ts` callbacks: rename / delete autosave first if affecting the active file and update the editor title; new file opens in the editor if it's a `.qmd`. Zip import now refreshes the tree and opens the first `.qmd` it finds instead of populating a dropdown.
- Toolbar's `<select>` removed (along with its `refreshFileList` helper); navigation is the tree from here on.
- Initial layout: Files panel at 220 px width, Editor and Preview to its right. All three are tab-draggable / dock-rearrangeable like before.

Smoke test: 10/10 still passing (no renderer-touching changes). Build clean; Chromium e2e renders the workshop deck in ~1.5 s.

UX notes worth flagging:

- Rename / new-file / new-folder use `window.prompt()`. Functional, but ugly on iOS. Inline rename via swap-to-input is a Phase 2 polish item.
- Delete uses `window.confirm()`. Same comment.
- No drag-and-drop reorder / move yet — would build on Dockview's DnD primitives but is its own increment.

### User-testing backlog (Phase 2)

Reported during testing, queued for individual increments. Tick off as they ship.

- ✓ **[5a]** Editor unreadable in light mode — see increment 5a below.
- ✓ **[5b]** Editor only opens `.qmd` files — see increment 5b/d below.
- [ ] **[5c]** Zip import appears to drop non-`.qmd` files. User reports only the `.qmd` survives the import. Possibilities: real bug in `importZip` or its filtering, an auto-collapsed folder hiding what's actually there, or a missing tree refresh. Needs investigation with a real Quarto project zip + better post-import diagnostics ("Imported N files across M folders").
- ✓ **[5d]** Renderer wasn't picking up the theme at all (not just the `.css` case). Real root cause was that pandoc emitted a `<link>` referencing the WASI VFS path which the iframe couldn't resolve — see increment 5b/d below.
- ✓ **[5e]** Renderer ignored the YAML's `theme:` declaration and just globbed for the first `.scss`. The seed deck declared `theme: ../assets/imago.scss` but the renderer never read that — it accidentally worked because there was only one `.scss` in the project. Fragile if multiple stylesheets exist or one gets renamed. Fixed by `resolveDeclaredPath` (see increment 5e below).
- ✓ **[7a]** iPad PWA viewport overflow — toolbar scrolled off-screen when editor scrolled to bottom. See increment 7.
- ✓ **[7b]** YAML `format.revealjs.*` options (notably booleans like `controls: false`) silently ignored. See increment 7.
- ✓ **[wish-1]** A subtle UI affordance to toggle vim bindings on/off — shipped in increment 29 as a circled-"V" toggle in the toolbar.
- ✓ **[wish-2]** Offline-readiness indicator in the chrome — a small plane icon that goes green when everything's cached locally. Shipped across Phase 3 increments 19 / 20 / 24.

### Increment 4.1: File-tree actions always visible

User feedback: "how do I rename on touch?" The action icons (✎ rename, × delete, + new-file-in-folder) were hidden by default and only revealed on hover, with a `@media (hover: none)` fallback meant to keep them visible on touch devices. iOS Safari reports `hover: none` inconsistently (especially when an iPad is paired with a keyboard or trackpad), so on the user's iPhone the icons weren't appearing at all and there was no obvious way to discover them.

Fix: drop the hover gate entirely. Actions are now always-visible at 0.45 opacity, brightening to full on row hover / focus. Touch-target size bumped to 28×28 px. ~10 lines of CSS, no logic change. Smoke test still 10/10.

### Increment 5a: Editor readable in light mode

User report: editor was "not just unaesthetic, but unusable" in light mode — couldn't edit the `.qmd` at all. Root cause: CodeMirror's `defaultHighlightStyle` is designed for white backgrounds, but the editor's element had no explicit background, so Dockview's dark panel chrome bled through. Result: dark syntax colours on a dark background, illegible.

Fix:

- `@codemirror/theme-one-dark` added as a dependency — the standard community dark theme for CodeMirror, ~5 KB.
- `editor.ts` now snapshots `prefers-color-scheme` at construction. Dark mode loads `oneDark` (which brings its own background + highlight palette). Light mode keeps `defaultHighlightStyle` on an explicit white background.
- Explicit `EditorView.theme` block sets background, foreground, caret, gutter, active-line, and selection colours for both modes so the editor chrome stays coherent with the rest of the app.
- Live theme switching deferred — snapshot at load is enough for now; a reload picks up an OS appearance flip. Wire to a live `matchMedia` listener if it becomes an annoyance.

Verified by light and dark screenshots: both modes legible, syntax highlighting visible, file tree / toolbar / preview palettes coherent. Smoke test still 10/10.

### Increment 5b/d: Edit any text file + theme actually applies

Two user-testing reports landed in the same area of the codebase, bundled into one increment.

**5d — theme files weren't being picked up at all.** Bigger bug than the report suggested. We compile the project's SCSS to CSS and put it in pandoc's WASI VFS at path `theme.css`, and tell pandoc `css: ["theme.css"]`. Pandoc dutifully emits `<link rel="stylesheet" href="theme.css">` in the output — but the iframe receiving that HTML via `srcdoc` has no way to resolve `theme.css` (the VFS is invisible to it). So every render since Phase 1 has been silently missing its theme; the smoke test was passing on "link tag exists" without checking the CSS ever reached the browser.

Same fix shape as the reveal.js inlining (increment 3): post-process pandoc's output to swap the `<link>` for an inline `<style data-from="theme.css">` block carrying the compiled CSS. New `inlineThemeCss(html, css)` in `core/inline-assets.ts`; `render.ts` calls it right after `inlineRevealAssets`.

Stylesheet picker in `project.ts` now also accepts `.css` natively — prefers `.scss` when both exist (so source edits keep applying), falls back to `.css` for projects that ship pre-compiled themes. New `stylesheetIsPrecompiled` flag on `RenderInputs` tells the renderer whether to run Sass or pass through.

Smoke test gets two new assertions: rendered HTML contains the imago navy colour (`#24226f`) and the Figtree font reference, plus a synthetic deck with a `.css` stylesheet round-trips through unchanged. 12 tests now.

**5b — edit any text file.** The file tree's `onOpen` previously bailed for non-`.qmd` paths. Two changes:

- `project.ts` separates `activeEditor` (whatever's in the editor — `.qmd`, `.scss`, `.bib`, `.yaml`, etc.) from `activeQmd` (what Render targets, last-touched `.qmd`). Autosave and `Cmd+S` write to `activeEditor`; the Render button still targets `activeQmd`, which persists when the user navigates to a non-`.qmd` to tweak the theme.
- New `isTextFile(path)` helper with an extension allowlist (qmd, md, scss, css, bib, csl, yaml, json, txt, svg, html, lua, tex, js, ts). Binary opens are still refused — no point shoving a PNG's bytes into a text editor.
- `main.ts` callbacks reworked: rename / delete / create / fileTree highlight all key off `activeEditor`. Delete-of-active-qmd falls back to the next available `.qmd`; delete-of-non-qmd-editor-file falls back to whichever `.qmd` is currently the active deck.

Old `readQmd` / `saveQmd` helpers in `project.ts` are now thin wrappers superseded by `readFile` / `saveFile`.

Smoke test still 12/12. Browser e2e confirms: clicking the imago `.scss` in the tree opens it in the editor; the toolbar's deck status survives the navigation; hitting Render still renders the last-touched `.qmd`.

### Increment 8: Multi-tab editor + CSS syntax for `.scss` / `.css`

User asked for multiple files open at once, plus syntax highlighting for non-`.qmd` text files. Both ship together — they're adjacent to each other and to the editor refactor either one needs.

**Multi-tab editor.** `main.ts` now manages an `opens: Map<path, OpenEditor>` instead of a singleton editor. Each open file gets its own Dockview panel with its own CodeMirror instance, its own undo history, scroll position, vim state, and autosave timer. Tabs live in the editor group; user can drag-reorder, drag-out-to-split, or close them with the × button. Active-tab change is wired through Dockview's `onDidActivePanelChange`; panel removal through `onDidRemovePanel` (with a best-effort save flush on close so a quick edit-then-close doesn't lose keystrokes). Rename of an open file updates its tab title in place; delete closes the tab; zip import closes every open tab before clearing storage.

A subtle nuance worth flagging: switching tabs to a `.qmd` updates the *active deck* (what Render targets) too. Switching to a `.scss` / `.bib` / `.yaml` does not — so you can pop over to the theme file, tweak it, and hit Render to see the deck you were just looking at, the way Phase 2 / 5b already promised.

**Syntax highlighting.** `@codemirror/lang-css` added. New `languageFor(path)` helper in `editor.ts` picks the right CodeMirror language: markdown for `.qmd` / `.md`, CSS for `.scss` / `.css` / `.sass` (SCSS is a CSS superset; lang-css highlights selectors, properties, values, hex colours, and `@import` rules — the Sass-only `$var` syntax doesn't get a special colour but everything else does), YAML for `.yaml` / `.yml`. `.bib` opens as plain text — no maintained CodeMirror language pack exists. New `language` option on `createEditor` so each open editor picks the right one.

**Regression caught + locked down.** First version of the override-script injector (from increment 7) used `html.replace(/<\/body>/i, …)` to insert before `</body>`. Reveal.js's notes plugin embeds the literal string `"</body>\n</html>"` in its source (used when constructing the speaker-view popup), so the regex matched *inside* the inlined notes plugin source — splitting it in half and breaking the whole bundle, producing JS syntax errors and a preview pane showing literal JS as text. Fixed by switching to `lastIndexOf("</body>")` (the real close tag is always the last `</body>`). New smoke-test assertion locks this down: the override script's offset must come *after* the last inlined reveal.js asset.

Smoke test: 25/25 passing.

### Increment 7: iPad viewport + YAML reveal.js options

Two issues from deployed testing.

**7a — iPad PWA viewport overflow.** When installed to Home Screen, scrolling to the bottom of the editor pushed the toolbar off-screen because `#app { height: 100vh }` is taller than the visible viewport on iOS (vh counts the off-screen URL bar even when there isn't one in PWA mode). Fix:

- `index.html` gets `viewport-fit=cover` on the viewport meta + the `apple-mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style` / `apple-mobile-web-app-title` tags so iOS recognises this as a PWA.
- `styles.css` switches `#app` to `100dvh` (dynamic viewport height — accounts for actual visible area on iOS), with a `100vh` fallback. `html, body` pinned with `position: fixed; inset: 0` so touch scrolls in CodeMirror can't bubble up to the document.
- `overscroll-behavior: contain` on the toolbar, pane area, and CodeMirror's `.cm-scroller` to stop swipe-scroll leak.
- Safe-area-inset padding on `#app` so toolbar / file tree / preview don't sit under the iPad status bar or home indicator.

**7b — YAML reveal.js options weren't applying.** User couldn't disable navigation arrows via `controls: false`. Two root causes:

1. The user's options live under `format.revealjs.*` (nested), but pandoc's revealjs template reads metadata at top level. Some keys (e.g., `controls-layout: 'bottom-right'`) come through anyway because pandoc inherits them down, but plain top-level reads miss the nested form.
2. More fundamentally, pandoc's template uses `$if(controls)$` to decide whether to emit `controls: $controls$,` in the `Reveal.initialize()` call. `$if$` treats YAML boolean `false` as "not set", so `controls: false` is silently dropped and reveal.js falls back to its default (`true`).

Fix: `extractDeclarations` now also returns a `revealjsOptions` map containing every `format.revealjs.*` key (excluding `theme`), with kebab-case converted to camelCase. `render.ts` calls a new `injectRevealConfigOverride(html, opts)` post-pandoc, which inserts a small `<script>` before `</body>` that runs `Reveal.configure(opts)` once Reveal is ready. Reveal.configure applies whatever we hand it unconditionally — `controls: false` actually disables the arrows.

Smoke test gains an end-to-end assertion: rendered HTML must contain the override script with the workshop deck's `center: false`, `navigationMode: "linear"`, `controlsLayout: "bottom-right"`. Frontmatter unit tests updated to cover the new `revealjsOptions` field. 24/24 passing.

### Increment 6: Vim bindings

Per the spec's editor section: vim bindings always-on, via `@replit/codemirror-vim`.

- The package's `vim()` extension is prepended to CodeMirror's extension array so its keymap binds before the standard one. Single-key normal-mode bindings (`hjkl`, `i`, `:`, `/`, …) win; modifier shortcuts (`Cmd+S`, `Cmd+R`) keep working because vim doesn't intercept those.
- Ex commands wired to our existing save handler: `:w`, `:write`, `:up`, `:update`, `:wq`, `:x` all call `opts.onSave`. We have no buffer-close concept, so the `:q`-variants are effectively save aliases — useful for keyboard users who type `:wq` reflexively.
- Status line is built into the extension; it appears at the bottom of the editor only when you type `:` or `/`, so it stays out of the way otherwise.
- Snapshot-at-construction approach for themes / vim — a reload picks up changes; no live runtime toggle needed.

Smoke test: no new assertions (vim is editor-only, doesn't touch the render pipeline). 23/23 still passing. Build + light/dark e2e screenshots show the vim normal-mode block cursor present and the editor chrome unchanged.

### Increment 5e: Honour the YAML's theme: / bibliography: declarations

User caught a fragility: the seed `.qmd` declares `theme: ../assets/imago.scss` but the actual file lives at `assets/imago.scss` (the seed flattened the workshop's `slides/` directory). The renderer was accidentally working because `buildRenderInputs` ignored the YAML declarations entirely and globbed for the first `.scss` it found — fine with one stylesheet, surprising as soon as a project has two.

New modules:

- `core/frontmatter.ts` — `extractDeclarations(qmd)` parses YAML frontmatter and returns `{ theme, bib }`, handling both top-level `theme:` / `bibliography:` and the nested `format: revealjs: theme:` form.
- `core/path-resolve.ts` — `resolveDeclaredPath(declared, allPaths)` tries (a) exact match, (b) match after stripping leading `./` and `../` segments, (c) unambiguous basename match anywhere in the tree. Returns null when ambiguous so the caller can fall back to a glob.

`buildRenderInputs` now extracts the declarations, resolves them, and only falls back to "first `.scss` / `.css` / `.bib`" when nothing's declared *or* the declared path can't be resolved.

Smoke test added 11 new unit-level assertions:

- 4 for `extractDeclarations`: top-level, nested-format, missing frontmatter, malformed YAML.
- 7 for `resolveDeclaredPath`: exact match, single/multiple `../` stripping, `./` stripping, unambiguous basename, ambiguous basename → null, unknown → null, exact match preferred over basename when ambiguous would otherwise apply.

Total now 23/23 passing. The existing imago workshop end-to-end render still hits the same `assets/imago.scss` it always did, but now via the declaration-driven path rather than by accident.

### Increment 10: Default workspace layout

Two commits getting the opening pane arrangement right. The app previously opened as three columns (Files | Editor | Preview). The new default puts the editor full-height on the left and splits the right column between Preview (top) and Files (bottom) — more horizontal room for editing while keeping both the deck preview and the file tree visible.

The first cut docked the Files panel "below preview" while preview was still the only panel, so Dockview placed it below the *entire root* and it spanned the full bottom width. Fix: dock Files lazily — only after the first editor has opened to the left of preview and split the grid into two columns — so "below preview" resolves to just the right column.

Result: Editor (full left) | Preview (top right) / Files (bottom right). Subsequent editors stack as tabs in the editor group wherever the user has dragged it. `main.ts` only; smoke test 25/25.

### Increment 11: Image insertion — paste, drag-drop, file picker

The three image-insertion flows from `SPEC.md`. All save the image to `assets/YYYYMMDD-HHMMSS.ext` and insert `![](assets/...)` at the cursor in the active editor.

- New `core/image-insert.ts`: `timestampFilename()`, `saveImageToAssets()`, `readFileBytes()`.
- `ui/editor.ts`: paste and drop handlers wired through `EditorView.domEventHandlers`; an `onImageFile` callback on `EditorOptions` and an `insertImageMarkdown(path)` method on `EditorHandle`.
- `ui/layout.ts`: an "Insert image…" toolbar button backed by a hidden `<input type="file" accept="image/*">`.
- `main.ts`: `handleImageFile()` wires all three entry points — picker change, editor paste, editor drag-drop — to `saveImageToAssets`, refreshes the file tree, then inserts the markdown at the active tab.

Smoke test 25/25 (editor-only, no renderer change).

### Increment 12: Drag files onto the file tree

Complements increment 11's editor flow: dropping files on the Files panel saves them under their *original* filename (no timestamp rename) — for adding files you'll reference manually by name. Targeting rules:

- Drop on a folder row → that folder.
- Drop on a file row → the file's parent folder.
- Drop on the panel body → `assets/` for images, project root for everything else.

A dashed outline highlights the drop target during the drag. Multiple files can be dropped in one gesture, each saved independently so a per-file error doesn't abort the rest. `file-tree.ts` + `main.ts` + a little CSS. Smoke test 25/25.

### Increment 13: Vim visual-mode highlight + iOS keyboard viewport

Two fixes from testing.

**Selection highlight.** Vim's visual-mode selection was tracked internally but never painted — `cm-selectionBackground` had nothing to attach to. Fix: add CodeMirror's `drawSelection()` to the extension list.

**Keyboard viewport.** When the on-screen keyboard appears (e.g. typing `:` in vim command mode) iOS shrinks the visual viewport; `dvh` alone is unreliable across Safari versions. Added a `visualViewport` resize listener that pins `#app`'s pixel height to `window.visualViewport.height` — a harder guarantee that the toolbar stays on-screen.

Smoke test 25/25.

### Increment 14: App chrome palette aligned with the icon

Cosmetic pass bringing the app's light/dark chrome into line with the icon palette (sky `#B8D6EE` · sand `#F0D5B5` · charcoal `#3a4a52`).

- Light mode: accent navy → charcoal `#3a4a52`; toolbar plain white → sky-blue wash `#daeaf5`; neutral greys → cool blue-tinted variants.
- Dark mode: pure-grey backgrounds → charcoal-blue; accent orange → sky blue `#8fc5df`.
- Editor (CodeMirror): background / gutter / active-line / selection colours updated to match.

`editor.ts` + `styles.css`. Smoke test 25/25.

### Increment 15: slipway-demo seed template replaces imago-workshop

The first-run seed was the real Imago workshop deck — production content tied to a specific project. Replaced with `slipway-demo`, a showcase deck designed to demonstrate every feature the app supports: editor shortcuts and file management, inline formatting and in-slide headings, incremental lists and fragments, two/three-column layouts, syntax-highlighted code and KaTeX math, slide attributes and `{{< include >}}`, citations and the `.bib` workflow.

- `assets/theme.scss` — clean Slipway-palette SCSS (sky/sand/charcoal), a system font stack (works offline, no Google Fonts dependency), blockquote / code / table styling.
- `_snippet.md` — a small include file demonstrating `{{< include >}}`; named `.md` (not `.qmd`) so `listQmds()` doesn't surface it ahead of `slide.qmd` on first launch.
- `seed.ts` simplified — no PNG fetch, all text files inlined via `?raw`.
- `smoke.test.ts`: primary suite retargeted at `slipway-demo`; the imago-workshop deck kept as a secondary suite for PNG-inlining + external-URL assertions.

Smoke test 25/25.

### Increment 16: Insert-image button moved into the Files panel

Small UX correction following increment 11: the "Insert image…" button conceptually belongs with file operations, not document operations. It now sits next to "+ File" / "+ Folder" in the file-tree toolbar, styled to match; the hidden `<input type="file">` is owned by the file tree and `onImageFile` joins `FileTreeCallbacks` so `main.ts` keeps the save/insert logic. Toolbar and `LayoutHandle` shed the now-unused button.

### Increment 17: Presentation UI slide in the demo deck

Content-only addition to `slide.qmd`: a slide documenting the `controls` / `progress` / `slide-number` YAML knobs, noting the hamburger menu plugin isn't built in yet, and listing the always-available reveal.js keyboard shortcuts (`F` / `Esc` / `S` / `?`).

### Increment 18: Slide navigation fix — sandbox storage/history polyfill

Navigation stalled after the last fragment on a slide fired. Root cause: the preview iframe runs `sandbox="allow-scripts allow-popups"` (no `allow-same-origin`), giving it a *null* origin. Accessing `localStorage` / `sessionStorage` or calling `history.replaceState` from a null origin throws `SecurityError`. reveal.js's notes plugin reads `localStorage` on every keydown; the uncaught throw killed the Reveal keyboard handler.

Fix: a small synchronous polyfill (`slipway:sandbox-compat`) injected right after `<body>` opens, before any reveal.js code loads. It detects storage-access failures and swaps in lightweight in-memory `localStorage` / `sessionStorage` fallbacks, and wraps `history.replaceState` / `pushState` in try-catch so null-origin `SecurityError`s are silent. Present mode (blob URL, no sandbox) is unaffected. New smoke assertion: the polyfill must appear before the inlined reveal.js bundle.

### Increment 21: Rendered presentation included in the export zip

`exportZip()` now takes an optional `renderedHtml` string. When the deck has been rendered at least once, the export zip carries a `rendered/index.html` entry alongside the source files — fully self-contained (all assets inlined), opens directly in any browser with no server. The status bar confirms it ("Exported (… + rendered/index.html)"); decks never rendered export source-only as before.

-----

## Phase 3 — Polish & PWA

**Status:** 🚧 in progress
**Goal (per `SPEC.md`):** service worker + offline, web app manifest, PDF export, presenter view, plugin opt-in (Menu / Search / Chalkboard), KaTeX, templates, app icon.

Several Phase 3 deliverables shipped interleaved with Phase 2 work rather than as a separate push, so the increment numbers here are not contiguous — they're a single global sequence across the project. **Shipped:** the service worker + offline precache, the offline-readiness indicator, the SW update prompt, the PWA manifest + app icon, inlined KaTeX, and PDF export. **Outstanding:** the in-app presenter view, per-deck plugin opt-in (Menu / Search / Chalkboard), and bundled templates beyond `slipway-demo`. Increments 25–26 are cross-cutting repo/doc housekeeping that landed during this phase.

### Increment 9: App icon + PWA manifest

Replaces the placeholder data-URI favicon (a generic navy-and-orange "document" mark, the only icon Slipway has ever had) with a designed-for-the-app one, and wires the manifest tags so iOS Add-to-Home-Screen / Android install picks it up properly.

**Design.** Sky-blue background, a shallow sand-toned slipway ramp along the bottom (~18° slope), a charcoal-outlined slide poised on the ramp. Pastel palette `#B8D6EE` / `#F0D5B5` / `#3a4a52`. Two rounds of user review: first picked direction (D — "diagonal split") from four concepts, then picked the sky-and-sand pastel pair from four variants, then picked no-shadow over offset-ghost-shadow / filled-with-drop-shadow alternatives.

**Files.**

- `public/icon.svg` — rounded-corner master (used by browser favicons; the SVG has its own 22%-radius rounding so it looks right in tabs and bookmarks regardless of OS).
- `public/icon-180.png`, `icon-192.png`, `icon-512.png` — square (no corner radius) PNGs for apple-touch-icon and the PWA manifest. iOS rounds the apple-touch-icon automatically; Android applies its adaptive-icon mask; either way our design fits inside the inner ~80% safe zone so no clipping. Generated by `scripts/render-icons.mjs` — a one-shot Playwright-driven renderer that takes a square-bleed variant of the design (kept inline in the script as the single source-of-truth alongside `icon.svg`) and writes PNGs at the three target sizes.
- `public/manifest.webmanifest` — PWA manifest declaring name / short_name / description / display: standalone / start_url / scope, the three icons (192 and 512 with `purpose: "any maskable"`, SVG with `any`), and matching theme/background colours.

**`index.html` updates.** Old data-URI favicon removed. New `<link rel="icon" type="image/svg+xml">`, `<link rel="apple-touch-icon">`, `<link rel="manifest">`. Added `<meta name="theme-color" content="#B8D6EE">` for iOS Safari status-bar tint when the PWA is open — keeps visual continuity with the icon's background.

Total icon + manifest footprint: ~8 KB across five files. Smoke test still 25/25.

### Increment 19: Service worker for full offline support (PWA)

The plane-friendly goal from `SPEC.md`. Uses `vite-plugin-pwa` (Workbox `generateSW` strategy) to precache the entire build output on install — including the ~56 MB `pandoc.wasm` (Workbox's per-file size cap raised to 100 MB so the wasm isn't silently dropped from the precache manifest).

- `vite.config.ts`: `VitePWA` plugin; `manifest: false` keeps the hand-crafted `public/manifest.webmanifest`; `navigateFallback` → `index.html`.
- `main.ts`: `registerSW()` after layout mounts; `onOfflineReady` reports cache completion.
- `vite-env.d.ts`: references `vite-plugin-pwa/client` for the `virtual:pwa-register` types.

First load installs the SW in the background and caches every asset (JS, CSS, WASM, images); subsequent visits — including with no network — serve entirely from cache. Present mode's blob URL is unaffected.

### Increment 20: Offline-readiness indicator in the toolbar

Replaces increment 19's ephemeral "Ready to work offline" status text with a permanent toolbar signal — a plane icon (✈) to the left of the status text. Grey with a red diagonal slash while the SW is installing / still caching; green once all assets (including `pandoc.wasm`) are precached. The `title` attribute carries a one-line explanation. State driven by `registerSW`'s `onOfflineReady` callback.

### Increment 22: Inline KaTeX for offline math

Closes the last hole in the offline story. With `html-math-method=katex`, pandoc emits two `cdn.jsdelivr.net/npm/katex@latest/...` tags — broken offline and floating on `@latest` resolution.

- New `katexInlinePlugin()` in `vite.config.ts` builds a `virtual:katex-inlined` module at build time, exporting `katex.min.js` verbatim and `katex.min.css` with all 20 woff2 fonts replaced by data URIs (so they resolve in the null-origin `srcdoc` iframe); woff/ttf fallback entries stripped since woff2 is universal.
- New `inlineKatexAssets()` in `inline-assets.ts` swaps both CDN tags for inline `<script>` / `<style>` — a third post-pandoc pass in `render.ts`, between reveal.js inlining and theme inlining.

Smoke test: the "no external CDN refs" assertion now covers KaTeX, plus two new assertions check the inlined markers are present and no `url(fonts/KaTeX_*)` strings survive in the rendered HTML.

### Increment 23: Service-worker update notification

Switches `registerType` from `autoUpdate` to `prompt` so a waiting service worker raises `onNeedRefresh` instead of swapping itself silently with no user signal. An amber "↻ Update ready" button appears in the toolbar when an update is waiting; clicking it calls `updateSW(true)` (skipWaiting + reload) and shows "Reloading…" while the reload is in flight. The button is hidden until needed. Independent of the green/grey plane indicator from increment 20 — the two signals (offline ready, update available) are separate.

### Increment 24: Offline indicator fixed on PWA relaunch

`onOfflineReady` only fires the first time the SW installs. On every later page load — including every launch of the installed iPad PWA — the SW already controls the page, the callback never fires, and the plane indicator stayed grey-and-crossed despite the app being fully cached and working offline. Fix: check `navigator.serviceWorker.controller` synchronously at startup; if it's non-null a SW is already in control and the precache is populated, so the indicator goes green immediately. `onOfflineReady` still handles the genuine first-install case.

### Increment 25: Repo cleanup

Housekeeping at a natural stopping point — clearing the deferred list below and catching documentation up to the code.

- **Removed `phase0/`.** The Phase 0 validation prototype was fully superseded by `app/` and the smoke test; it lives on in git history (`7d27dae`, `d9e1cbc`).
- **Relocated the imago-workshop deck** from `app/src/templates/imago-workshop/` to `app/test/fixtures/imago-workshop/`. It stopped being a template when `slipway-demo` became the seed (increment 15) — it is now purely a smoke-test fixture (PNG inlining + external-URL coverage the demo deck doesn't exercise), and `src/templates/` shouldn't imply otherwise. `smoke.test.ts`'s one path constant updated; no app code referenced it (`seed.ts` imports `slipway-demo` explicitly, so the fixture was never bundled into `dist`).
- **Backfilled this log.** Increments 10–24 above were shipped but never written up; reconstructed from commit messages.
- **Refreshed `CLAUDE.md` and the deferred list below** — corrected the layout tree (seed deck is `slipway-demo`; fixture moved) and dropped the now-done items (`phase0/` removal; KaTeX inlining, done in increment 22).

No code or behaviour change beyond the test's fixture path. Smoke test 27/27.

### Increment 26: PHASES.md phase-structure reconciliation

Increment 25 backfilled the increment-by-increment log, but the higher-level structure still lagged: several Phase 3 deliverables (app icon, service worker, offline indicator, KaTeX inlining, SW update prompt) had been logged as increments under the "Phase 2 — Full UX" heading, because that was the only section that existed when they shipped.

This increment splits them out:

- New `## Phase 3 — Polish & PWA` section; increments 9, 19, 20, 22, 23, 24 moved under it. Increment numbers are a single global sequence, so they read non-contiguously within each phase section — that's expected.
- Phase 2's status line changed from a bare "in progress" to "mostly shipped" with an explicit Outstanding note: the three *named* pane modes and the in-app presenter view never shipped (the app has a free Dockview layout instead).
- Phase 3 gets a status line spelling out shipped vs outstanding (PDF export, presenter view, per-deck plugin opt-in and extra templates still to come).
- `[wish-2]` (offline-readiness indicator) ticked off the user-testing backlog — it shipped across increments 19 / 20 / 24.

Documentation-only; no code change.

### Increment 27: iPad keyboard avoidance without reflowing the app

Daily-use friction on the installed iPad PWA: opening the on-screen keyboard — or triggering the vim command line — resized and shoved the whole interface, unlike native apps (e.g. Obsidian).

Root cause was increment 13's own keyboard handling. A `visualViewport` resize listener pinned `#app`'s height to `visualViewport.height`, so the keyboard shrank the entire app: `#app` is a `toolbar / 1fr` grid, so every pane (editor, preview, file tree) reflowed into the smaller box. The listener also ignored `visualViewport.offsetTop`, so when iOS scrolled the visual viewport to lift the caret above the keyboard, `#app` wasn't repositioned and the toolbar rode off the top.

Fix — inset only the focused editor, the way native apps do:

- `main.ts`: the `#app`-resizing listener is gone. `#app` stays `100dvh` (which doesn't shrink for the keyboard), and `html` / `body` are already `position: fixed`, so the toolbar can't scroll away. A small `visualViewport` `resize` + `scroll` listener computes the keyboard overlap (`innerHeight − visualViewport.height − offsetTop`) and writes it to the `--keyboard-inset` CSS variable.
- `styles.css`: `.cm-editor` gets `padding-bottom: var(--keyboard-inset, 0px)` with a 150 ms transition. The focused editor's content — text area and the vim command line, which is a CodeMirror bottom panel inside `.cm-editor` — lifts above the keyboard; the toolbar, preview and file tree don't move. CodeMirror keeps the caret inside the now-shorter scroller itself, so iOS no longer force-scrolls the viewport.

Side effect: the Dockview re-layout jank goes too — `resizeDock` was bound to `window.resize`, which the keyboard doesn't fire, so panels used to go stale-sized mid-reflow. With `#app` no longer resizing there's nothing to re-lay-out.

Editor-only; smoke test unaffected (27/27). Needs verification on a real iPad — keyboard behaviour can't be exercised in the headless sandbox.

### Increment 28: iPad keyboard avoidance — pin #app to the visual viewport

Increment 27 was tested on a real iPad and didn't hold up. The deployment iPad uses a *hardware* keyboard, so the failing case isn't the full on-screen keyboard but the accessory/shortcuts bar iOS shows along the bottom (microphone, language picker). When it appears, iOS shrinks the visual viewport and shifts the layout up by roughly the bar's height — the app keeps its full height but its top, toolbar included, rides off the top of the screen.

Increment 27's fix (inset `.cm-editor` by the keyboard overlap) addressed the wrong thing: it kept the app full-height and only padded the editor, so the whole layout still got shoved up. The wanted behaviour is the opposite — let the app *lose* that height off the bottom and keep the top pinned.

Fix:

- `main.ts`: the `--keyboard-inset` listener is replaced by one that pins `#app` to the visual viewport — `height` tracks `visualViewport.height` (so the lost space comes off the bottom) and a `translate(offsetLeft, offsetTop)` transform re-anchors the top edge to the visible area, undoing the iOS shift. Driven by `visualViewport`'s `resize` + `scroll` events.
- `styles.css`: `#app` becomes `position: fixed` (`top`/`left`/`right: 0`) so the transform has a stable anchor; the `100dvh` height stays as the pre-sync fallback. The increment-27 `.cm-editor` padding rule is reverted.
- `main.ts`: the Dockview re-layout is now driven by a `ResizeObserver` on the pane host instead of the `window` `resize` event — `window` doesn't fire when only `#app`'s inline height changes, so the dock used to go stale-sized whenever the keyboard opened.

Editor/shell-only; smoke test 27/27. Still needs confirming on the iPad.

### Increment 29: Vim on/off toggle + shorter Import/Export labels

Two toolbar tweaks from user testing.

**Vim toggle (closes `wish-1`).** The spec said vim is always-on, but on a phone it's worth switching off. A circled "V" button now sits left of the offline-readiness plane: tinted green when vim is on, muted with a red slash when off — the same visual language as the plane.

- `editor.ts`: the `vim()` extension moves into a CodeMirror `Compartment`, and the editor handle gains `setVim(on)`, which dispatches a `reconfigure` effect — so toggling is live, with no editor rebuild or page reload. A new `EditorOptions.vimEnabled` seeds the initial state.
- `main.ts`: the preference is read from / written to `localStorage` (`slipway:vim`), defaulting on. Toggling updates every open editor tab and the button in one go.
- `layout.ts` / `styles.css`: the `.vim-toggle` button and its on/off styling (a `data-on` attribute drives the colour + slash, mirroring the offline indicator).

**Import / Export labels.** "Import zip…" → "Import" and "Export zip" → "Export"; the ".zip" detail moves to the buttons' `title` tooltips.

Editor/UI-only; smoke test 27/27. The toggle's live behaviour wants a quick check on device.

### Increment 30: Export PDF

A dedicated "Export PDF" button right of Export opens the deck in a new tab with reveal's print layout and triggers Safari's print sheet, where the user picks "Save as PDF" / "Save to Files". Three pieces, matching the investigation in the prior commit:

- **Force `view: "print"` without a URL query.** reveal.js 5.2 paginates a deck for PDF when initialized with `view: "print"` — the `?print-pdf` URL query just sets that option. Our deck runs from a `srcdoc` / blob URL, so `injectPrintView` in `inline-assets.ts` regex-inserts `view: "print",` as the first key inside the deck's `Reveal.initialize({…})` call (a post-pandoc pass like the existing reveal / KaTeX / theme inliners).
- **Inline reveal's print stylesheet.** reveal ships `css/print/pdf.scss` as uncompiled SCSS — there's no `dist/…/pdf.css`. A new `revealPrintCssPlugin` in `vite.config.ts` compiles it once at build (the file is standalone, no `@import` / `@use`) and exposes it via `virtual:reveal-print-css`. `inlinePrintAssets` injects the compiled CSS plus a small auto-print script before the last `</body>` — the script listens for reveal's `pdf-ready` / `ready` events with a 2 s `setTimeout` fallback, then calls `window.print()`.
- **Composer + button.** `core/print.ts` exports `buildPrintVariant(html)` that runs both passes. `layout.ts` adds the `Export PDF` button next to Export (disabled until first render); `main.ts` wires it to open the print variant in a new tab via the same blob-URL mechanism as Present.

Smoke test gains three assertions on `buildPrintVariant`: it injects `view: "print"` (without losing existing options), inlines the print-CSS + auto-print markers, and places both blocks before the last `</body>`. 30 tests now passing.

Tested headlessly only — Safari's print dialog can't be exercised in the sandbox; the actual "Save as PDF" round-trip needs iPad verification.

### Increment 30.1: PDF export — force landscape

Device testing of increment 30 confirmed the suspected iOS Safari quirk: it ignores reveal's runtime `@page { size: WIDTHpx HEIGHTpx }` injection, so slides defaulted to whatever paper the print sheet picked (A4 portrait in practice). The result: each 16:9 slide letterboxed as a small rectangle at the top of a portrait page, overflowing into a second page — a ~22-slide deck rendered as 37 pages.

iOS Safari does honor the `landscape` / `portrait` *keyword*, though. `inlinePrintAssets` now prepends an `@page { size: landscape; margin: 0 }` rule before reveal's print CSS. Landscape A4 (297×210mm) fits a default reveal slide (960×700px) comfortably, so most decks now print one slide per page.

The "blob:…" URL and "Page X of Y" strip across the top of each PDF page is Safari's print-dialog "Show Headers and Footers" option — purely a print-sheet preference, nothing we can suppress from CSS. The PDF button's `title` and the on-click status message both surface that as a one-line tip.

Smoke test gains a new assertion that the `@page { size: landscape … }` rule is present in the print variant. 31 tests now.

### Increment 30.2: PDF export — iPad workaround documented

Increment 30.1's `@page { size: landscape; margin: 0 }` rule turned out to be a no-op on iOS Safari (which ignores `@page` size/orientation entirely), and tapping the print sheet's Landscape button while it was in place produced *worse* output — 74 pages from a 22-slide deck — because reveal's own px-based `@page` rule and ours were getting tangled.

Grepping reveal's bundled source confirmed the URL `?print-pdf` flow and our `view: "print"` config injection land in the same code path: both add the `reveal-print` class and inject the same `@page { size: ${n}px ${r}px; margin: 0 }` rule that iOS Safari then ignores. So neither approach can side-step Safari's quirk. Chrome / Firefox / Brave for iPadOS share the WebKit engine (Apple's App Store rule) so they don't help either.

The user found that **Paper Size = US Letter + Orientation = Landscape** in Safari's print sheet gives an acceptable result — slides fill the page, with a small "blob:…" URL + date strip at the bottom (Safari's "Show Headers and Footers" preference, suppressible there). The PDF button's `title` and the on-click status message now spell out that recipe so the next iPad user doesn't have to discover it.

The fuller fix — bypass reveal's print mode entirely and lay slides out ourselves with viewport-relative CSS, freeing us from the `@page { size }` dance — is deferred to a future increment in case the workaround becomes annoying. UI text only; smoke test still 31/31.

### Increment 31: Tap-to-expand details modal for render warnings

The toolbar's status text shows "(N warnings)" after a render, with the full text in the element's `title` attribute. That's hard to use on iPad — long-press is undiscoverable, the tooltip truncates on small screens, and copying text out of a tooltip isn't really possible.

A render-warnings modal now opens on tap. When the latest render has warnings, the status text picks up `data-has-details="true"`, which styles it as a tappable hint (dotted underline + a "›" chevron + pointer cursor). Tapping pops a centred modal with:

- the warnings in a scrollable `<pre>` block (text-selectable on iPad);
- a **Copy** button that puts the full list on the clipboard (with a manual selection fallback for environments where `navigator.clipboard.writeText` is unavailable);
- × button, click-outside, and Escape all dismiss.

Wiring:

- `layout.ts`: a new `buildDetailsModal()` builds the modal DOM and appends it to `document.body` so it sits above `#app` (which has a transform from the keyboard-avoidance fix) and Dockview's z-indexed chrome. `LayoutHandle` grows `setStatusDetails(details)`; non-empty arrays arm the affordance, empty arrays clear it and hide the modal if it's open.
- `main.ts`: `runRender` calls `setStatusDetails([])` when the render starts and `setStatusDetails(result.warnings)` after it lands, so the chevron tracks the current render's state.

The existing `title`-tooltip path stays (cheap, occasionally useful on desktop hover). Smoke test still 31/31 — no render-pipeline change.

-----

## Repo cleanup (deferred)

Small tidy-ups to land at the next natural stopping point — none are blocking, all are bookkeeping. (`phase0/` removal and KaTeX inlining were cleared — see increments 25 and 22.)

- **Fix Dockview light/dark theme cascade** (the increment 2 cosmetic gap). Drive the dock theme from the same CSS variables as the toolbar instead of `prefers-color-scheme` on the dock host.
- **Migrate `imago.scss` off `darken()`/`lighten()`.** Both are deprecated in Dart Sass; output is correct today but each render emits warnings. The file now lives in `test/fixtures/imago-workshop/` — a frozen test fixture, so low urgency, but the warnings still surface in test output.
- **Clean up `test/` directory naming** if we add more test types (right now it's `smoke.test.ts` plus `fixtures/`; if unit tests grow, organise into `test/unit/` and `test/smoke/`).
- **PHASES.md increment ordering.** Within Phase 2 the increment 5e–8 blocks sit in descending order (8, 7, 6, 5e) rather than ship order, which works against CLAUDE.md's "read bottom-up for most recent" guidance. Increments 10+ are in ascending ship order; reordering that older batch to match is a deferred tidy-up.

-----

## Deployment (continuous)

**Status:** ✓ wired up
**Commits:** `81e2639`
**Workflow:** [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
**URLs:**
- `https://darribas.github.io/slipway/`
- `https://darribas.org/slipway/` (via account-level custom domain)

### How it works

Every push to `main` (and the manual **Run workflow** button) triggers:

1. `cd app && npm ci && npm run build`
2. Upload `app/dist/` as the Pages artifact
3. `actions/deploy-pages@v4` publishes it

Total run time ≈ 1–2 minutes. The deploy job's own `npm run build` step runs `tsc --noEmit` first, so a typecheck regression fails CI before publishing.

### One-time GitHub UI step

`Settings → Pages → Source → "GitHub Actions"`. Without this, the first deploy fails with a clear "Pages not configured for Actions source" error.

### Why Actions, not Pages-from-branch

The deployable files only exist after a Vite build — `app/` itself is TypeScript source. The "Deploy from a branch" Pages mode can only serve pre-built HTML.

### Why no `CNAME` file or per-repo custom domain

`darribas.org` is an account-level verified custom domain, so GitHub Pages automatically serves every repo at `darribas.org/<repo>/` in addition to `darribas.github.io/<repo>/`. Adding a per-repo `CNAME` would try to claim the apex `darribas.org/` itself, conflicting with that setup.

### Why `base: "./"` in `vite.config.ts`

Relative URLs in the built HTML resolve correctly under any subpath, so the build works identically at `darribas.github.io/slipway/` and `darribas.org/slipway/` with no per-host configuration.

### Capacity headroom

Total deployed footprint ~62 MB (58 MB `pandoc.wasm` + 4 MB JS). Pages limits: 100 MB/file, 1 GB/site (we're well under both). Soft bandwidth cap is 100 GB/month — about 1,600 first-time visits before throttling. Hashed asset filenames mean repeat visits hit the browser cache and cost zero bandwidth.
