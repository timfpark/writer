---
title: "ADR 0008: Editor, Markdown subset, round trip, and autosave timing"
description: Selects Tiptap 3 on ProseMirror with a Writer-owned Markdown bridge on micromark, defines the supported Markdown subset and its canonical form, keeps Markdown outside the subset as raw source, guarantees identical bytes for unedited documents and blocks, and sets input rules, undo history, autosave timing and flush events, document styles, the bundle budget, responsiveness targets, and the path to anchored pair-writer suggestions
author: Tim Park
ms.date: 2026-11-21
ms.topic: reference
status: Accepted
subsystems:
  - webapp
keywords:
  - adr
  - webapp
  - editor
  - tiptap
  - prosemirror
  - markdown
  - commonmark
  - micromark
  - round trip
  - autosave
estimated_reading_time: 18
---

## Status

Accepted on 2026-11-20.

Amended on 2026-11-21, when backlog 33 found that `Enter` always left a
paragraph gap and that hidden markers left writers unable to see or end
formatting. `Enter` now breaks the line in a paragraph, and twice starts a
new one. Formatting never carries onto a new line or into a new paragraph,
and the Markdown markers of the formatted run at the caret show as
decorations, with a caret stop on each side. The Markdown subset, its
canonical form, and the round trip do not change.

