import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import {
  escapeLinkPart,
  isAlphanumeric,
  isPunctuation,
  isWhitespace,
  lineEndingsToSpaces,
  startsCharacterReference,
} from "./syntax";

// "mixed" writes `_` or `__` for emphasis that opens directly beside another
// run's closing `*`; "asterisk" writes `*` throughout.
export type DelimiterStyle = "mixed" | "asterisk";

export type InlineMark = "italic" | "bold" | "link" | "code";

export interface InlineOptions {
  readonly heading: boolean;
  readonly style: DelimiterStyle;
  readonly drop: ReadonlySet<string>;
}

const CHAR = 0;
const RAW = 1;
const BREAK = 2;

interface Units {
  readonly kind: number[];
  readonly text: string[];
  readonly em: boolean[];
  readonly strong: boolean[];
  readonly code: boolean[];
  readonly link: (Mark | null)[];
}

function collectUnits(node: PMNode, drop: ReadonlySet<string>): Units {
  const u: Units = {
    kind: [],
    text: [],
    em: [],
    strong: [],
    code: [],
    link: [],
  };
  const push = (kind: number, text: string, marks: readonly Mark[]) => {
    let em = false;
    let strong = false;
    let code = false;
    let link: Mark | null = null;
    for (const mark of marks) {
      const name = mark.type.name;
      if (drop.has(name)) continue;
      if (name === "italic") em = true;
      else if (name === "bold") strong = true;
      else if (name === "code") code = kind === CHAR;
      else if (name === "link") link = mark;
    }
    u.kind.push(kind);
    u.text.push(text);
    u.em.push(em && kind !== BREAK);
    u.strong.push(strong && kind !== BREAK);
    u.code.push(code);
    u.link.push(link);
  };
  node.forEach((child) => {
    if (child.isText) {
      for (const ch of lineEndingsToSpaces(child.text ?? "")) {
        push(CHAR, ch, child.marks);
      }
    } else if (child.type.name === "rawInline") {
      push(RAW, String(child.attrs["source"] ?? ""), child.marks);
    } else if (child.type.name === "hardBreak") {
      push(BREAK, "", []);
    }
  });
  // A hard break that ends a paragraph is dropped.
  let end = u.kind.length;
  while (end > 0 && u.kind[end - 1] === BREAK) end--;
  u.kind.length = end;
  u.text.length = end;
  u.em.length = end;
  u.strong.length = end;
  u.code.length = end;
  u.link.length = end;
  for (let i = 0; i < u.kind.length; i++) {
    if (u.kind[i] !== BREAK) continue;
    const before = u.link[i - 1] ?? null;
    const after = u.link[i + 1] ?? null;
    u.link[i] = before && after && before.eq(after) ? before : null;
  }
  return u;
}

type Token =
  | { readonly t: "text"; s: string }
  | { readonly t: "lit"; readonly s: string }
  | {
      readonly t: "delim";
      readonly mark: "em" | "strong";
      readonly open: boolean;
      readonly unit: number;
      s: string;
    }
  | { readonly t: "br" };

type Active = "link" | "strong" | "em" | "code";

const RANK: Record<Active, number> = { link: 0, strong: 1, em: 2, code: 3 };

function has(u: Units, mark: Active, i: number): boolean {
  if (mark === "link") return u.link[i] != null;
  return (
    (mark === "em" ? u.em : mark === "strong" ? u.strong : u.code)[i] === true
  );
}

function same(u: Units, mark: Active, a: number, b: number): boolean {
  if (mark !== "link") return has(u, mark, a) && has(u, mark, b);
  const x = u.link[a];
  const y = u.link[b];
  return x != null && y != null && x.eq(y);
}

function runEnds(u: Units, mark: Active): number[] {
  const n = u.kind.length;
  const ends = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (!has(u, mark, i)) continue;
    ends[i] = i + 1 < n && same(u, mark, i, i + 1) ? (ends[i + 1] ?? 0) : i + 1;
  }
  return ends;
}

// A backtick fence longer than any backtick run in the text.
export function codeFence(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return "`".repeat(longest + 1);
}

