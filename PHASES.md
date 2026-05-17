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

## Phase 2 — Full UX (in progress)

**Status:** 🚧 in progress
**Goal (per `SPEC.md`):** three pane modes (Write / Review / Present), vim bindings, file tree manager, image insertion flows (paste / picker / drag-drop). Plus, beyond the original spec: tabbed and flexibly resizable panes (VS Code / Jupyter Lab style) as the foundation the pane modes sit on top of.

### Increment 1: Smoke test in CI

The regression net that gates everything else in Phase 2. Before any new UI work touches the renderer's neighbours (preprocessor, sass, asset inlining), the deck has to keep rendering correctly.

- `vitest` added as a devDep; `app/test/smoke.test.ts` drives `src/core/render.ts` directly against the bundled imago workshop template and asserts on the output. Mirrors the spirit of `phase0/smoke.js` but exercises the *current* code path, not the frozen Phase 0 inline copy.
- 9 assertions: end-to-end render produces ≥50KB of HTML with empty stderr; reveal.js + compiled theme.css present; `.dark` / `.columns` / `.hlg` classes survive; footnotes + bibliography in `#refs` + citeproc entries render; local PNGs inlined as data URIs; external Wikimedia URLs left intact; `::: {.incremental}` becomes reveal.js fragments. Two synthetic-mini-deck probes cover features the workshop doesn't exercise: KaTeX assets injection on `$math$`, `::: notes` → `<aside class="notes">`.
- `PandocInstance` interface moved from `core/pandoc.ts` (which has a Vite-only `virtual:pandoc-wasm-url` import) to `core/types.ts` so the test can import it in a node-only context without dragging the Vite virtual module into the test runner. `pandoc-wasm`'s `convert()` is shape-compatible with `PandocInstance.convert` and is used as the renderer's pandoc dependency in tests.
- New `.github/workflows/ci.yml` runs `npm test` + `npm run build` on every PR to main and on manual dispatch.
- The existing `deploy.yml` got a `npm test` step before `npm run build`, so a regression on a direct push to main also fails the deploy before publishing.

Runs in ~9s locally. CI should finish under a minute including the npm cache restore.

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
