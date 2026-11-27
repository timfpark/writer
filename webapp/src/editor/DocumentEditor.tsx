import { Extension } from "@tiptap/core";
import { EditorState, Selection, TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DocumentContent } from "../api/client";
import type { DocumentSaver } from "../saving/documentSaver";
import type { SaveManager } from "../saving/saveManager";
import { titleId } from "../shell/Header";
import { regionElement } from "../shell/regions";
import {
  useEditorBridge,
  type EditorSelection,
} from "../workspace/editorBridge";
import styles from "./DocumentEditor.module.css";
import { editorExtensions } from "./extensions";
import type { LinkTarget } from "./LinkDialog";
import {
  parseMarkdown,
  serializeMarkdown,
  type LoadedMarkdown,
} from "./markdown";
import {
  docPosToTextOffset,
  findQuoteRange,
  highlightQuoteInEditor,
  setSelectionIgnoredInEditor,
} from "./passageHighlights";

const LinkDialog = lazy(() =>
  import("./LinkDialog").then((module) => ({ default: module.LinkDialog })),
);

interface DocumentEditorProps {
  documentId: string;
  language: string;
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

function isAsciiSpace(code: number): boolean {
  return (
    code === 32 ||
    code === 9 ||
    code === 10 ||
    code === 13 ||
    code === 12 ||
    code === 11
  );
}

// Zero-allocation word count so measuring a 1 MiB manuscript never triggers a
// GC pause during editor mount or typing.
function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const space = code <= 32 ? isAsciiSpace(code) : /\s/.test(text[i] ?? "");
    if (space) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count += 1;
    }
  }
  return count;
}

function activeSelection(editor: Editor): EditorSelection | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const text = editor.state.doc.textBetween(from, to, "\n").trim();
  if (!text) return null;
  return { text, from, to };
}

