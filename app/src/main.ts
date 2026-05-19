import "dockview-core/dist/styles/dockview.css";
import "./ui/styles.css";

import { DockviewComponent, type IContentRenderer } from "dockview-core";

import { mountLayout } from "./ui/layout";
import { createEditor, type EditorHandle } from "./ui/editor";
import { PreviewPane } from "./ui/preview";
import { createFileTree } from "./ui/file-tree";

import { getPandoc } from "./core/pandoc";
import { renderDeck } from "./core/render";

import { seedIfEmpty } from "./storage/seed";
import {
  buildRenderInputs,
  getActiveEditor,
  getActiveQmd,
  isTextFile,
  listQmds,
  readFile,
  saveFile,
  setActiveEditor,
  setActiveQmd,
} from "./storage/project";
import { exportZip, importZip } from "./storage/zip";
import {
  exists,
  listFiles,
  probeCapabilities,
  remove,
  rename,
  writeText,
} from "./storage/storage";

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

  const initialQmds = await listQmds();
  const initialQmd: string | null = initialQmds[0] ?? null;
  if (!initialQmd) {
    layout.setStatus("No .qmd files in project — import a zip or create one", "warn");
  } else {
    setActiveQmd(initialQmd);
    setActiveEditor(initialQmd);
  }

  // Build the editor, preview, and file-tree into their own DOM containers,
  // then hand each one to Dockview as panel content. Dockview moves these
  // around during dock/tab/split operations; CodeMirror, the iframe, and the
  // tree all handle resulting size changes.
  const editorContainer = document.createElement("div");
  editorContainer.style.cssText = "height:100%;width:100%;display:flex;flex-direction:column;min-height:0";
  const previewContainer = document.createElement("div");
  previewContainer.style.cssText = "height:100%;width:100%;position:relative";
  const filesContainer = document.createElement("div");
  filesContainer.style.cssText = "height:100%;width:100%";

  const previewPane = new PreviewPane(previewContainer);
  let lastRenderedHtml: string | null = null;

  const editor = createEditor({
    parent: editorContainer,
    initialDoc: initialQmd ? await readFile(initialQmd) : "",
    onChange: () => {
      layout.setStale(true);
      scheduleAutosave(editor);
    },
    onSave: () => void manualSave(editor, layout),
    onRender: () => void runRender(),
  });

  const containerRenderers: Record<string, IContentRenderer> = {
    files: { element: filesContainer, init: () => {} },
    editor: { element: editorContainer, init: () => {} },
    preview: { element: previewContainer, init: () => {} },
  };
  const dock = new DockviewComponent(layout.paneHost, {
    createComponent: (options) => {
      const renderer = containerRenderers[options.name];
      if (!renderer) throw new Error(`unknown dock component: ${options.name}`);
      return renderer;
    },
  });
  const filesPanel = dock.addPanel({
    id: "files",
    component: "files",
    title: "Files",
  });
  const editorPanel = dock.addPanel({
    id: "editor",
    component: "editor",
    title: initialQmd ?? "(no file)",
    position: { referencePanel: "files", direction: "right" },
  });
  dock.addPanel({
    id: "preview",
    component: "preview",
    title: "Preview",
    position: { referencePanel: "editor", direction: "right" },
  });
  filesPanel.api.setSize({ width: 220 });
  const resizeDock = () => dock.layout(layout.paneHost.clientWidth, layout.paneHost.clientHeight);
  resizeDock();
  window.addEventListener("resize", resizeDock);

  const fileTree = createFileTree(filesContainer, {
    onOpen: (path) => void openFile(path),
    onRename: async (oldPath, newPath) => {
      try {
        await flushAutosave(editor);
        await rename(oldPath, newPath);
        if (getActiveEditor() === oldPath) {
          setActiveEditor(newPath);
          editorPanel.api.setTitle(newPath);
        }
        if (getActiveQmd() === oldPath) setActiveQmd(newPath);
        await refreshTree();
        layout.setStatus(`Renamed → ${newPath}`, "ok");
      } catch (e) {
        layout.setStatus(`Rename failed: ${msgOf(e)}`, "error");
      }
    },
    onDelete: async (path) => {
      try {
        await remove(path);
        const editorWasActive = getActiveEditor() === path;
        const qmdWasActive = getActiveQmd() === path;
        if (qmdWasActive) {
          const remainingQmds = (await listQmds()).filter((p) => p !== path);
          setActiveQmd(remainingQmds[0] ?? null);
        }
        if (editorWasActive) {
          const fallback = getActiveQmd();
          if (fallback) {
            editor.setDoc(await readFile(fallback));
            setActiveEditor(fallback);
            editorPanel.api.setTitle(fallback);
          } else {
            setActiveEditor(null);
            editor.setDoc("");
            editorPanel.api.setTitle("(no file)");
          }
        }
        await refreshTree();
        layout.setStatus(`Deleted ${path}`, "ok");
      } catch (e) {
        layout.setStatus(`Delete failed: ${msgOf(e)}`, "error");
      }
    },
    onCreateFile: async (parentDir, name) => {
      const path = joinPath(parentDir, name);
      try {
        if (await exists(path)) {
          layout.setStatus(`File already exists: ${path}`, "warn");
          return;
        }
        await writeText(path, "");
        await refreshTree();
        // Open the new file in the editor if it looks like text the user
        // probably wants to start typing into. Stays unopened for binary.
        if (isTextFile(path)) await openFile(path);
        layout.setStatus(`Created ${path}`, "ok");
      } catch (e) {
        layout.setStatus(`Create failed: ${msgOf(e)}`, "error");
      }
    },
    onCreateFolder: async (parentDir, name) => {
      // IDB has no real directories — we model them with a .placeholder file
      // so the tree can render an empty folder. The placeholder is filtered
      // out of the displayed list.
      const placeholder = `${joinPath(parentDir, name)}/.placeholder`;
      try {
        await writeText(placeholder, "");
        await refreshTree();
        layout.setStatus(`Created folder ${joinPath(parentDir, name)}`, "ok");
      } catch (e) {
        layout.setStatus(`Create folder failed: ${msgOf(e)}`, "error");
      }
    },
  });

  async function openFile(path: string): Promise<void> {
    if (!isTextFile(path)) {
      layout.setStatus(`${path} isn't a text file — open skipped`, "warn");
      return;
    }
    await flushAutosave(editor);
    editor.setDoc(await readFile(path));
    setActiveEditor(path);
    // Only .qmd files become the deck target. Editing other files (theme,
    // bib, etc.) leaves the previous active deck in place so Render still
    // works as expected.
    if (path.toLowerCase().endsWith(".qmd")) {
      setActiveQmd(path);
      layout.setStale(true);
    }
    editorPanel.api.setTitle(path);
    fileTree.setActive(path);
    layout.setStatus(`Opened ${path}`);
  }

  async function refreshTree(): Promise<void> {
    const all = await listFiles();
    fileTree.refresh(
      all.filter((p) => {
        // Hide dot-prefixed filenames (.seeded marker, .placeholder folder
        // stubs, .DS_Store leftovers from zip imports).
        const segments = p.split("/");
        return !segments[segments.length - 1].startsWith(".");
      }),
    );
    fileTree.setActive(getActiveEditor());
  }

  await refreshTree();

  layout.renderBtn.addEventListener("click", () => void runRender());

  layout.importInput.addEventListener("change", async () => {
    const file = layout.importInput.files?.[0];
    if (!file) return;
    layout.setStatus(`Importing ${file.name}…`);
    try {
      const { filesWritten } = await importZip(file);
      layout.setStatus(`Imported ${filesWritten} files`, "ok");
      const qmds = await listQmds();
      if (qmds[0]) {
        await openFile(qmds[0]);
      } else {
        setActiveQmd(null);
        editor.setDoc("");
        editorPanel.api.setTitle("(no file)");
        layout.setStatus("Imported zip contains no .qmd files", "warn");
      }
      await refreshTree();
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
  const path = getActiveEditor();
  if (!path) return;
  await saveFile(path, editor.getDoc());
}

// ---- Helpers --------------------------------------------------------------

function joinPath(parentDir: string, name: string): string {
  const safeName = name.replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!parentDir) return safeName;
  return `${parentDir.replace(/\/+$/, "")}/${safeName}`;
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
      `indexedDB: ${cap.indexedDB}\n` +
      `writable: ${cap.writable}\n` +
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
