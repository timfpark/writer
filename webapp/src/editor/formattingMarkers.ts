import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Mark, Node } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { codeFence, linkTail } from "./markdown/inline";

// The formatting whose Markdown markers show at the caret, outermost first,
// in the order the serializer nests them.
const RANK: Readonly<Record<string, number>> = {
  link: 0,
  bold: 1,
  italic: 2,
  code: 3,
};

function rank(mark: Mark): number {
  return RANK[mark.type.name] ?? 0;
}

// A stretch of a textblock carrying one formatting mark.
export interface Run {
  readonly mark: Mark;
  readonly from: number;
  to: number;
}

// One run's opening or closing marker.
interface Edge {
  readonly run: Run;
  readonly opens: boolean;
}

// The caret and the markers at it. Each marker at the caret gives it one
// more stop: stop 0 is left of every marker, and stop `edges.length` right
// of them all.
interface Caret {
  readonly pos: number;
  readonly runs: readonly Run[];
  readonly edges: readonly Edge[];
  readonly marks: readonly Mark[];
  readonly stop: number;
}

// The formatting runs in a textblock whose content starts at `start`.
export function formattingRuns(block: Node, start: number): Run[] {
  const runs: Run[] = [];
  let open: Run[] = [];
  block.forEach((child, offset) => {
    const from = start + offset;
    const to = from + child.nodeSize;
    const next: Run[] = [];
    for (const mark of child.marks) {
      if (!(mark.type.name in RANK)) continue;
      let run = open.find((candidate) => candidate.mark.eq(mark));
      if (run) run.to = to;
      else {
        run = { mark, from, to };
        runs.push(run);
      }
      next.push(run);
    }
    open = next;
  });
  return runs;
}

// The markers at a position, left to right: closing markers innermost first,
// then opening markers outermost first.
function edgesAt(runs: readonly Run[], pos: number): Edge[] {
  const closing = runs
    .filter((run) => run.to === pos)
    .sort((a, b) => b.from - a.from || rank(b.mark) - rank(a.mark));
  const opening = runs
    .filter((run) => run.from === pos)
    .sort((a, b) => b.to - a.to || rank(a.mark) - rank(b.mark));
  return [
    ...closing.map((run) => ({ run, opens: false })),
    ...opening.map((run) => ({ run, opens: true })),
  ];
}

// Whether text typed at a stop takes the formatting of the marker at index.
function edgeApplies(edge: Edge, index: number, stop: number): boolean {
  return edge.opens ? stop > index : stop <= index;
}

// The stop matching the formatting typed text would take, so the caret
// shows where typing lands. Stored marks, such as from Mod+B, keep it.
function stopFor(edges: readonly Edge[], marks: readonly Mark[]): number {
  let best = 0;
  let bestScore = -1;
  for (let stop = 0; stop <= edges.length; stop++) {
    let score = 0;
    edges.forEach((edge, index) => {
      if (edgeApplies(edge, index, stop) === edge.run.mark.isInSet(marks)) {
        score++;
      }
    });
    if (score > bestScore) {
      best = stop;
      bestScore = score;
    }
  }
  return best;
}

function marksAtStop(caret: Caret, stop: number): readonly Mark[] {
  let marks = caret.marks;
  caret.edges.forEach((edge, index) => {
    marks = edgeApplies(edge, index, stop)
      ? edge.run.mark.addToSet(marks)
      : edge.run.mark.removeFromSet(marks);
  });
  return marks;
}

function caretAt(state: EditorState): Caret | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.inlineContent || $from.parent.type.spec.code) return null;
  const runs = formattingRuns($from.parent, $from.start());
  const edges = edgesAt(runs, $from.pos);
  const marks = state.storedMarks ?? $from.marks();
  return { pos: $from.pos, runs, edges, marks, stop: stopFor(edges, marks) };
}

// The stop the caret is at among the markers there, and how many there are.
export function caretStop(
  state: EditorState,
): { stop: number; stops: number } | null {
  const caret = caretAt(state);
  return caret ? { stop: caret.stop, stops: caret.edges.length + 1 } : null;
}

function markerText(state: EditorState, edge: Edge): string {
  const { mark, from, to } = edge.run;
  switch (mark.type.name) {
    case "bold":
      return "**";
    case "italic":
      return "*";
    case "code":
      return codeFence(state.doc.textBetween(from, to));
    default:
      return edge.opens ? "[" : linkTail(mark);
  }
}

function markerElement(document: Document, text: string): HTMLElement {
  const element = document.createElement("span");
  element.dataset["marker"] = "";
  element.textContent = text;
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("contenteditable", "false");
  element.setAttribute("spellcheck", "false");
  return element;
}

