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
