# CLAUDE.md

Bootstrap file. Read this first when starting a new Claude Code session on this
repo. It points at the substantive docs and flags the gotchas that have eaten
time before so they don't have to be rediscovered.

## What Slipway is

A Progressive Web App for authoring Quarto-flavoured reveal.js slide decks
fully locally — including offline — on iPad and desktop. No code execution;
pure document authoring with custom theming. Pipeline: `.qmd` (with YAML
frontmatter) → SCSS compile via Dart Sass → Quarto-style preprocessing →
pandoc-wasm `--to revealjs --standalone --citeproc` → reveal.js HTML →
sandboxed iframe preview. All in-browser.

Since Phase 4 (issue #41) the renderer is a shared package, `core/`
(`@slipway/core`), consumed by the PWA and — as Phase 4 progresses — by a
`slipway` CLI (`cli/`) and a VS Code web extension (`vscode/`). All surfaces
must render the same deck to the same HTML; `core/test/goldens/` guards that.

The deployed app lives at <https://darribas.org/slipway/> (and
<https://darribas.github.io/slipway/>), served via GitHub Pages and built by
`.github/workflows/deploy.yml` on every push to `main`. The same site
carries the extension, unpacked, at `/slipway/vscode/` and the CLI tarball at
`/slipway/cli/` — **permanent addresses, never move them** (VS Code for the
Web re-fetches the extension from its install URL on every launch).

## The two canonical docs

- **`SPEC.md`** — the unchanging design doc. What we're building, what's
  explicitly out of scope, resolved decisions. Read before suggesting any
  architectural change.
- **`PHASES.md`** — the running log of every increment that's shipped, why,
  what was caught, and what's deferred. **Append to this whenever you ship
  an increment.** Has three running lists worth checking before proposing
  new work:
  - the per-phase increment narrative (Phase 0 → present)
  - "User-testing backlog (Phase 2)" — items the user has reported but
    hasn't been worked yet
  - "Repo cleanup (deferred)" — things to clean up at the next stopping
    point (notably: fix the Dockview theme cascade; migrate the
    `imago.scss` render fixture off deprecated Sass functions)

Commit messages also carry substantive context — `git log` is informative.

## Layout

```
SPEC.md, PHASES.md, LICENSE           project-level docs
core/                                  @slipway/core — the shared renderer.
                                       No DOM, no Node built-ins, no fetch,
                                       no bundler-specific imports.
  src/                                 render, sass, preprocess,
                                       inline-assets, frontmatter,
                                       path-resolve, print, host (global
                                       fallbacks), pandoc-core.js (vendored
                                       wasm glue), index.ts (public API)
  src/generated/assets.ts              git-ignored; reveal.js + KaTeX + print
                                       CSS as strings (scripts/gen-assets.mjs)
  test/render.test.ts                  end-to-end render assertions
  test/golden.test.ts, test/goldens/   byte-exact output hashes per deck
  test/fixtures/imago-workshop/        secondary render fixture (test-only)
app/                                   the PWA (Vite project)
  src/                                 TS sources
    pandoc.ts                          PWA's pandoc.wasm loader (fetch +
                                       progress)
    storage/                           IDB-backed storage + project model
    ui/                                editor (CodeMirror 6 + vim), preview,
                                       file tree, Dockview layout
    templates/slipway-demo/            seed deck (also core's main fixture)
  test/app.test.ts                     storage / zip / file-tree tests + a
                                       PWA-vs-core golden check
  scripts/render-icons.mjs             one-shot icon regenerator
  public/                              icon files + manifest.webmanifest
cli/                                   the `slipway` command (Node)
  src/cli.ts                           args, exit codes, render flow
  src/node-fs.ts, src/root.ts          node:fs ProjectFS, project-root rules
  src/bin.ts                           executable entry
  scripts/build.mjs                    esbuild → dist/slipway.mjs, copies
                                       pandoc.wasm next to it
  test/cli.test.ts                     in-process + built-artifact tests
vscode/                                the VS Code web extension
  package.json                         the extension manifest (publisher
                                       darribas; browser + main → dist/)
  src/extension.ts                     activate(): load pandoc, commands
  src/renderer.ts, src/project.ts      pandoc instance + render queue;
                                       workspace.fs ProjectFS, project root
  src/preview.ts, src/webview.ts       webview panels; CSP + reveal bridge
  scripts/build.mjs                    esbuild (browser, cjs) → dist/
  test/                                unit tests + the built bundle driven
                                       through a fake `vscode` (fake-vscode.ts)
  test-web/                            separate package: the bundle inside
                                       real VS Code for the Web (CI only —
                                       needs to download VS Code)
.github/workflows/                     ci.yml (PR gate, also dispatchable on
                                       a branch), deploy.yml (Pages),
                                       release.yml (vscode-v* / cli-v* tags)
.github/scripts/assemble-site.sh       lays out the Pages site
```

There is **no root npm workspace**. Each package has its own `package.json`
and lockfile; consumers depend on core via `"@slipway/core": "file:../core"`
(npm symlinks it) and bundle its TypeScript source themselves. A fresh
checkout therefore needs `npm ci` in `core/` *and* in the package you're
working on.

## Working conventions

- **Develop on the assigned feature branch.** The orchestrator system prompt
  tells you which branch in each session. Never push to `main` directly;
  merge there happens via PR / fast-forward when the user is ready.
- **One increment = one commit.** Small, focused, with a substantive commit
  message. The user has a strong preference for shipping each increment as
  its own merge to `main` rather than batching.
- **Tests must stay green.** `cd core && npm test` (renderer + goldens),
  `cd app && npm test`, `cd cli && npm test` and `cd vscode && npm test`. CI gates merges via `.github/workflows/ci.yml`;
  deploy re-runs the tests before publishing. When you change the renderer,
  add an assertion to `core/test/render.test.ts` that locks the behaviour
  down. If the change intentionally alters rendered HTML, re-record the
  goldens (`cd core && UPDATE_GOLDENS=1 npm test`) in the same commit and
  say why in the commit message.
- **Append to PHASES.md** with an "### Increment N: …" block when shipping.
  Sub-letter the increment (4.1, 5a/b/d, 7a/b) when fixing follow-ups to
  earlier work.
- **No npm commands at the repo root.** The root `.gitignore` blocks a root
  `node_modules/` / `package.json` / `package-lock.json` from being
  committed — this guard exists because shell cwd has reset on us before
  and 23 000 lines of npm garbage ended up in a commit. Run npm only from
  inside a package directory (`core/`, `app/`, and later `cli/`, `vscode/`).

## Gotchas worth saving you time

- **Shell cwd resets between some Bash calls** in this execution environment.
  Use absolute paths, or chain commands with `&&` from `cd app`.
- **Sandbox network policies can block jsdelivr / unpkg.** If you run a
  headless browser screenshot and the rendered deck looks broken, that's
  almost certainly the iframe failing to fetch reveal.js from a CDN — but
  reveal.js + plugins + theme are inlined into the HTML post-pandoc, so the
  real deployment works. Always test screenshots against the bundled build.
- **iOS Safari is the platform of record.** OPFS was tried first and
  abandoned after iPhone Safari testing revealed `getFileHandle({create:true})`
  itself fails opaquely on regular browser tabs. Storage is IDB now. See
  the Phase 1 "Post-release fixes" section of `PHASES.md` for the full
  debugging story before suggesting OPFS again.
- **Reveal.js + theme + KaTeX-config are inlined post-pandoc** in
  `core/src/inline-assets.ts`. Pandoc emits `<link>`/`<script>` pointing at
  unpkg, and the deck wouldn't work offline (and our sandbox can't reach
  the CDN); we rewrite those refs. The deck's `format.revealjs.*` YAML
  options also reach reveal.js via a `Reveal.configure()` override script
  injected after init, because pandoc's template silently drops options
  set to boolean `false`. Don't break the override-script injection — there's
  a regression guard in the smoke test.
