import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import type {
  FindingDecorationRange,
  FindingMapUpdate,
  PassageDescriptor,
  ResolvedFindingAnchor,
} from "../workspace/editorBridge";
import {
  allocateBlockId,
  mapFindingThroughTransaction,
  updateBlockIds,
  utf16RangeInBlockToDocRange,
} from "./findingUnderlines";

interface HighlightState {
  focused: boolean;
  selectionIgnored: boolean;
  quoteRange: { from: number; to: number } | null;
  blockIds: readonly string[];
  findings: readonly FindingDecorationRange[];
  selectedFindingId: string | null;
  lastEditedPassageIds: readonly string[];
  lastFindingUpdates: readonly FindingMapUpdate[];
  txSeq: number;
}

interface HighlightPatch {
  focused?: boolean;
  selectionIgnored?: boolean;
  quoteRange?: { from: number; to: number } | null;
  findings?: readonly FindingDecorationRange[];
  selectedFindingId?: string | null;
}

export interface FindingCallbacks {
  onTransaction: (
    editedPassageIds: readonly string[],
    findingUpdates: readonly FindingMapUpdate[],
  ) => void;
  onClickFinding: (findingId: string) => void;
}

export const passageHighlightsKey = new PluginKey<HighlightState>(
  "writerPassageHighlights",
);

const findingCallbacks = new WeakMap<EditorView, FindingCallbacks>();
const isNonProse = (name: string) =>
  name === "codeBlock" || name === "rawBlock" || name === "horizontalRule";
const isSceneBreak = (name: string) =>
  name === "heading" || name === "horizontalRule";

// Finds the exact ProseMirror position range of `quote` inside `doc`'s
// rendered text, spanning inline formatting such as emphasis or links.
export function findQuoteRange(
  doc: ProseMirrorNode,
  quote: string,
): { from: number; to: number } | null {
  const needle = quote.trim();
  if (!needle) return null;
  const fullText = doc.textBetween(0, doc.content.size, "\n");
  const start = fullText.indexOf(needle);
  if (start === -1) return null;
  return utf16RangeInBlockToDocRange(doc, 0, start, start + needle.length);
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

const pendingPatches = new WeakMap<object, HighlightPatch>();

function dispatchMeta(editor: Editor, patch: HighlightPatch): void {
  if (editor.isDestroyed) return;
  const tr = editor.state.tr;
  pendingPatches.set(tr, patch);
  editor.view.dispatch(tr);
}

export function setSelectionIgnoredInEditor(
  editor: Editor,
  ignored: boolean,
): void {
  dispatchMeta(editor, { selectionIgnored: ignored });
}

function scrollToDocPos(editor: Editor, pos: number): void {
  try {
    const { node } = editor.view.domAtPos(pos);
    (node instanceof HTMLElement ? node : node.parentElement)?.scrollIntoView({
      block: "center",
    });
  } catch {
    // Ignore scroll failures in synthetic DOM environments such as jsdom.
  }
}

export function setFindingCallbacks(
  editor: Editor,
  callbacks: FindingCallbacks | null,
): void {
  if (editor.isDestroyed) return;
  if (callbacks) findingCallbacks.set(editor.view, callbacks);
  else findingCallbacks.delete(editor.view);
}

function walkBlocks(
  editor: Editor,
  visit: (
    block: ProseMirrorNode,
    index: number,
    blockStartPos: number,
    sceneIndex: number,
    passageId: string,
  ) => boolean | void,
): void {
  const state = editor.isDestroyed
    ? undefined
    : passageHighlightsKey.getState(editor.state);
  if (!state) return;
  const doc = editor.state.doc;
  let pos = 0;
  let sceneIndex = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (i > 0 && isSceneBreak(child.type.name)) sceneIndex += 1;
    const passageId = state.blockIds[i];
    if (passageId && visit(child, i, pos, sceneIndex, passageId) === false) {
      return;
    }
    pos += child.nodeSize;
  }
}

