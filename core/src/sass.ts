import * as sass from "sass";

import type { RenderDiagnostic } from "./types";

/**
 * Compile SCSS to CSS. Sass's own messages are captured rather than printed
 * (its default logger writes straight to stderr / the console, which is
 * noise in a CLI and invisible in an editor): pass `diagnostics` to collect
 * them. Deprecation notices are "info" — the output is still correct — and
 * `@warn` messages are "warning". `@debug` output is dropped.
 */
export function compileScss(scssText: string, diagnostics?: RenderDiagnostic[]): string {
  if (!scssText.trim()) return "";
  const result = sass.compileString(scssText, {
    style: "expanded",
    logger: {
      warn(message, options) {
        if (!diagnostics) return;
        const line = options.span ? ` (theme line ${options.span.start.line + 1})` : "";
        if (options.deprecation) {
          const type = options.deprecationType?.id ? ` [${options.deprecationType.id}]` : "";
          diagnostics.push({
            severity: "info",
            message: `Sass deprecation${type}: ${message.split("\n")[0]}${line}`,
          });
        } else {
          diagnostics.push({ severity: "warning", message: `Sass: ${message}${line}` });
        }
      },
      debug() {},
    },
  });
  return result.css;
}
