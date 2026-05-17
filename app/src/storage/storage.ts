// Project storage, backed by IndexedDB.
//
// Originally OPFS, but iOS Safari (tested with 18.7 / Safari 26.4 in a
// regular browser tab) fails opaquely at `getFileHandle({create: true})`
// with a generic "operation failed for an unknown transient reason" — the
// platform appears to deny proper storage to web apps that haven't been
// installed to Home Screen. IDB has none of those constraints: it's been
// reliable on every browser including Safari for over a decade, supports
// binary data via Uint8Array values, and respects navigator.storage.persist().
//
// The public API mirrors the previous OPFS layer (writeText, writeBytes,
// readText, readBytes, exists, remove, clearRoot, listFiles) so the rest
// of the app didn't need to change when this swapped under it.

const DB_NAME = "slipway";
const DB_VERSION = 1;
const STORE = "files";

let _dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    req.onblocked = () => reject(new Error("indexedDB upgrade blocked"));
  });
  return _dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb request failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await getDb();
  const tx = db.transaction(STORE, mode);
  const store = tx.objectStore(STORE);
  try {
    return await fn(store);
  } finally {
    // Wait for transaction to complete on writes; reads don't need it.
    if (mode === "readwrite") {
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("idb transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("idb transaction aborted"));
      });
    }
  }
}

function normalisePath(path: string): string {
  // IDB string keys don't care about slashes; we just keep them so the OPFS-
  // style POSIX paths the rest of the codebase uses round-trip cleanly.
  return path.replace(/^\/+/, "").replace(/\/+/g, "/");
}

export async function writeBytes(path: string, content: Uint8Array): Promise<void> {
  const key = normalisePath(path);
  // Own copy in a fresh ArrayBuffer so the caller can safely reuse the array.
  const data = new Uint8Array(content).slice();
  try {
    await withStore("readwrite", (store) => promisify(store.put(data, key)));
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes(key)) throw e;
    const wrapped = new Error(`${m} (writing "${key}", ${data.byteLength} bytes)`);
    if (e instanceof Error && e.stack) wrapped.stack = e.stack;
    throw wrapped;
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeBytes(path, new TextEncoder().encode(content));
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const key = normalisePath(path);
  const result = await withStore("readonly", (store) => promisify(store.get(key)));
  if (result === undefined) throw new Error(`File not found: ${key}`);
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  throw new Error(`Unexpected stored type for ${key}: ${Object.prototype.toString.call(result)}`);
}

export async function readText(path: string): Promise<string> {
  return new TextDecoder().decode(await readBytes(path));
}

export async function exists(path: string): Promise<boolean> {
  const key = normalisePath(path);
  const found = await withStore("readonly", (store) => promisify(store.getKey(key)));
  return found !== undefined;
}

export async function remove(path: string): Promise<void> {
  const key = normalisePath(path);
  await withStore("readwrite", async (store) => {
    // Treat the path as both an exact key and as a directory prefix so callers
    // can rm-rf a whole subtree if needed. Matches the OPFS removeEntry({recursive:true})
    // behaviour we relied on previously.
    await promisify(store.delete(key));
    const range = IDBKeyRange.bound(key + "/", key + "/￿");
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor(range);
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error("cursor failed"));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
    });
  });
}

export async function clearRoot(): Promise<void> {
  await withStore("readwrite", (store) => promisify(store.clear()));
}

export async function listFiles(prefix = ""): Promise<string[]> {
  const normPrefix = prefix ? normalisePath(prefix) : "";
  const range = normPrefix
    ? IDBKeyRange.bound(normPrefix, normPrefix + "￿")
    : undefined;
  const keys = await withStore("readonly", (store) =>
    promisify(store.getAllKeys(range)),
  );
  return (keys as IDBValidKey[])
    .filter((k): k is string => typeof k === "string")
    .sort();
}

/**
 * Probe what the current browser supports. Runs a real write/read round-trip
 * so the startup error banner can say definitively whether storage works,
 * not just whether the API is present.
 */
export async function probeCapabilities(): Promise<{
  indexedDB: boolean;
  writable: boolean | null;
  persisted: boolean | null;
  probeError: string | null;
}> {
  const out = {
    indexedDB: typeof indexedDB !== "undefined",
    writable: null as boolean | null,
    persisted: null as boolean | null,
    probeError: null as string | null,
  };
  if (!out.indexedDB) return out;
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
  } catch {
    /* persisted() not available; leave null */
  }
  try {
    const probeKey = "__capability_probe__";
    const probeData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await writeBytes(probeKey, probeData);
    const back = await readBytes(probeKey);
    out.writable = back.length === 4 && back[0] === 0xde && back[3] === 0xef;
    await remove(probeKey);
  } catch (e) {
    out.writable = false;
    out.probeError = e instanceof Error ? e.message : String(e);
  }
  return out;
}
