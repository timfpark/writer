import type {
  Mark,
  MarkType,
  Node as PMNode,
  NodeType,
  Schema,
} from "@tiptap/pm/model";
import type { Nodes, PhrasingContent, Root, RootContent } from "mdast";
import {
  countLineEndings,
  escapeLinkPart,
  lineEndingsToSpaces,
  normalizeLineEndings,
  parseSyntax,
} from "./syntax";

export interface SchemaTypes {
  readonly schema: Schema;
  readonly doc: NodeType;
  readonly paragraph: NodeType;
  readonly heading: NodeType;
  readonly blockquote: NodeType;
  readonly bulletList: NodeType;
  readonly orderedList: NodeType;
  readonly listItem: NodeType;
  readonly codeBlock: NodeType;
  readonly horizontalRule: NodeType;
  readonly hardBreak: NodeType;
  readonly rawBlock: NodeType;
  readonly rawInline: NodeType;
  readonly italic: MarkType;
  readonly bold: MarkType;
  readonly code: MarkType;
  readonly link: MarkType;
}

const typesBySchema = new WeakMap<Schema, SchemaTypes>();

export function schemaTypes(schema: Schema): SchemaTypes {
  const cached = typesBySchema.get(schema);
  if (cached) return cached;
  const node = (name: string): NodeType => {
    const type = schema.nodes[name];
    if (!type) throw new Error(`the editor schema has no '${name}' node`);
    return type;
  };
  const mark = (name: string): MarkType => {
    const type = schema.marks[name];
    if (!type) throw new Error(`the editor schema has no '${name}' mark`);
    return type;
  };
  const types: SchemaTypes = {
    schema,
    doc: node("doc"),
    paragraph: node("paragraph"),
    heading: node("heading"),
    blockquote: node("blockquote"),
    bulletList: node("bulletList"),
    orderedList: node("orderedList"),
    listItem: node("listItem"),
    codeBlock: node("codeBlock"),
    horizontalRule: node("horizontalRule"),
    hardBreak: node("hardBreak"),
    rawBlock: node("rawBlock"),
    rawInline: node("rawInline"),
    italic: mark("italic"),
    bold: mark("bold"),
    code: mark("code"),
    link: mark("link"),
  };
  typesBySchema.set(schema, types);
  return types;
}

// A definition a block holds, keyed by namespace and normalized label, with a
// minimal Markdown form that defines the same label to the same target.
export interface HeldDefinition {
  readonly key: string;
  readonly synthetic: string;
}

export interface ConvertedBlock {
  readonly node: PMNode;
  readonly start: number;
  readonly end: number;
  readonly frontMatter: boolean;
  readonly defines: readonly HeldDefinition[];
  readonly relies: readonly string[];
}

class OutsideSubset extends Error {}

interface Target {
  readonly url: string;
  readonly title: string | null;
}

interface Context {
  readonly source: string;
  readonly t: SchemaTypes;
  readonly targets: ReadonlyMap<string, Target>;
}

function startOf(node: Nodes): number {
  return node.position?.start.offset ?? 0;
}

function endOf(node: Nodes): number {
  return node.position?.end.offset ?? 0;
}

function hasChildren(node: Nodes): node is Nodes & { children: Nodes[] } {
  return "children" in node && Array.isArray(node.children);
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if (hasChildren(node)) for (const child of node.children) walk(child, visit);
}

function linkTitle(title: string | null | undefined): string | null {
  return title ? lineEndingsToSpaces(title) : null;
}

function collectTargets(root: Root): Map<string, Target> {
  const targets = new Map<string, Target>();
  walk(root, (node) => {
    if (node.type === "definition" && !targets.has(node.identifier)) {
      targets.set(node.identifier, {
        url: node.url,
        title: linkTitle(node.title),
      });
    }
  });
  return targets;
}

function labelText(label: string | null | undefined, identifier: string) {
  return lineEndingsToSpaces(label ?? identifier);
}

export function heldLabels(node: Nodes): {
  defines: HeldDefinition[];
  relies: string[];
} {
  const defines: HeldDefinition[] = [];
  const relies: string[] = [];
  walk(node, (n) => {
    switch (n.type) {
      case "definition": {
        const title =
          n.title == null ? "" : ` "${escapeLinkPart(n.title, /"/)}"`;
        defines.push({
          key: `link:${n.identifier}`,
          synthetic: `[${labelText(n.label, n.identifier)}]: <${escapeLinkPart(
            n.url.replace(/\r\n?|\n/g, ""),
            /[<>]/,
          )}>${lineEndingsToSpaces(title)}`,
        });
        break;
      }
      case "footnoteDefinition":
        defines.push({
          key: `fn:${n.identifier}`,
          synthetic: `[^${labelText(n.label, n.identifier)}]: x`,
        });
        break;
      case "linkReference":
      case "imageReference":
        relies.push(`link:${n.identifier}`);
        break;
      case "footnoteReference":
        relies.push(`fn:${n.identifier}`);
        break;
      default:
        break;
    }
  });
  return { defines, relies };
}

