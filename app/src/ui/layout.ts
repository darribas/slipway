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
  pdfBtn: HTMLButtonElement;
  presentBtn: HTMLButtonElement;
  vimBtn: HTMLButtonElement;
  status: HTMLSpanElement;
  setStale: (stale: boolean) => void;
  setStatus: (text: string, kind?: "info" | "warn" | "error" | "ok") => void;
  /** Update the persistent offline-readiness indicator in the toolbar. */
  setOfflineReady: (ready: boolean) => void;
  /** Update the vim on/off toggle's visual state + tooltip. */
  setVimOn: (on: boolean) => void;
  /**
   * Attach a list of detail strings to the status text. When non-empty, the
   * status becomes tappable (dotted underline + a "›" chevron); tapping
   * opens a modal that shows the full list and offers Copy-to-clipboard.
   * Used for render warnings, which are too long to fit in the toolbar and
   * useful enough to be readable + copyable.
   */
  setStatusDetails: (details: string[]) => void;
  /**
   * Show the update-ready button. `onAccept` is called when the user clicks
   * it; the caller should trigger a SW skip-waiting + page reload there.
   */
  showUpdateReady: (onAccept: () => void) => void;
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
  importLabel.textContent = "Import";
  importLabel.title = "Import a project from a .zip file";
  const importInput = el("input") as HTMLInputElement;
  importInput.type = "file";
  importInput.accept = ".zip,application/zip";
  importLabel.appendChild(importInput);
  toolbar.appendChild(importLabel);

  const exportBtn = el("button") as HTMLButtonElement;
  exportBtn.textContent = "Export";
  exportBtn.title = "Download the project as a .zip";
  toolbar.appendChild(exportBtn);

  const pdfBtn = el("button") as HTMLButtonElement;
  pdfBtn.textContent = "Export PDF";
  pdfBtn.title =
    "Open the deck in print layout for Safari → Save as PDF. " +
    "On iPad: in Safari's print sheet, pick Paper Size = US Letter and " +
    "Orientation = Landscape for the best fit, and turn off " +
    "'Show Headers and Footers' to drop the URL strip.";
  pdfBtn.disabled = true;
  toolbar.appendChild(pdfBtn);

  toolbar.appendChild(el("span", "spacer"));

  const updateBtn = el("button", "update-ready") as HTMLButtonElement;
  updateBtn.textContent = "↻ Update ready";
  updateBtn.title = "A new version is available — click to reload";
  updateBtn.hidden = true;
  toolbar.appendChild(updateBtn);

  const vimBtn = el("button", "vim-toggle") as HTMLButtonElement;
  vimBtn.textContent = "V";
  toolbar.appendChild(vimBtn);

  const offlineIndicator = el("span", "offline-indicator") as HTMLSpanElement;
  offlineIndicator.textContent = "✈";
  offlineIndicator.dataset.ready = "false";
  offlineIndicator.title = "Offline mode not yet ready";
  toolbar.appendChild(offlineIndicator);

  const status = el("span", "status") as HTMLSpanElement;
  toolbar.appendChild(status);

  root.appendChild(toolbar);

  // Dockview lives in this container; main.ts attaches a DockviewComponent.
  // Theme class is auto-toggled via prefers-color-scheme so the dock chrome
  // tracks the app chrome.
  const paneHost = el("div", "slipway-panes");
  applyDockTheme(paneHost);
  root.appendChild(paneHost);

  // Tap-to-expand details modal for render warnings. Status becomes
  // visually tappable (data-has-details = "true") whenever the latest
  // setStatusDetails([…]) call had a non-empty list.
  let currentDetails: string[] = [];
  const detailsModal = buildDetailsModal();
  document.body.appendChild(detailsModal.el);
  status.addEventListener("click", () => {
    if (status.dataset.hasDetails !== "true" || currentDetails.length === 0) return;
    detailsModal.show("Render warnings", currentDetails);
  });

  return {
    toolbar,
    paneHost,
    renderBtn,
    importInput,
    exportBtn,
    pdfBtn,
    presentBtn,
    vimBtn,
    status,
    setStale: (stale) => {
      renderBtn.dataset.stale = stale ? "true" : "false";
    },
    setStatus: (text, kind = "info") => {
      status.textContent = text;
      status.className = `status ${kind === "info" ? "" : kind}`.trim();
    },
    setOfflineReady: (ready) => {
      offlineIndicator.dataset.ready = ready ? "true" : "false";
      offlineIndicator.title = ready
        ? "App is cached and works offline"
        : "Offline mode not yet ready — stay connected while assets cache";
    },
    setVimOn: (on) => {
      vimBtn.dataset.on = on ? "true" : "false";
      vimBtn.title = on
        ? "Vim bindings on — tap to switch off"
        : "Vim bindings off — tap to switch on";
    },
    setStatusDetails: (details) => {
      currentDetails = details.slice();
      if (currentDetails.length > 0) {
        status.dataset.hasDetails = "true";
      } else {
        delete status.dataset.hasDetails;
        detailsModal.hide();
      }
    },
    showUpdateReady: (onAccept) => {
      updateBtn.hidden = false;
      updateBtn.onclick = () => {
        updateBtn.disabled = true;
        updateBtn.textContent = "Reloading…";
        onAccept();
      };
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

/**
 * Build a hidden floating modal element with a scrollable body, a Copy
 * button, and click-outside / Escape dismissal. Used by the toolbar's
 * status text to surface render warnings on demand.
 */
function buildDetailsModal(): {
  el: HTMLElement;
  show: (title: string, details: string[]) => void;
  hide: () => void;
} {
  const root = document.createElement("div");
  root.className = "slipway-details-modal";
  root.hidden = true;
  root.innerHTML = `
    <div class="slipway-details-backdrop"></div>
    <div class="slipway-details-card" role="dialog" aria-modal="true" aria-labelledby="slipway-details-title">
      <header class="slipway-details-header">
        <h2 id="slipway-details-title" class="slipway-details-title"></h2>
        <button class="slipway-details-close" aria-label="Close">×</button>
      </header>
      <pre class="slipway-details-body"></pre>
      <footer class="slipway-details-footer">
        <button class="slipway-details-copy">Copy</button>
      </footer>
    </div>
  `;

  const titleEl = root.querySelector(".slipway-details-title") as HTMLElement;
  const bodyEl = root.querySelector(".slipway-details-body") as HTMLElement;
  const closeBtn = root.querySelector(".slipway-details-close") as HTMLButtonElement;
  const copyBtn = root.querySelector(".slipway-details-copy") as HTMLButtonElement;
  const backdrop = root.querySelector(".slipway-details-backdrop") as HTMLElement;

  let currentText = "";

  function hide(): void {
    root.hidden = true;
    copyBtn.textContent = "Copy";
    delete copyBtn.dataset.copied;
  }

  function show(title: string, details: string[]): void {
    titleEl.textContent = title;
    currentText = details.join("\n\n");
    bodyEl.textContent = currentText;
    root.hidden = false;
    copyBtn.textContent = "Copy";
    delete copyBtn.dataset.copied;
  }

  closeBtn.addEventListener("click", hide);
  backdrop.addEventListener("click", hide);
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentText);
      copyBtn.dataset.copied = "true";
      copyBtn.textContent = "Copied ✓";
    } catch {
      // Clipboard API may be unavailable (insecure context, denied
      // permission). Fall back to selecting the body so the user can
      // copy manually with the system gesture.
      const range = document.createRange();
      range.selectNodeContents(bodyEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !root.hidden) hide();
  });

  return { el: root, show, hide };
}

function el<T extends HTMLElement = HTMLElement>(tag: string, className?: string): T {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  return node;
}
