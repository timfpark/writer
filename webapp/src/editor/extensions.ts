import {
  Extension,
  getSchema,
  mergeAttributes,
  Node,
  type AnyExtension,
} from "@tiptap/core";
import { Bold } from "@tiptap/extension-bold";
import { Code } from "@tiptap/extension-code";
import { Heading } from "@tiptap/extension-heading";
import { Italic } from "@tiptap/extension-italic";
import type { Schema } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import { FormattingMarkers } from "./formattingMarkers";
import { CaretAfterTyping, LineBreaks } from "./lineBreaks";
import { PassageHighlights } from "./passageHighlights";

export const TOP_LEVEL_BLOCKS = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "codeBlock",
  "horizontalRule",
  "rawBlock",
] as const;

// Markdown source outside the subset, kept as one top-level block and edited
// as plain text.
export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  parseHTML() {
    return [{ tag: "pre[data-raw-block]", preserveWhitespace: "full" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "pre",
      mergeAttributes(HTMLAttributes, {
        "data-raw-block": "",
        class: "raw-block",
        role: "group",
        "aria-label": "Markdown source",
        spellcheck: "false",
      }),
      ["code", 0],
    ];
  },
});

// An inline construct outside the subset, such as an image or inline HTML,
// held as its source.
export const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) => element.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-raw-inline]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-raw-inline": "",
        class: "raw-inline",
      }),
      String(node.attrs["source"] ?? ""),
    ];
  },

  renderText({ node }) {
    return String(node.attrs["source"] ?? "");
  },
});

// Attributes the Markdown bridge relies on that never render into HTML, so
// copied and pasted content never carries them.
const BridgeAttributes = Extension.create({
  name: "markdownBridgeAttributes",

  addGlobalAttributes() {
    return [
      {
        types: [...TOP_LEVEL_BLOCKS],
        attributes: {
          sourceIndex: {
            default: null,
            rendered: false,
            keepOnSplit: false,
            parseHTML: () => null,
          },
        },
      },
      {
        types: ["bulletList", "orderedList"],
        attributes: {
          tight: { default: true, rendered: false, parseHTML: () => null },
        },
      },
    ];
  },
});

export function editorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      bold: false,
      italic: false,
      strike: false,
      underline: false,
      code: false,
      heading: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
      },
      undoRedo: { depth: 500, newGroupDelay: 500 },
    }),
    // Formatting never carries onto a new line or into a new paragraph, and
    // the formatting markers replace Tiptap's exit from a code span.
    Bold.extend({ keepOnSplit: false }),
    Italic.extend({ keepOnSplit: false }),
    Code.extend({ excludes: "", keepOnSplit: false, exitable: false }),
    Heading.extend({ content: "(text | rawInline)*" }).configure({
      levels: [1, 2, 3, 4, 5, 6],
    }),
    RawBlock,
    RawInline,
    BridgeAttributes,
    LineBreaks,
    CaretAfterTyping,
    FormattingMarkers,
    PassageHighlights,
  ];
}

export function editorSchema(): Schema {
  return getSchema(editorExtensions());
}