This record settles the editor decisions that
[ADR 0005](./0005-workspace-model.md#follow-up-decisions) left open: the
Markdown subset, its canonical form, and when autosave fires. It also settles
what [ADR 0007](./0007-webapp-interface.md#follow-up-decisions) left to it:
the bundle budget, the flush events that drive unsaved-text writes, and
styles for document content.

## Decision summary

* Edit documents with Tiptap 3 on ProseMirror through `@tiptap/react`, using
  StarterKit without strikethrough and underline. Tiptap's own Markdown
  extension is not used.
* Read Markdown with a Writer-owned bridge on `mdast-util-from-markdown` 2.1
  and micromark: CommonMark, plus GFM tables, strikethrough, footnotes, and
  task lists, and YAML or TOML front matter, but not GFM's bare-URL links.
  Write Markdown with a Writer-owned serializer.
* Edit paragraphs, headings 1 to 6, emphasis, strong emphasis, code spans,
  links, hard line breaks, block quotes, nested bullet and ordered lists, code
  blocks, and thematic breaks. Each has one canonical form: one line per
  paragraph, `*` and `**`, `-` bullets, `N.` numbers, backtick fences, `---`
  rules, LF line endings, one blank line between blocks, and one final
  newline.
* Break the line on `Enter` in a paragraph and start a new paragraph on
  `Enter` twice. Never carry formatting onto a new line or into a new
  paragraph, and show the Markdown markers of the formatted run at the caret
  as decorations, with a caret stop inside and outside each.
* Never drop Markdown outside the subset. A top-level block that holds any of
  it becomes a raw block, shown and edited as source, and an image, inline
  HTML, strikethrough, or footnote reference inside a paragraph becomes a raw
  inline atom holding its source.
* Guarantee the round trip. Saving a document without edits writes identical
  bytes, whatever wrote it. A top-level block the writer has not changed keeps
  its exact bytes when others change, unless it would read differently beside
  a new neighbor. A canonical document serializes to identical bytes. Every
  block written reads back block for block with the same text, apart from a
  hard break ending a paragraph, and writes the same bytes again; a last
  resort of escaped plain text makes that always possible. A synthetic
  corpus and seeded random documents verify it in Vitest.
* Save 1 second after the last change, and no later than 5 seconds after the
  first unsaved change while typing continues. Flush pending changes on
  `Mod+S`, on leaving the document, when the writing surface loses focus,
  when the page is hidden, and on `pagehide`. Retry an unreachable service
  after 1 second, doubling to 30.
* Keep undo history per open document in memory, 500 steps deep, grouping
  changes made within 500 ms. Opening or replacing content is never undoable.
* Load the editor as its own chunk when a document opens, within 160 KB
  gzipped, and keep all JavaScript for an open document within 400 KB. Under
  4× CPU throttling, a 1 MiB document becomes editable within 1 second and
  answers 95% of keystrokes within 50 ms.
* Add later pair-writer suggestions as ProseMirror decorations, which follow
  edits and never enter the document or its Markdown.

## Context

The [README](../../README.md#product-direction) stores documents as Markdown
and edits them in a rich-text surface that hides the markup. Its first
storage backend writes each document as a `.md` file that other tools can
read and edit. [ADR 0005](./0005-workspace-model.md#content) makes content
UTF-8 Markdown of at most 1 MiB that the service stores and returns byte for
byte, and leaves the supported subset, the canonical form, and the autosave
timing to this record. [ADR 0006](./0006-storage-architecture.md#layout)
keeps identifiers, titles, and order out of document files, so a file holds
exactly the document's content, and front matter that a writer or another
tool adds is content the editor must preserve.

[ADR 0007](./0007-webapp-interface.md) sets the writing typeface, the
contrast targets, and the tokens document styles build on. It holds unsaved
text in IndexedDB, written on the flush events this record names, and
measured 199 KB of gzipped JavaScript for the shell and navigator before the
editor, leaving the budget here. Backlog 23
built the writing surface on these choices. A later release adds pair-writer
suggestions anchored to passages of text, which the editor must not rule out.

A prototype built outside the repository, on Node.js 26.13.1 and macOS 26.7.2
on an Apple M5 Max, copied the webapp's configuration and installed the
candidates through the npm proxy with install scripts disabled. It built a
Markdown bridge for Tiptap in about 1,000 lines of TypeScript and tested it, and
the other candidates' own Markdown support, against a corpus of 21 synthetic
documents. Eight are in the canonical form. Thirteen are written the way other
tools write Markdown: front matter, a GFM table, HTML blocks and spans, an
image, footnotes, strikethrough, setext headings, `*` and `+` bullets,
underscores, closed ATX headings, hard-wrapped paragraphs, CRLF line endings,
no final newline, extra blank lines, reference links, a task list, indented
code, math, tabs, and character references. It measured loading and typing
in Chrome for Testing 156 through Playwright. Findings that shaped this
decision are noted where they apply. Adoption figures are npm weekly
downloads for November 13 to 19, 2026, and sizes are gzipped JavaScript from
Vite 8 production builds, compared with a bare React page of 66 KB.

## Decision drivers

* No text lost or rewritten that the writer did not change, including
  Markdown that other tools wrote
* A surface that hides markup, with formatting quick to apply from the
  keyboard
* Ranges anchored to text for later suggestions, without touching the
  document
* Responsive typing in a document at ADR 0005's 1 MiB limit
* Few dependencies, exact versions, no install scripts, and active
  maintenance
* A short unsaved window without flooding the service with whole-document
  saves

## Considered options

### Editing library

| Option                                   | JavaScript added                          | Packages added             | Weekly downloads                    | Its own Markdown on the corpus |
|------------------------------------------|-------------------------------------------|----------------------------|-------------------------------------|--------------------------------|
| Tiptap 3.34.0 on ProseMirror             | 123 KB, or 142 KB with `@tiptap/markdown` | 53 with `@tiptap/markdown` | About 40 million, `@tiptap/core`    | 2 identical, 10 changed        |
| Lexical 0.53.0                           | 96 KB with `@lexical/markdown`            | 46                         | About 9.6 million                   | 2 identical, 7 changed         |
| Milkdown 7.23.0                          | 111 KB                                    | 204 with `@milkdown/kit`   | About 1.3 million, `@milkdown/core` | 6 identical, 2 changed         |
| CodeMirror 6, `@codemirror/view` 6.43.15 | 166 KB with `@codemirror/lang-markdown`   | 22                         | About 27 million                    | 21 identical, as plain text    |

Every option is MIT licensed. Identical counts the 21 corpus documents that
loaded and saved to the same bytes. Changed counts documents whose letters
and digits differed afterwards, meaning content was lost or markup became
visible text; reformatting alone does not count.

1. Tiptap 3.34.0 wraps ProseMirror, whose schema-checked document,
   transactions, position mapping, decorations, input rules, and history do
   the work. Tiptap adds an extension API, React bindings, and StarterKit's
   nodes, marks, input rules, and shortcuts, and `@tiptap/pm` re-exports the
   ProseMirror packages, so a schema and plugins written against ProseMirror
   carry over if Tiptap is ever dropped. It published 17 stable releases in
   the three months to November 20, 2026. Tiptap GmbH sells hosted
   collaboration and paid extensions, none of which Writer needs.
   `@tiptap/markdown` 3.34.0 parses with `marked` 17, a major version behind
   `marked` 18.2.0. On the corpus it dropped a GFM table entirely, removed
   HTML tags while keeping their text, and reduced an image to its alt text.
2. Lexical 0.53.0, from Meta, loaded the least JavaScript. It is still before
   1.0, and its Markdown import and export match lines against
   regular-expression transformers rather than parsing CommonMark. In the
   prototype it turned HTML, front matter brackets, and reference link
   definitions into character references such as `&#60;div`, so they became
   visible text. Lexical marks annotations with `MarkNode`, which lives in the
   document tree, so suggestions would have to be stripped from every save.
3. Milkdown 7.23.0 is ProseMirror with remark, and had the best fidelity of
   the stock options: it changed words only in the reference link and tab
   documents. It still rewrote 15 of the 21 documents into remark's own
   form, `@milkdown/kit` added 204 packages, and its adoption is a small
   fraction of Tiptap's. Tiptap with a Writer-owned bridge keeps the same
   engine and parser family while controlling exactly what is written.
4. CodeMirror 6 edits Markdown as text, so the round trip is exact and its
   decorations and range mapping are excellent, but it shows the markup,
   which the README rules out. A live preview that hides markers away from
   the caret would need a widget for every construct, and
   `@codemirror/lang-markdown` pulled in HTML, CSS, and JavaScript grammars.
   It is the baseline any rich editor must match for fidelity.

ProseMirror without Tiptap would add fewer packages, but the schema, input
rules, shortcuts, list commands, and React integration would be ours to build
and maintain.

### Markdown bridge

1. `mdast-util-from-markdown` 2.1.0 on micromark 4 (MIT, about 100 million
   weekly) follows the CommonMark specification, takes GFM and front matter
   as separate extensions, and records the source offsets of every node,
   which keeping unedited bytes depends on. Its packages are small and
   numerous: 53 for the parser and the extensions here, all from the unified
   collective.
2. markdown-it 15.0.3, through `prosemirror-markdown` 1.13.9, adds 10
   packages and follows CommonMark, but its block tokens carry only line
   ranges and its inline tokens no positions, so the exact source of an
   inline image or HTML span cannot be recovered. `prosemirror-markdown`
   still expects markdown-it 14.
3. `marked` 18.2.0, which `@tiptap/markdown` uses at version 17, is the most
   downloaded and keeps each token's raw text, but not its offset in the
   source.
4. Any library's serializer, such as remark's or `prosemirror-markdown`'s,
   writes that library's canonical form and cannot keep untouched blocks byte
   for byte.

### Markdown outside the subset

1. Drop or flatten it, as `@tiptap/markdown` and Lexical did in the
   prototype, which loses content.
2. Show the whole document as source when any part is unsupported, which
   punishes a long manuscript for one table.
3. Keep each unsupported top-level block, and each unsupported inline
   construct, as raw source in place.
4. Support tables, images, footnotes, and task lists in the first release,
   which needs an editing interface for each and, for images, storage that
   does not exist yet.

### Canonical form and untouched blocks

1. Rewrite the whole document canonically on its first save. A one-word edit
   to a file another tool wrote would rewrap its paragraphs and change its
   markers throughout, which shows as a large diff in Git and other tools and
   changes text the writer never touched.
2. Keep each untouched top-level block's source bytes, and write only changed
   blocks canonically.
3. Track the source of every inline span, so even an edited paragraph keeps
   its untouched sentences byte for byte, at much greater complexity.

### Autosave timing

1. Save after every change, throttled. Each save sends the whole document, up
   to 1 MiB, and the filesystem backend syncs each save to disk, which on
   macOS waits for `F_FULLFSYNC`.
2. Save after an idle delay, with a maximum delay while typing continues.
3. Save only on flush events, which would leave a long typing session in the
   browser alone.

The idle delay trades request volume against how soon the header shows the
text as saved, while IndexedDB holds the text in between, at most 500 ms
behind typing. One second feels immediate after a pause, and five seconds
caps the unsaved interval during continuous typing at about 12 saves a
minute.

## Decision

### Packages

Install these packages, starting on the versions shown. Resolved versions live
in `webapp/package-lock.json`, and upgrading within these choices is a
dependency change, not a new decision.

| Package                                                                   | Starting version | Purpose                                                | License |
|---------------------------------------------------------------------------|------------------|--------------------------------------------------------|---------|
| `@tiptap/core`                                                            | 3.34.0           | Editor core and extension API                          | MIT     |
| `@tiptap/pm`                                                              | 3.34.0           | ProseMirror packages                                   | MIT     |
| `@tiptap/react`                                                           | 3.34.0           | React bindings                                         | MIT     |
| `@tiptap/starter-kit`                                                     | 3.34.0           | Nodes, marks, input rules, shortcuts, and undo history | MIT     |
| `@tiptap/extension-code`                                                  | 3.34.0           | Code spans that combine with other marks               | MIT     |
| `@tiptap/extension-heading`                                               | 3.34.0           | Headings that cannot hold a hard break                 | MIT     |
| `@tiptap/extension-bold`, `@tiptap/extension-italic`                      | 3.34.0           | Emphasis that ends at a line or paragraph break        | MIT     |
| `mdast-util-from-markdown`                                                | 2.1.0            | CommonMark parsing with source positions               | MIT     |
| `micromark-extension-gfm-table`, `mdast-util-gfm-table`                   | 2.1.2, 2.0.1     | Recognizing tables, kept as raw blocks                 | MIT     |
| `micromark-extension-gfm-strikethrough`, `mdast-util-gfm-strikethrough`   | 2.1.0, 2.0.1     | Recognizing strikethrough, kept as raw inline atoms    | MIT     |
| `micromark-extension-gfm-footnote`, `mdast-util-gfm-footnote`             | 2.1.0, 2.1.0     | Recognizing footnotes, kept as raw source              | MIT     |
| `micromark-extension-gfm-task-list-item`, `mdast-util-gfm-task-list-item` | 2.1.0, 2.0.1     | Recognizing task lists, kept as raw blocks             | MIT     |
| `micromark-extension-frontmatter`, `mdast-util-frontmatter`               | 2.0.0, 2.0.1     | Recognizing YAML and TOML front matter, kept as raw    | MIT     |
| `@types/mdast` (development)                                              | 4.0.4            | Syntax tree types                                      | MIT     |

In the prototype these added 104 packages, all MIT licensed and none with an
install script, and `npm audit` through the proxy reported no
vulnerabilities. The GFM extensions are installed one by one, rather than
through `micromark-extension-gfm`, to leave out bare-URL links: text a writer
typed as `www.example.com` would otherwise become a link when the document
is next opened. Exact versions, the committed lockfile, `ignore-scripts`, and
Dependabot's cooldown from ADR 0007 apply.

### Editor setup

* Build the editor in `webapp/src/editor/` (planned) with `useEditor` and
  `EditorContent` from `@tiptap/react`, and the bridge beside it in
  `webapp/src/editor/markdown/` (planned).
* Configure StarterKit with `bold`, `italic`, `strike`, `underline`, `code`,
  and `heading` turned off, and Link with `openOnClick` and `autolink` off.
  Add bold and italic through `Bold.extend` and `Italic.extend` with
  `keepOnSplit: false`, so emphasis ends at a split. Add the code mark through
  `Code.extend({ excludes: "", keepOnSplit: false, exitable: false })`,
  because Tiptap's code mark excludes every other mark by default and
  Markdown allows a code span inside a link or emphasis, and because the
  formatting markers replace Tiptap's exit from a code span, which typed a
  space. Add headings through `Heading.extend` with content
  `(text | rawInline)*`, because a Markdown heading is one line and cannot
  hold a hard break.
* Add a `rawBlock` node, a code-like block holding source text, and a
  `rawInline` node, an atom holding a source string. Add a `sourceIndex`
  attribute to every top-level block type and a `tight` attribute to lists.
  Neither attribute renders into HTML, so copied and pasted content never
  carries them.
* Parse with the editor's own schema. Nodes from another schema instance
  never compare equal; in the prototype, parsing with a separate schema
  silently turned off byte preservation and made every save rewrite the
  document.
* Set content from the service without adding it to undo history or
  emitting an update, so opening a document never schedules a save.
* Give the surface `role="textbox"` and `aria-multiline="true"`, labelled by
  the document title, and leave the browser's spelling check on.
* Do not add Tiptap's Typography extension. Text stays as typed, with no
  quotes or dashes substituted.

### Supported Markdown

In the table, `Mod` is `Cmd` on macOS and iPadOS and `Ctrl` elsewhere.

| Construct       | Reads                                  | Writes                                                                                        | Typed as                                                                    | Shortcut                       |
|-----------------|----------------------------------------|-----------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|--------------------------------|
| Paragraph       | Any paragraph                          | One line                                                                                      | Any text, ended by `Enter` twice                                            | `Mod+Alt+0`                    |
| Heading         | ATX and setext, levels 1 to 6          | One to six `#`, a space, and the text                                                         | One to six `#` and a space                                                  | `Mod+Alt+1` to `Mod+Alt+6`     |
| Emphasis        | `*` or `_`                             | `*text*`                                                                                      | `*text*` or `_text_`                                                        | `Mod+I`                        |
| Strong emphasis | `**` or `__`                           | `**text**`                                                                                    | `**text**` or `__text__`                                                    | `Mod+B`                        |
| Code span       | Any backtick fence                     | A backtick fence longer than any backtick run inside                                          | Text between two backticks                                                  | `Mod+E`                        |
| Link            | Inline, reference, and angle autolinks | `[text](destination "title")`, angle brackets around a destination with spaces or parentheses | `[text](url)`                                                               | `Mod+K`, which backlog 23 adds |
| Hard line break | A backslash or two spaces at line end  | A backslash at line end                                                                       | `Enter` in a paragraph, or `Shift+Enter` or `Mod+Enter` except in a heading | None                           |
| Block quote     | `>`                                    | `>` and a space on every line, `>` alone on blank lines                                       | `>` and a space                                                             | `Mod+Shift+B`                  |
| Bullet list     | `-`, `*`, or `+`                       | `-` and a space                                                                               | `-`, `*`, or `+` and a space                                                | `Mod+Shift+8`                  |
| Ordered list    | `1.` or `1)`, from any start           | `N.` and a space, counting from the start                                                     | A number, `.`, and a space                                                  | `Mod+Shift+7`                  |
| Code block      | Fenced, or indented by four spaces     | A backtick fence longer than any run inside, with the language                                | Three backticks or tildes, a language if any, and space or Enter            | `Mod+Alt+C`                    |
| Thematic break  | `---`, `***`, or `___`                 | `---`                                                                                         | `---`, or `***` or `___` and a space                                        | None                           |

Headings 1 to 3 take ADR 0007's 2, 1.5, and 1.25 rem; 4 to 6 are set at the
body size. The document title is not a heading, as ADR 0005 decides, and the
editor offers no way to insert anything outside the subset.

### Canonical form

The serializer writes every block it does not keep byte for byte in one
canonical form:

* UTF-8 with LF line endings, one blank line between blocks, no trailing
  spaces, and exactly one newline at the end. An empty document is zero
  bytes.
* Lines are never wrapped. Each paragraph is one line, and a hard break ends
  a line with a backslash.
* Lists are tight unless they were loose when read, or an item holds blocks
  that cannot follow its paragraph without a blank line, such as a second
  paragraph or a nested ordered list not starting at 1. A loose list puts a
  blank line between items. Nested blocks indent to their item's content
  column: two spaces under `-`, three under `1.`, and four under `10.`.
* A bullet list directly after another bullet list uses `*`, and an ordered
  list directly after another ordered list uses `N)`, because the same marker
  would merge them into one list. A thematic break that opens the document is
  `***`, because `---` there could open front matter.
* Text escapes with a backslash: `\`, the backtick, `*`, `[`, `]`, `~`, and
  `|` always; `_` unless it sits between letters or digits; `<` unless
  whitespace follows it, so no tag or autolink can form; `&` that would start
  a character reference; `!` before `[`; and at the start of a line, heading
  `#` markers, `>`, `-`,
  `+`, `=`, and the `.` or `)` after a number. A space or tab at the start or
  end of a line is written `&#32;` or `&#9;`, and closing `#` characters in a
  heading are escaped.
* Emphasis delimiters never sit beside whitespace or punctuation that would
  stop them opening or closing under CommonMark's flanking rules. Such
  characters move outside the delimiters, ending the formatting one character
  sooner. Emphasis directly beside another run's `*` uses `_` or `__`.
* Code blocks write their content unchanged, and raw blocks and raw inline
  atoms write their source unchanged.
* A hard break that ends a paragraph is dropped, because a backslash there
  would read as text, and a line feed inside text, which typing cannot
  produce, is written as a space. Empty paragraphs are not written, because
  Markdown cannot represent them.

### Markdown outside the subset

* These read as a raw block: front matter, tables, HTML blocks, footnote
  definitions, link reference definitions, task lists, code blocks with text
  after the language, empty block quotes, list items that start with
  anything but a paragraph, setext headings containing a hard break, and any
  top-level block containing one of these or an inline construct below that
  spans lines.
* These read as a raw inline atom: images, inline HTML, strikethrough, and
  footnote references.
* A raw block shows its source in the monospace face, in a muted frame named
  "Markdown source" for assistive technology, and edits as plain text. A raw
  inline atom shows its source and can be selected, copied, and deleted, but
  not edited in place.
* Raw content is written exactly as held, so a table or front matter
  survives every save. Edits to a raw block take effect as Markdown when the
  document next opens, which may turn the source into supported blocks.
* A reference link inside a supported block becomes a link. If that block is
  edited, the link is written inline, and its definition stays as its own raw
  block.
* Pasted HTML maps onto the subset through the schema's parse rules, keeping
  the text of any formatting outside it. Pasted plain text is inserted as
  text, with the same formatting rules as typing.

### Round-trip guarantee

1. Loading a document and saving it without edits writes exactly the bytes
   loaded, for any content: canonical or not, with any line endings, with or
   without a byte order mark or final newline.
2. A top-level block whose content the writer has not changed keeps its exact
   bytes when other blocks change, and so does the text between two such
   blocks that were adjacent when loaded. Undoing edits back to a block's
   loaded content restores its bytes. The exceptions are the repairs below,
   made only when the block would otherwise read differently beside a new
   neighbor.
3. A document in canonical form serializes to identical bytes from the
   editor's document alone.
4. Every document saved after an edit reads back block for block: each block
   with the same structure, apart from what the canonical form normalizes,
   and the same text, apart from a hard break ending a paragraph. It then
   serializes to the same bytes again, so a document is stable from its first
   save. The one exception is text added after a raw block that never ends,
   described below.
5. Serialization never fails. When no form that keeps a block's formatting
   reads back, the block is written as plain text that does, so a save and
   the unsaved-text record always hold every character the writer typed.

The bridge keeps these promises as follows:

* At load, it keeps each top-level block's source text, the text before it,
  the node it parsed to, and the link and footnote definition labels it
  holds or relies on, and tags the editor's node with that block's
  `sourceIndex`. For each label it records which block's definition takes
  effect, which under CommonMark is the first.
* At save, a node that equals, by ProseMirror's `Node.eq`, the node its
  source parsed to is written as that source, provided each label it relies
  on still takes effect from the same unchanged block. Edited raw blocks are
  parsed for definitions they now hold, because an earlier definition of a
  label would take over. Any other node is written canonically. The
  separator between two source blocks that were adjacent comes from the
  source, and every other separator is one blank line. The text after the
  last block comes from the source when that block was last when loaded,
  and is otherwise one newline.
* When the result differs from the text loaded, the serializer checks each
  new adjacency that involves a source block by parsing the two blocks,
  after the document's unchanged definitions, and comparing them with the
  editor's nodes. If they read differently, it writes the later block
  canonically instead, or failing that the earlier one, and checks again.
  This repairs the cases the prototype found: two lists that would merge
  once the block between them is deleted, an indented block that would join
  a list, and a code fence left unclosed by another tool, which is closed
  when a block is added after it.
* It writes canonically a first block that begins with a `---` or `+++`
  line, other than front matter, because a later line could close it as
  front matter. A block whose link definition no longer takes effect is
  written canonically too, as an inline link to the destination the editor
  shows.
* After writing a paragraph or heading canonically, it parses the block
  again and checks the fourth promise. If the text differs, or the result
  would serialize differently, it tries the serialization of what it read
  back. Failing that, it removes marks from the block, emphasis first, then
  strong emphasis, links, and code spans. As a last resort it writes the
  block's text, including the source of any raw inline atoms, with every
  ASCII punctuation character escaped and spaces at line edges written as
  `&#32;`, which CommonMark always reads as exactly that text, so the raw
  atoms read back as plain text. It then writes what that reads back as by
  the normal rules, so the next save writes the same bytes, and keeps the
  escaped form only if the normal rules would not settle.
* Canonical results are cached per unchanged node, so a save serializes only
  the blocks changed since the last one.
* The client never saves a document it has not changed. Opening, focusing,
  and selecting schedule no save.

Raw blocks are never rewritten, so one case remains that no repair can
separate: text added after a raw block that never ends, such as an HTML
comment without its closing `-->`, joins that block when the document next
opens. The text survives, shown as source.

Vitest verifies the guarantee:

* A synthetic corpus in `webapp/src/editor/markdown/corpus/` (planned), with
  `canonical/` and `foreign/` folders like the prototype's, checks that every
  canonical document serializes to identical bytes, that every foreign
  document saves without edits to identical bytes, and that editing or
  deleting one block leaves every other block's bytes in place.
* Focused tests cover each repair and its counterexample: lists separated
  by a deleted paragraph, an unclosed fence followed by a new paragraph, a
  `---` rule that becomes the first block before a later rule, a deleted
  link reference definition, a deleted first definition of a label defined
  twice, a never-ending HTML comment, literal text such as `<1@example.com>`
  that could read as an autolink, a paragraph left holding only inline HTML,
  and hard breaks.
* Seeded random documents in the subset, serialized once and read back,
  must keep their exact text and serialize identically again. The prototype
  ran 3,000 documents each of prose with formatting, punctuation-heavy text
  without formatting, and punctuation-heavy text with formatting. None
  changed on the second save and none changed text. Marks were removed in
  71 blocks of the prose documents, all emphasis around a code span directly
  after a letter, and in 211 blocks of the punctuation-heavy formatted
  documents.

The prototype found two more details the implementation must keep. mdast's
`spread` fields differ from CommonMark's definition of a loose list, so the
bridge decides looseness from blank lines between items and between an
item's blocks. A nested ordered list can follow its item's paragraph without
a blank line only when it starts at 1.

### Input rules and shortcuts

The [supported Markdown](#supported-markdown) table lists each construct's
input rule and shortcut, which are StarterKit's defaults. In addition:

* `Mod+Z` undoes, and `Mod+Shift+Z` and `Mod+Y` redo.
* `Mod+S` saves at once instead of opening the browser's dialog.
* `Backspace` directly after an input rule fires reverts it, leaving the
  characters typed.
* In a paragraph, including one in a block quote, `Enter` inserts a hard line
  break. On an empty line of a paragraph that holds other text, `Enter`
  removes the line and starts a new paragraph, so `Enter`
  twice separates paragraphs, and `Backspace` directly after puts the line
  break back. List items, headings, code blocks, and empty paragraphs keep
  StarterKit's `Enter`.
* Emphasis, strong emphasis, code spans, and links never carry onto a new
  line or into a new paragraph, whichever key starts it.
* In a list, `Tab` and `Shift+Tab` nest and unnest the item. Everywhere else,
  including code blocks, `Tab` moves focus out of the writing surface, so the
  keyboard is never trapped.
* Underline and strikethrough are not registered, so `Mod+U` applies no
  formatting.
* Backlog 26 tests the shortcuts and the focus path from the keyboard in
  browser tests, and the webapp README's manual screen reader check covers
  them with a screen reader.

While the writing surface has focus and the caret is inside or at the edge
of a run of emphasis, strong emphasis, a code span, or a link, the run's
Markdown markers show at its edges, as Typora does, and hide again when the
caret leaves. They are `*`, `**`, a backtick fence as the serializer would
write it, and a link's `[` and `](destination "title")`, the last read-only;
the link dialog still edits the destination. Like
[pair-writer suggestions](#pair-writer-suggestions-later), they are
ProseMirror widget decorations, so they never enter the document, its
Markdown, or copied text, and they are hidden from assistive technology.

* Each marker at the caret adds a caret stop, so an edge has one inside the
  marker and one outside. Text typed at a stop takes the formatting that
  stop is inside, which the caret's stored marks record, and the caret shows
  on the matching side of the marker.
* `ArrowLeft` and `ArrowRight` step across a marker one stop at a time, and
  arrive at an edge on its nearest stop. Arriving another way, such as by
  clicking, uses ProseMirror's marks at the position: inside emphasis, strong
  emphasis, and code spans, and outside links.
* After an input rule formats a run, the caret sits outside its closing
  marker.
* `Backspace` or `Delete` into a marker removes that formatting from the
  whole run, keeping the text, as an undo step of its own.

### Undo history

* Each open document keeps its own undo history in memory, through
  StarterKit's ProseMirror history, 500 steps deep instead of the default 100,
  grouping changes made within 500 ms into one step.
* Loading a document, and replacing its content from the service, are not
  undoable, so undo never empties the surface or returns to another
  document's text.
* Opening another document or reloading the page discards the history. Title
  edits in the header are not part of it.
* Undo and redo are edits like any other and are saved.

### Autosave timing and flush events

* A change to the document schedules a save 1,000 ms after the last change,
  and no later than 5,000 ms after the first unsaved change while changes
  continue. Selection changes, focus, and opening schedule nothing.
* At most one save is in flight per document, as ADR 0005 requires. Changes
  made meanwhile go into the next save, which starts when the current one
  settles if its time has come.
* These events flush pending changes: `Mod+S`; leaving the document, by
  opening another or navigating to `/`; the writing surface losing focus;
  `visibilitychange` to hidden, which covers switching tabs or apps and
  minimizing; and `pagehide`, which covers closing and reloading. A flush
  writes the unsaved-text record at once and starts a save now, or directly
  after the save in flight.
* On `pagehide`, a save whose body is at most 64 KiB is sent with
  `keepalive`, the most a page may send after it unloads. Longer text relies
  on the unsaved-text record and is recovered when the document next opens.
* Between saves, the unsaved-text record that ADR 0007 defines is written at
  most every 500 ms while the writer types, before each save, and on each
  flush.
* A network failure or 5xx response is retried after 1 second, doubling to at
  most 30 seconds, and at once on the browser's `online` event or a flush.
  The header shows retrying meanwhile. Other responses follow
  [ADR 0005](./0005-workspace-model.md#presenting-saves-and-recovering) and
  are not retried on a timer.
* Markdown is serialized only for saves and unsaved-text writes, never on
  each keystroke.

### Document styles

Document content builds on ADR 0007's tokens. Backlog 23 may tune values
within them:

| Element            | Treatment                                                                                       |
|--------------------|-------------------------------------------------------------------------------------------------|
| Body text          | Newsreader at `--writing-size` and `--writing-leading` in `--color-ink`, blocks 1 em apart      |
| Headings           | Levels 1 to 3 at 2, 1.5, and 1.25 rem and levels 4 to 6 at `--writing-size`, all at weight 600  |
| Block quotes       | Indented 1.5 em with a 2 px `--color-border` rule at the left, text in `--color-ink-muted`      |
| Lists              | Indented 1.5 em per level                                                                       |
| Links              | `--color-accent`, underlined                                                                    |
| Code               | `--font-mono` at 0.9 em; code blocks on `--color-chrome` with `--radius-sm` corners             |
| Raw Markdown       | `--font-mono` at 0.9 em in `--color-ink-muted`, framed by a 1 px dashed `--color-border` line   |
| Thematic breaks    | A 1 px `--color-border` line across the middle third of the measure                             |
| Formatting markers | Shown only at the caret, in the writing face at regular weight, upright, in `--color-ink-muted` |

`--color-ink` on `--color-chrome` measures 14.90:1 in the light theme and
14.25:1 in the dark, and backlog 23 adds the pair to ADR 0007's contrast test
with the writing surface's 10:1 target.

### Pair-writer suggestions later

ProseMirror decorations fit anchored suggestions without changing anything
here. A plugin holds a `DecorationSet` of inline, widget, or node decorations
over ranges of the document and maps it through every transaction, so a
highlighted passage follows edits made around it. Decorations never enter the
document, so they cannot reach the saved Markdown or disturb the round trip.
A prototype test anchored a decoration to a word, inserted text before it,
and found the decoration still on the word and the saved Markdown unchanged
by it. Accepting a suggestion is an ordinary transaction, so it is undoable
and saved like typing.

How the service names a passage, for example by quoting it with surrounding
context, is left to the pair-writing decisions. The bridge can map a block's
source offsets to editor positions for blocks the writer has not changed.

### Bundle budget

* The editor, its extensions, the bridge, and the parser load as one chunk,
  through a dynamic import when a document route renders, so `/` and the
  navigator never wait for them. That chunk stays within 160 KB gzipped; in
  the prototype it measured 149 KB.
* All JavaScript loaded for `/documents/{documentId}` stays within 400 KB
  gzipped. ADR 0007's shell and navigator measured 199 KB, so the first
  release should load about 350 KB.
* Backlog 23 adds a check to the webapp phase of `tools/check` that measures
  the built `dist/` against both budgets and fails when either is exceeded.

### Responsiveness

The prototype generated synthetic manuscripts from a seeded script, with
chapter headings, paragraphs of 80 to 150 words carrying emphasis, strong
emphasis, and a link, and occasional block quotes and lists. It loaded each
through the bridge into Tiptap, typed 107 keystrokes into a paragraph in the
middle, and measured each keystroke from `keydown` to the frame after it:

| Document              | CPU | Parse  | Editable | Save, unedited | Save, edited | Keystroke median | 95th percentile | Slowest |
|-----------------------|-----|--------|----------|----------------|--------------|------------------|-----------------|---------|
| 20,000 words, 132 KB  | 1×  | 23 ms  | 37 ms    | 0.6 ms         | 5.5 ms       | 4 ms             | 16 ms           | 19 ms   |
| 100,000 words, 659 KB | 1×  | 74 ms  | 112 ms   | 1.7 ms         | 9.1 ms       | 7 ms             | 16 ms           | 18 ms   |
| 170,000 words, 1.1 MB | 1×  | 117 ms | 179 ms   | 4.9 ms         | 6.5 ms       | 9 ms             | 17 ms           | 19 ms   |
| 20,000 words, 132 KB  | 4×  | 91 ms  | 143 ms   | 2.5 ms         | 9.9 ms       | 5 ms             | 16 ms           | 21 ms   |
| 100,000 words, 659 KB | 4×  | 297 ms | 454 ms   | 8.2 ms         | 16.0 ms      | 14 ms            | 19 ms           | 37 ms   |
| 170,000 words, 1.1 MB | 4×  | 461 ms | 711 ms   | 11.6 ms        | 20.0 ms      | 22 ms            | 26 ms           | 61 ms   |

Editable runs from the start of parsing to the frame after the editor
mounts. Every unedited save matched the loaded bytes, and every edited save
grew by 112 bytes: the 106 characters typed, the blank line that split the
paragraph, and a trailing space written as `&#32;`. The largest document is
just over ADR 0005's 1 MiB limit.

The webapp meets these targets for a 1 MiB document in Chromium, on
development hardware with the CPU throttled 4×, which stands in for slower
machines and iPads:

* The document is editable within 1 second of its content arriving.
* 95% of keystrokes reach the next frame within 50 ms, and within 33 ms, two
  frames at 60 Hz, without throttling.
* Serializing the document for a save takes at most 25 ms.

Backlog 23 adds a browser test, on [ADR 0009](./0009-browser-tests.md)'s
tooling, that generates a
synthetic 1 MiB document and fails when a target is missed.

## Consequences

Positive outcomes:

* Writer never drops or rewrites Markdown the writer did not change. Files
  from other tools keep their formatting block by block, and an unedited
  document is never rewritten.
* Documents Writer creates are plain, predictable CommonMark that any tool
  reads, one line per paragraph, and they diff cleanly in Git.
* The surface hides markup for everything a writer formats in the first
  release, with Markdown-style typing and familiar shortcuts.
* Suggestions anchored to text can arrive later as decorations without
  changing the document model or the round trip.
* Typing stays within about a frame on a manuscript at the size limit, and a
  save costs a few milliseconds.

Trade-offs and risks:

* Writer owns its Markdown serializer, about 650 lines in the prototype, and
  CommonMark's emphasis rules have many edge cases. The corpus and random
  documents guard it, and every change to it must keep them passing.
* Tables, images, footnotes, task lists, strikethrough, and front matter show
  as Markdown source rather than formatted content.
* Formatting that CommonMark cannot express, such as emphasis around a code
  span directly after a letter, is dropped from that block on save, and
  formatting at a boundary may end a character sooner. The text is kept.
* An edited block from another tool is rewritten whole: a hard-wrapped
  paragraph becomes one line, and `*` bullets become `-` in an edited list.
* Empty paragraphs and extra blank lines disappear when the document next
  opens, and so does a hard break at the end of a paragraph.
* Revealed markers widen the line around the caret while it is in a formatted
  run, so the text there shifts by their width.
* Two browser workarounds keep typing in place: Chrome misreports the caret
  after a paragraph break that follows a hard break, and WebKit's own
  `Enter`, which ProseMirror uses on iPadOS, does nothing beside markers that
  just hid. The browser tests in `webapp/e2e/writing.spec.ts` guard both.
* Text added after a raw block that never ends, such as an HTML comment
  without `-->`, joins that block as source when the document next opens.
* In the rare block that only the last-resort form can write, the saved
  file shows backslashes before its punctuation, and any raw inline atoms in
  it become plain text when the document next opens.
* The parser adds 53 small packages from one collective; Tiptap and
  ProseMirror add about 50 more. Tiptap releases often.
* Text over 64 KiB that is unsaved when the tab closes is recovered from
  browser storage on next open rather than saved as the tab closes.
* The first document opened after a page load waits for the editor chunk,
  which on loopback takes a moment.
* `Tab` inside a list nests the item rather than moving focus.

## Revisit triggers

* Writers need to edit tables, images, footnotes, or task lists as
  formatted content: add them to the subset with their own nodes and
  interfaces, and images with a storage decision.
* The mark fallback drops formatting writers notice: refine the serializer,
  for example by preferring the underscore forms in more positions.
* Tiptap stalls, has a compromised release, or departs from ProseMirror:
  drop Tiptap and keep the schema, plugins, and bridge on ProseMirror
  directly.
* A responsiveness target is missed, on an iPad or elsewhere: profile
  parsing and rendering, and consider rendering long documents
  incrementally.
* Writers ask for typographic quotes and dashes: add substitution as an
  opt-in preference.
* Two people or devices edit one document at once: revisit undo history and
  saving whole documents, for example with collaborative editing.

## Follow-up decisions

* How the pair writer names passages for suggestions, with the
  [pair-writing agent decision](../backlog/0010-agent-architecture-adr.md);
  how suggestions are shown and accepted is settled in
  [ADR 0012](./0012-pair-writing-experience.md#suggestions-stay-advice)
  (advice-only, never writing into the manuscript)
* Image storage, if images join the subset
* The link editing interface behind `Mod+K`, which backlog 23 designs

## References

* [CommonMark specification 0.31.2](https://spec.commonmark.org/0.31.2/),
  including emphasis and flanking rules, list tightness, and lists that
  interrupt paragraphs
* [GitHub Flavored Markdown specification](https://github.github.com/gfm/)
* [Tiptap documentation](https://tiptap.dev/docs/editor/getting-started/overview)
* [Tiptap StarterKit](https://tiptap.dev/docs/editor/extensions/functionality/starterkit)
* [ProseMirror guide](https://prosemirror.net/docs/guide/), including
  decorations and position mapping
* [micromark](https://github.com/micromark/micromark)
* [`mdast-util-from-markdown`](https://github.com/syntax-tree/mdast-util-from-markdown)
* [mdast syntax tree](https://github.com/syntax-tree/mdast)
* [markdown-it](https://github.com/markdown-it/markdown-it) and
  [`prosemirror-markdown`](https://github.com/ProseMirror/prosemirror-markdown)
* [marked](https://marked.js.org/)
* [Lexical Markdown](https://lexical.dev/docs/concepts/serialization)
* [Milkdown](https://milkdown.dev/)
* [CodeMirror 6](https://codemirror.net/)
* [Fetch standard: `keepalive`](https://fetch.spec.whatwg.org/#request-keepalive-flag)
* [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
* [WCAG 2.2: no keyboard trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap)
