// Thin wrappers over the Origin Private File System API.
// All paths are POSIX-style and relative to the OPFS root.

// Local declaration — lib.dom in this TS version doesn't expose
// FileSystemSyncAccessHandle as a named global. We feature-detect it at
// runtime for the Safari fallback path.
interface SyncAccessHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

export async function root(): Promise<FileSystemDirectoryHandle> {
  return await navigator.storage.getDirectory();
}

async function resolveDir(
  path: string,
  { create = false } = {},
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split("/").filter(Boolean);
  let dir = await root();
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create });
  }
  return dir;
}

async function resolveFile(
  path: string,
  { create = false } = {},
): Promise<FileSystemFileHandle> {
  const segments = path.split("/").filter(Boolean);
  const name = segments.pop();
  if (!name) throw new Error(`Invalid path: ${path}`);
  const dir = await resolveDir(segments.join("/"), { create });
  return await dir.getFileHandle(name, { create });
}

export async function readText(path: string): Promise<string> {
  const handle = await resolveFile(path);
  const file = await handle.getFile();
  return await file.text();
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const handle = await resolveFile(path);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function exists(path: string): Promise<boolean> {
  try {
    await resolveFile(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeBytes(path, new TextEncoder().encode(content));
}

export async function writeBytes(path: string, content: Uint8Array): Promise<void> {
  const handle = await resolveFile(path, { create: true });
  // Own copy in a fresh ArrayBuffer — guarantees a plain ArrayBuffer (some
  // lib.dom types reject ArrayBufferLike unions that could include
  // SharedArrayBuffer) and isolates from caller mutations.
  const data = new Uint8Array(content).slice();

  // Prefer createWritable (async, supported by Chromium, Firefox, and Safari
  // 18.4+). Fall back to createSyncAccessHandle (supported on Safari main
  // thread since 17.4) for older Safari. createSyncAccessHandle's underlying
  // calls are synchronous but only blocking for the duration of these few
  // small writes — fine for the main thread.
  const h = handle as FileSystemFileHandle & {
    createWritable?: () => Promise<FileSystemWritableFileStream>;
    createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
  };
  if (typeof h.createWritable === "function") {
    const writable = await h.createWritable();
    await writable.write(data.buffer);
    await writable.close();
    return;
  }
  if (typeof h.createSyncAccessHandle === "function") {
    const sync = await h.createSyncAccessHandle();
    try {
      sync.truncate(0);
      sync.write(data, { at: 0 });
      sync.flush();
    } finally {
      sync.close();
    }
    return;
  }
  throw new Error(
    "Browser doesn't support OPFS file writes (needs Safari 17.4+, " +
      "Chromium 86+, or Firefox 111+).",
  );
}

export async function remove(path: string): Promise<void> {
  const segments = path.split("/").filter(Boolean);
  const name = segments.pop();
  if (!name) return;
  const dir = await resolveDir(segments.join("/"));
  await dir.removeEntry(name, { recursive: true });
}

export async function clearRoot(): Promise<void> {
  const r = await root();
  for await (const [name] of (r as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    await r.removeEntry(name, { recursive: true });
  }
}

/**
 * Recursively list every file in OPFS under `prefix` (default: root).
 * Returns POSIX paths relative to root.
 */
export async function listFiles(prefix = ""): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: FileSystemDirectoryHandle, path: string): Promise<void> {
    for await (const [name, handle] of (dir as unknown as {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    }).entries()) {
      const here = path ? `${path}/${name}` : name;
      if (handle.kind === "directory") {
        await walk(handle as FileSystemDirectoryHandle, here);
      } else {
        out.push(here);
      }
    }
  }
  const start = prefix ? await resolveDir(prefix) : await root();
  await walk(start, prefix);
  return out.sort();
}
