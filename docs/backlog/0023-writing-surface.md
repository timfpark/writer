---
title: Write in the editing surface with autosave
description: Edit the open document in a typographically focused rich-text surface, edit its title in the header, and save every change automatically without losing text.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 3
---

## Story

As a writer, I want a beautiful, distraction-free writing surface that saves
my work as I go so that I think only about the words and never about saving
them.

## Context

[ADR 0008](../adrs/0008-editor.md) chooses the editor and its Markdown
bridge, the Markdown subset and its canonical form, the round-trip guarantee,
the autosave timing and flush events, document styles, the bundle budget,
and the responsiveness targets.
[ADR 0005](../adrs/0005-workspace-model.md#autosave-and-stale-writes) defines saving with a revision
token and the conflict response. [ADR 0007](../adrs/0007-webapp-interface.md)
chooses the writing typeface, the contrast target for body text, and the
browser storage for unsaved text.
Backlog 22 built the navigator, which opens documents into the writing
region.

## Scope

* Install the editor and its Markdown bridge as ADR 0008 decides, loaded as
  their own chunk when a document opens, and load the open document's
  Markdown and save it back under ADR 0008's round-trip guarantee.
* Set the writing surface's typography: a centered column with a comfortable
  measure, the chosen typeface, generous line height and paragraph spacing,
  and a surface the text contrasts with clearly, distinct from the
  surrounding chrome. Style document content as ADR 0008 sets, and add
  `--color-ink` on `--color-chrome` to the contrast test.
* Show the document's title in the header and edit it in place; a committed
  title change renames the document, and the navigator follows.
* Save automatically on ADR 0008's timing, and flush pending changes on its
  flush events, including switching documents, hiding the tab, and leaving
  the page. `Ctrl+S` or `Cmd+S` saves immediately instead of opening the
  browser's dialog.
* Add a way to create, edit, and remove a link from the keyboard, opened by
  `Ctrl+K` or `Cmd+K`.
* Show a quiet save status in the header: saved, saving, retrying while the
  service is unreachable, or in conflict.
* Keep unsaved changes until the service acknowledges them, in browser
  storage so a closed tab or reload loses nothing, and retry when it returns.
* On a conflict, never overwrite either version silently; offer the recovery
  path ADR 0005 defines.
* Add ADR 0008's round-trip corpus and random-document tests, its bundle
  budget check to `tools/check`, and browser tests for typing, reloading,
  renaming, recovering from an unreachable service, and its responsiveness
  targets on a synthetic 1 MiB document.

## Acceptance criteria

* [ ] Text typed into a synthetic document is present after a reload with no
  explicit save.
* [ ] Stopping the service while typing shows the retrying status, and the
  text is saved once the service returns.
* [ ] Editing a document's file outside Writer and then typing in Writer
  shows the conflict status, and neither version is lost.
* [ ] Body text on the writing surface meets the contrast target ADR 0007
  sets.
* [ ] Every document in the round-trip corpus saves without edits to
  identical bytes, and Markdown outside the subset survives an edit to
  another block.
* [ ] The built webapp stays within ADR 0008's bundle budget, and a 1 MiB
  document meets its responsiveness targets.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
