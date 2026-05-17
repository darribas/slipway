// Thin wrappers over the Origin Private File System API.
// All paths are POSIX-style and relative to the OPFS root.

// Lazily-constructed worker that handles createSyncAccessHandle writes
// off the main thread. Safari's sync-access-handle API throws unreliably
// in main-thread contexts (even on 17.4+ where it's officially supported);
// the worker context is the historical and currently-reliable home for it.
let _writeWorker: Worker | null = null;
const _pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

function getWriteWorker(): Worker {
  if (_writeWorker) return _writeWorker;
  _writeWorker = new Worker(new URL("./opfs-worker.ts", import.meta.url), { type: "module" });
  _writeWorker.addEventListener("message", (ev) => {
    const { id, ok, error, stack } = ev.data as {
      id: string;
      ok: boolean;
      error?: string;
      stack?: string;
    };
    const cb = _pending.get(id);
    if (!cb) return;
    _pending.delete(id);
    if (ok) {
      cb.resolve();
    } else {
      const err = new Error(error ?? "worker write failed");
      if (stack) err.stack = stack;
      cb.reject(err);
    }
  });
  _writeWorker.addEventListener("error", (ev) => {
    // Reject all pending writes with the worker error.
    for (const { reject } of _pending.values()) {
      reject(new Error(`opfs worker crashed: ${ev.message}`));
    }
    _pending.clear();
  });
  return _writeWorker;
}

function workerWrite(path: string, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    _pending.set(id, { resolve, reject });
    getWriteWorker().postMessage({ id, op: "write", path, data });
  });
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
  // Own copy in a fresh ArrayBuffer — guarantees a plain ArrayBuffer (some
  // lib.dom types reject ArrayBufferLike unions that could include
  // SharedArrayBuffer) and isolates from caller mutations.
  const data = new Uint8Array(content).slice();
  try {
    // Fast path: main-thread createWritable works on Chromium, Firefox, and
    // Safari 18.4+. Feature-detected via a probe handle to avoid keeping a
    // long-lived handle that could lock the file.
    const probe = await resolveFile(path, { create: true });
    const probeHandle = probe as FileSystemFileHandle & {
      createWritable?: () => Promise<FileSystemWritableFileStream>;
    };
    if (typeof probeHandle.createWritable === "function") {
      const writable = await probeHandle.createWritable();
      await writable.write(data.buffer);
      await writable.close();
      return;
    }
    // Safari fallback: do the write inside a worker via
    // createSyncAccessHandle. Main-thread sync access handle is unreliable
    // on iOS even when the API is technically exposed.
    await workerWrite(path, data);
  } catch (e) {
    // Attach the file path so generic Safari errors ("The operation failed
    // for an unknown transient reason") tell us *which* file blew up.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes(path)) throw e;
    const wrapped = new Error(`${msg} (writing "${path}", ${data.byteLength} bytes)`);
    if (e instanceof Error && e.stack) wrapped.stack = e.stack;
    throw wrapped;
  }
}

/**
 * Probe what the current browser supports. Useful for diagnostics in startup
 * error banners — we want to see at a glance which write API (if any) is
 * available, since "OPFS missing" and "OPFS present but failing" need very
 * different fixes. Errors at each step are reported (rather than swallowed)
 * so we can tell apart "API absent" from "API present but throwing".
 */
export async function probeCapabilities(): Promise<{
  storage: boolean;
  getDirectory: boolean;
  createWritable: boolean | null;
  createSyncAccessHandle: boolean | null;
  persisted: boolean | null;
  probeError: string | null;
}> {
  const out = {
    storage: !!navigator.storage,
    getDirectory: false,
    createWritable: null as boolean | null,
    createSyncAccessHandle: null as boolean | null,
    persisted: null as boolean | null,
    probeError: null as string | null,
  };
  if (!navigator.storage?.getDirectory) return out;
  out.getDirectory = true;
  try {
    out.persisted = await navigator.storage.persisted();
  } catch (e) {
    out.probeError = `persisted: ${msg(e)}`;
  }
  try {
    const r = await navigator.storage.getDirectory();
    const probeName = "capability-probe";
    const handle = await r.getFileHandle(probeName, { create: true });
    const h = handle as FileSystemFileHandle & {
      createWritable?: unknown;
      createSyncAccessHandle?: unknown;
    };
    out.createWritable = typeof h.createWritable === "function";
    out.createSyncAccessHandle = typeof h.createSyncAccessHandle === "function";
    try {
      await r.removeEntry(probeName);
    } catch {
      /* probe cleanup is best-effort */
    }
  } catch (e) {
    out.probeError = (out.probeError ? out.probeError + "; " : "") + `getHandle: ${msg(e)}`;
  }
  return out;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
