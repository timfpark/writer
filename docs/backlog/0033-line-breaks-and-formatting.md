---
title: Control line breaks and formatting edges
description: Make Enter break a line without a paragraph gap, stop emphasis from following the caret onto the next line, and reveal the Markdown markers of the formatted run at the caret so writers can see and adjust where formatting starts and ends.
author: Tim Park
ms.date: 2026-11-21
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 4
---

## Story

As a writer, I want `Enter` to put the next line directly below the last one
and to see where formatting starts and ends, so that I control the layout of
the page and never fight formatting the editor carried along on its own.

## Context

The writing surface from backlog 23 follows
[ADR 0008](../adrs/0008-editor.md). Using it on a draft shows two problems.

* There is no way to put lines directly under each other without
  searching for a shortcut. `Enter` always starts a new paragraph, which the
  serializer writes as a blank line and the surface sets 1 em apart.
  A hard line break exists, typed with `Shift+Enter` and written as a
  backslash at the end of the line, but nothing points to it. A writer setting
  a line of dialogue in one language directly above its translation, such as
  *¿Vienes mañana?* above "Are you coming tomorrow?", gets a gap they did not
  ask for.
* Emphasis follows the caret onto the next line. After typing `*a line in
  italics*`, the input rule formats the run, but pressing `Enter` makes the
  new line italic too. Tiptap's `splitBlock` keeps the marks at the caret
  (`keepOnSplit` defaults to `true`), and emphasis is inclusive at its end, so
  the closing `*` the writer typed does not end it. Because the markers are
  hidden, the writer cannot see why, or where the run ends.

Other Markdown editors handle this in different ways. Typora, Obsidian's Live
Preview, Zettlr, and MarkText hide markers but reveal them where the caret
is: Typora for the element at the caret, Obsidian for the line. iA Writer,
Ulysses, and Bear show dimmed markers all the time. Notion, Google Docs, and
Word never show markers, and Docs and Word also carry formatting across
`Enter`. Writer will reveal the markers of the formatted run at the caret,
the Typora model, which shows exactly the edge being edited, moves the text
the least, and keeps the rest of the page clean.

ADR 0008 already plans pair-writer suggestions as ProseMirror decorations
that never enter the document or its Markdown. The revealed markers use the
same mechanism, so the document model, the Markdown subset, and the
round-trip guarantee do not change.

## Scope

* In a paragraph, including one inside a block quote, `Enter` inserts a hard
  line break with no gap. `Enter` on an empty line, either a line after a hard
  break or an empty paragraph, removes that empty line and starts a new
  paragraph, so pressing `Enter` twice separates paragraphs. `Backspace`
  directly after that reverts to the single line break.
* Keep `Enter` as it is in list items, which start the next item or leave the
  list from an empty one, in headings, which start a paragraph, and in code
  blocks, which insert a newline. `Shift+Enter` keeps inserting a hard line
  break everywhere but headings.
* Write line breaks as ADR 0008's canonical backslash at the end of the line,
  so saved files remain CommonMark that other tools render the same way, and
  existing documents load and save unchanged.
* Never carry emphasis, strong emphasis, code spans, or links onto a new line
  or into a new paragraph.
* When the caret is inside or at the edge of a run of emphasis, strong
  emphasis, a code span, or a link, show that run's delimiters at its edges,
  such as `*`, `**`, and the backtick fence, as dimmed decorations, and hide
  them again when the caret leaves. Show a link's `[`, `](`, destination, and
  `)` the same way, read-only, and keep editing its destination in the link
  dialog.
* Give each revealed edge two caret stops, inside and outside the marker.
  Text typed inside extends the formatting and text typed outside does not.
  The arrow keys step across a marker one stop at a time. After an input rule
  formats a run, the caret sits outside its closing marker.
* `Backspace` or `Delete` into a revealed marker removes that formatting from
  the run and keeps the text, as one undoable step.
* Keep revealed markers out of the accessibility tree, copied text, and the
  saved Markdown, and style them with ADR 0007's `--color-ink-muted` and the
  writing face so they pass the contrast test.
* Amend ADR 0008's supported Markdown table, input rules and shortcuts, and
  document styles to match. Update `webapp/README.md` and the shortcut
  reference that [backlog 26](./0026-keyboard-accessibility.md) adds, if it
  exists by then.
* Cover the new behavior with Vitest tests of the commands and the round trip,
  and with browser tests in `webapp/e2e/writing.spec.ts`.

## Acceptance criteria

* [ ] Typing a line, pressing `Enter`, and typing a second line shows them
  directly under each other and saves them as one paragraph whose first line
  ends with a backslash.
* [ ] Pressing `Enter` twice starts a new paragraph, saved after one blank
  line, with no empty line or trailing backslash left behind.
* [ ] After typing `*italic*` at the end of a line, text typed next on that
  line, and on the next line after `Enter`, has no emphasis, and the same
  holds for strong emphasis, code spans, and links.
* [ ] Placing the caret in a formatted run shows its markers, and moving it
  elsewhere hides them, with no change to the saved Markdown.
* [ ] Unedited documents still save identical bytes, and the corpus and
  random round-trip tests pass.
* [ ] The automated accessibility check reports no serious or critical
  violations on the writing surface with markers revealed.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
