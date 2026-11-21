import { Mark, type Node as PMNode } from "@tiptap/pm/model";
import {
  type DelimiterStyle,
  type InlineMark,
  inlineText,
  writeEscaped,
  writeInline,
} from "./inline";
import {
  convertMarkdown,
  heldLabels,
  type HeldDefinition,
  type SchemaTypes,
} from "./parse";
import { escapeLinkPart, normalizeLineEndings, parseSyntax } from "./syntax";

export interface SourceBlock {
  readonly text: string;
  readonly before: string;
  readonly node: PMNode;
  readonly frontMatter: boolean;
  readonly defines: readonly HeldDefinition[];
  readonly relies: readonly string[];
}

export interface Caches {
  readonly unchanged: WeakSet<PMNode>;
  readonly blocks: WeakMap<PMNode, Map<string, string | null>>;
  readonly inline: WeakMap<PMNode, Map<number, string>>;
  readonly rawDefinitions: Map<string, readonly HeldDefinition[]>;
  readonly definitionSets: Map<string, number>;
}

export interface LoadedState {
  readonly doc: PMNode;
  readonly source: string;
  readonly bom: string;
  readonly blocks: readonly SourceBlock[];
  readonly trailing: string;
  readonly effective: ReadonlyMap<string, number>;
  readonly types: SchemaTypes;
  readonly caches: Caches;
}

interface Writer {
  readonly t: SchemaTypes;
  readonly caches: Caches;
  // Definitions in effect, written before a block that is read back so its
  // references resolve; empty when the document has none.
  readonly definitions: string;
  readonly definitionsId: number;
}

const MARKER = "<!-- -->";

export function newCaches(): Caches {
  return {
    unchanged: new WeakSet(),
    blocks: new WeakMap(),
    inline: new WeakMap(),
    rawDefinitions: new Map(),
    definitionSets: new Map([["", 0]]),
  };
}

// Reads Markdown as top-level editor nodes, after the document's definitions
// when the text could refer to one.
function readNodes(text: string, w: Writer, atStart: boolean): PMNode[] {
  if (w.definitions === "" || !text.includes("[")) {
    return convertMarkdown(text, w.t).map((b) => b.node);
  }
  if (atStart) {
    const source = `${text}\n\n${MARKER}\n\n${w.definitions}`;
    return convertMarkdown(source, w.t)
      .filter((b) => b.start < text.length)
      .map((b) => b.node);
  }
  const prefix = `${w.definitions}\n\n${MARKER}\n\n`;
  return convertMarkdown(prefix + text, w.t)
    .filter((b) => b.start >= prefix.length)
    .map((b) => b.node);
}

function sameIgnoringSource(a: PMNode, b: PMNode): boolean {
  if (a.type !== b.type || !Mark.sameSet(a.marks, b.marks)) return false;
  for (const key of Object.keys(a.attrs)) {
    if (key !== "sourceIndex" && a.attrs[key] !== b.attrs[key]) return false;
  }
  return a.content.eq(b.content);
}

interface Step {
  readonly drop: ReadonlySet<InlineMark>;
  readonly style: DelimiterStyle;
}

const STEPS: readonly Step[] = [
  { drop: new Set(), style: "mixed" },
  { drop: new Set(), style: "asterisk" },
  { drop: new Set(["italic"]), style: "mixed" },
  { drop: new Set(["italic"]), style: "asterisk" },
  { drop: new Set(["italic", "bold"]), style: "mixed" },
  { drop: new Set(["italic", "bold", "link"]), style: "mixed" },
  { drop: new Set(["italic", "bold", "link", "code"]), style: "mixed" },
];

function headingPrefix(node: PMNode): string {
  return "#".repeat(Number(node.attrs["level"] ?? 1));
}

function render(node: PMNode, step: Step, t: SchemaTypes): string {
  const heading = node.type === t.heading;
  const lines = writeInline(node, { heading, ...step });
  if (!heading) return lines.join("\n");
  const content = lines.join(" ");
  return content ? `${headingPrefix(node)} ${content}` : headingPrefix(node);
}

// Writes a paragraph or heading canonically, falling back to fewer marks and
// then to escaped text, so what it writes reads back with the same text and
// writes the same bytes again.
class TextBlockWriter {
  private readonly reads = new Map<string, PMNode | null>();
  private readonly renders = new WeakMap<PMNode, Map<Step, string>>();

  constructor(private readonly w: Writer) {}

  private readOne(text: string, like: PMNode): PMNode | null {
    let node = this.reads.get(text);
    if (node === undefined) {
      const nodes = readNodes(text, this.w, false);
      const only = nodes.length === 1 ? nodes[0] : undefined;
      node = only ?? null;
      this.reads.set(text, node);
    }
    if (!node || node.type !== like.type) return null;
    if (node.attrs["level"] !== like.attrs["level"]) return null;
    return node;
  }

