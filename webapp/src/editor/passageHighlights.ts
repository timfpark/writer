import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

interface HighlightState {
  focused: boolean;
  selectionIgnored: boolean;
  quoteRange: { from: number; to: number } | null;
}

type HighlightMeta =
  | { type: "focus"; focused: boolean }
  | { type: "ignoreSelection"; ignored: boolean }
  | { type: "quote"; range: { from: number; to: number } | null };

export const passageHighlightsKey = new PluginKey<HighlightState>(
  "writerPassageHighlights",
);

function isHighlightMeta(value: unknown): value is HighlightMeta {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const kind = value.type;
  return kind === "focus" || kind === "ignoreSelection" || kind === "quote";
}

interface TextSegment {
  text: string;
  startIndex: number;
  docPos: number;
}

function collectSegments(doc: ProseMirrorNode): {
  fullText: string;
  segments: TextSegment[];
} {
  const segments: TextSegment[] = [];
  let offset = 0;
  let needsBlockSep = false;

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (needsBlockSep) offset += 1;
      needsBlockSep = true;
      return true;
    }
    if (node.isText && node.text) {
      segments.push({
        text: node.text,
        startIndex: offset,
        docPos: pos,
      });
      offset += node.text.length;
      return false;
    }
    return true;
  });

  // Join segments with "\n" where block gaps occurred.
  const parts: string[] = [];
  let cursor = 0;
  for (const seg of segments) {
    if (seg.startIndex > cursor) {
      parts.push("\n".repeat(seg.startIndex - cursor));
    }
    parts.push(seg.text);
    cursor = seg.startIndex + seg.text.length;
  }
  return { fullText: parts.join(""), segments };
}

function textIndexToDocPos(
  segments: readonly TextSegment[],
  index: number,
  preferEnd: boolean,
): number | null {
  for (const seg of segments) {
    const end = seg.startIndex + seg.text.length;
    if (
      preferEnd
        ? index > seg.startIndex && index <= end
        : index >= seg.startIndex && index < end
    ) {
      return seg.docPos + (index - seg.startIndex);
    }
  }
  return null;
}

// Finds the exact ProseMirror position range of `quote` inside `doc`'s
// rendered text, spanning inline formatting such as emphasis or links.
export function findQuoteRange(
  doc: ProseMirrorNode,
  quote: string,
): { from: number; to: number } | null {
  const needle = quote.trim();
  if (!needle) return null;
  const { fullText, segments } = collectSegments(doc);
  const start = fullText.indexOf(needle);
  if (start === -1) return null;
  const end = start + needle.length;
  const from = textIndexToDocPos(segments, start, false);
  const to = textIndexToDocPos(segments, end, true);
  if (from === null || to === null || from >= to) return null;
  return { from, to };
}

// Approximate character offset in plain text corresponding to a ProseMirror
// document position, used to window documents past the 19,000-word limit.
export function docPosToTextOffset(doc: ProseMirrorNode, pos: number): number {
  let offset = 0;
  let found = false;
  doc.descendants((node, nodePos) => {
    if (found) return false;
    if (node.isText && node.text) {
      const end = nodePos + node.text.length;
      if (pos <= end) {
        offset += Math.max(0, pos - nodePos);
        found = true;
        return false;
      }
      offset += node.text.length;
      return false;
    }
    if (node.isTextblock && nodePos < pos && offset > 0) {
      offset += 1;
    }
    return true;
  });
  return offset;
}

const clearTimers = new WeakMap<Editor, ReturnType<typeof setTimeout>>();

export function setSelectionIgnoredInEditor(
  editor: Editor,
  ignored: boolean,
): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(passageHighlightsKey, {
      type: "ignoreSelection",
      ignored,
    } satisfies HighlightMeta),
  );
}

// Scrolls to an exact quote in the open document and briefly highlights it
// without editing the document or stealing focus from Chat.
export function highlightQuoteInEditor(editor: Editor, quote: string): boolean {
  if (editor.isDestroyed) return false;
  const range = findQuoteRange(editor.state.doc, quote);
  if (!range) return false;

  const existingTimer = clearTimers.get(editor);
  if (existingTimer !== undefined) clearTimeout(existingTimer);

  editor.view.dispatch(
    editor.state.tr.setMeta(passageHighlightsKey, {
      type: "quote",
      range,
    } satisfies HighlightMeta),
  );

  try {
    const domAt = editor.view.domAtPos(range.from);
    const element =
      domAt.node instanceof HTMLElement ? domAt.node : domAt.node.parentElement;
    element?.scrollIntoView({ block: "center" });
  } catch {
    // Ignore scroll failures in synthetic DOM environments such as jsdom.
  }

  const timer = setTimeout(() => {
    clearTimers.delete(editor);
    if (editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(passageHighlightsKey, {
        type: "quote",
        range: null,
      } satisfies HighlightMeta),
    );
  }, 2_400);
  clearTimers.set(editor, timer);
  return true;
}

// Keeps the active text selection visibly highlighted while focus moves to
// Chat, and highlights passages jumped to from a reply's quote links.
export const PassageHighlights = Extension.create({
  name: "writerPassageHighlights",

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: passageHighlightsKey,
        state: {
          init: () => ({
            focused: false,
            selectionIgnored: false,
            quoteRange: null,
          }),
          apply(tr, prev, oldState, newState) {
            let next = prev;
            const rawMeta: unknown = tr.getMeta(passageHighlightsKey);
            const meta = isHighlightMeta(rawMeta) ? rawMeta : undefined;
            if (meta?.type === "focus") {
              next = { ...next, focused: meta.focused };
            } else if (meta?.type === "ignoreSelection") {
              next = { ...next, selectionIgnored: meta.ignored };
            } else if (meta?.type === "quote") {
              next = { ...next, quoteRange: meta.range };
            }

            if (tr.docChanged && next.quoteRange) {
              const from = tr.mapping.map(next.quoteRange.from);
              const to = tr.mapping.map(next.quoteRange.to);
              next = {
                ...next,
                quoteRange: from < to ? { from, to } : null,
              };
            }

            if (
              next.selectionIgnored &&
              (oldState.selection.from !== newState.selection.from ||
                oldState.selection.to !== newState.selection.to)
            ) {
              next = { ...next, selectionIgnored: false };
            }

            return next;
          },
        },
        props: {
          handleDOMEvents: {
            focus(view) {
              view.dispatch(
                view.state.tr.setMeta(passageHighlightsKey, {
                  type: "focus",
                  focused: true,
                } satisfies HighlightMeta),
              );
              return false;
            },
            blur(view) {
              view.dispatch(
                view.state.tr.setMeta(passageHighlightsKey, {
                  type: "focus",
                  focused: false,
                } satisfies HighlightMeta),
              );
              return false;
            },
          },
          decorations(state) {
            const pluginState = passageHighlightsKey.getState(state);
            if (!pluginState) return DecorationSet.empty;
            const decorations: Decoration[] = [];

            if (
              !pluginState.focused &&
              !pluginState.selectionIgnored &&
              !state.selection.empty
            ) {
              decorations.push(
                Decoration.inline(state.selection.from, state.selection.to, {
                  class: "writer-inactive-selection",
                }),
              );
            }

            if (pluginState.quoteRange) {
              decorations.push(
                Decoration.inline(
                  pluginState.quoteRange.from,
                  pluginState.quoteRange.to,
                  { class: "writer-quote-highlight" },
                ),
              );
            }

            return decorations.length > 0
              ? DecorationSet.create(state.doc, decorations)
              : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
