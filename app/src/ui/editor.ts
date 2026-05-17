import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, foldGutter, LanguageDescription } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";

export interface EditorHandle {
  view: EditorView;
  getDoc: () => string;
  setDoc: (text: string) => void;
  focus: () => void;
}

export interface EditorOptions {
  parent: HTMLElement;
  initialDoc: string;
  onChange?: (doc: string) => void;
  onSave?: () => void; // Cmd/Ctrl-S
  onRender?: () => void; // Cmd/Ctrl-R
}

export function createEditor(opts: EditorOptions): EditorHandle {
  const extensions: Extension[] = [
    history(),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    foldGutter(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown({
      codeLanguages: [
        LanguageDescription.of({
          name: "yaml",
          alias: ["yml"],
          load: async () => yamlLang(),
        }),
      ],
    }),
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
    EditorView.theme({
      "&": { height: "100%", fontSize: "14px" },
      ".cm-scroller": { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
      ".cm-content": { padding: "12px 0" },
    }),
  ];

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.initialDoc, extensions }),
  });

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc: (text) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    focus: () => view.focus(),
  };
}
