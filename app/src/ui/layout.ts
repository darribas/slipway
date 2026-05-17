// App chrome: toolbar across the top, Dockview-managed pane area below.
//
// Dockview gives us VS Code / Jupyter Lab-style tabbed panels with drag-to-
// dock, drag-to-tab, splits in any direction, and resizable splitters — all
// for free. main.ts mounts the editor and preview as panels into the Dockview
// instance; this module just builds the chrome and hands main.ts the
// container element to attach Dockview to.

export interface LayoutHandle {
  toolbar: HTMLElement;
  paneHost: HTMLElement; // root for the DockviewComponent
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

  const renderBtn = el("button", "primary") as HTMLButtonElement;
  renderBtn.textContent = "Render";
  renderBtn.title = "Render the current deck (⌘R / Ctrl+R)";
  toolbar.appendChild(renderBtn);

  const presentBtn = el("button") as HTMLButtonElement;
  presentBtn.textContent = "Present";
  presentBtn.title = "Open the rendered deck in a new tab for full-screen presenting";
  presentBtn.disabled = true;
  toolbar.appendChild(presentBtn);

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

  // Dockview lives in this container; main.ts attaches a DockviewComponent.
  // Theme class is auto-toggled via prefers-color-scheme so the dock chrome
  // tracks the app chrome.
  const paneHost = el("div", "slipway-panes");
  applyDockTheme(paneHost);
  root.appendChild(paneHost);

  return {
    toolbar,
    paneHost,
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

function applyDockTheme(host: HTMLElement): void {
  const apply = () => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    host.classList.toggle("dockview-theme-dark", dark);
    host.classList.toggle("dockview-theme-light", !dark);
  };
  apply();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
}

function el<T extends HTMLElement = HTMLElement>(tag: string, className?: string): T {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  return node;
}
