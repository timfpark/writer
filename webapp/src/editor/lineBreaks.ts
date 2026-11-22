import { Extension, type Editor } from "@tiptap/core";
import type { Node, ResolvedPos } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type Transaction,
} from "@tiptap/pm/state";
import type { Step } from "@tiptap/pm/transform";

// The steps of the last paragraph break made from an empty line, and where
// the caret was before it, until the next edit or caret move.
class Revert {
  constructor(
    readonly steps: readonly Step[],
    readonly docs: readonly Node[],
    readonly caret: number,
  ) {}
}

const revertKey = new PluginKey<Revert | null>("writerLineBreaks");

// A paragraph outside a list item, directly in the document or in a block
// quote. List items keep their own Enter behavior.
function isPlainParagraph($pos: ResolvedPos): boolean {
  if ($pos.parent.type.name !== "paragraph") return false;
  return $pos.depth < 2 || $pos.node(-1).type.name !== "listItem";
}

function isBreak(node: Node | null | undefined): boolean {
  return node?.type.name === "hardBreak";
}

function onEmptyLine($pos: ResolvedPos): boolean {
  const atStart = $pos.parentOffset === 0 || isBreak($pos.nodeBefore);
  const atEnd =
    $pos.parentOffset === $pos.parent.content.size || isBreak($pos.nodeAfter);
  return atStart && atEnd;
}

// Replaces the empty line at the caret with a paragraph break, removing the
// hard breaks around it, and leaves the caret where the writer goes on.
function breakParagraph($pos: ResolvedPos, tr: Transaction): Transaction {
  const before = isBreak($pos.nodeBefore);
  const after = isBreak($pos.nodeAfter);
  const from = before ? $pos.pos - 1 : $pos.pos;
  const to = after ? $pos.pos + 1 : $pos.pos;
  tr.delete(from, to);
  tr.split(from, 1, [
    {
      type: $pos.parent.type,
      attrs: { ...$pos.parent.attrs, sourceIndex: null },
    },
  ]);
  // With text below, the caret starts it; on a paragraph's first line, it
  // stays in the empty paragraph above.
  const caret = before ? from + 2 : from;
  return tr.setSelection(TextSelection.create(tr.doc, caret));
}

// Enter in a paragraph: a hard line break, carrying no formatting onto the
// new line, or on an empty line, a paragraph break in its place.
export const enterLineBreak: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return false;
  const { $from, $to } = selection;
  if (!$from.sameParent($to) || !isPlainParagraph($from)) return false;
  if (selection.empty && onEmptyLine($from)) {
    if ($from.parent.content.size === 0) return false;
    if (dispatch) {
      const tr = breakParagraph($from, state.tr);
      const revert = new Revert(
        tr.steps.slice(),
        tr.docs.slice(),
        selection.head,
      );
      dispatch(tr.setMeta(revertKey, revert).scrollIntoView());
    }
    return true;
  }
  const hardBreak = state.schema.nodes["hardBreak"];
  if (!hardBreak) return false;
  if (dispatch) {
    dispatch(
      state.tr.replaceSelectionWith(hardBreak.create(), false).scrollIntoView(),
    );
  }
  return true;
};

// Backspace straight after Enter made a paragraph break from an empty line
// puts the line break back.
export const revertParagraphBreak: Command = (state, dispatch) => {
  const revert = revertKey.getState(state);
  if (!revert) return false;
  if (dispatch) {
    const tr = state.tr;
    for (let index = revert.steps.length - 1; index >= 0; index--) {
      const step = revert.steps[index];
      const doc = revert.docs[index];
      if (step && doc) tr.step(step.invert(doc));
    }
    tr.setSelection(TextSelection.create(tr.doc, revert.caret));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export function lineBreaksPlugin(): Plugin<Revert | null> {
  return new Plugin<Revert | null>({
    key: revertKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const revert: unknown = tr.getMeta(revertKey);
        if (revert instanceof Revert) return revert;
        return tr.docChanged || tr.selectionSet ? null : value;
      },
    },
  });
}

// Chrome reports the caret before the first character typed within a frame
// of a paragraph break made after a hard break, and then types the next one
// there too. Typed text always leaves the caret after it.
export function caretAfterTypingPlugin(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, _text, insert) {
        if (view.composing) return false;
        const tr = insert();
        const { selection } = tr;
        if (selection.empty && selection.head === from) {
          tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(to)));
        }
        view.dispatch(tr);
        return true;
      },
    },
  });
}

export const LineBreaks = Extension.create({
  name: "writerLineBreaks",
  // Ahead of the formatting markers, list items, and Tiptap's own keymap.
  priority: 1200,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => runCommand(editor, enterLineBreak),
      Backspace: ({ editor }) => runCommand(editor, revertParagraphBreak),
    };
  },

  addProseMirrorPlugins() {
    return [lineBreaksPlugin()];
  },
});

// After every input rule, so the rules still see typed text first.
export const CaretAfterTyping = Extension.create({
  name: "writerCaretAfterTyping",
  priority: 1,

  addProseMirrorPlugins() {
    return [caretAfterTypingPlugin()];
  },
});

function runCommand(editor: Editor, command: Command): boolean {
  return command(editor.state, (tr) => editor.view.dispatch(tr));
}