export function codeSpan(text: string): string {
  const fence = codeFence(text);
  const pad =
    text.startsWith("`") ||
    text.endsWith("`") ||
    (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text));
  const space = pad ? " " : "";
  return fence + space + text + space + fence;
}

const NEVER = /(?!)/;

function needsAngleBrackets(href: string): boolean {
  for (let i = 0; i < href.length; i++) {
    const code = href.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return /[\s()<>]/.test(href);
}

export function linkTail(mark: Mark): string {
  const href = String(mark.attrs["href"] ?? "").replace(/[\r\n]/g, "");
  const rawTitle: unknown = mark.attrs["title"];
  const title =
    typeof rawTitle === "string" && rawTitle !== ""
      ? ` "${escapeLinkPart(lineEndingsToSpaces(rawTitle), /"/)}"`
      : "";
  let destination: string;
  if (href === "") destination = title ? "<>" : "";
  else if (needsAngleBrackets(href)) {
    destination = `<${escapeLinkPart(href, /[<>]/)}>`;
  } else destination = escapeLinkPart(href, NEVER);
  return `](${destination}${title})`;
}

function generate(u: Units): Token[] {
  const n = u.kind.length;
  const ends: Record<Active, number[]> = {
    link: runEnds(u, "link"),
    strong: runEnds(u, "strong"),
    em: runEnds(u, "em"),
    code: runEnds(u, "code"),
  };
  const tokens: Token[] = [];
  const stack: { mark: Active; link: Mark | null; unit: number }[] = [];
  let codeText = "";

  const close = (boundary: number) => {
    const top = stack.pop();
    if (!top) return;
    if (top.mark === "code") {
      tokens.push({ t: "lit", s: codeSpan(codeText) });
      codeText = "";
    } else if (top.mark === "link" && top.link) {
      tokens.push({ t: "lit", s: linkTail(top.link) });
    } else if (top.mark === "em" || top.mark === "strong") {
      tokens.push({
        t: "delim",
        mark: top.mark,
        open: false,
        unit: boundary - 1,
        s: "",
      });
    }
  };

  for (let i = 0; i <= n; i++) {
    const desired: Active[] = [];
    if (i < n) {
      for (const mark of ["link", "strong", "em"] as const) {
        if (has(u, mark, i)) desired.push(mark);
      }
      // Longer runs open outside shorter ones; ties keep the order already
      // open, so a run never closes only to reopen.
      const held = (mark: Active) => {
        const at = stack.findIndex((entry) => entry.mark === mark);
        return at < 0 ? stack.length : at;
      };
      desired.sort(
        (a, b) =>
          (ends[b][i] ?? 0) - (ends[a][i] ?? 0) ||
          held(a) - held(b) ||
          RANK[a] - RANK[b],
      );
      if (u.code[i]) desired.push("code");
    }
    let keep = 0;
    while (keep < stack.length && keep < desired.length) {
      const entry = stack[keep];
      const mark = desired[keep];
      if (!entry || entry.mark !== mark) break;
      if (mark === "link" && !(entry.link && u.link[i]?.eq(entry.link))) break;
      if (mark !== "link" && !same(u, mark, entry.unit, i)) break;
      keep++;
    }
    while (stack.length > keep) close(i);
    if (i === n) break;
    for (const mark of desired.slice(keep)) {
      const link = mark === "link" ? (u.link[i] ?? null) : null;
      stack.push({ mark, link, unit: i });
      if (mark === "link") tokens.push({ t: "lit", s: "[" });
      else if (mark === "em" || mark === "strong") {
        tokens.push({ t: "delim", mark, open: true, unit: i, s: "" });
      }
    }
    const kind = u.kind[i];
    const text = u.text[i] ?? "";
    if (kind === BREAK) tokens.push({ t: "br" });
    else if (kind === RAW) tokens.push({ t: "lit", s: text });
    else if (u.code[i]) codeText += text;
    else {
      const last = tokens[tokens.length - 1];
      if (last?.t === "text") last.s += text;
      else tokens.push({ t: "text", s: text });
    }
  }
  return tokens;
}

function escapeText(s: string, beforeBracket: boolean): string {
  const chars = Array.from(s);
  let out = "";
  let offset = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    switch (ch) {
      case "\\":
      case "`":
      case "*":
      case "[":
      case "]":
      case "~":
      case "|":
        out += "\\" + ch;
        break;
      case "_":
        out +=
          isAlphanumeric(chars[i - 1] ?? "") &&
          isAlphanumeric(chars[i + 1] ?? "")
            ? "_"
            : "\\_";
        break;
      case "<": {
        const next = chars[i + 1];
        out += next === " " || next === "\t" ? "<" : "\\<";
        break;
      }
      case "&":
        out += startsCharacterReference(s.slice(offset + 1)) ? "\\&" : "&";
        break;
      case "!":
        out += i === chars.length - 1 && beforeBracket ? "\\!" : "!";
        break;
      default:
        out += ch;
    }
    offset += ch.length;
  }
  return out;
}

