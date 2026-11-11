#!/usr/bin/env bash
# Assemble the GitHub Pages site from the three built packages.
#
#   _site/
#     …          app/dist      — the PWA at the root, as always
#     vscode/    the extension, unpacked: package.json, dist/extension.js,
#                dist/pandoc.wasm, README.md, LICENSE, icon.png
#     cli/       slipway-cli-<version>.tgz (+ index.html listing it), and for
#                a-Shell on iPad: slipway-ashell.js + pandoc.wasm
#
# The two sub-paths are permanent addresses: VS Code for the Web re-fetches
# the extension from /vscode/ on every launch, so moving it uninstalls it for
# everyone. Any test channel goes under /vscode/next/.
#
# Expects: app/dist built, vscode/dist built, cli/dist built.
# Usage: .github/scripts/assemble-site.sh [output-dir]   (default: _site)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/_site}"

for required in app/dist/index.html vscode/dist/extension.js vscode/dist/pandoc.wasm cli/dist/slipway.mjs cli/dist/slipway-ashell.js cli/dist/pandoc.wasm; do
  [ -f "$ROOT/$required" ] || { echo "assemble-site: missing $required — build that package first" >&2; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT/vscode/dist" "$OUT/cli"

# 1. The PWA.
cp -R "$ROOT/app/dist/." "$OUT/"

# The PWA must not own these paths.
for reserved in vscode cli; do
  if [ -n "$(ls -A "$ROOT/app/dist/$reserved" 2>/dev/null || true)" ]; then
    echo "assemble-site: app/dist already contains /$reserved" >&2; exit 1
  fi
done

# 2. The extension, exactly the files VS Code loads.
cp "$ROOT/vscode/package.json" "$ROOT/vscode/README.md" "$ROOT/vscode/LICENSE" "$ROOT/vscode/icon.png" "$OUT/vscode/"
cp "$ROOT/vscode/dist/extension.js" "$ROOT/vscode/dist/pandoc.wasm" "$OUT/vscode/dist/"

# 3. The CLI tarball. --ignore-scripts: dist/ is already built.
( cd "$ROOT/cli" && npm pack --ignore-scripts --pack-destination "$OUT/cli" >/dev/null )
TARBALL="$(cd "$OUT/cli" && ls slipway-cli-*.tgz)"
VERSION="$(node -p "require('$ROOT/cli/package.json').version")"
[ "$TARBALL" = "slipway-cli-$VERSION.tgz" ] || { echo "assemble-site: unexpected tarball name $TARBALL" >&2; exit 1; }

# 4. The a-Shell adapter: the script and the wasm it loads from beside itself.
cp "$ROOT/cli/dist/slipway-ashell.js" "$ROOT/cli/dist/pandoc.wasm" "$OUT/cli/"

cat > "$OUT/cli/index.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>slipway CLI</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}code,pre{background:#8881;padding:.1em .3em;border-radius:4px}pre{padding:.8em;overflow:auto}</style>
<h1>slipway CLI</h1>
<p>Render Quarto-flavoured reveal.js decks to one self-contained HTML file, offline. Needs Node.js 20 or newer.</p>
<pre>npm install -g https://darribas.github.io/slipway/cli/$TARBALL</pre>
<p>Current version: <a href="$TARBALL">$TARBALL</a>.
Documentation: <a href="https://github.com/darribas/slipway/tree/main/cli#readme">cli/README.md</a>.</p>
<h2>a-Shell (iPad / iPhone)</h2>
<pre>mkdir -p ~/Documents/bin &amp;&amp; cd ~/Documents/bin
curl -L -O https://darribas.github.io/slipway/cli/slipway-ashell.js
curl -L -O https://darribas.github.io/slipway/cli/pandoc.wasm</pre>
<p>Then <code>jsc ~/Documents/bin/slipway-ashell.js render deck.qmd</code>. The second download is 56 MB.</p>
HTML

echo "assemble-site: $OUT"
( cd "$OUT" && du -sh . vscode cli | sed 's/^/  /' )
