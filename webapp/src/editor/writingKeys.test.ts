import { Editor } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { editorExtensions } from "./extensions";
import { caretStop } from "./formattingMarkers";
import { parseMarkdown, serializeMarkdown } from "./markdown";

// The editor open in the current test, destroyed after it.
let current: Editor | null = null;

afterEach(() => {
  current?.destroy();
  current = null;
});

// Opens Markdown in the writing surface's extensions, focused, as the
// document editor does.
function open(markdown: string) {
  current?.destroy();
  const created = new Editor({ extensions: editorExtensions() });
  current = created;
  const loaded = parseMarkdown(markdown, created.schema);
  created.view.updateState(
    EditorState.create({ doc: loaded.doc, plugins: created.state.plugins }),
  );
  created.view.dispatch(created.state.tr.setMeta("focus", {}));
  return {
    editor: created,
    save: () => serializeMarkdown(created.state.doc, loaded),
  };
}

// Puts the caret after the first match of `needle`, where a hard break
// reads as a line feed.
function caretAfter(target: Editor, needle: string) {
  let found = -1;
  target.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isTextblock) return found < 0;
    const text = node.textBetween(0, node.content.size, undefined, "\n");
    const index = text.indexOf(needle);
    if (index >= 0) found = pos + 1 + index + needle.length;
    return false;
  });
  if (found < 0) throw new Error(`no "${needle}" in the document`);
  target.commands.setTextSelection(found);
}

function caretAtEnd(target: Editor) {
  target.commands.setTextSelection(target.state.doc.content.size - 1);
}

function press(target: Editor, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey });
  const { view } = target;
  return view.someProp("handleKeyDown", (handle) => handle(view, event));
}

// Types as the browser reports text input, so input rules apply.
function type(target: Editor, text: string) {
  for (const character of text) {
    const { view } = target;
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(character, from, to);
    const handled = view.someProp("handleTextInput", (handle) =>
      handle(view, from, to, character, insert),
    );
    if (!handled) view.dispatch(insert());
  }
}

function markers(target: Editor): string[] {
  return [...target.view.dom.querySelectorAll("[data-marker]")].map(
    (element) => element.textContent,
  );
}

describe("Enter in a paragraph", () => {
  test("breaks the line without a gap, saved with a backslash", () => {
    const { editor, save } = open("");
    type(editor, "¿Vienes mañana?");
    press(editor, "Enter");
    type(editor, "Are you coming tomorrow?");
    expect(editor.state.doc.childCount).toBe(1);
    expect(save()).toBe("¿Vienes mañana?\\\nAre you coming tomorrow?\n");
  });

  test("starts a paragraph on the second press, leaving no empty line", () => {
    const { editor, save } = open("");
    type(editor, "First");
    press(editor, "Enter");
    press(editor, "Enter");
    type(editor, "Second");
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(0).childCount).toBe(1);
    expect(save()).toBe("First\n\nSecond\n");
  });

  test("Backspace straight after puts the line break back", () => {
    const { editor, save } = open("");
    type(editor, "First");
    press(editor, "Enter");
    const broken = editor.state.doc;
    press(editor, "Enter");
    press(editor, "Backspace");
    expect(editor.state.doc.eq(broken)).toBe(true);
    type(editor, "again");
    expect(save()).toBe("First\\\nagain\n");
  });

  test("turns an empty line between two lines into a paragraph break", () => {
    const { editor, save } = open("One\\\n\\\nTwo\n");
    caretAfter(editor, "One\n");
    press(editor, "Enter");
    type(editor, "And ");
    expect(save()).toBe("One\n\nAnd Two\n");
  });

  test("breaks lines and paragraphs inside a block quote", () => {
    const { editor, save } = open("> Quoted\n");
    caretAtEnd(editor);
    press(editor, "Enter");
    type(editor, "more");
    press(editor, "Enter");
    press(editor, "Enter");
    type(editor, "Next");
    expect(save()).toBe("> Quoted\\\n> more\n>\n> Next\n");
  });

  test("keeps Enter in list items, headings, and code blocks", () => {
    const list = open("- Item\n");
    caretAtEnd(list.editor);
    press(list.editor, "Enter");
    type(list.editor, "Next");
    press(list.editor, "Enter", true);
    type(list.editor, "line");
    expect(list.save()).toBe("- Item\n- Next\\\n  line\n");

    const heading = open("# Title\n");
    caretAtEnd(heading.editor);
    press(heading.editor, "Enter");
    type(heading.editor, "Body");
    expect(heading.save()).toBe("# Title\n\nBody\n");

    const code = open("```\ncode\n```\n");
    caretAtEnd(code.editor);
    press(code.editor, "Enter");
    type(code.editor, "more");
    expect(code.save()).toBe("```\ncode\nmore\n```\n");
  });

  test("leaves the caret after typed text when the browser reports it before", () => {
    const { editor, save } = open("");
    type(editor, "First");
    press(editor, "Enter");
    press(editor, "Enter");
    const { view } = editor;
    const at = view.state.selection.from;
    // As Chrome reports text typed straight after the paragraph break.
    view.someProp("handleTextInput", (handle) =>
      handle(view, at, at, "S", () => {
        const tr = view.state.tr.insertText("S", at, at);
        return tr.setSelection(TextSelection.create(tr.doc, at));
      }),
    );
    type(editor, "econd");
    expect(save()).toBe("First\n\nSecond\n");
  });
});

