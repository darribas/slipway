import "./ui/styles.css";

import { mountLayout } from "./ui/layout";
import { createEditor, type EditorHandle } from "./ui/editor";
import { PreviewPane } from "./ui/preview";

import { getPandoc } from "./core/pandoc";
import { renderDeck } from "./core/render";

import { seedIfEmpty } from "./storage/seed";
import {
  buildRenderInputs,
  getActiveQmd,
  listQmds,
  readQmd,
  saveQmd,
  setActiveQmd,
} from "./storage/project";
import { exportZip, importZip } from "./storage/zip";
import { probeCapabilities } from "./storage/opfs";

const AUTOSAVE_MS = 2_000;

async function main(): Promise<void> {
  const layout = mountLayout(document.getElementById("app")!);

  // Request persistent storage so OPFS contents survive eviction. Best-effort:
  // some browsers gate this behind heuristics; ignore the resolved value.
  if (navigator.storage?.persist) {
    void navigator.storage.persist();
  }

  layout.setStatus("Seeding project…");
  let wasSeeded = false;
  try {
    wasSeeded = await seedIfEmpty();
  } catch (e) {
    layout.setStatus(`Seed failed: ${msgOf(e)}`, "error");
    console.error("seed failed:", e);
    throw e;
  }
  if (wasSeeded) layout.setStatus("Seeded with imago workshop template");

  await refreshFileList(layout.fileSelect);
  const initialQmd = layout.fileSelect.value;
  if (!initialQmd) {
    layout.setStatus("No .qmd files in project — import a zip to get started", "warn");
    return;
  }
  setActiveQmd(initialQmd);

  const previewPane = new PreviewPane(layout.previewHost);
  let lastRenderedHtml: string | null = null;

  const editor = createEditor({
    parent: layout.editorHost,
    initialDoc: await readQmd(initialQmd),
    onChange: () => {
      layout.setStale(true);
      scheduleAutosave(editor);
    },
    onSave: () => void manualSave(editor, layout),
    onRender: () => void runRender(),
  });

  // File picker switches the active .qmd, autosaving the outgoing one first.
  layout.fileSelect.addEventListener("change", async () => {
    await flushAutosave(editor);
    const path = layout.fileSelect.value;
    setActiveQmd(path);
    editor.setDoc(await readQmd(path));
    layout.setStale(true);
    layout.setStatus(`Opened ${path}`);
  });

  layout.renderBtn.addEventListener("click", () => void runRender());

  layout.importInput.addEventListener("change", async () => {
    const file = layout.importInput.files?.[0];
    if (!file) return;
    layout.setStatus(`Importing ${file.name}…`);
    try {
      const { filesWritten } = await importZip(file);
      layout.setStatus(`Imported ${filesWritten} files`, "ok");
      await refreshFileList(layout.fileSelect);
      const path = layout.fileSelect.value;
      if (path) {
        setActiveQmd(path);
        editor.setDoc(await readQmd(path));
        layout.setStale(true);
      } else {
        editor.setDoc("");
        layout.setStatus("Imported zip contains no .qmd files", "warn");
      }
    } catch (e) {
      layout.setStatus(`Import failed: ${msgOf(e)}`, "error");
    } finally {
      layout.importInput.value = "";
    }
  });

  layout.exportBtn.addEventListener("click", async () => {
    await flushAutosave(editor);
    layout.setStatus("Exporting…");
    try {
      const blob = await exportZip();
      downloadBlob(blob, suggestedExportName());
      layout.setStatus(`Exported (${(blob.size / 1024).toFixed(0)} KB)`, "ok");
    } catch (e) {
      layout.setStatus(`Export failed: ${msgOf(e)}`, "error");
    }
  });

  layout.presentBtn.addEventListener("click", () => {
    if (lastRenderedHtml) previewPane.openInNewTab(lastRenderedHtml);
  });

  // Kick off pandoc download in the background so the first Render is fast.
  layout.setStatus("Loading pandoc.wasm…");
  void getPandoc((loaded, total) => {
    if (total > 0) {
      layout.setStatus(`pandoc.wasm: ${(loaded / 1_048_576).toFixed(1)} / ${(total / 1_048_576).toFixed(1)} MB`);
    } else {
      layout.setStatus(`pandoc.wasm: ${(loaded / 1_048_576).toFixed(1)} MB`);
    }
  })
    .then(() => layout.setStatus("Ready", "ok"))
    .catch((e) => layout.setStatus(`pandoc load failed: ${msgOf(e)}`, "error"));

  async function runRender(): Promise<void> {
    const path = getActiveQmd();
    if (!path) return;
    await flushAutosave(editor);
    layout.renderBtn.disabled = true;
    layout.setStatus("Rendering…");
    try {
      const pandoc = await getPandoc();
      const inputs = await buildRenderInputs(path);
      const result = await renderDeck(pandoc, inputs);
      previewPane.render(result.html);
      lastRenderedHtml = result.html;
      layout.presentBtn.disabled = false;
      layout.setStale(false);
      const warn = result.warnings.length ? ` (${result.warnings.length} warnings)` : "";
      layout.setStatus(`Rendered in ${Math.round(result.durationMs)}ms${warn}`, "ok");
      // Surface warning details as a tooltip on the status text (long-press
      // on iPad, hover on desktop). Logged to the console too so they're
      // visible in dev tools when needed.
      if (result.warnings.length) {
        layout.status.title = result.warnings.join("\n");
        console.warn("render warnings:\n" + result.warnings.join("\n"));
      } else {
        layout.status.title = "";
      }
      if (result.stderr.trim()) {
        console.warn("render stderr:", result.stderr);
      }
    } catch (e) {
      layout.setStatus(`Render failed: ${msgOf(e)}`, "error");
      console.error(e);
    } finally {
      layout.renderBtn.disabled = false;
    }
  }
}

