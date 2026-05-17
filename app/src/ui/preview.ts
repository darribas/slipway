// Sandboxed iframe that displays rendered reveal.js decks.
// srcdoc gives us a unique-origin sandbox without needing the host page to
// serve the HTML separately.

export class PreviewPane {
  private iframe: HTMLIFrameElement;
  private placeholder: HTMLDivElement;

  constructor(container: HTMLElement) {
    container.classList.add("slipway-preview");
    this.placeholder = document.createElement("div");
    this.placeholder.className = "slipway-preview-placeholder";
    this.placeholder.innerHTML = `
      <div>
        <h2>No deck rendered yet</h2>
        <p>Edit the .qmd on the left, then press <kbd>Render</kbd> (or <kbd>⌘R</kbd>).</p>
      </div>`;
    container.appendChild(this.placeholder);

    this.iframe = document.createElement("iframe");
    this.iframe.className = "slipway-preview-iframe";
    this.iframe.setAttribute("sandbox", "allow-scripts allow-popups");
    this.iframe.setAttribute("title", "Rendered deck preview");
    this.iframe.style.display = "none";
    container.appendChild(this.iframe);
  }

  render(html: string): void {
    this.iframe.srcdoc = html;
    this.iframe.style.display = "block";
    this.placeholder.style.display = "none";
  }

  clear(): void {
    this.iframe.style.display = "none";
    this.iframe.srcdoc = "";
    this.placeholder.style.display = "flex";
  }

  /** Open the current rendered HTML in a new tab for full-screen presentation. */
  openInNewTab(html: string): void {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
