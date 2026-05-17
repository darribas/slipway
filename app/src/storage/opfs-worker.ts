/* OPFS write worker.
 *
 * Safari's createSyncAccessHandle is unreliable on the main thread in regular
 * browser tabs (throws "operation failed for an unknown transient reason"
 * even when the API is technically present, leaving OPFS in a stuck state
 * where the next file handle also fails). The original — and still most
 * reliable — context for this API on Safari is a Web Worker.
 *
 * The worker exposes a small postMessage protocol:
 *   { id, op: "write", path, data }   -> { id, ok: true } | { id, ok: false, error, stack }
 *
 * Multiple write strategies are tried inside the worker because some Safari
 * builds reject the {at: 0} options arg and want a positional call instead.
 */

interface WriteMessage {
  id: string;
  op: "write";
  path: string;
  data: Uint8Array;
}

type IncomingMessage = WriteMessage;

interface SyncHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView | ArrayBuffer, options?: { at?: number }): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

self.addEventListener("message", async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  try {
    if (msg.op === "write") {
      await writeFile(msg.path, msg.data);
      (self as unknown as Worker).postMessage({ id: msg.id, ok: true });
      return;
    }
    throw new Error(`unknown op: ${(msg as { op: string }).op}`);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
});

async function writeFile(path: string, data: Uint8Array): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const segments = path.split("/").filter(Boolean);
  const name = segments.pop();
  if (!name) throw new Error(`invalid path: ${path}`);

  let dir = root;
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const handle = await dir.getFileHandle(name, { create: true });
  const h = handle as FileSystemFileHandle & {
    createSyncAccessHandle: () => Promise<SyncHandle>;
  };
  if (typeof h.createSyncAccessHandle !== "function") {
    throw new Error("createSyncAccessHandle missing in worker context");
  }
  const sync = await h.createSyncAccessHandle();

  // Try several write-call shapes — Safari has been picky historically
  // (sometimes rejects the {at} options object; sometimes wants a positional
  // call). Whichever first writes exactly data.byteLength bytes wins.
  const attempts: Array<{ name: string; call: () => number }> = [
    { name: "view+at0", call: () => sync.write(data, { at: 0 }) },
    { name: "view", call: () => sync.write(data) },
    { name: "buffer+at0", call: () => sync.write(data.buffer as ArrayBuffer, { at: 0 }) },
  ];

  let lastError: Error | null = null;
  const tried: string[] = [];
  try {
    for (const { name: strat, call } of attempts) {
      tried.push(strat);
      try {
        const written = call();
        if (written === data.byteLength) {
          sync.truncate(data.byteLength);
          sync.flush();
          return;
        }
        lastError = new Error(`short write: ${written}/${data.byteLength} bytes (strategy ${strat})`);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw new Error(
      `all sync write strategies failed [tried: ${tried.join(", ")}]: ${lastError?.message ?? "unknown"}`,
    );
  } finally {
    sync.close();
  }
}

// Module worker requires a default export presence to be treated as a module
// by Vite's worker plugin in some configurations.
export {};
