import type { Mark, Node, Schema } from "@tiptap/pm/model";
import { describe, expect, test } from "vitest";
import { editorSchema } from "../extensions";
import { parseMarkdown, serializeMarkdown } from "./index";
import { inlineText } from "./inline";

const schema: Schema = editorSchema();

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = "prose" | "punctuation" | "formattedPunctuation";

const WORDS =
  "the quiet harbor lamp river stone window letter garden morning evening silver paper north road candle orchard winter bridge meadow voice".split(
    " ",
  );
const PUNCTUATION = Array.from(
  "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ \t  abc12é—“”…",
);

class Generator {
  private readonly next: () => number;

  constructor(
    seed: number,
    private readonly kind: Kind,
  ) {
    this.next = random(seed);
  }

  private int(n: number): number {
    return Math.floor(this.next() * n);
  }

  private pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new Error("empty choice");
    return item;
  }

  private chance(p: number): boolean {
    return this.next() < p;
  }

  private piece(): string {
    if (this.kind === "prose") {
      let text = "";
      const count = 1 + this.int(5);
      for (let i = 0; i < count; i++) {
        text += (i > 0 ? " " : "") + this.pick(WORDS);
        if (this.chance(0.15)) text += this.pick([",", ".", ";", "!", "?"]);
      }
      return this.chance(0.5) ? text + " " : text;
    }
    let text = "";
    const count = 1 + this.int(6);
    for (let i = 0; i < count; i++) text += this.pick(PUNCTUATION);
    return text;
  }

  private marks(): Mark[] {
    if (this.kind === "punctuation") return [];
    let marks: readonly Mark[] = [];
    const add = (mark: Mark) => {
      marks = mark.addToSet(marks);
    };
    if (this.chance(0.2)) add(schema.mark("italic"));
    if (this.chance(0.2)) add(schema.mark("bold"));
    if (this.chance(0.1)) add(schema.mark("code"));
    if (this.chance(0.1)) {
      add(
        schema.mark("link", {
          href: this.pick([
            "https://example.com/a",
            "/b c",
            "x(y)",
            "",
            "a\\b",
          ]),
          title: this.chance(0.3) ? this.pick(['say "hi"', "t"]) : null,
        }),
      );
    }
    return [...marks];
  }

  inline(heading: boolean): Node[] {
    const nodes: Node[] = [];
    const count = 1 + this.int(8);
    for (let i = 0; i < count; i++) {
      const roll = this.next();
      if (!heading && roll < 0.05) nodes.push(schema.node("hardBreak"));
      else if (roll < 0.08) {
        const source = this.pick(["![alt](a.png)", "<b>", "~~gone~~"]);
        nodes.push(
          schema.node("rawInline", { source }, undefined, this.marks()),
        );
      } else nodes.push(schema.text(this.piece(), this.marks()));
    }
    nodes.push(schema.text(this.piece(), this.marks()));
    return nodes;
  }

  private list(depth: number): Node {
    const ordered = this.chance(0.4);
    const items: Node[] = [];
    const count = 1 + this.int(3);
    for (let i = 0; i < count; i++) {
      const children = [schema.node("paragraph", null, this.inline(false))];
      if (depth < 2 && this.chance(0.3)) children.push(this.block(depth + 1));
      items.push(schema.node("listItem", null, children));
    }
    const tight = this.chance(0.7);
    return ordered
      ? schema.node(
          "orderedList",
          { start: this.pick([1, 1, 3, 10]), tight },
          items,
        )
      : schema.node("bulletList", { tight }, items);
  }

  block(depth: number): Node {
    const roll = this.next();
    if (roll < 0.5) return schema.node("paragraph", null, this.inline(false));
    if (roll < 0.62) {
      return schema.node(
        "heading",
        { level: 1 + this.int(6) },
        this.inline(true),
      );
    }
    if (roll < 0.8) return this.list(depth);
    if (roll < 0.87 && depth < 2) {
      return schema.node("blockquote", null, [
        this.block(depth + 1),
        ...(this.chance(0.4) ? [this.block(depth + 1)] : []),
      ]);
    }
    if (roll < 0.94) {
      const text = Array.from({ length: 1 + this.int(3) }, () =>
        this.piece(),
      ).join("\n");
      return schema.node(
        "codeBlock",
        { language: this.chance(0.5) ? "js" : null },
        schema.text(text),
      );
    }
    return schema.node("horizontalRule");
  }

  doc(): Node {
    const blocks = Array.from({ length: 1 + this.int(6) }, () => this.block(0));
    return schema.node("doc", null, blocks);
  }
}

// The text of every paragraph, heading, and code block, in order.
function texts(doc: Node): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "codeBlock") out.push(`code:${node.textContent}`);
    else if (node.isTextblock) {
      const text = inlineText(node);
      if (text !== "" || node.type.name === "heading") {
        out.push(`${node.type.name}:${text}`);
      }
      return false;
    }
    return true;
  });
  return out;
}

const empty = parseMarkdown("", schema);

describe.each<[Kind, number]>([
  ["prose", 1000],
  ["punctuation", 1000],
  ["formattedPunctuation", 1000],
])("random %s documents", (kind, count) => {
  test("read back with the same text and write the same bytes again", () => {
    for (let seed = 1; seed <= count; seed++) {
      const doc = new Generator(seed, kind).doc();
      const markdown = serializeMarkdown(doc, empty);
      const loaded = parseMarkdown(markdown, schema);
      expect({ seed, markdown, texts: texts(loaded.doc) }).toEqual({
        seed,
        markdown,
        texts: texts(doc),
      });
      const again = serializeMarkdown(withoutSource(loaded.doc), empty);
      expect({ seed, markdown: again }).toEqual({ seed, markdown });
    }
  });
});

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
