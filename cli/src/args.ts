// Command-line surface shared by the Node CLI (cli.ts) and the a-Shell
// adapter (ashell/main.ts). Pure: no Node or host imports.

import pkg from "../package.json";

export const USAGE = `slipway ${pkg.version} — render Quarto-flavoured reveal.js decks, fully offline

Usage:
  slipway render <deck.qmd> [-o <out.html>] [--root <dir>] [--print] [--verbose]
  slipway --version
  slipway --help

Options:
  -o, --output <file>  Where to write the HTML (default: <deck>.html next to the deck)
      --root <dir>     Project root: the folder searched for the theme, bibliography,
                       images, fonts and includes. Default: the nearest ancestor of
                       the deck containing _quarto.yml, else the current directory if
                       the deck is under it, else the deck's folder.
      --print          Write the print variant instead (opens the browser's print
                       dialog, one slide per page — for saving as PDF)
  -v, --verbose        Also show pandoc's informational notes
  -h, --help           Show this help
  -V, --version        Show the version

Exit codes: 0 rendered · 1 pandoc or Sass error · 2 usage error or file not found
`;

export class UsageError extends Error {}

export interface RenderArgs {
  deck: string;
  output?: string;
  root?: string;
  print: boolean;
  verbose: boolean;
}

export function parseRenderArgs(args: string[]): RenderArgs {
  const out: RenderArgs = { deck: "", print: false, verbose: false };
  const positional: string[] = [];
  const value = (flag: string, i: number): string => {
    const v = args[i];
    if (v === undefined) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-o" || arg === "--output") out.output = value(arg, ++i);
    else if (arg.startsWith("--output=")) out.output = arg.slice("--output=".length);
    else if (arg === "--root") out.root = value(arg, ++i);
    else if (arg.startsWith("--root=")) out.root = arg.slice("--root=".length);
    else if (arg === "--print") out.print = true;
    else if (arg === "-v" || arg === "--verbose") out.verbose = true;
    else if (arg === "--") positional.push(...args.slice(i + 1)), (i = args.length);
    else if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length === 0) throw new UsageError("render needs a deck: slipway render <deck.qmd>");
  if (positional.length > 1) throw new UsageError(`render takes one deck, got ${positional.length}`);
  out.deck = positional[0];
  return out;
}