describe("formatting at a line or paragraph break", () => {
  test.each([
    ["*soft*", "*soft*"],
    ["**firm**", "**firm**"],
    ["`code`", "`code`"],
  ])("ends %s typed by its input rule", (typed, saved) => {
    const { editor, save } = open("");
    type(editor, `Plain ${typed}`);
    type(editor, " after");
    press(editor, "Enter");
    type(editor, `More ${typed}`);
    press(editor, "Enter");
    type(editor, "next");
    press(editor, "Enter");
    press(editor, "Enter");
    type(editor, "Then");
    expect(save()).toBe(
      `Plain ${saved} after\\\nMore ${saved}\\\nnext\n\nThen\n`,
    );
  });

  test("never carries a link onto the next line", () => {
    const { editor, save } = open("See [chart](https://example.com/c)\n");
    caretAtEnd(editor);
    type(editor, "!");
    press(editor, "Enter");
    type(editor, "next");
    expect(save()).toBe("See [chart](https://example.com/c)!\\\nnext\n");
  });

  test("never carries formatting from inside a run", () => {
    const { editor, save } = open("*soft*\n");
    caretAtEnd(editor);
    expect(caretStop(editor.state)).toEqual({ stop: 0, stops: 2 });
    press(editor, "Enter");
    type(editor, "line");
    press(editor, "Enter");
    press(editor, "Enter");
    type(editor, "paragraph");
    expect(save()).toBe("*soft*\\\nline\n\nparagraph\n");
  });

  test("never carries formatting into a new list item or after a heading", () => {
    const list = open("- *item*\n");
    caretAtEnd(list.editor);
    press(list.editor, "Enter");
    type(list.editor, "next");
    expect(list.save()).toBe("- *item*\n- next\n");

    const heading = open("# **Title**\n");
    caretAtEnd(heading.editor);
    press(heading.editor, "Enter");
    type(heading.editor, "Body");
    expect(heading.save()).toBe("# **Title**\n\nBody\n");
  });
});

describe("formatting markers", () => {
  const markdown = "Plain *soft* and **firm** text.\n";

  test("show at the run around the caret and hide elsewhere", () => {
    const { editor, save } = open(markdown);
    caretAfter(editor, "so");
    expect(markers(editor)).toEqual(["*", "*"]);
    caretAfter(editor, "and");
    expect(markers(editor)).toEqual([]);
    caretAfter(editor, "firm");
    expect(markers(editor)).toEqual(["**", "**"]);
    editor.view.dispatch(editor.state.tr.setMeta("blur", {}));
    expect(markers(editor)).toEqual([]);
    expect(save()).toBe(markdown);
  });

  test("nest, fence code by its backticks, and show a link's destination", () => {
    const nested = open("**firm *soft* firm**\n");
    caretAfter(nested.editor, "so");
    expect(markers(nested.editor)).toEqual(["**", "*", "*", "**"]);

    const code = open("Use ``a`b`` here\n");
    caretAfter(code.editor, "a");
    expect(markers(code.editor)).toEqual(["``", "``"]);

    const link = open('See [chart](https://example.com/c "Chart") now\n');
    caretAfter(link.editor, "ch");
    expect(markers(link.editor)).toEqual([
      "[",
      '](https://example.com/c "Chart")',
    ]);
    expect(
      link.editor.view.dom.querySelector("[data-marker]")?.ariaHidden,
    ).toBe("true");
  });

  test("give each edge an inside and an outside stop", () => {
    const { editor, save } = open(markdown);
    caretAfter(editor, "sof");
    press(editor, "ArrowRight");
    expect(caretStop(editor.state)).toEqual({ stop: 0, stops: 2 });
    type(editor, "er");
    press(editor, "ArrowRight");
    expect(caretStop(editor.state)).toEqual({ stop: 1, stops: 2 });
    type(editor, ",");
    expect(save()).toBe("Plain *softer*, and **firm** text.\n");

    // Leftward, the caret arrives outside the marker, then steps inside.
    caretAfter(editor, "firm ");
    press(editor, "ArrowLeft");
    expect(caretStop(editor.state)).toEqual({ stop: 1, stops: 2 });
    press(editor, "ArrowLeft");
    type(editor, "er");
    expect(save()).toBe("Plain *softer*, and **firmer** text.\n");
  });

  test("leave the caret outside the closing marker after an input rule", () => {
    const { editor } = open("");
    type(editor, "Plain *soft*");
    expect(caretStop(editor.state)).toEqual({ stop: 1, stops: 2 });
    expect(markers(editor)).toEqual(["*", "*"]);
  });

  test("remove the formatting, keeping the text, on Backspace or Delete", () => {
    const { editor, save } = open(markdown);
    caretAfter(editor, "soft");
    press(editor, "ArrowRight");
    press(editor, "Backspace");
    expect(save()).toBe("Plain soft and **firm** text.\n");
    editor.commands.undo();
    expect(save()).toBe(markdown);

    caretAfter(editor, "and ");
    press(editor, "Delete");
    expect(save()).toBe("Plain *soft* and firm text.\n");
  });

  test("let Backspace straight after an input rule revert it", () => {
    const { editor, save } = open("");
    type(editor, "Plain *soft*");
    press(editor, "Backspace");
    expect(save()).toBe("Plain \\*soft\\*\n");
  });
});
