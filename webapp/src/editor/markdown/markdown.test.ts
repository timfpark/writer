import type { Node } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { describe, expect, test } from "vitest";
import { editorSchema } from "../extensions";
import { parseMarkdown, serializeMarkdown, type LoadedMarkdown } from "./index";
import { inlineText } from "./inline";
import { parseSyntax } from "./syntax";

const schema = editorSchema();

const corpus = import.meta.glob<string>("./corpus/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function documents(folder: "canonical" | "foreign"): [string, string][] {
  return Object.entries(corpus)
    .filter(([path]) => path.startsWith(`./corpus/${folder}/`))
    .map(([path, text]) => [path.slice(path.lastIndexOf("/") + 1), text]);
}

const canonical = documents("canonical");
const foreign = documents("foreign");

function withoutSource(doc: Node): Node {
  const blocks: Node[] = [];
  doc.forEach((block) =>
    blocks.push(
      block.type.create(
        { ...block.attrs, sourceIndex: null },
        block.content,
        block.marks,
      ),
    ),
  );
  return doc.type.create(doc.attrs, blocks);
}

function blockStart(doc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

function change(
  loaded: LoadedMarkdown,
  edit: (tr: Transaction, doc: Node) => void,
): Node {
  const state = EditorState.create({ doc: loaded.doc });
  const tr = state.tr;
  edit(tr, tr.doc);
  return state.apply(tr).doc;
}

function deleteBlock(loaded: LoadedMarkdown, index: number): Node {
  return change(loaded, (tr, doc) => {
    const from = blockStart(doc, index);
    tr.delete(from, from + doc.child(index).nodeSize);
  });
}

// Inserts text at the start of the first textblock inside a top-level block.
function typeInto(loaded: LoadedMarkdown, index: number, text: string): Node {
  return change(loaded, (tr, doc) => {
    const block = doc.child(index);
    let target = -1;
    block.descendants((node, pos) => {
      if (target >= 0) return false;
      if (node.isTextblock) target = pos + 1;
      return target < 0;
    });
    if (block.isTextblock) target = 0;
    tr.insertText(text, blockStart(doc, index) + 1 + target);
  });
}

function appendParagraph(loaded: LoadedMarkdown, text: string): Node {
  return change(loaded, (tr, doc) => {
    tr.insert(
      doc.content.size,
      schema.node("paragraph", null, schema.text(text)),
    );
  });
}

function save(markdown: string, edit?: (loaded: LoadedMarkdown) => Node) {
  const loaded = parseMarkdown(markdown, schema);
  return serializeMarkdown(edit ? edit(loaded) : loaded.doc, loaded);
}

// The text of every textblock, in order; raw blocks count as text.
function texts(doc: Node): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "codeBlock" || node.type.name === "rawBlock") {
      out.push(node.textContent);
    } else if (node.isTextblock) {
      const text = inlineText(node);
      if (text !== "" || node.type.name === "heading") out.push(text);
    }
    return !node.isTextblock;
  });
  return out;
}

function expectReadsBack(markdown: string, doc: Node) {
  const loaded = parseMarkdown(markdown, schema);
  expect({ markdown, texts: texts(loaded.doc) }).toEqual({
    markdown,
    texts: texts(doc),
  });
  expect(serializeMarkdown(loaded.doc, loaded)).toBe(markdown);
}

