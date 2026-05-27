// Build a print-variant of a rendered deck for "Export PDF".
//
// The deck runs from a srcdoc/blob with no URL, so we can't trigger reveal's
// PDF layout via the conventional ?print-pdf query. Instead we inject
// `view: "print"` into the deck's Reveal.initialize call (the config that
// query would have set) and inline reveal's print stylesheet (which ships
// only as SCSS, compiled at build by revealPrintCssPlugin). A small auto-
// print script then opens Safari's print sheet on load — see
// inlinePrintAssets in ./inline-assets.

import printCss from "virtual:reveal-print-css";
import { injectPrintView, inlinePrintAssets } from "./inline-assets";

export function buildPrintVariant(html: string): string {
  return inlinePrintAssets(injectPrintView(html), printCss);
}
