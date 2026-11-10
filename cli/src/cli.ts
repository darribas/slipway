// The `slipway` command. Everything here is a plain function of
// (argv, environment) → exit code so tests can call it in-process; bin.ts is
// the thin executable wrapper.

import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import {
  buildPrintVariant,
  buildRenderInputs,
  createPandocInstance,
  finalizeRender,
  prepareRender,
} from "@slipway/core";

import pkg from "../package.json";
import { nodeProjectFS } from "./node-fs";
import { findProjectRoot, isInside, toProjectPath } from "./root";

export const EXIT_OK = 0;
export const EXIT_RENDER_ERROR = 1; // pandoc or Sass failed
export const EXIT_USAGE = 2; // bad arguments, or a file that isn't there

export interface CliEnv {
  cwd: string;
  /** Absolute path of pandoc.wasm. */
  wasmPath: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `slipway ${pkg.version} — render Quarto-flavoured reveal.js decks, fully offline

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

class UsageError extends Error {}

interface RenderArgs {
  deck: string;
  output?: string;
  root?: string;
  print: boolean;
  verbose: boolean;
}

function parseRenderArgs(args: string[]): RenderArgs {
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

async function render(args: RenderArgs, env: CliEnv): Promise<number> {
  const deckAbs = resolve(env.cwd, args.deck);
  if (!existsSync(deckAbs) || !statSync(deckAbs).isFile()) {
    throw new UsageError(`deck not found: ${args.deck}`);
  }
  const root = findProjectRoot(deckAbs, env.cwd, args.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new UsageError(`project root is not a directory: ${args.root ?? root}`);
  }
  if (!isInside(root, deckAbs)) {
    throw new UsageError(`the deck is not inside the project root (${root})`);
  }
  const outAbs = args.output
    ? resolve(env.cwd, args.output)
    : join(dirname(deckAbs), basename(deckAbs, extname(deckAbs)) + ".html");

  const inputs = await buildRenderInputs(toProjectPath(root, deckAbs), nodeProjectFS(root));

  // Sass errors surface here; pandoc errors below. Both are render errors.
  let html: string;
  try {
    const job = prepareRender(inputs);
    const pandoc = await createPandocInstance(await readFile(env.wasmPath));
    const result = finalizeRender(job, await pandoc.convert(job.options, job.stdin, job.files));
    for (const d of result.diagnostics) {
      if (d.severity === "warning") env.stderr(`warning: ${d.message}\n`);
      else if (args.verbose) env.stderr(`info: ${d.message}\n`);
    }
    if (result.stderr.trim()) env.stderr(result.stderr.trimEnd() + "\n");
    if (!result.ok) {
      if (!result.stderr.trim()) env.stderr("error: pandoc produced no output\n");
      return EXIT_RENDER_ERROR;
    }
    html = args.print ? buildPrintVariant(result.html) : result.html;
  } catch (err) {
    env.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_RENDER_ERROR;
  }

  await writeFile(outAbs, html, "utf8");
  const shown = isInside(env.cwd, outAbs) ? relative(env.cwd, outAbs) : outAbs;
  env.stdout(`Output created: ${shown}\n`);
  return EXIT_OK;
}

export async function main(argv: string[], env: CliEnv): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === "-h" || command === "--help" || command === "help") {
      env.stdout(USAGE);
      return command === undefined ? EXIT_USAGE : EXIT_OK;
    }
    if (command === "-V" || command === "--version") {
      env.stdout(`${pkg.version}\n`);
      return EXIT_OK;
    }
    if (command === "render") {
      if (rest.includes("-h") || rest.includes("--help")) {
        env.stdout(USAGE);
        return EXIT_OK;
      }
      return await render(parseRenderArgs(rest), env);
    }
    throw new UsageError(`unknown command: ${command}`);
  } catch (err) {
    if (err instanceof UsageError) {
      env.stderr(`slipway: ${err.message}\nTry 'slipway --help'.\n`);
      return EXIT_USAGE;
    }
    throw err;
  }
}