describe("the round-trip corpus", () => {
  test("holds enough documents", () => {
    expect(canonical.length).toBeGreaterThanOrEqual(8);
    expect(foreign.length).toBeGreaterThanOrEqual(13);
  });

  test.each(canonical)(
    "canonical %s serializes from the editor document alone",
    (_, markdown) => {
      const loaded = parseMarkdown(markdown, schema);
      expect(serializeMarkdown(withoutSource(loaded.doc), loaded)).toBe(
        markdown,
      );
      expect(serializeMarkdown(loaded.doc, loaded)).toBe(markdown);
    },
  );

  test.each([...canonical, ...foreign])(
    "%s saves without edits to identical bytes in any form",
    (_, markdown) => {
      const unix = markdown.replace(/\r\n/g, "\n");
      const variants = [
        markdown,
        unix.replace(/\n/g, "\r\n"),
        unix.replace(/\n+$/, ""),
        `\uFEFF${markdown}`,
        `${unix}\n\n`,
      ];
      for (const variant of variants) expect(save(variant)).toBe(variant);
    },
  );

  test.each([...canonical, ...foreign])(
    "%s keeps other blocks' bytes when one block is edited or deleted",
    (_, markdown) => {
      const loaded = parseMarkdown(markdown, schema);
      const original = loaded.doc;
      const count = original.childCount;
      const sourceTexts = blockSources(markdown);
      for (let i = 0; i < count; i++) {
        const edits: Node[] = [deleteBlock(loaded, i)];
        if (original.child(i).type.name !== "horizontalRule") {
          edits.push(typeInto(loaded, i, "Zq "));
        }
        for (const edited of edits) {
          const out = serializeMarkdown(edited, loaded);
          // Blocks relying on a definition in the changed block may change.
          const definesLabels = /^ {0,3}\[[^\]]+\]:/.test(sourceTexts[i] ?? "");
          let from = 0;
          for (let j = 0; j < count; j++) {
            if (Math.abs(j - i) <= 1) continue;
            if (definesLabels && sourceTexts[j]?.includes("[")) continue;
            const text = sourceTexts[j] ?? "";
            const at = out.indexOf(text, from);
            expect({ changed: i, block: j, kept: at >= 0, out }).toEqual({
              changed: i,
              block: j,
              kept: true,
              out,
            });
            from = at + text.length;
          }
          if (original.child(i).type.name !== "rawBlock") {
            expectReadsBack(out, edited);
          }
        }
      }
    },
  );
});

// The source text of each top-level block.
function blockSources(markdown: string): string[] {
  const body = markdown.replace(/^\uFEFF/, "");
  return parseSyntax(body).children.map((child) =>
    body.slice(child.position?.start.offset, child.position?.end.offset),
  );
}

describe("documents", () => {
  test("an empty document is zero bytes", () => {
    const loaded = parseMarkdown("", schema);
    expect(loaded.doc.childCount).toBe(1);
    expect(serializeMarkdown(loaded.doc, loaded)).toBe("");
    const blank = change(loaded, (tr) => {
      tr.insert(0, schema.node("paragraph"));
    });
    expect(serializeMarkdown(blank, loaded)).toBe("");
  });

  test("typed text in an empty document ends with one newline", () => {
    expect(save("", (l) => typeInto(l, 0, "Hello."))).toBe("Hello.\n");
  });

  test("an edited document keeps its byte order mark and unchanged blocks", () => {
    const markdown = "\uFEFFFirst.\r\nline\r\n\r\nSecond.\r\n";
    expect(save(markdown, (l) => typeInto(l, 1, "A "))).toBe(
      "\uFEFFFirst.\r\nline\n\nA Second.\n",
    );
  });

  test("blocks hold their source index", () => {
    const loaded = parseMarkdown("# A\n\nB\n\n- c\n", schema);
    const indexes: unknown[] = [];
    loaded.doc.forEach((node) => indexes.push(node.attrs["sourceIndex"]));
    expect(indexes).toEqual([0, 1, 2]);
  });

  test("undoing an edit restores the block's bytes", () => {
    const markdown = "Wrapped\nparagraph.\n\nNext.\n";
    const loaded = parseMarkdown(markdown, schema);
    const state = EditorState.create({ doc: loaded.doc });
    const edited = state.apply(state.tr.insertText("X", 1));
    const restored = edited.apply(edited.tr.delete(1, 2));
    expect(serializeMarkdown(edited.doc, loaded)).toBe(
      "XWrapped paragraph.\n\nNext.\n",
    );
    expect(serializeMarkdown(restored.doc, loaded)).toBe(markdown);
  });

  test("markdown outside the subset becomes raw blocks and atoms", () => {
    const loaded = parseMarkdown(
      "| a |\n|---|\n\nSee ![x](y.png) and <i>z</i> ~~w~~.\n\n- [ ] task\n\n```js title\nx\n```\n\n>\n\n- > quoted\n\n# A  \nB\n",
      schema,
    );
    const names: string[] = [];
    loaded.doc.forEach((node) => names.push(node.type.name));
    expect(names).toEqual([
      "rawBlock",
      "paragraph",
      "rawBlock",
      "rawBlock",
      "rawBlock",
      "rawBlock",
      "heading",
      "paragraph",
    ]);
    const atoms: string[] = [];
    loaded.doc.child(1).forEach((node) => {
      if (node.type.name === "rawInline")
        atoms.push(String(node.attrs["source"]));
    });
    expect(atoms).toEqual(["![x](y.png)", "<i>", "</i>", "~~w~~"]);
  });

  test("a setext heading holding a hard break is a raw block", () => {
    const loaded = parseMarkdown("Line one\\\nline two\n===\n", schema);
    expect(loaded.doc.child(0).type.name).toBe("rawBlock");
  });

  test("looseness comes from blank lines between items and their blocks", () => {
    const tight = parseMarkdown("- a\n- b\n\n  - c\n", schema).doc.child(0);
    expect(tight.attrs["tight"]).toBe(false);
    const nested = parseMarkdown(
      "- a\n  - b\n\n  - c\n- d\n",
      schema,
    ).doc.child(0);
    expect(nested.attrs["tight"]).toBe(true);
    expect(nested.child(0).child(1).attrs["tight"]).toBe(false);
  });

  test("bare URLs stay text", () => {
    const loaded = parseMarkdown("Visit www.example.com today.\n", schema);
    expect(loaded.doc.child(0).firstChild?.marks).toEqual([]);
  });
});

