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

[Backlog 17](./0017-editor-adr.md) chooses the editor, the Markdown subset,
the round-trip guarantee, and the autosave timing.
[ADR 0005](../adrs/0005-workspace-model.md#autosave-and-stale-writes) defines saving with a revision
token and the conflict response. [Backlog 16](./0016-webapp-interface-adr.md)
chooses the writing typeface and the contrast target for body text.
[Backlog 22](./0022-workspace-navigator.md) opens documents into the writing
region.

## Scope

* Load the open document's Markdown into the editor and save it back in the
  editor ADR's canonical form.
* Set the writing surface's typography: a centered column with a comfortable
  measure, the chosen typeface, generous line height and paragraph spacing,
  and a surface the text contrasts with clearly, distinct from the
  surrounding chrome.
* Show the document's title in the header and edit it in place; a committed
  title change renames the document, and the navigator follows.
* Save automatically on the editor ADR's timing, and flush pending changes
  when the writer switches documents, hides the tab, or leaves the page.
  `Ctrl+S` or `Cmd+S` saves immediately instead of opening the browser's
  dialog.
* Show a quiet save status in the header: saved, saving, retrying while the
  service is unreachable, or in conflict.
* Keep unsaved changes until the service acknowledges them, in browser
  storage so a closed tab or reload loses nothing, and retry when it returns.
* On a conflict, never overwrite either version silently; offer the recovery
  path ADR 0005 defines.
* Add the round-trip corpus tests and browser tests for typing, reloading,
  renaming, and recovering from an unreachable service.

## Acceptance criteria

* [ ] Text typed into a synthetic document is present after a reload with no
  explicit save.
* [ ] Stopping the service while typing shows the retrying status, and the
  text is saved once the service returns.
* [ ] Editing a document's file outside Writer and then typing in Writer
  shows the conflict status, and neither version is lost.
* [ ] Body text on the writing surface meets the contrast target backlog 16
  sets.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record the editor ADR](./0017-editor-adr.md)
* [Navigate and organize the workspace tree](./0022-workspace-navigator.md)
