import { Extension } from "@tiptap/core";
import { EditorState, Selection, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DocumentContent } from "../api/client";
import type { DocumentSaver } from "../saving/documentSaver";
import type { SaveManager } from "../saving/saveManager";
import { titleId } from "../shell/Header";
import styles from "./DocumentEditor.module.css";
import { editorExtensions } from "./extensions";
import { LinkDialog, type LinkTarget } from "./LinkDialog";
import {
  parseMarkdown,
  serializeMarkdown,
  type LoadedMarkdown,
} from "./markdown";

interface DocumentEditorProps {
  documentId: string;
  content: DocumentContent;
  manager: SaveManager;
}

// Mod+S saves at once rather than opening the browser's save dialog,
// wherever focus is while a document is open.
function isSaveShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "s"
  );
}

// Brings the editor's selection up to date with the page's. The browser
// reports a selection extended from the keyboard, such as with Shift+Arrow,
// a moment later, so a shortcut pressed straight after would otherwise act
// on the selection as it was.
function readSelection(editor: Editor): void {
  const { view } = editor;
  const selection = view.dom.ownerDocument.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (!selection || !anchorNode || !focusNode) return;
  if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) return;
  let anchor: number;
  let head: number;
  try {
    anchor = view.posAtDOM(anchorNode, selection.anchorOffset);
    head = view.posAtDOM(focusNode, selection.focusOffset);
  } catch {
    return;
  }
  const current = editor.state.selection;
  if (anchor === current.anchor && head === current.head) return;
  editor.commands.setTextSelection({ from: anchor, to: head });
}

function linkTarget(editor: Editor): LinkTarget {
  readSelection(editor);
  const href: unknown = editor.getAttributes("link")["href"];
  const { from, to } = editor.state.selection;
  return {
    href: typeof href === "string" ? href : "",
    isLink: editor.isActive("link"),
    from,
    to,
  };
}

// Moves the caret to the start or end of the document, or extends the
// selection there. The editor handles these keys itself because blocks out
// of view skip layout (see DocumentEditor.module.css), and browsers then
// place a caret moved there natively at an estimated position.
function toBoundary(editor: Editor, end: boolean, extend: boolean): boolean {
  const { state, view } = editor;
  const target = end
    ? Selection.atEnd(state.doc)
    : Selection.atStart(state.doc);
  const selection = extend
    ? TextSelection.between(state.selection.$anchor, target.$head)
    : target;
  view.dispatch(state.tr.setSelection(selection).scrollIntoView());
  return true;
}

// The writing surface: ADR 0008's Tiptap editor over the open document's
// Markdown, saved by the document's saver as the writer types.
export default function DocumentEditor({
  documentId,
  content,
  manager,
}: DocumentEditorProps) {
  const saverRef = useRef<DocumentSaver | null>(null);
  // The Markdown each editor instance was loaded from. Tiptap recreates the
  // editor when the surface is hidden and shown again, as Suspense may do,
  // and the new one loads the saver's current text.
  const loadedRef = useRef<{ editor: Editor; loaded: LoadedMarkdown } | null>(
    null,
  );
  const openLinkRef = useRef<() => void>(() => {});
  const [link, setLink] = useState<LinkTarget | null>(null);

  const extensions = useMemo(
    () => [
      ...editorExtensions(),
      Extension.create({
        name: "writerShortcuts",
        addKeyboardShortcuts() {
          return {
            "Mod-k": () => {
              openLinkRef.current();
              return true;
            },
            "Mod-Home": ({ editor }) => toBoundary(editor, false, false),
            "Mod-End": ({ editor }) => toBoundary(editor, true, false),
            "Shift-Mod-Home": ({ editor }) => toBoundary(editor, false, true),
            "Shift-Mod-End": ({ editor }) => toBoundary(editor, true, true),
            "Meta-ArrowUp": ({ editor }) => toBoundary(editor, false, false),
            "Meta-ArrowDown": ({ editor }) => toBoundary(editor, true, false),
            "Shift-Meta-ArrowUp": ({ editor }) =>
              toBoundary(editor, false, true),
            "Shift-Meta-ArrowDown": ({ editor }) =>
              toBoundary(editor, true, true),
          };
        },
      }),
    ],
    [],
  );

  // Options keep their identity across renders: Tiptap reapplies changed
  // options to the view, which can reset a selection the browser has just
  // extended but ProseMirror has not yet read.
  const options = useMemo(
    () => ({
      extensions,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: styles.content ?? "",
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": titleId,
          spellcheck: "true",
        },
        // Keeps the caret clear of the page edges and the on-screen keyboard.
        scrollThreshold: 80,
        scrollMargin: 80,
      },
      onUpdate: () => saverRef.current?.change(),
      onBlur: () => saverRef.current?.flush(),
    }),
    [extensions],
  );
  const editor = useEditor(options);

  useEffect(() => {
    openLinkRef.current = () => setLink(linkTarget(editor));
  }, [editor]);

  // Shows the document's text without adding it to undo history or
  // scheduling a save, then hands its serializer to the saver.
  useLayoutEffect(() => {
    if (editor.isDestroyed) return undefined;
    const { saver, markdown } = manager.open(documentId, content);
    if (loadedRef.current?.editor !== editor) {
      const loaded = parseMarkdown(markdown, editor.schema);
      loadedRef.current = { editor, loaded };
      editor.view.updateState(
        EditorState.create({ doc: loaded.doc, plugins: editor.state.plugins }),
      );
      // Browser tests measure ADR 0008's responsiveness targets with these.
      requestAnimationFrame(() => performance.mark("writer:editable"));
    }
    const { loaded } = loadedRef.current;
    saver.attach(() => {
      const start = performance.now();
      const text = serializeMarkdown(editor.state.doc, loaded);
      // Observers receive the entry; the timeline does not keep one per save.
      performance.measure("writer:serialize", { start });
      performance.clearMeasures("writer:serialize");
      return text;
    });
    saverRef.current = saver;
    return () => {
      saverRef.current = null;
      saver.detach();
    };
  }, [editor, manager, documentId, content]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSaveShortcut(event)) return;
      event.preventDefault();
      saverRef.current?.flush();
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <EditorContent editor={editor} className={styles.surface} />
      {link ? (
        <LinkDialog
          target={link}
          onApply={(href) => {
            const chain = editor
              .chain()
              .focus()
              .setTextSelection({ from: link.from, to: link.to });
            if (link.isLink) chain.extendMarkRange("link");
            if (link.from === link.to && !link.isLink) {
              return chain
                .insertContent({
                  type: "text",
                  text: href,
                  marks: [{ type: "link", attrs: { href } }],
                })
                .run();
            }
            return chain.setLink({ href }).run();
          }}
          onRemove={() => {
            editor
              .chain()
              .focus()
              .setTextSelection({ from: link.from, to: link.to })
              .extendMarkRange("link")
              .unsetLink()
              .run();
          }}
          onClose={() => {
            setLink(null);
            editor.commands.focus();
          }}
        />
      ) : null}
    </>
  );
}
