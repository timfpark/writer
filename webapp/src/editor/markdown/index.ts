import type { Node, Schema } from "@tiptap/pm/model";
import { convertMarkdown, schemaTypes } from "./parse";
import {
  type LoadedState,
  newCaches,
  serialize,
  type SourceBlock,
} from "./serialize";

// What parseMarkdown read: the editor document, and the source blocks,
// separators, definition labels, and caches serializeMarkdown relies on.
export interface LoadedMarkdown {
  readonly doc: Node;
}

const states = new WeakMap<LoadedMarkdown, LoadedState>();

export function parseMarkdown(
  markdown: string,
  schema: Schema,
): LoadedMarkdown {
  const types = schemaTypes(schema);
  const bom = markdown.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = markdown.slice(bom.length);
  const blocks: SourceBlock[] = [];
  const effective = new Map<string, number>();
  let previousEnd = 0;
  for (const block of convertMarkdown(body, types)) {
    const index = blocks.length;
    const node = block.node.type.create(
      { ...block.node.attrs, sourceIndex: index },
      block.node.content,
      block.node.marks,
    );
    blocks.push({
      text: body.slice(block.start, block.end),
      before: body.slice(previousEnd, block.start),
      node,
      frontMatter: block.frontMatter,
      defines: block.defines,
      relies: block.relies,
    });
    for (const definition of block.defines) {
      if (!effective.has(definition.key)) effective.set(definition.key, index);
    }
    previousEnd = block.end;
  }
  const doc = types.doc.create(
    null,
    blocks.length > 0
      ? blocks.map((block) => block.node)
      : types.paragraph.create(),
  );
  const loaded: LoadedMarkdown = { doc };
  states.set(loaded, {
    doc,
    source: markdown,
    bom,
    blocks,
    trailing: body.slice(previousEnd),
    effective,
    types,
    caches: newCaches(),
  });
  return loaded;
}

function escapedText(doc: Node): string {
  const text = doc.textBetween(0, doc.content.size, "\n\n", (leaf) =>
    leaf.type.name === "hardBreak" ? "\n" : String(leaf.attrs["source"] ?? ""),
  );
  const lines = text
    .split("\n")
    .map((line) => line.replace(/[!-/:-@[-`{-~]/g, "\\$&").trim());
  const out = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out === "" ? "" : out + "\n";
}

// Serializes an editor document descended from loaded.doc. Never throws: if
// the bridge fails, every block is written as escaped plain text.
export function serializeMarkdown(doc: Node, loaded: LoadedMarkdown): string {
  try {
    const state =
      states.get(loaded) ??
      states.get(parseMarkdown("", doc.type.schema)) ??
      null;
    if (state) return serialize(doc, state);
  } catch {
    // Fall through to the plain text form.
  }
  return escapedText(doc);
}