export function readPassagesFromEditor(
  editor: Editor,
  passageIds: ReadonlySet<string>,
): PassageDescriptor[] {
  if (passageIds.size === 0) return [];
  const result: PassageDescriptor[] = [];
  walkBlocks(editor, (child, index, _pos, sceneIndex, passageId) => {
    if (!passageIds.has(passageId) || isNonProse(child.type.name)) return;
    const text = child.textBetween(0, child.content.size, "\n");
    if (text.trim()) result.push({ passageId, index, sceneIndex, text });
  });
  return result;
}

export function resolveFindingAnchorInEditor(
  editor: Editor,
  anchor: {
    passageId: string;
    startOffset: number;
    endOffset: number;
    quote: string;
  },
): ResolvedFindingAnchor | null {
  let found: ResolvedFindingAnchor | null = null;
  walkBlocks(editor, (child, _index, pos, sceneIndex, passageId) => {
    if (passageId !== anchor.passageId) return undefined;
    const range = utf16RangeInBlockToDocRange(
      child,
      pos + 1,
      anchor.startOffset,
      anchor.endOffset,
    );
    if (
      range &&
      editor.state.doc.textBetween(range.from, range.to, "\n") === anchor.quote
    ) {
      found = { ...range, sceneIndex };
    }
    return false;
  });
  return found;
}

export function syncFindingDecorationsInEditor(
  editor: Editor,
  ranges: readonly FindingDecorationRange[],
  selectedFindingId: string | null,
): void {
  dispatchMeta(editor, { findings: ranges, selectedFindingId });
}

export function focusFindingRangeInEditor(
  editor: Editor,
  from: number,
  to: number,
  moveCaret: boolean,
): boolean {
  if (
    editor.isDestroyed ||
    from < 0 ||
    to > editor.state.doc.content.size ||
    from >= to
  ) {
    return false;
  }
  if (moveCaret) {
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, from))
        .scrollIntoView(),
    );
    editor.view.focus();
  }
  scrollToDocPos(editor, from);
  return true;
}

// Scrolls to an exact quote in the open document and briefly highlights it
// without editing the document or stealing focus from Chat.
export function highlightQuoteInEditor(editor: Editor, quote: string): boolean {
  if (editor.isDestroyed) return false;
  const range = findQuoteRange(editor.state.doc, quote);
  if (!range) return false;

  const existingTimer = clearTimers.get(editor);
  if (existingTimer !== undefined) clearTimeout(existingTimer);

  dispatchMeta(editor, { quoteRange: range });
  scrollToDocPos(editor, range.from);

  const timer = setTimeout(() => {
    clearTimers.delete(editor);
    dispatchMeta(editor, { quoteRange: null });
  }, 2_400);
  clearTimers.set(editor, timer);
  return true;
}

