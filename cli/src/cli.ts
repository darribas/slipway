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
import { UsageError, USAGE, parseRenderArgs } from "./args";
import type { RenderArgs } from "./args";
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
