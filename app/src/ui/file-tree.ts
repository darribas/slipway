// File tree panel. Builds a hierarchical view from the flat list of paths
// stored in IDB, with click-to-open and per-row rename / delete / new
// actions. Replaces the toolbar's <select> dropdown for navigation.
//
// Action UX is touch-friendly: each row has visible action buttons rather
// than a right-click context menu, since iPad Safari doesn't surface
// right-click and long-press would conflict with iOS text-selection. New-
// file / new-folder / rename use the platform prompt() — good enough for
// MVP; inline editing is a polish item.

export interface FileTreeCallbacks {
  onOpen: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void> | void;
  onDelete: (path: string) => Promise<void> | void;
  onCreateFile: (parentDir: string, name: string) => Promise<void> | void;
  onCreateFolder: (parentDir: string, name: string) => Promise<void> | void;
  /** Called when files are dropped onto the tree. targetDir is the folder
   *  they were dropped on ("" = project root, "assets" = assets/, etc.) */
  onDropFiles: (files: File[], targetDir: string) => Promise<void> | void;
  /** Called when the user picks an image via the Insert image button. */
  onImageFile: (file: File) => Promise<void> | void;
}

export interface FileTreeHandle {
  refresh: (paths: string[]) => void;
  setActive: (path: string | null) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: Map<string, TreeNode>;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isDir: true, children: new Map() };
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      let child = cur.children.get(name);
      if (!child) {
        child = { name, path: fullPath, isDir: !isLast, children: new Map() };
        cur.children.set(name, child);
      }
      cur = child;
    }
  }
  return root;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    // Folders before files, then case-insensitive name.
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function iconFor(node: TreeNode): string {
  if (node.isDir) return "📁";
  const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      qmd: "📝", md: "📝",
      scss: "🎨", css: "🎨",
      bib: "📚",
      png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️", svg: "🖼️",
      yaml: "⚙️", yml: "⚙️",
    }[ext] ?? "📄"
  );
}