function entity(ch: string): string {
  return ch === "\t" ? "&#9;" : "&#32;";
}

function escapeLineStart(s: string): string {
  const first = s.charAt(0);
  if (first === " " || first === "\t") return entity(first) + s.slice(1);
  if (/^#{1,6}(?=[ \t]|$)/.test(s) || /^[>+=-]/.test(s)) return "\\" + s;
  const number = /^(\d{1,9})([.)])/.exec(s);
  if (number?.[1] && number[2]) {
    return `${number[1]}\\${number[2]}${s.slice(number[0].length)}`;
  }
  return s;
}

function escapeLineEnd(s: string): string {
  const last = s.charAt(s.length - 1);
  return last === " " || last === "\t" ? s.slice(0, -1) + entity(last) : s;
}

function finish(tokens: Token[], heading: boolean): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.t !== "text") continue;
    const previous = tokens[i - 1];
    const next = tokens[i + 1];
    const beforeBracket = next?.t === "lit" && next.s.startsWith("[");
    let s = escapeText(token.s, beforeBracket);
    if (!previous || previous.t === "br") {
      if (heading) {
        const first = s.charAt(0);
        if (first === " " || first === "\t") s = entity(first) + s.slice(1);
      } else s = escapeLineStart(s);
    }
    if (!next) s = escapeLineEnd(s);
    token.s = s;
  }
}

interface Problem {
  readonly mark: "em" | "strong";
  readonly unit: number;
  readonly open: boolean;
}

function tokenString(token: Token): string {
  return token.t === "br" ? "\\\n" : token.s;
}

function assignDelimiters(tokens: Token[], style: DelimiterStyle): void {
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i]?.t !== "delim") {
      i++;
      continue;
    }
    let j = i;
    while (tokens[j]?.t === "delim") j++;
    const cluster = tokens.slice(i, j);
    const mixed =
      style === "mixed" &&
      cluster.some((t) => t.t === "delim" && !t.open) &&
      cluster.some((t) => t.t === "delim" && t.open);
    for (const token of cluster) {
      if (token.t !== "delim") continue;
      const ch = mixed && token.open ? "_" : "*";
      token.s = token.mark === "strong" ? ch + ch : ch;
    }
    i = j;
  }
}

function flankingProblems(tokens: Token[]): Problem[] {
  const problems: Problem[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token?.t !== "delim") {
      i++;
      continue;
    }
    const ch = token.s.charAt(0);
    let j = i;
    for (;;) {
      const next = tokens[j];
      if (next?.t !== "delim" || next.s.charAt(0) !== ch) break;
      j++;
    }
    const before = tokens[i - 1];
    const after = tokens[j];
    const prev =
      before && before.t !== "br" ? tokenString(before).slice(-1) : "";
    const next = after && after.t !== "br" ? tokenString(after).charAt(0) : "";
    const left =
      !isWhitespace(next) &&
      (!isPunctuation(next) || isWhitespace(prev) || isPunctuation(prev));
    const right =
      !isWhitespace(prev) &&
      (!isPunctuation(prev) || isWhitespace(next) || isPunctuation(next));
    const canOpen = ch === "*" ? left : left && (!right || isPunctuation(prev));
    const canClose =
      ch === "*" ? right : right && (!left || isPunctuation(next));
    for (let k = i; k < j; k++) {
      const delim = tokens[k];
      if (delim?.t !== "delim") continue;
      if (delim.open ? !canOpen : !canClose) {
        problems.push({ mark: delim.mark, unit: delim.unit, open: delim.open });
      }
    }
    i = Math.max(j, i + 1);
  }
  return problems;
}

