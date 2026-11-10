// @slipway/core — the renderer shared by every Slipway surface (PWA, VS Code
// extension, CLI). No DOM, no Node built-ins, no fetch, no bundler-specific
// imports: only standard JS, TextEncoder/TextDecoder and (for pandoc)
// WebAssembly.

export { renderDeck } from "./render";
export { buildPrintVariant } from "./print";
export { buildRenderInputs } from "./project";
export type { ProjectFS } from "./project";
export { createPandocInstance } from "./pandoc-core.js";
export { extractDeclarations } from "./frontmatter";
export type { Declarations } from "./frontmatter";
export { resolveDeclaredPath, rebaseChildPath } from "./path-resolve";
export { preprocessDeck } from "./preprocess";
export { compileScss } from "./sass";
export {
  injectRevealConfigOverride,
  injectSandboxCompat,
  inlineFontUrls,
  inlineKatexAssets,
  inlineRevealAssets,
  inlineThemeCss,
} from "./inline-assets";
export { base64Encode } from "./host";
export type { FileMap, PandocInstance, ProjectFile, RenderInputs, RenderResult } from "./types";
