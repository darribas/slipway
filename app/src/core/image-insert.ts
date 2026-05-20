import { writeBytes } from "../storage/storage";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

export function mimeToExt(mimeType: string): string {
  return MIME_TO_EXT[mimeType.toLowerCase().split(";")[0].trim()] ?? "png";
}

export function timestampFilename(mimeType: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}.${mimeToExt(mimeType)}`;
}

/** Save raw image bytes to assets/ and return the stored path. */
export async function saveImageToAssets(bytes: Uint8Array, mimeType: string): Promise<string> {
  const path = `assets/${timestampFilename(mimeType)}`;
  await writeBytes(path, bytes);
  return path;
}

/** Read a File/Blob into a Uint8Array. */
export function readFileBytes(file: File | Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(file);
  });
}
