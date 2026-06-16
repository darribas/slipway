/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "virtual:pandoc-wasm-url" {
  const url: string;
  export default url;
}

declare module "virtual:katex-inlined" {
  export const js: string;
  export const css: string;
}

declare module "virtual:reveal-print-css" {
  const css: string;
  export default css;
}

declare module "virtual:seed-fonts" {
  // Map of project-relative font path → base64-encoded file contents.
  const fonts: Record<string, string>;
  export default fonts;
}