  private render(node: PMNode, step: Step): string {
    let byStep = this.renders.get(node);
    if (!byStep) {
      byStep = new Map();
      this.renders.set(node, byStep);
    }
    let text = byStep.get(step);
    if (text === undefined) {
      text = render(node, step, this.w.t);
      byStep.set(step, text);
    }
    return text;
  }

  private *candidates(node: PMNode): Generator<[string, Step]> {
    for (const step of STEPS) {
      const text = this.render(node, step);
      yield [text, step];
      const read = this.readOne(text, node);
      if (read) yield [this.render(read, step), step];
    }
  }

  private settles(text: string, step: Step, node: PMNode): PMNode | null {
    const read = this.readOne(text, node);
    if (!read || inlineText(read) !== inlineText(node)) return null;
    return this.render(read, step) === text ? read : null;
  }

  private shallow(node: PMNode): string | null {
    for (const [text, step] of this.candidates(node)) {
      if (this.settles(text, step, node)) return text;
    }
    return null;
  }

  canonical(node: PMNode): string | null {
    for (const [text, step] of this.candidates(node)) {
      const read = this.settles(text, step, node);
      if (read && this.shallow(read) === text) return text;
    }
    return null;
  }

  write(node: PMNode): string {
    const text = this.canonical(node);
    if (text !== null) return text;
    const lines = writeEscaped(node);
    const escaped =
      node.type === this.w.t.heading
        ? `${headingPrefix(node)} ${lines.join(" ")}`.trimEnd()
        : lines.join("\n");
    const read = this.readOne(escaped, node);
    if (read) {
      const normal = this.canonical(read);
      if (normal !== null) {
        const again = this.readOne(normal, node);
        if (again && inlineText(again) === inlineText(node)) return normal;
      }
    }
    return escaped;
  }
}

function writeTextBlock(node: PMNode, w: Writer): string {
  let byDefinitions = w.caches.inline.get(node);
  const cached = byDefinitions?.get(w.definitionsId);
  if (cached !== undefined) return cached;
  const text = new TextBlockWriter(w).write(node);
  if (!byDefinitions) {
    byDefinitions = new Map();
    w.caches.inline.set(node, byDefinitions);
  }
  byDefinitions.set(w.definitionsId, text);
  return text;
}