// The writing surface: ADR 0008's Tiptap editor over the open document's
// Markdown, saved by the document's saver as the writer types.
export default function DocumentEditor({
  documentId,
  language,
  content,
  manager,
}: DocumentEditorProps) {
  const bridge = useEditorBridge();
  const saverRef = useRef<DocumentSaver | null>(null);
  // The Markdown each editor instance was loaded from. Tiptap recreates the
  // editor when the surface is hidden and shown again, as Suspense may do,
  // and the new one loads the saver's current text.
  const loadedRef = useRef<{ editor: Editor; loaded: LoadedMarkdown } | null>(
    null,
  );
  const versionRef = useRef(0);
  const hadSelectionRef = useRef(false);
  const summaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openLinkRef = useRef<() => void>(() => {});
  const onUpdateRef = useRef<() => void>(() => {});
  const onSelectionRef = useRef<() => void>(() => {});
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
          // The shell's F6 shortcut focuses the writing region here.
          "data-focus-target": "",
          spellcheck: "true",
        },
        // Keeps the caret clear of the page edges and the on-screen keyboard.
        scrollThreshold: 80,
        scrollMargin: 80,
      },
      onUpdate: () => {
        saverRef.current?.change();
        onUpdateRef.current();
      },
      onSelectionUpdate: () => onSelectionRef.current(),
      onBlur: () => saverRef.current?.flush(),
    }),
    [extensions],
  );
  const editor = useEditor(options);

  useEffect(() => {
    openLinkRef.current = () => setLink(linkTarget(editor));
  }, [editor]);

  // Keep the writing surface's lang attribute in sync with the document's
  // language without recreating Tiptap's editor options.
  useLayoutEffect(() => {
    if (editor.isDestroyed) return;
    editor.view.dom.setAttribute("lang", language);
  }, [editor, language]);

  // Focus left on the writing region, such as by a pane that closed as this
  // document opened, moves into the document once the editor is ready.
  useEffect(() => {
    if (document.activeElement !== regionElement("writing")) return undefined;
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      // The writer may have put the caret somewhere meanwhile.
      if (document.activeElement !== regionElement("writing")) return;
      editor.commands.focus("start");
    });
    return () => cancelAnimationFrame(frame);
  }, [editor]);

  // Shows the document's text without adding it to undo history or
  // scheduling a save, then hands its serializer to the saver and registers
  // the editor handle with the assistant bridge.
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

  // Connects the editor to the assistant bridge after layout/paint so opening
  // a 1 MiB document never blocks its first editable frame.
  useEffect(() => {
    if (editor.isDestroyed) return undefined;
    const versionStamp = () => `${content.revision}:${versionRef.current}`;

    const pushSummary = () => {
      if (editor.isDestroyed) return;
      const selection = activeSelection(editor);
      hadSelectionRef.current = selection !== null;
      bridge.updateSummary({
        documentId,
        wordCount: countWords(
          editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n"),
        ),
        cursorOffset: docPosToTextOffset(
          editor.state.doc,
          editor.state.selection.head,
        ),
        selection,
        version: versionStamp(),
      });
    };

    const scheduleSummary = () => {
      if (summaryTimerRef.current !== null) {
        clearTimeout(summaryTimerRef.current);
      }
      summaryTimerRef.current = setTimeout(() => {
        summaryTimerRef.current = null;
        pushSummary();
      }, 300);
    };

    onUpdateRef.current = () => {
      // Bump the edit version synchronously so a caret move within 300 ms
      // never drops an edit and sending mid-debounce sees the current version.
      versionRef.current += 1;
      scheduleSummary();
    };
    onSelectionRef.current = () => {
      if (editor.isDestroyed) return;
      const selection = activeSelection(editor);
      if (selection !== null || hadSelectionRef.current) {
        // Mirror selection changes immediately so the selection chip appears
        // or clears without lag.
        pushSummary();
      } else {
        scheduleSummary();
      }
    };

    const initialSelection = activeSelection(editor);
    hadSelectionRef.current = initialSelection !== null;
    const unregister = bridge.register({
      documentId,
      readSnapshot: () => {
        const currentLoaded = loadedRef.current?.loaded;
        const plainText = editor.state.doc.textBetween(
          0,
          editor.state.doc.content.size,
          "\n",
        );
        const liveMarkdown = currentLoaded
          ? serializeMarkdown(editor.state.doc, currentLoaded)
          : plainText;
        const toMarkdownOffset = (plainOffset: number) =>
          plainText.length > 0
            ? Math.round((plainOffset / plainText.length) * liveMarkdown.length)
            : 0;
        const selection = activeSelection(editor);
        const rawCursorOffset = docPosToTextOffset(
          editor.state.doc,
          editor.state.selection.head,
        );
        const rawSelectionOffset = selection
          ? docPosToTextOffset(
              editor.state.doc,
              Math.floor((selection.from + selection.to) / 2),
            )
          : null;
        return {
          documentId,
          markdown: liveMarkdown,
          plainText,
          wordCount: countWords(liveMarkdown),
          cursorOffset: toMarkdownOffset(rawCursorOffset),
          selectionOffset:
            rawSelectionOffset !== null
              ? toMarkdownOffset(rawSelectionOffset)
              : null,
          selection,
          version: versionStamp(),
        };
      },
      hasExactQuote: (quote) =>
        !editor.isDestroyed && findQuoteRange(editor.state.doc, quote) !== null,
      highlightQuote: (quote) => highlightQuoteInEditor(editor, quote),
      setSelectionIgnored: (ignored) =>
        setSelectionIgnoredInEditor(editor, ignored),
    });

    // Defer the initial word count and summary emission until after the first
    // editable frame so opening a 1 MiB document never blocks its paint.
    let summaryFrame: number | null = null;
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    summaryFrame = requestAnimationFrame(() => {
      summaryFrame = null;
      initialTimer = setTimeout(() => {
        initialTimer = null;
        if (editor.isDestroyed) return;
        bridge.updateSummary({
          documentId,
          wordCount: countWords(content.markdown),
          cursorOffset: 0,
          selection: activeSelection(editor),
          version: versionStamp(),
        });
      }, 0);
    });

    return () => {
      if (summaryFrame !== null) cancelAnimationFrame(summaryFrame);
      if (initialTimer !== null) clearTimeout(initialTimer);
      if (summaryTimerRef.current !== null) {
        clearTimeout(summaryTimerRef.current);
        summaryTimerRef.current = null;
      }
      unregister();
    };
  }, [editor, documentId, content.markdown, content.revision, bridge]);

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
      <EditorContent
        editor={editor}
        className={styles.surface}
        lang={language}
      />
      {link ? (
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}
    </>
  );
}
