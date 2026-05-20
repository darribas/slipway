import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { css as cssLang } from "@codemirror/lang-css";
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, foldGutter, LanguageDescription } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { vim, Vim } from "@replit/codemirror-vim";

/**
 * Pick the CodeMirror language extension for a given file path. SCSS / CSS
 * share lang-css (SCSS is a superset; lang-css highlights enough of the
 * common surface — selectors, properties, values, comments — to be useful;
 * Sass-specific things like `$vars` get the plain-identifier colour, which
 * is fine for now). .bib has no maintained CodeMirror language package, so
 * it opens as plain text.
 */
export function languageFor(path: string): Extension {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "qmd" || ext === "md" || ext === "markdown") {
    return markdown({
      codeLanguages: [
        LanguageDescription.of({
          name: "yaml",
          alias: ["yml"],
          load: async () => yamlLang(),
        }),
      ],
    });
  }
  if (ext === "scss" || ext === "css" || ext === "sass") return cssLang();
  if (ext === "yaml" || ext === "yml") return yamlLang();
  return []; // plain text (no syntax highlighting, still fully editable)
}

export interface EditorHandle {
  view: EditorView;
  getDoc: () => string;
  setDoc: (text: string) => void;
  focus: () => void;
  /** Insert `![](path)` on its own line at the current cursor position. */
  insertImageMarkdown: (path: string) => void;
}

export interface EditorOptions {
  parent: HTMLElement;
  initialDoc: string;
  /**
   * The CodeMirror language extension to use. Defaults to markdown so
   * existing call sites don't change behaviour; pass `languageFor(path)` to
   * pick automatically based on file extension.
   */
  language?: Extension;
  onChange?: (doc: string) => void;
  onSave?: () => void; // Cmd/Ctrl-S
  onRender?: () => void; // Cmd/Ctrl-R
  /** Called when the user pastes or drops an image file into the editor. */
  onImageFile?: (file: File | Blob) => void;
}

export function createEditor(opts: EditorOptions): EditorHandle {
  // Wire ex commands once per process — Vim.defineEx is global. Doing this
  // inside createEditor (rather than at module load) means the latest
  // onSave / onRender closures get used; the global registry just stores
  // the most recent definition.
  Vim.defineEx("write", "w", () => opts.onSave?.());
  Vim.defineEx("update", "up", () => opts.onSave?.());
  // :wq and :x save then "quit" — we have no buffer to close, so they're
  // effectively just save aliases.
  Vim.defineEx("wq", "wq", () => opts.onSave?.());
  Vim.defineEx("xit", "x", () => opts.onSave?.());

  // The previous build relied on CodeMirror's defaultHighlightStyle, which is
  // designed for white backgrounds. In light mode, Dockview's panel
  // background bled through (no explicit bg set), giving dark-on-dark text
  // that was literally unreadable. Now we set an explicit background tied to
  // our --bg-elev var and pick whichever syntax theme matches the user's
  // OS appearance. Snapshot at construction; a reload picks up theme flips.
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  const extensions: Extension[] = [
    // Vim must come first so its keymap binds before the standard ones —
    // this lets normal-mode bindings (hjkl, :, etc.) take precedence.
    // Cmd/Ctrl shortcuts still reach our keymap.of() below because vim only
    // intercepts non-modifier keystrokes.
    vim(),
    history(),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    foldGutter(),
    indentOnInput(),
    // Pick the syntax highlighting that goes with the editor background.
    // oneDark in dark mode (its built-in scheme includes the background too);
    // defaultHighlightStyle in light mode (designed for white).
    ...(isDark ? [oneDark] : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })]),
    opts.language ?? languageFor("untitled.md"),
    EditorView.lineWrapping,
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          opts.onSave?.();
          return true;
        },
      },
      {
        key: "Mod-r",
        preventDefault: true,
        run: () => {
          opts.onRender?.();
          return true;
        },
      },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onChange?.(update.state.doc.toString());
    }),
    // Image paste and drag-drop: intercept clipboard / dataTransfer image
    // items so they go to assets/ rather than trying to paste binary data.
    EditorView.domEventHandlers({
      paste(event) {
        if (!opts.onImageFile) return false;
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) { event.preventDefault(); opts.onImageFile(file); return true; }
          }
        }
        return false;
      },
      drop(event) {
        if (!opts.onImageFile) return false;
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        let handled = false;
        for (const file of Array.from(files)) {
          if (file.type.startsWith("image/")) {
            event.preventDefault();
            opts.onImageFile(file);
            handled = true;
          }
        }
        return handled;
      },
    }),
    // Override the surrounding chrome (gutter, active line, cursor, etc.)
    // even when oneDark is loaded — its defaults match its own dark palette,
    // which is fine, but explicit values let light mode look clean too.
    EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: "14px",
          backgroundColor: isDark ? "#1e1e1e" : "#ffffff",
          color: isDark ? "#ececec" : "#1a1a1a",
        },
        ".cm-scroller": { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
        ".cm-content": { padding: "12px 0", caretColor: isDark ? "#ececec" : "#1a1a1a" },
        ".cm-gutters": {
          backgroundColor: isDark ? "#1e1e1e" : "#fafafa",
          color: isDark ? "#666" : "#aaa",
          border: "0",
        },
        ".cm-activeLine": { backgroundColor: isDark ? "#2a2a2a" : "#f4f4f4" },
        ".cm-activeLineGutter": { backgroundColor: isDark ? "#2a2a2a" : "#f0f0f0" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
          backgroundColor: isDark ? "#264f78" : "#cfe1ff",
        },
      },
      { dark: isDark },
    ),
  ];

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.initialDoc, extensions }),
  });

  function insertImageMarkdown(path: string): void {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    // Insert on its own line: if cursor is at line start use `md\n`, otherwise
    // prepend a newline so we don't concatenate with existing text.
    const md = `![](${path})`;
    const insert = pos === line.from ? `${md}\n` : `\n${md}\n`;
    view.dispatch({
      changes: { from: pos, insert },
      selection: { anchor: pos + insert.length },
    });
    view.focus();
  }

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc: (text) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    focus: () => view.focus(),
    insertImageMarkdown,
  };
}