describe("repairs", () => {
  test("lists separated by a deleted paragraph stay two lists", () => {
    const markdown = "- a\n- b\n\nMiddle.\n\n- c\n";
    const out = save(markdown, (l) => deleteBlock(l, 1));
    expect(out).toBe("- a\n- b\n\n* c\n");
    expect(parseMarkdown(out, schema).doc.childCount).toBe(2);
  });

  test("lists that cannot merge keep their bytes when the paragraph between goes", () => {
    expect(save("* a\n\nMiddle.\n\n1) c\n", (l) => deleteBlock(l, 1))).toBe(
      "* a\n\n1) c\n",
    );
  });

  test("an unclosed fence is closed when a paragraph follows it", () => {
    const out = save("Intro.\n\n```\ncode", (l) =>
      appendParagraph(l, "After."),
    );
    expect(out).toBe("Intro.\n\n```\ncode\n```\n\nAfter.\n");
  });

  test("a closed fence keeps its bytes when a paragraph follows it", () => {
    const out = save("~~~\ncode\n~~~", (l) => appendParagraph(l, "After."));
    expect(out).toBe("~~~\ncode\n~~~\n\nAfter.\n");
  });

  test("an indented code block that would join a list is written fenced", () => {
    const out = save("- item\n\nMiddle.\n\n    code\n", (l) =>
      deleteBlock(l, 1),
    );
    expect(out).toBe("- item\n\n```\ncode\n```\n");
  });

  test("a --- rule that becomes the first block is written as ***", () => {
    const markdown = "Opening.\n\n---\n\nMiddle.\n\n---\n\nEnd.\n";
    const out = save(markdown, (l) => deleteBlock(l, 0));
    expect(out).toBe("***\n\nMiddle.\n\n---\n\nEnd.\n");
    expect(parseMarkdown(out, schema).doc.child(0).type.name).toBe(
      "horizontalRule",
    );
  });

  test("a * * * rule that becomes the first block keeps its bytes", () => {
    expect(save("Opening.\n\n* * *\n\nEnd.\n", (l) => deleteBlock(l, 0))).toBe(
      "* * *\n\nEnd.\n",
    );
  });

  test("front matter keeps its bytes when the text after it changes", () => {
    const markdown = "---\ntitle: x\n---\n\nText.\n";
    expect(save(markdown, (l) => typeInto(l, 1, "More "))).toBe(
      "---\ntitle: x\n---\n\nMore Text.\n",
    );
  });

  test("a deleted link reference definition turns its references inline", () => {
    const markdown =
      "See [the mill][mill] today.\n\n[mill]: https://example.com/mill\n";
    expect(save(markdown, (l) => deleteBlock(l, 1))).toBe(
      "See [the mill](https://example.com/mill) today.\n",
    );
  });

  test("references keep their bytes while their definition stays", () => {
    const markdown = "See [the mill][mill].\n\nOther.\n\n[mill]: /m\n";
    expect(save(markdown, (l) => deleteBlock(l, 1))).toBe(
      "See [the mill][mill].\n\n[mill]: /m\n",
    );
  });

  test("deleting the first of two definitions keeps the destination shown", () => {
    const markdown = "Go [x] now.\n\n[x]: /first\n\n[x]: /second\n";
    expect(save(markdown, (l) => deleteBlock(l, 1))).toBe(
      "Go [x](/first) now.\n\n[x]: /second\n",
    );
    expect(save(markdown, (l) => deleteBlock(l, 2))).toBe(
      "Go [x] now.\n\n[x]: /first\n",
    );
  });

  test("an edited raw block that now defines a label takes it over", () => {
    const markdown = "Go [x] now.\n\n[y]: /other\n\n[x]: /second\n";
    const out = save(markdown, (l) =>
      change(l, (tr, doc) => {
        const at = blockStart(doc, 1) + 2;
        tr.insertText("x", at, at + 1);
      }),
    );
    expect(out).toBe("Go [x](/second) now.\n\n[x]: /other\n\n[x]: /second\n");
  });

  test("text after a never-ending HTML comment joins it when reopened", () => {
    const out = save("Intro.\n\n<!-- never closed", (l) =>
      appendParagraph(l, "After."),
    );
    expect(out).toBe("Intro.\n\n<!-- never closed\n\nAfter.\n");
    const reopened = parseMarkdown(out, schema).doc;
    expect(reopened.childCount).toBe(2);
    expect(reopened.child(1).textContent).toMatch(
      /^<!-- never closed\n\nAfter\./,
    );
  });

  test("text that could read as an autolink stays text", () => {
    const out = save("", (l) => typeInto(l, 0, "Mail <1@example.com> now"));
    expect(out).toBe("Mail \\<1@example.com> now\n");
    const reopened = parseMarkdown(out, schema).doc.child(0);
    expect(reopened.textContent).toBe("Mail <1@example.com> now");
    expect(reopened.firstChild?.marks).toEqual([]);
  });

  test("a paragraph left holding only inline HTML is written as text", () => {
    const markdown = "Bold <b>start</b> here.\n";
    const out = save(markdown, (l) =>
      change(l, (tr) => {
        tr.delete(7, tr.doc.child(0).nodeSize - 1);
        tr.delete(1, 6);
      }),
    );
    expect(out).toBe("\\<b>\n");
    const reopened = parseMarkdown(out, schema).doc.child(0);
    expect(reopened.type.name).toBe("paragraph");
    expect(reopened.textContent).toBe("<b>");
  });

  test("inline HTML beside text stays raw when the paragraph is edited", () => {
    expect(
      save("Bold <b>start</b> here.\n", (l) => typeInto(l, 0, "So ")),
    ).toBe("So Bold <b>start</b> here.\n");
  });

  test("hard breaks are written with a backslash, except at the end", () => {
    const loaded = parseMarkdown("", schema);
    const br = () => schema.node("hardBreak");
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("One"),
        br(),
        schema.text("two "),
        br(),
        schema.text(" three"),
        br(),
        br(),
      ]),
    ]);
    const out = serializeMarkdown(doc, loaded);
    expect(out).toBe("One\\\ntwo \\\n&#32;three\n");
    expectReadsBack(out, doc);
  });

  test("a two-space hard break keeps its bytes until its paragraph is edited", () => {
    const markdown = "Line one  \nline two\n\nNext.\n";
    expect(save(markdown, (l) => typeInto(l, 1, "A "))).toBe(
      "Line one  \nline two\n\nA Next.\n",
    );
    expect(save(markdown, (l) => typeInto(l, 0, "A "))).toBe(
      "A Line one\\\nline two\n\nNext.\n",
    );
  });

  test("emphasis around a code span after a letter is dropped, keeping the text", () => {
    const loaded = parseMarkdown("", schema);
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("call"),
        schema.text("f()", [schema.mark("italic"), schema.mark("code")]),
        schema.text(" now"),
      ]),
    ]);
    const out = serializeMarkdown(doc, loaded);
    expect(out).toBe("call`f()` now\n");
  });

  test("whitespace and punctuation move outside emphasis", () => {
    const loaded = parseMarkdown("", schema);
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("a"),
        schema.text(" bold. ", [schema.mark("bold")]),
        schema.text("b"),
      ]),
    ]);
    expect(serializeMarkdown(doc, loaded)).toBe("a **bold.** b\n");
  });
});