function writeCodeBlock(node: PMNode): string {
  const language = String(node.attrs["language"] ?? "").replace(/\s+/g, "");
  const text = normalizeLineEndings(node.textContent);
  const fenceChar = language.includes("`") ? "~" : "`";
  let longest = 0;
  for (const run of text.match(fenceChar === "`" ? /`+/g : /~+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  const fence = fenceChar.repeat(Math.max(3, longest + 1));
  const info = escapeLinkPart(language, /(?!)/);
  return [fence + info, ...(text === "" ? [] : text.split("\n")), fence].join(
    "\n",
  );
}

function bulletMarker(previous: string | null): string {
  const match = previous
    ? /^ {0,3}([-*+])(?:[ \t\r\n]|$)/.exec(previous)
    : null;
  return match?.[1] === "-" ? "*" : "-";
}

function orderedDelimiter(previous: string | null): string {
  const match = previous
    ? /^ {0,3}\d{1,9}([.)])(?:[ \t\r\n]|$)/.exec(previous)
    : null;
  return match?.[1] === "." ? ")" : ".";
}

function listMarker(node: PMNode, t: SchemaTypes, previous: string | null) {
  if (node.type === t.bulletList) return bulletMarker(previous);
  if (node.type === t.orderedList) return orderedDelimiter(previous);
  return "";
}

interface Written {
  readonly node: PMNode;
  readonly text: string;
}

function writeChildren(parent: PMNode, w: Writer): Written[] {
  const written: Written[] = [];
  parent.forEach((child) => {
    const previous = written[written.length - 1]?.text ?? null;
    const text = writeBlock(child, w, false, listMarker(child, w.t, previous));
    if (text !== null) written.push({ node: child, text });
  });
  return written;
}

// An ordered list not starting at 1 cannot interrupt a paragraph, even at the
// start of a block quote that does.
function opensLateList(node: PMNode | null, t: SchemaTypes): boolean {
  if (!node) return false;
  if (node.type === t.orderedList)
    return Number(node.attrs["start"] ?? 1) !== 1;
  return node.type === t.blockquote && opensLateList(node.firstChild, t);
}

// Whether a block in a list item needs a blank line before it, which makes
// the list loose.
function needsBlankLine(
  node: PMNode,
  previous: PMNode | undefined,
  t: SchemaTypes,
) {
  return (
    node.type === t.paragraph ||
    node.type === t.horizontalRule ||
    node.type === t.rawBlock ||
    opensLateList(node, t) ||
    (node.type === t.blockquote && previous?.type === t.blockquote)
  );
}

function writeList(node: PMNode, w: Writer, marker: string): string | null {
  const { t } = w;
  const ordered = node.type === t.orderedList;
  const startAttr = Number(node.attrs["start"] ?? 1);
  const start = Number.isFinite(startAttr)
    ? Math.max(0, Math.floor(startAttr))
    : 1;
  const items: Written[][] = [];
  node.forEach((item) => {
    const children = writeChildren(item, w);
    if (children.length > 0) items.push(children);
  });
  if (items.length === 0) return null;
  const loose =
    node.attrs["tight"] === false ||
    items.some((children) =>
      children.some(
        (child, i) =>
          i > 0 && needsBlankLine(child.node, children[i - 1]?.node, t),
      ),
    );
  const between = loose ? "\n\n" : "\n";
  return items
    .map((children, k) => {
      const bullet = ordered ? `${start + k}${marker}` : marker;
      const indent = " ".repeat(bullet.length + 1);
      return children
        .map((child) => child.text)
        .join(between)
        .split("\n")
        .map((line, i) => {
          if (i === 0) return line === "" ? bullet : `${bullet} ${line}`;
          return line === "" ? "" : indent + line;
        })
        .join("\n");
    })
    .join(between);
}

function writeBlock(
  node: PMNode,
  w: Writer,
  first: boolean,
  marker: string,
): string | null {
  const { t } = w;
  switch (node.type) {
    case t.paragraph:
      return inlineText(node) === "" ? null : writeTextBlock(node, w);
    case t.heading:
      return writeTextBlock(node, w);
    case t.horizontalRule:
      return first ? "***" : "---";
    case t.codeBlock:
      return writeCodeBlock(node);
    case t.rawBlock: {
      const text = node.textContent;
      return text === "" ? null : text;
    }
    case t.blockquote: {
      const children = writeChildren(node, w);
      if (children.length === 0) return null;
      return children
        .map((child) => child.text)
        .join("\n\n")
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    }
    case t.bulletList:
    case t.orderedList:
      return writeList(node, w, marker);
    default:
      return null;
  }
}

function writeTopLevel(
  node: PMNode,
  w: Writer,
  first: boolean,
  previous: string | null,
): string | null {
  const marker = listMarker(node, w.t, previous);
  const key = `${first ? 1 : 0}|${marker}|${w.definitionsId}`;
  let byContext = w.caches.blocks.get(node);
  const cached = byContext?.get(key);
  if (cached !== undefined) return cached;
  const text = writeBlock(node, w, first, marker);
  if (!byContext) {
    byContext = new Map();
    w.caches.blocks.set(node, byContext);
  }
  byContext.set(key, text);
  return text;
}

function rawDefinitions(
  text: string,
  caches: Caches,
): readonly HeldDefinition[] {
  let defines = caches.rawDefinitions.get(text);
  if (!defines) {
    defines = parseSyntax(text).children.flatMap(
      (child) => heldLabels(child).defines,
    );
    if (caches.rawDefinitions.size > 1000) caches.rawDefinitions.clear();
    caches.rawDefinitions.set(text, defines);
  }
  return defines;
}

interface Entry {
  readonly node: PMNode;
  readonly index: number | null;
  mode: "source" | "canonical";
  text: string | null;
}

function isUnchanged(node: PMNode, source: PMNode, caches: Caches): boolean {
  if (node === source || caches.unchanged.has(node)) return true;
  if (!node.eq(source)) return false;
  caches.unchanged.add(node);
  return true;
}

const FRONT_MATTER_FENCE = /^(?:---|\+\+\+)[ \t]*(?:\r?\n|\r|$)/;

export function serialize(doc: PMNode, loaded: LoadedState): string {
  if (doc === loaded.doc || doc.eq(loaded.doc)) return loaded.source;
  const { blocks, caches, types: t } = loaded;

  const entries: Entry[] = [];
  const inEffect = new Map<
    string,
    { block: number | null; synthetic: string }
  >();
  doc.forEach((node) => {
    const attr: unknown = node.attrs["sourceIndex"];
    const index = typeof attr === "number" ? attr : null;
    const source = index === null ? undefined : blocks[index];
    const unchanged =
      source !== undefined && isUnchanged(node, source.node, caches);
    entries.push({
      node,
      index: unchanged ? index : null,
      mode: unchanged ? "source" : "canonical",
      text: null,
    });
    if (node.type !== t.rawBlock) return;
    const defines = unchanged
      ? (source?.defines ?? [])
      : rawDefinitions(node.textContent, caches);
    for (const definition of defines) {
      if (!inEffect.has(definition.key)) {
        inEffect.set(definition.key, {
          block: unchanged ? index : null,
          synthetic: definition.synthetic,
        });
      }
    }
  });

  for (const entry of entries) {
    if (entry.mode !== "source" || entry.index === null) continue;
    for (const key of blocks[entry.index]?.relies ?? []) {
      const current = inEffect.get(key);
      if (!current || current.block !== loaded.effective.get(key)) {
        entry.mode = "canonical";
        break;
      }
    }
  }

  const definitions = [...inEffect.values()]
    .map((d) => d.synthetic)
    .join("\n\n");
  let definitionsId = caches.definitionSets.get(definitions);
  if (definitionsId === undefined) {
    definitionsId = caches.definitionSets.size;
    caches.definitionSets.set(definitions, definitionsId);
  }
  const w: Writer = { t, caches, definitions, definitionsId };

  const sourceOf = (entry: Entry) =>
    entry.mode === "source" && entry.index !== null
      ? blocks[entry.index]
      : undefined;
  const canonical = (entry: Entry, first: boolean, previous: string | null) => {
    entry.mode = "canonical";
    entry.text = writeTopLevel(entry.node, w, first, previous);
  };

  const written: Entry[] = [];
  for (const entry of entries) {
    const source = sourceOf(entry);
    if (source) entry.text = source.text;
    else {
      const previous = written[written.length - 1]?.text ?? null;
      canonical(entry, written.length === 0, previous);
    }
    if (entry.text !== null) written.push(entry);
  }

  // A first block that opens with a front matter fence could be closed as
  // front matter by a later line.
  const head = written[0];
  const headSource = head && sourceOf(head);
  if (head && headSource && !headSource.frontMatter) {
    const lead = head.index === 0 ? headSource.before : "";
    if (FRONT_MATTER_FENCE.test(lead + headSource.text)) {
      canonical(head, true, null);
    }
  }

  const textOf = (entry: Entry | undefined) => entry?.text ?? "";
  const adjacentInSource = (a: Entry, b: Entry) =>
    a.mode === "source" &&
    b.mode === "source" &&
    a.index !== null &&
    b.index === a.index + 1;
  const expected = (entry: Entry, atStart: boolean): PMNode[] => {
    const source = sourceOf(entry);
    return source ? [source.node] : readNodes(textOf(entry), w, atStart);
  };
  const readsSame = (k: number): boolean => {
    const a = written[k - 1];
    const b = written[k];
    if (!a || !b) return true;
    const atStart = k - 1 === 0;
    const got = readNodes(`${textOf(a)}\n\n${textOf(b)}`, w, atStart);
    const want = [...expected(a, atStart), ...expected(b, false)];
    return (
      got.length === want.length &&
      got.every((node, i) => {
        const other = want[i];
        return other !== undefined && sameIgnoringSource(node, other);
      })
    );
  };
  const rewriteFollowing = (k: number) => {
    for (let i = k + 1; i < written.length; i++) {
      const entry = written[i];
      if (!entry || entry.mode !== "canonical") return;
      const before = entry.text;
      canonical(entry, false, textOf(written[i - 1]));
      if (entry.text === before) return;
    }
  };

  let k = 1;
  let budget = written.length * 4 + 16;
  while (k < written.length && budget-- > 0) {
    const a = written[k - 1];
    const b = written[k];
    if (!a || !b) break;
    const involvesSource = a.mode === "source" || b.mode === "source";
    if (involvesSource && !adjacentInSource(a, b) && !readsSame(k)) {
      if (b.mode === "source") {
        canonical(b, false, textOf(a));
        rewriteFollowing(k);
        continue;
      }
      if (a.mode === "source") {
        canonical(a, k - 1 === 0, k >= 2 ? textOf(written[k - 2]) : null);
        rewriteFollowing(k - 1);
        k = Math.max(1, k - 1);
        continue;
      }
    }
    k++;
  }

  const first = written[0];
  if (!first) return "";
  const firstSource = sourceOf(first);
  let out =
    loaded.bom + (firstSource && first.index === 0 ? firstSource.before : "");
  out += textOf(first);
  for (let i = 1; i < written.length; i++) {
    const a = written[i - 1];
    const b = written[i];
    if (!a || !b) continue;
    const source = sourceOf(b);
    out +=
      (source && adjacentInSource(a, b) ? source.before : "\n\n") + textOf(b);
  }
  const last = written[written.length - 1];
  const lastSource = last && sourceOf(last);
  out +=
    lastSource && last.index === blocks.length - 1 ? loaded.trailing : "\n";
  return out;
}