// Removes a mark from the unit beside a delimiter that cannot open or close.
// A code span inside the delimiter loses the mark as a whole.
function fix(u: Units, problem: Problem): void {
  const flags = problem.mark === "em" ? u.em : u.strong;
  const step = problem.open ? 1 : -1;
  let i = problem.unit;
  flags[i] = false;
  if (!u.code[i]) return;
  for (i += step; u.code[i] === true && flags[i] === true; i += step) {
    flags[i] = false;
  }
}

function trimWhitespace(u: Units): void {
  const n = u.kind.length;
  const blank = (k: number) =>
    u.kind[k] === CHAR && !u.code[k] && isWhitespace(u.text[k] ?? "");
  for (const flags of [u.em, u.strong]) {
    let i = 0;
    while (i < n) {
      if (!flags[i]) {
        i++;
        continue;
      }
      let end = i;
      while (end + 1 < n && flags[end + 1]) end++;
      let first = i;
      let last = end;
      while (first <= last && blank(first)) flags[first++] = false;
      while (last >= first && blank(last)) flags[last--] = false;
      i = end + 1;
    }
  }
}

function writeTokens(tokens: Token[]): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    if (token.t === "br") {
      lines.push(line + "\\");
      line = "";
    } else line += token.s;
  }
  lines.push(line);
  return lines;
}

// Writes the inline content of a paragraph or heading as lines, which hard
// breaks separate.
export function writeInline(node: PMNode, options: InlineOptions): string[] {
  const u = collectUnits(node, options.drop);
  trimWhitespace(u);
  let tokens: Token[] = [];
  for (let attempt = 0; attempt <= u.kind.length; attempt++) {
    tokens = generate(u);
    finish(tokens, options.heading);
    assignDelimiters(tokens, options.style);
    const problems = flankingProblems(tokens);
    if (problems.length === 0) break;
    for (const problem of problems) fix(u, problem);
    trimWhitespace(u);
  }
  const lines = writeTokens(tokens);
  if (options.heading) {
    const last = lines.length - 1;
    const text = lines[last] ?? "";
    const closing = /(^|[ \t])(#+)$/.exec(text);
    if (closing) {
      const at = closing.index + (closing[1]?.length ?? 0);
      lines[last] = `${text.slice(0, at)}\\${text.slice(at)}`;
    }
  }
  return lines;
}

// The text a paragraph or heading reads as: raw inline atoms as their source,
// hard breaks as line feeds, apart from those that end it.
export function inlineText(node: PMNode): string {
  let text = "";
  node.forEach((child) => {
    if (child.isText) text += lineEndingsToSpaces(child.text ?? "");
    else if (child.type.name === "rawInline") {
      text += String(child.attrs["source"] ?? "");
    } else if (child.type.name === "hardBreak") text += "\n";
  });
  return text.replace(/\n+$/, "");
}

// Every ASCII punctuation character escaped, which CommonMark always reads as
// exactly the text written.
export function writeEscaped(node: PMNode): string[] {
  return inlineText(node)
    .split("\n")
    .map((line) => {
      const escaped = line.replace(/[!-/:-@[-`{-~]/g, "\\$&");
      return escapeLineEnd(
        escaped.startsWith(" ") || escaped.startsWith("\t")
          ? entity(escaped.charAt(0)) + escaped.slice(1)
          : escaped,
      );
    })
    .map((line, i, all) => (i < all.length - 1 ? line + "\\" : line));
}