// ---- Autosave -------------------------------------------------------------

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: Promise<void> | null = null;

function scheduleAutosave(editor: EditorHandle): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    pendingSave = saveActive(editor);
  }, AUTOSAVE_MS);
}

async function flushAutosave(editor: EditorHandle): Promise<void> {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    pendingSave = saveActive(editor);
  }
  if (pendingSave) await pendingSave;
}

async function manualSave(editor: EditorHandle, layout: ReturnType<typeof mountLayout>): Promise<void> {
  await flushAutosave(editor);
  await saveActive(editor);
  layout.setStatus("Saved", "ok");
}

async function saveActive(editor: EditorHandle): Promise<void> {
  const path = getActiveQmd();
  if (!path) return;
  await saveQmd(path, editor.getDoc());
}

// ---- Helpers --------------------------------------------------------------

async function refreshFileList(select: HTMLSelectElement): Promise<void> {
  const paths = await listQmds();
  select.innerHTML = "";
  for (const path of paths) {
    const opt = document.createElement("option");
    opt.value = path;
    opt.textContent = path;
    select.appendChild(opt);
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function suggestedExportName(): string {
  const t = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `slipway-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}.zip`;
}

function msgOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

main().catch(async (e) => {
  console.error("Slipway startup failed:", e);
  await showStartupError(e);
});

async function showStartupError(e: unknown): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  const stack = e instanceof Error && e.stack ? e.stack : "";
  let diag = "";
  try {
    const cap = await probeCapabilities();
    diag =
      `userAgent: ${navigator.userAgent}\n` +
      `storage: ${cap.storage}\n` +
      `getDirectory: ${cap.getDirectory}\n` +
      `createWritable: ${cap.createWritable}\n` +
      `createSyncAccessHandle: ${cap.createSyncAccessHandle}\n` +
      `persisted: ${cap.persisted}\n` +
      `probeError: ${cap.probeError ?? "(none)"}`;
  } catch (probeErr) {
    diag = `(capability probe also failed: ${probeErr instanceof Error ? probeErr.message : String(probeErr)})`;
  }

  // Always render a full-width banner — the toolbar status text gets
  // truncated by ellipsis on narrow viewports (e.g. iPad portrait), which
  // hides the actual message.
  const banner = document.createElement("div");
  banner.className = "slipway-error-banner";
  banner.innerHTML = `
    <div class="head">
      <strong>Slipway failed to start</strong>
      <button class="copy" type="button">Copy details</button>
      <button class="dismiss" type="button" aria-label="Dismiss">×</button>
    </div>
    <p class="msg"></p>
    <details>
      <summary>Diagnostics</summary>
      <pre class="diag"></pre>
      <pre class="stack"></pre>
    </details>`;
  banner.querySelector(".msg")!.textContent = message;
  banner.querySelector(".diag")!.textContent = diag;
  banner.querySelector(".stack")!.textContent = stack;
  banner.querySelector(".dismiss")!.addEventListener("click", () => banner.remove());
  banner.querySelector(".copy")!.addEventListener("click", async () => {
    const text = `Slipway startup failure\n\n${message}\n\n--- diagnostics ---\n${diag}\n\n--- stack ---\n${stack}`;
    try {
      await navigator.clipboard.writeText(text);
      (banner.querySelector(".copy") as HTMLButtonElement).textContent = "Copied";
    } catch {
      // Clipboard API can fail in non-secure contexts or without user gesture.
      // Fall back to selecting the diag block so the user can long-press copy.
      const range = document.createRange();
      range.selectNodeContents(banner.querySelector(".diag")!);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });
  document.body.insertBefore(banner, document.body.firstChild);

  // Also colour-flag the status text if the toolbar managed to mount.
  const status = document.querySelector(".slipway-toolbar .status");
  if (status) {
    status.textContent = "Startup failed (see banner)";
    status.className = "status error";
  }
}