function rawInline(node: Nodes, c: Context, marks: readonly Mark[]): PMNode {
  const source = c.source.slice(startOf(node), endOf(node));
  if (/[\r\n]/.test(source)) throw new OutsideSubset();
  return c.t.rawInline.create({ source }, null, marks);
}

function inlines(
  children: readonly PhrasingContent[],
  c: Context,
  marks: readonly Mark[],
  out: PMNode[],
): PMNode[] {
  const { t } = c;
  for (const child of children) {
    switch (child.type) {
      case "text": {
        const text = lineEndingsToSpaces(child.value);
        if (text) out.push(t.schema.text(text, marks));
        break;
      }
      case "emphasis":
        inlines(child.children, c, t.italic.create().addToSet(marks), out);
        break;
      case "strong":
        inlines(child.children, c, t.bold.create().addToSet(marks), out);
        break;
      case "inlineCode": {
        const text = lineEndingsToSpaces(child.value);
        if (text)
          out.push(t.schema.text(text, t.code.create().addToSet(marks)));
        break;
      }
      case "link": {
        const link = t.link.create({
          href: child.url,
          title: linkTitle(child.title),
        });
        inlines(child.children, c, link.addToSet(marks), out);
        break;
      }
      case "linkReference": {
        const target = c.targets.get(child.identifier);
        if (!target) throw new OutsideSubset();
        const link = t.link.create({ href: target.url, title: target.title });
        inlines(child.children, c, link.addToSet(marks), out);
        break;
      }
      case "break":
        out.push(t.hardBreak.create());
        break;
      case "image":
      case "imageReference":
      case "html":
      case "delete":
      case "footnoteReference":
        out.push(rawInline(child, c, marks));
        break;
      default:
        throw new OutsideSubset();
    }
  }
  return out;
}

function isLoose(list: Nodes & { children: Nodes[] }, source: string): boolean {
  const gapHasBlankLine = (a: Nodes, b: Nodes) =>
    countLineEndings(source.slice(endOf(a), startOf(b))) >= 2;
  const items = list.children;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const previous = items[i - 1];
    if (previous && gapHasBlankLine(previous, item)) return true;
    if (hasChildren(item)) {
      for (let j = 1; j < item.children.length; j++) {
        const a = item.children[j - 1];
        const b = item.children[j];
        if (a && b && gapHasBlankLine(a, b)) return true;
      }
    }
  }
  return false;
}

function block(node: Nodes, c: Context): PMNode {
  const { t } = c;
  switch (node.type) {
    case "paragraph":
      return t.paragraph.create(null, inlines(node.children, c, [], []));
    case "heading": {
      const content = inlines(node.children, c, [], []);
      if (content.some((n) => n.type === t.hardBreak))
        throw new OutsideSubset();
      return t.heading.create({ level: node.depth }, content);
    }
    case "thematicBreak":
      return t.horizontalRule.create();
    case "code": {
      if (node.meta != null) throw new OutsideSubset();
      const text = normalizeLineEndings(node.value);
      return t.codeBlock.create(
        { language: node.lang || null },
        text ? t.schema.text(text) : null,
      );
    }
    case "blockquote":
      if (node.children.length === 0) throw new OutsideSubset();
      return t.blockquote.create(
        null,
        node.children.map((child) => block(child, c)),
      );
    case "list": {
      const items = node.children.map((item) => {
        if (item.checked != null || item.children[0]?.type !== "paragraph") {
          throw new OutsideSubset();
        }
        return t.listItem.create(
          null,
          item.children.map((child) => block(child, c)),
        );
      });
      const tight = !isLoose(node, c.source);
      return node.ordered
        ? t.orderedList.create({ start: node.start ?? 1, tight }, items)
        : t.bulletList.create({ tight }, items);
    }
    default:
      throw new OutsideSubset();
  }
}

export function rawBlock(t: SchemaTypes, source: string): PMNode {
  const text = normalizeLineEndings(source);
  return t.rawBlock.create(null, text ? t.schema.text(text) : null);
}

function topLevel(node: RootContent, c: Context): ConvertedBlock {
  const start = startOf(node);
  const end = endOf(node);
  let converted: PMNode;
  try {
    converted = block(node, c);
  } catch (error) {
    if (!(error instanceof OutsideSubset)) throw error;
    converted = rawBlock(c.t, c.source.slice(start, end));
  }
  const type: string = node.type;
  return {
    node: converted,
    start,
    end,
    frontMatter: type === "yaml" || type === "toml",
    ...heldLabels(node),
  };
}

export function convertMarkdown(
  source: string,
  t: SchemaTypes,
): ConvertedBlock[] {
  const root = parseSyntax(source);
  const c: Context = { source, t, targets: collectTargets(root) };
  return root.children.map((child) => topLevel(child, c));
}

// Parses Markdown into top-level editor nodes, without source tracking.
export function readBlocks(source: string, t: SchemaTypes): PMNode[] {
  return convertMarkdown(source, t).map((converted) => converted.node);
}
