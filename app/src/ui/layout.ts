// Constructs the toolbar + split-pane DOM and exposes hooks for main.ts to wire
// up. The split pane supports horizontal dragging; on narrow viewports it
// stacks vertically and drags vertically.

export interface LayoutHandle {
  toolbar: HTMLElement;
  editorHost: HTMLElement;
  previewHost: HTMLElement;
  fileSelect: HTMLSelectElement;
  renderBtn: HTMLButtonElement;
  importInput: HTMLInputElement;
  exportBtn: HTMLButtonElement;
  presentBtn: HTMLButtonElement;
  status: HTMLSpanElement;
  setStale: (stale: boolean) => void;
  setStatus: (text: string, kind?: "info" | "warn" | "error" | "ok") => void;
}

export function mountLayout(root: HTMLElement): LayoutHandle {
  root.innerHTML = "";

  const toolbar = el("header", "slipway-toolbar");
  const title = el("h1");
  title.innerHTML = `Slipway <small>· Quarto reveal.js authoring</small>`;
  toolbar.appendChild(title);

  const fileSelect = el("select") as HTMLSelectElement;
  fileSelect.title = "Active .qmd file";
  toolbar.appendChild(fileSelect);

  const renderBtn = el("button", "primary") as HTMLButtonElement;
  renderBtn.textContent = "Render";
  renderBtn.title = "Render the current deck (⌘R / Ctrl+R)";
  toolbar.appendChild(renderBtn);

  const presentBtn = el("button") as HTMLButtonElement;
  presentBtn.textContent = "Present";
  presentBtn.title = "Open the rendered deck in a new tab for full-screen presenting";
  presentBtn.disabled = true;
  toolbar.appendChild(presentBtn);

  // Import zip via a hidden file input wrapped in a label
  const importLabel = el("label", "file-input") as HTMLLabelElement;
  importLabel.textContent = "Import zip…";
  const importInput = el("input") as HTMLInputElement;
  importInput.type = "file";
  importInput.accept = ".zip,application/zip";
  importLabel.appendChild(importInput);
  toolbar.appendChild(importLabel);

  const exportBtn = el("button") as HTMLButtonElement;
  exportBtn.textContent = "Export zip";
  exportBtn.title = "Download the project as a .zip";
  toolbar.appendChild(exportBtn);

  toolbar.appendChild(el("span", "spacer"));

  const status = el("span", "status") as HTMLSpanElement;
  toolbar.appendChild(status);

  root.appendChild(toolbar);

  // Split panes
  const panes = el("div", "slipway-panes");
  const editorHost = el("div", "slipway-editor");
  const splitter = el("div", "slipway-splitter");
  const previewHost = el("div", "slipway-preview");
  panes.appendChild(editorHost);
  panes.appendChild(splitter);
  panes.appendChild(previewHost);
  root.appendChild(panes);

  attachSplitter(panes, splitter);

  return {
    toolbar,
    editorHost,
    previewHost,
    fileSelect,
    renderBtn,
    importInput,
    exportBtn,
    presentBtn,
    status,
    setStale: (stale) => {
      renderBtn.dataset.stale = stale ? "true" : "false";
    },
    setStatus: (text, kind = "info") => {
      status.textContent = text;
      status.className = `status ${kind === "info" ? "" : kind}`.trim();
    },
  };
}

function el<T extends HTMLElement = HTMLElement>(tag: string, className?: string): T {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  return node;
}

function attachSplitter(panes: HTMLElement, splitter: HTMLElement): void {
  let dragging = false;
  let isVertical = window.matchMedia("(max-width: 700px)").matches;
  const onResize = () => {
    isVertical = window.matchMedia("(max-width: 700px)").matches;
  };
  window.addEventListener("resize", onResize);

  function onMove(ev: PointerEvent): void {
    if (!dragging) return;
    const rect = panes.getBoundingClientRect();
    if (isVertical) {
      const ratio = clamp((ev.clientY - rect.top) / rect.height, 0.1, 0.9);
      panes.style.gridTemplateRows = `${ratio}fr var(--splitter-w) ${1 - ratio}fr`;
    } else {
      const ratio = clamp((ev.clientX - rect.left) / rect.width, 0.1, 0.9);
      panes.style.gridTemplateColumns = `${ratio}fr var(--splitter-w) ${1 - ratio}fr`;
    }
  }
  splitter.addEventListener("pointerdown", (ev) => {
    dragging = true;
    splitter.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  splitter.addEventListener("pointermove", onMove);
  splitter.addEventListener("pointerup", (ev) => {
    dragging = false;
    splitter.releasePointerCapture(ev.pointerId);
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
