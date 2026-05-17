// Thin wrappers over the Origin Private File System API.
// All paths are POSIX-style and relative to the OPFS root.

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
  const handle = await resolveFile(path, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function writeBytes(path: string, content: Uint8Array): Promise<void> {
  const handle = await resolveFile(path, { create: true });
  const writable = await handle.createWritable();
  // Slice to guarantee a plain ArrayBuffer (some lib.dom types reject
  // ArrayBufferLike unions that could include SharedArrayBuffer).
  await writable.write(new Uint8Array(content).slice().buffer);
  await writable.close();
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
