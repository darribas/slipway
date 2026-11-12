// Base64 → bytes, for what jsc.readFileBase64 returns. Hand-rolled rather
// than atob(): atob would build a second, binary string of the whole file
// before it could be copied into a typed array — for the 58 MB pandoc.wasm
// that is memory the web view may not have to spare.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < 64; i++) LOOKUP[B64.charCodeAt(i)] = i;

export function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && b64.charCodeAt(len - 1) === 61) len--; // strip '='
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const n = (LOOKUP[b64.charCodeAt(i)] << 18) | (LOOKUP[b64.charCodeAt(i + 1)] << 12) |
      (LOOKUP[b64.charCodeAt(i + 2)] << 6) | LOOKUP[b64.charCodeAt(i + 3)];
    out[o++] = n >> 16; out[o++] = (n >> 8) & 255; out[o++] = n & 255;
  }
  if (len - i === 2) {
    out[o++] = ((LOOKUP[b64.charCodeAt(i)] << 18) | (LOOKUP[b64.charCodeAt(i + 1)] << 12)) >> 16;
  } else if (len - i === 3) {
    const n = (LOOKUP[b64.charCodeAt(i)] << 18) | (LOOKUP[b64.charCodeAt(i + 1)] << 12) | (LOOKUP[b64.charCodeAt(i + 2)] << 6);
    out[o++] = n >> 16; out[o++] = (n >> 8) & 255;
  }
  return out;
}