// Keeps the active text selection visibly highlighted while focus moves to
// Chat, highlights jumped-to quotes, renders ADR 0011 finding underlines, and
// maps finding ranges through edits and deletions without mutating the doc.
export const PassageHighlights = Extension.create({
  name: "writerPassageHighlights",

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: passageHighlightsKey,
        state: {
          init: (_config, instance) => ({
            focused: false,
            selectionIgnored: false,
            quoteRange: null,
            blockIds: Array.from(
              { length: instance.doc.childCount },
              allocateBlockId,
            ),
            findings: [],
            selectedFindingId: null,
            lastEditedPassageIds: [],
            lastFindingUpdates: [],
            txSeq: 0,
          }),
          apply(tr, prev, oldState, newState) {
            let next: HighlightState = {
              ...prev,
              lastEditedPassageIds: [],
              lastFindingUpdates: [],
            };
            const patch = pendingPatches.get(tr);
            if (patch?.focused !== undefined) next.focused = patch.focused;
            if (patch?.selectionIgnored !== undefined) {
              next.selectionIgnored = patch.selectionIgnored;
            }
            if (patch?.quoteRange !== undefined) {
              next.quoteRange = patch.quoteRange;
            }

            if (tr.docChanged) {
              const blockUpdate = updateBlockIds(
                oldState.doc,
                newState.doc,
                prev.blockIds,
                tr,
              );
              let findings = next.findings;
              let findingUpdates: readonly FindingMapUpdate[] = [];
              if (prev.findings.length > 0) {
                const kept: FindingDecorationRange[] = [];
                const updates: FindingMapUpdate[] = [];
                for (const finding of prev.findings) {
                  const mapped = mapFindingThroughTransaction(
                    finding,
                    tr,
                    newState.doc,
                  );
                  updates.push(mapped);
                  if (mapped.status !== "deleted") {
                    kept.push({
                      ...finding,
                      from: mapped.from,
                      to: mapped.to,
                      status: mapped.status,
                    });
                  }
                }
                findings = kept;
                findingUpdates = updates;
              }
              let quoteRange = next.quoteRange;
              if (quoteRange) {
                const from = tr.mapping.map(quoteRange.from);
                const to = tr.mapping.map(quoteRange.to);
                quoteRange = from < to ? { from, to } : null;
              }
              next = {
                ...next,
                quoteRange,
                blockIds: blockUpdate.blockIds,
                findings,
                lastEditedPassageIds: blockUpdate.editedPassageIds,
                lastFindingUpdates: findingUpdates,
                txSeq: next.txSeq + 1,
              };
            }

            if (patch?.findings !== undefined) {
              next = {
                ...next,
                findings: patch.findings,
                selectedFindingId:
                  patch.selectedFindingId !== undefined
                    ? patch.selectedFindingId
                    : next.selectedFindingId,
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
        view() {
          let lastNotifiedSeq = 0;
          return {
            update(view) {
              const state = passageHighlightsKey.getState(view.state);
              if (!state || state.txSeq === lastNotifiedSeq) return;
              lastNotifiedSeq = state.txSeq;
              const callbacks = findingCallbacks.get(view);
              if (
                callbacks &&
                (state.lastEditedPassageIds.length > 0 ||
                  state.lastFindingUpdates.length > 0)
              ) {
                callbacks.onTransaction(
                  state.lastEditedPassageIds,
                  state.lastFindingUpdates,
                );
              }
            },
          };
        },
        props: {
          handleClick(view, pos) {
            const state = passageHighlightsKey.getState(view.state);
            const callbacks = findingCallbacks.get(view);
            const hit = state?.findings.find(
              (f) => f.status === "active" && pos >= f.from && pos <= f.to,
            );
            if (hit && callbacks) {
              setTimeout(() => callbacks.onClickFinding(hit.findingId), 0);
            }
            return false;
          },
          handleDOMEvents: {
            focus(view) {
              const tr = view.state.tr;
              pendingPatches.set(tr, { focused: true });
              view.dispatch(tr);
              return false;
            },
            blur(view) {
              const tr = view.state.tr;
              pendingPatches.set(tr, { focused: false });
              view.dispatch(tr);
              return false;
            },
          },
          decorations(state) {
            const pluginState = passageHighlightsKey.getState(state);
            if (!pluginState) return DecorationSet.empty;
            const decorations: Decoration[] = [];
            const size = state.doc.content.size;

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

            for (const f of pluginState.findings) {
              if (
                f.status !== "active" ||
                f.from < 0 ||
                f.to > size ||
                f.from >= f.to
              ) {
                continue;
              }
              const cls =
                `writer-finding-underline writer-finding-${f.style}` +
                (f.findingId === pluginState.selectedFindingId
                  ? " writer-finding-selected"
                  : "");
              decorations.push(
                Decoration.inline(f.from, f.to, {
                  class: cls,
                  "data-finding-id": f.findingId,
                  "data-finding-style": f.style,
                }),
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