- **`npm install` (fresh resolve) can crash** with `Cannot read properties
  of null (reading 'edgesOut')` on npm 10.9 when vitest is in the tree. Use
  `npm install --legacy-peer-deps` to update a lockfile; plain `npm ci`
  from the committed lockfiles is unaffected.
- **Pin anything that affects rendered bytes** (sass, yaml, reveal.js,
  katex, pandoc-wasm) to exact versions in `core/package.json`; bumping
  one changes the goldens.
- **Don't import `.css` / `.scss` with `?raw` in code under test.** Vitest's
  CSS plugin wins over `?raw` and yields an empty string (this hid empty
  reveal stylesheets in the test renders until increment 4.0a).
- **The extension host has no DOM and no Node.** `vscode/` is bundled with
  esbuild `platform: "browser"` and a plugin that fails the build on any
  Node built-in import; all file I/O goes through `vscode.workspace.fs`
  with Uris (never assume `file:`). `vscode/test-web` cannot run in this
  sandbox (VS Code's download hosts are blocked) — run the `CI` workflow
  on the branch (it has `workflow_dispatch`) to exercise it.
- **`pandoc.wasm` is 58 MB.** First load is heavy. The dev plugin in
  `vite.config.ts` serves it through middleware in dev and emits it as a
  hashed asset at build.
- **Vim bindings are always on** (spec). There's a "subtle on/off toggle"
  in the user wishlist in `PHASES.md`.

## How to start working in a new session

1. Read `SPEC.md` — design and scope.
2. Read `PHASES.md` from the bottom up — most recent increments first, then
   the user-testing backlog, then the deferred cleanup list.
3. Skim `git log --oneline -20` to see what's landed lately.
4. Ask the user what they want next; don't assume from the backlog.
