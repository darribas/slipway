#!/bin/sh
# Start a Slipway deck folder: a bundled theme with its fonts, a starter deck
# and (where there is one) the theme's showcase deck to crib from.
#
#   curl -L -O https://darribas.github.io/slipway/cli/new-deck.sh
#   sh new-deck.sh mytalk                 # Travelogue (the default)
#   sh new-deck.sh mytalk imago           # or: imago, journal
#
# Then: cd mytalk && slipway render deck.qmd
#
# Plain POSIX sh with no loops over arrays or other bashisms, so it runs under
# a-Shell's dash on iPad as well as any desktop shell. Files come from the
# repository's main branch; set SLIPWAY_BASE to fetch from somewhere else
# (the tests point it at a local checkout with a file:// URL).
#
# The font lists below must match themes/<name>/ — cli/test/new-deck.test.ts
# checks that they do.

set -e

NAME="${1:-}"
THEME="${2:-travelogue}"
BASE="${SLIPWAY_BASE:-https://raw.githubusercontent.com/darribas/slipway/main}"
DEMO="app/src/templates/slipway-demo"

usage() {
  echo "usage: sh new-deck.sh <folder> [travelogue|imago|journal]"
}

if [ -z "$NAME" ] || [ "$NAME" = "-h" ] || [ "$NAME" = "--help" ]; then
  usage
  exit 1
fi

case "$THEME" in
  travelogue)
    FONTS="fonts/fraunces/OFL.txt
fonts/fraunces/fraunces-latin-full-normal.woff2
fonts/fraunces/fraunces-latin-full-italic.woff2
fonts/courier-prime/OFL.txt
fonts/courier-prime/courier-prime-latin-400-normal.woff2
fonts/courier-prime/courier-prime-latin-400-italic.woff2
fonts/courier-prime/courier-prime-latin-700-normal.woff2
fonts/courier-prime/courier-prime-latin-700-italic.woff2"
    SHOWCASE="travelogue-showcase.qmd"
    EXTRAS="travelogue-plate.svg"
    BIB=""
    ;;
  imago)
    FONTS="fonts/figtree/OFL.txt
fonts/figtree/figtree-latin-wght-normal.woff2
fonts/figtree/figtree-latin-wght-italic.woff2
fonts/figtree/figtree-latin-ext-wght-normal.woff2
fonts/figtree/figtree-latin-ext-wght-italic.woff2"
    SHOWCASE="imago-showcase.qmd"
    EXTRAS=""
    BIB="yes"   # the showcase cites references.bib
    ;;
  journal)
    FONTS="fonts/et-book/LICENSE.txt
fonts/et-book/et-book-roman-line-figures/et-book-roman-line-figures.woff
fonts/et-book/et-book-display-italic-old-style-figures/et-book-display-italic-old-style-figures.woff
fonts/et-book/et-book-bold-line-figures/et-book-bold-line-figures.woff
fonts/et-book/et-book-roman-old-style-figures/et-book-roman-old-style-figures.woff"
    SHOWCASE=""
    EXTRAS=""
    BIB=""
    ;;
  *)
    echo "new-deck: unknown theme '$THEME' (choose travelogue, imago or journal)"
    exit 1
    ;;
esac

if [ -e "$NAME" ]; then
  echo "new-deck: '$NAME' already exists — pick another name"
  exit 1
fi

# get <url> <path inside the new folder>
get() {
  mkdir -p "$NAME/$(dirname "$2")"
  if ! curl -sfL -o "$NAME/$2" "$1"; then
    echo "new-deck: could not download $1"
    exit 1
  fi
}

echo "Setting up '$NAME' with the $THEME theme…"
mkdir -p "$NAME/assets"

get "$BASE/themes/$THEME/$THEME.scss" "assets/$THEME.scss"
for f in $FONTS; do
  get "$BASE/themes/$THEME/$f" "assets/$f"
done
for f in $EXTRAS; do
  get "$BASE/$DEMO/assets/$f" "assets/$f"
done
if [ -n "$BIB" ]; then
  get "$BASE/$DEMO/references.bib" "assets/references.bib"
fi
if [ -n "$SHOWCASE" ]; then
  # The showcase lives in demos/ upstream and says ../assets/…; here it sits
  # next to assets/, so drop the ../ (the renderer would cope, but this way
  # the paths are simply right).
  get "$BASE/$DEMO/demos/$SHOWCASE" "showcase.tmp"
  sed 's#\.\./assets/#assets/#g' "$NAME/showcase.tmp" > "$NAME/showcase.qmd"
  rm "$NAME/showcase.tmp"
fi

cat > "$NAME/deck.qmd" <<EOF
---
title: "Title"
subtitle: "Subtitle"
author: "Your Name"
date: "Date"
lang: en
format:
  revealjs:
    theme: assets/$THEME.scss
    center: false
    slide-number: true
    transition: none
    navigation-mode: linear
---

## First slide

- a point
- another point

## Second slide

Put images in assets/ (or a folder inside it) and use them with
\`![a caption](assets/my-image.jpg)\`.
EOF

echo "Done. Next:"
echo "  cd $NAME"
echo "  slipway render deck.qmd      (or: jsc ~/Documents/bin/slipway-ashell.js render deck.qmd)"
if [ -n "$SHOWCASE" ]; then
  echo "showcase.qmd shows everything the theme can do."
fi
