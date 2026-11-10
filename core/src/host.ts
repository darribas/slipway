// The few host globals core touches that are not guaranteed everywhere it
// runs (browser main thread, Web Worker extension host, Node, a-Shell's
// JavaScriptCore). Everything goes through `globalThis` lookups so core
// type-checks without the DOM lib and degrades gracefully at runtime.

const g = globalThis as {
  performance?: { now?: () => number };
  btoa?: (binary: string) => string;
};

/** Monotonic-ish milliseconds: performance.now() where present, else Date.now(). */
export function now(): number {
  return typeof g.performance?.now === "function" ? g.performance.now() : Date.now();
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Pure-JS base64 encoder (RFC 4648, padded). Exported for tests. */
export function base64EncodePure(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    if (chunk.length >= 0x8000) {
      parts.push(chunk);
      chunk = "";
    }
  }
  if (i < len) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    chunk += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    chunk += i + 1 < len ? B64[(b & 15) << 2] + "=" : "==";
  }
  parts.push(chunk);
  return parts.join("");
}

/** Base64-encode bytes with the host's btoa when it has one, else in pure JS. */
export function base64Encode(bytes: Uint8Array): string {
  if (typeof g.btoa !== "function") return base64EncodePure(bytes);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return g.btoa(bin);
}
