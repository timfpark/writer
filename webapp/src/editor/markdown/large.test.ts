import type { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { expect, test } from "vitest";
import { editorSchema } from "../extensions";
import { parseMarkdown, serializeMarkdown } from "./index";

const WORDS =
  "the a quiet harbor lamp river stone window letter garden morning evening silver paper north road candle orchard winter bridge meadow voice keeper ferry tide rope salt gull shutter wick lantern map island cove".split(
    " ",
  );

// A synthetic manuscript in canonical form: chapter headings, paragraphs of
// 80 to 150 words with emphasis, strong emphasis, and a link, and occasional
// block quotes and lists.
function manuscript(bytes: number, seed = 7): string {
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
  const word = () => WORDS[Math.floor(next() * WORDS.length)] ?? "tide";
  const words = (n: number) => Array.from({ length: n }, word).join(" ");
  const paragraph = () => {
    const count = 80 + Math.floor(next() * 71);
    const parts = [words(Math.floor(count / 4))];
    parts.push(`*${words(3)}*`, words(Math.floor(count / 4)));
    parts.push(`**${words(2)}**`, words(Math.floor(count / 4)));
    parts.push(`[${words(2)}](https://example.com/${word()})`);
    parts.push(`${words(count - 3 * Math.floor(count / 4) - 7)}.`);
    const text = parts.join(" ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const blocks: string[] = [];
  let size = 0;
  let chapter = 0;
  while (size < bytes) {
    let block: string;
    const plain = !/^[->]/.test(blocks[blocks.length - 1] ?? "");
    const roll = plain ? next() : 1;
    if (blocks.length % 40 === 0) block = `# Chapter ${++chapter}`;
    else if (roll < 0.04) block = `> ${paragraph()}`;
    else if (roll < 0.08) {
      block = `- ${words(6)}\n- ${words(5)}\n- ${words(7)}`;
    } else block = paragraph();
    blocks.push(block);
    size += block.length + 2;
  }
  return blocks.join("\n\n") + "\n";
}

function blockStart(doc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

test("a 1 MiB manuscript saves unedited and edited", () => {
  const markdown = manuscript(1024 * 1024);
  expect(markdown.length).toBeGreaterThan(1024 * 1024);
  const loaded = parseMarkdown(markdown, editorSchema());
  expect(serializeMarkdown(loaded.doc, loaded)).toBe(markdown);

  const doc = loaded.doc;
  let middle = Math.floor(doc.childCount / 2);
  while (doc.child(middle).type.name !== "paragraph") middle++;
  const state = EditorState.create({ doc });
  const at = blockStart(doc, middle) + 1;
  const edited = state.apply(state.tr.insertText("Typed words ", at));
  const paragraphs = markdown.split("\n\n");
  const expected = [
    ...paragraphs.slice(0, middle),
    `Typed words ${paragraphs[middle] ?? ""}`,
    ...paragraphs.slice(middle + 1),
  ].join("\n\n");
  expect(serializeMarkdown(edited.doc, loaded)).toBe(expected);

  const again = edited.apply(edited.tr.insertText("More ", at));
  expect(serializeMarkdown(again.doc, loaded)).toBe(
    expected.replace("Typed words ", "More Typed words "),
  );
});
