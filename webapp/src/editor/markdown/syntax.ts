import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";

// The GFM extensions are listed one by one to leave out bare-URL links.
const options = {
  extensions: [
    frontmatter(["yaml", "toml"]),
    gfmTable(),
    gfmStrikethrough(),
    gfmFootnote(),
    gfmTaskListItem(),
  ],
  mdastExtensions: [
    frontmatterFromMarkdown(["yaml", "toml"]),
    gfmTableFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmFootnoteFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  ],
};

export function parseSyntax(markdown: string): Root {
  return fromMarkdown(markdown, options);
}

const whitespace = /^\s$/u;
const punctuation = /^[\p{P}\p{S}]$/u;
const alphanumeric = /^[\p{L}\p{N}]$/u;

// An empty string stands for the start or end of a line.
export function isWhitespace(ch: string): boolean {
  return ch === "" || whitespace.test(ch);
}

export function isPunctuation(ch: string): boolean {
  return ch !== "" && punctuation.test(ch);
}

export function isAlphanumeric(ch: string): boolean {
  return ch !== "" && alphanumeric.test(ch);
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function lineEndingsToSpaces(text: string): string {
  return text.replace(/\r\n?|\n/g, " ");
}

export function countLineEndings(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) count++;
    else if (code === 13 && text.charCodeAt(i + 1) !== 10) count++;
  }
  return count;
}

const characterReference =
  /^(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/;

export function startsCharacterReference(rest: string): boolean {
  return characterReference.test(rest);
}

// Escapes a link destination or title, where backslash escapes and character
// references are recognized.
export function escapeLinkPart(text: string, extra: RegExp): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\\" || extra.test(ch)) out += "\\" + ch;
    else if (ch === "&" && startsCharacterReference(text.slice(i + 1)))
      out += "\\&";
    else out += ch;
  }
  return out;
}
