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

The deployed app lives at <https://darribas.org/slipway/> (and
<https://darribas.github.io/slipway/>), served via GitHub Pages from
`app/dist/`, built by `.github/workflows/deploy.yml` on every push to `main`.

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
app/                                   the Vite project; everything else
                                       lives under here
  src/                                 TS sources
    core/                              renderer (pandoc, sass, preprocess,
                                       inline-assets, frontmatter,
                                       path-resolve, image-insert)
    storage/                           IDB-backed storage + project model
    ui/                                editor (CodeMirror 6 + vim), preview,
                                       file tree, Dockview layout
    templates/slipway-demo/            seed deck
  test/smoke.test.ts                   end-to-end render assertions
  test/fixtures/imago-workshop/        secondary render fixture (test-only)
  scripts/render-icons.mjs             one-shot icon regenerator
  public/                              icon files + manifest.webmanifest
.github/workflows/                     deploy.yml + ci.yml
```

## Working conventions

- **Develop on the assigned feature branch.** The orchestrator system prompt
  tells you which branch in each session. Never push to `main` directly;
  merge there happens via PR / fast-forward when the user is ready.
- **One increment = one commit.** Small, focused, with a substantive commit
  message. The user has a strong preference for shipping each increment as
  its own merge to `main` rather than batching.
- **Smoke test must stay green.** `cd app && npm test`. CI gates merges via
  `.github/workflows/ci.yml`; deploy re-runs the test before publishing.
  When you change the renderer, add an assertion to the smoke test that
  locks the behaviour down.
- **Append to PHASES.md** with an "### Increment N: …" block when shipping.
  Sub-letter the increment (4.1, 5a/b/d, 7a/b) when fixing follow-ups to
  earlier work.
- **No npm commands at the repo root.** The root `.gitignore` blocks
  `node_modules/` / `package.json` / `package-lock.json` from being
  committed — this guard exists because shell cwd has reset on us before
  and 23 000 lines of npm garbage ended up in a commit. Always run npm
  from `app/`.

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
  `core/inline-assets.ts`. Pandoc emits `<link>`/`<script>` pointing at
  unpkg, and the deck wouldn't work offline (and our sandbox can't reach
  the CDN); we rewrite those refs. The deck's `format.revealjs.*` YAML
  options also reach reveal.js via a `Reveal.configure()` override script
  injected after init, because pandoc's template silently drops options
  set to boolean `false`. Don't break the override-script injection — there's
  a regression guard in the smoke test.
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