// Widgets showing the markers of every run the caret is in or beside. The
// widgets' sides put each marker on the correct side of the caret's stop.
export function markerDecorations(state: EditorState): DecorationSet {
  const caret = caretAt(state);
  if (!caret) return DecorationSet.empty;
  const shown = caret.runs.filter(
    (run) => run.from <= caret.pos && caret.pos <= run.to,
  );
  if (shown.length === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  for (const pos of new Set(shown.flatMap((run) => [run.from, run.to]))) {
    const atCaret = pos === caret.pos;
    const edges = atCaret ? caret.edges : edgesAt(shown, pos);
    const stop = atCaret
      ? caret.stop
      : edges.filter((edge) => !edge.opens).length;
    // Inside formatting that continues across the position, so its element
    // is not split around the marker.
    const $pos = state.doc.resolve(pos);
    const after = $pos.nodeAfter?.marks ?? [];
    const context = ($pos.nodeBefore?.marks ?? []).filter((mark) =>
      mark.isInSet(after),
    );
    edges.forEach((edge, index) => {
      const side = index < stop ? index - stop : index - stop + 1;
      const text = markerText(state, edge);
      decorations.push(
        Decoration.widget(
          pos,
          (view) => markerElement(view.dom.ownerDocument, text),
          {
            side,
            marks: context,
            key: `marker ${side} ${text}`,
            ignoreSelection: true,
          },
        ),
      );
    });
  }
  return DecorationSet.create(state.doc, decorations);
}

// Arrow keys step across each marker at the caret one stop at a time, and
// moving onto markers arrives at the nearest stop.
export function stepCaret(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const caret = caretAt(state);
    if (!caret) return false;
    const stop = caret.stop + direction;
    if (caret.edges.length > 0 && stop >= 0 && stop <= caret.edges.length) {
      dispatch?.(state.tr.setStoredMarks(marksAtStop(caret, stop)));
      return true;
    }
    const { $from } = state.selection;
    const node = direction > 0 ? $from.nodeAfter : $from.nodeBefore;
    if (!node?.isText || !node.text) return false;
    const { text } = node;
    // A character outside the Basic Multilingual Plane spans two positions.
    const code = text.codePointAt(direction > 0 ? 0 : text.length - 2);
    const width = code !== undefined && code > 0xffff ? 2 : 1;
    const target = caret.pos + direction * width;
    const edges = edgesAt(caret.runs, target);
    if (edges.length === 0) return false;
    if (dispatch) {
      const arrival: Caret = {
        pos: target,
        runs: caret.runs,
        edges,
        marks: state.doc.resolve(target).marks(),
        stop: 0,
      };
      const tr = state.tr.setSelection(TextSelection.create(state.doc, target));
      tr.setStoredMarks(marksAtStop(arrival, direction > 0 ? 0 : edges.length));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// Backspace or Delete into a marker removes that formatting from its run,
// keeping the text, as an undo step of its own.
export function removeMarker(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const caret = caretAt(state);
    if (!caret) return false;
    const edge = caret.edges[direction < 0 ? caret.stop - 1 : caret.stop];
    if (!edge) return false;
    if (dispatch) {
      const { mark, from, to } = edge.run;
      dispatch(closeHistory(state.tr.removeMark(from, to, mark)));
    }
    return true;
  };
}

interface MarkersState {
  readonly focused: boolean;
  readonly decorations: DecorationSet;
}

const markersKey = new PluginKey<MarkersState>("writerFormattingMarkers");

// After markers beside the caret are removed, WebKit can keep the caret at
// an offset in the paragraph element where its own Enter does nothing, which
// ProseMirror relies on for iOS. This puts it back in the text beside it.
function anchorCaretInText(view: EditorView): void {
  const { selection } = view.state;
  if (!selection.empty || !view.hasFocus()) return;
  const domSelection = view.dom.ownerDocument.getSelection();
  if (!domSelection?.anchorNode || domSelection.anchorNode.nodeType === 3) {
    return;
  }
  const { node, offset } = view.domAtPos(selection.head, -1);
  if (node.nodeType === 3) domSelection.collapse(node, offset);
}

// Shows markers only while the writing surface has focus, following the
// focus and blur transactions Tiptap dispatches.
export function markersPlugin(): Plugin<MarkersState> {
  return new Plugin<MarkersState>({
    key: markersKey,
    state: {
      init: () => ({ focused: false, decorations: DecorationSet.empty }),
      apply(tr, value, _old, state) {
        let { focused } = value;
        if (tr.getMeta("focus")) focused = true;
        if (tr.getMeta("blur")) focused = false;
        if (!focused) {
          return value.focused
            ? { focused, decorations: DecorationSet.empty }
            : value;
        }
        const unchanged =
          value.focused &&
          !tr.docChanged &&
          !tr.selectionSet &&
          !tr.storedMarksSet;
        if (unchanged) return value;
        return { focused, decorations: markerDecorations(state) };
      },
    },
    props: {
      decorations: (state) => markersKey.getState(state)?.decorations,
    },
    view: () => ({
      update(view, previous) {
        const before = markersKey.getState(previous)?.decorations;
        const after = markersKey.getState(view.state)?.decorations;
        if (before !== DecorationSet.empty && after === DecorationSet.empty) {
          anchorCaretInText(view);
        }
      },
    }),
  });
}

function runCommand(editor: Editor, command: Command): boolean {
  return command(editor.state, (tr) => editor.view.dispatch(tr));
}

export const FormattingMarkers = Extension.create({
  name: "writerFormattingMarkers",
  // Ahead of Tiptap's keymap and its exit handling for links.
  priority: 1100,

  addKeyboardShortcuts() {
    return {
      ArrowRight: ({ editor }) => runCommand(editor, stepCaret(1)),
      ArrowLeft: ({ editor }) => runCommand(editor, stepCaret(-1)),
      // Straight after an input rule, Backspace reverts it instead.
      Backspace: ({ editor }) =>
        editor.commands.undoInputRule() || runCommand(editor, removeMarker(-1)),
      Delete: ({ editor }) => runCommand(editor, removeMarker(1)),
    };
  },

  addProseMirrorPlugins() {
    return [markersPlugin()];
  },
});