export function createFileTree(parent: HTMLElement, cb: FileTreeCallbacks): FileTreeHandle {
  parent.classList.add("slipway-file-tree");
  parent.innerHTML = `
    <div class="ft-toolbar">
      <button class="ft-new-file" title="New file at project root">＋ File</button>
      <button class="ft-new-folder" title="New folder at project root">＋ Folder</button>
      <label class="ft-insert-image" title="Pick an image to insert at the cursor (or paste / drag-drop onto the editor)">
        ＋ Image<input type="file" accept="image/*" style="display:none">
      </label>
    </div>
    <div class="ft-body"></div>`;

  const body = parent.querySelector<HTMLDivElement>(".ft-body")!;
  const expanded = new Set<string>([""]); // root always expanded
  let activePath: string | null = null;
  let currentPaths: string[] = [];

  parent.querySelector<HTMLButtonElement>(".ft-new-file")!.addEventListener("click", () =>
    handleNewFile(""),
  );
  parent.querySelector<HTMLButtonElement>(".ft-new-folder")!.addEventListener("click", () =>
    handleNewFolder(""),
  );

  const imageInput = parent.querySelector<HTMLInputElement>(".ft-insert-image input")!;
  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (file) void cb.onImageFile(file);
    imageInput.value = "";
  });

  function handleNewFile(parentDir: string): void {
    const name = window.prompt(
      `New file name${parentDir ? ` in ${parentDir}/` : ""}:`,
      "",
    );
    if (!name) return;
    void cb.onCreateFile(parentDir, name);
  }
  function handleNewFolder(parentDir: string): void {
    const name = window.prompt(
      `New folder name${parentDir ? ` in ${parentDir}/` : ""}:`,
      "",
    );
    if (!name) return;
    void cb.onCreateFolder(parentDir, name);
  }
  function handleRename(path: string): void {
    const segments = path.split("/");
    const oldName = segments[segments.length - 1];
    const newName = window.prompt(`Rename ${path} to:`, oldName);
    if (!newName || newName === oldName) return;
    segments[segments.length - 1] = newName;
    void cb.onRename(path, segments.join("/"));
  }
  function handleDelete(path: string): void {
    if (!window.confirm(`Delete ${path}?\nThis cannot be undone.`)) return;
    void cb.onDelete(path);
  }

  // ---- Drag-and-drop onto the file tree body --------------------------------
  // Dropping on a folder row targets that folder; dropping anywhere else on
  // the panel defaults to assets/ for images and project root for other files.

  function filesFromDrop(dt: DataTransfer): File[] {
    return Array.from(dt.files).filter((f) => f.size > 0);
  }

  function defaultTargetDir(files: File[]): string {
    // If all dropped files are images, default to assets/; otherwise root.
    return files.every((f) => f.type.startsWith("image/")) ? "assets" : "";
  }

  function rowDirAt(el: Element | null): string | null {
    // Walk up the DOM to find the nearest ft-row and return its folder path.
    // Returns null if the target isn't on a row.
    const row = el?.closest<HTMLElement>(".ft-row");
    if (!row) return null;
    const path = row.dataset.path ?? "";
    // If it's a directory row, that IS the target folder. If it's a file row,
    // use its parent directory.
    const isDir = row.querySelector(".ft-chevron")?.textContent !== "·";
    return isDir ? path : path.split("/").slice(0, -1).join("/");
  }

  let dragOverRow: HTMLElement | null = null;

  function clearDragHighlight(): void {
    dragOverRow?.classList.remove("ft-drag-over");
    body.classList.remove("ft-drag-over");
    dragOverRow = null;
  }

  body.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    clearDragHighlight();
    const row = (e.target as Element).closest<HTMLElement>(".ft-row");
    if (row) { row.classList.add("ft-drag-over"); dragOverRow = row; }
    else { body.classList.add("ft-drag-over"); }
  });

  body.addEventListener("dragleave", (e) => {
    if (!body.contains(e.relatedTarget as Node | null)) clearDragHighlight();
  });

  body.addEventListener("drop", (e) => {
    e.preventDefault();
    clearDragHighlight();
    const files = e.dataTransfer ? filesFromDrop(e.dataTransfer) : [];
    if (!files.length) return;
    const dir = rowDirAt(e.target as Element) ?? defaultTargetDir(files);
    void cb.onDropFiles(files, dir);
  });

  function render(): void {
    body.innerHTML = "";
    const tree = buildTree(currentPaths);
    renderInto(body, tree, 0);
  }

  function renderInto(host: HTMLElement, node: TreeNode, depth: number): void {
    for (const child of sortedChildren(node)) {
      const row = renderRow(child, depth);
      host.appendChild(row);
      if (child.isDir && expanded.has(child.path)) {
        renderInto(host, child, depth + 1);
      }
    }
  }

  function renderRow(node: TreeNode, depth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "ft-row";
    row.dataset.path = node.path;
    if (!node.isDir && node.path === activePath) row.classList.add("active");
    row.style.paddingLeft = `${8 + depth * 14}px`;

    const chevron = document.createElement("span");
    chevron.className = "ft-chevron";
    chevron.textContent = node.isDir ? (expanded.has(node.path) ? "▾" : "▸") : "·";
    row.appendChild(chevron);

    const icon = document.createElement("span");
    icon.className = "ft-icon";
    icon.textContent = iconFor(node);
    row.appendChild(icon);

    const name = document.createElement("span");
    name.className = "ft-name";
    name.textContent = node.name;
    row.appendChild(name);

    const actions = document.createElement("span");
    actions.className = "ft-actions";
    if (node.isDir) {
      actions.appendChild(actionButton("＋", "New file in this folder", (e) => {
        e.stopPropagation();
        handleNewFile(node.path);
      }));
    }
    actions.appendChild(actionButton("✎", "Rename", (e) => {
      e.stopPropagation();
      handleRename(node.path);
    }));
    actions.appendChild(actionButton("×", "Delete", (e) => {
      e.stopPropagation();
      handleDelete(node.path);
    }));
    row.appendChild(actions);

    row.addEventListener("click", () => {
      if (node.isDir) {
        if (expanded.has(node.path)) expanded.delete(node.path);
        else expanded.add(node.path);
        render();
      } else {
        cb.onOpen(node.path);
      }
    });

    return row;
  }

  function actionButton(label: string, title: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "ft-action";
    btn.type = "button";
    btn.title = title;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  return {
    refresh: (paths) => {
      currentPaths = paths;
      // Auto-expand any folders along the active path so it's visible after
      // a rename / open / etc.
      if (activePath) expandAncestors(activePath);
      render();
    },
    setActive: (path) => {
      activePath = path;
      if (path) expandAncestors(path);
      render();
    },
  };

  function expandAncestors(path: string): void {
    const segments = path.split("/").filter(Boolean);
    for (let i = 1; i < segments.length; i++) {
      expanded.add(segments.slice(0, i).join("/"));
    }
  }
}
