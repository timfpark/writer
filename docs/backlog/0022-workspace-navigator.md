---
title: Navigate and organize the workspace tree
description: Show the folder and document hierarchy in the navigator with indentation and collapsible subtrees, and create, rename, delete, and open items at any level.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want to see my projects as a tree of folders and documents,
fold away the parts I am not working on, and create, rename, or delete items
at any level so that I can organize related writing and focus on one part of
it.

## Context

The service's workspace API, in [openapi.json](../../service/openapi.json),
serves the operations, and
[ADR 0005](../adrs/0005-workspace-model.md) sets the title rules and what
deleting a folder does. [ADR 0007](../adrs/0007-webapp-interface.md#components)
chooses the tree primitive and server-state caching, and
[backlog 20](./0020-workspace-shell.md) provides the pane.
Moving and reordering by drag and drop arrive in
[backlog 24](./0024-tree-drag-and-drop.md). The tree's keyboard structure
belongs here because adding it later means rebuilding the component;
shortcuts beyond moving through the tree arrive in
[backlog 26](./0026-keyboard-accessibility.md).

## Scope

* Render the hierarchy with indentation per level and guide lines or another
  visual cue, distinct folder and document icons, and the order the service
  returns.
* Expand and collapse a folder, collapse or expand a whole subtree in one
  action, and collapse everything from the top of the pane. Remember
  expansion across reloads.
* Create a document or folder at the top level or inside any folder from
  hover actions and a context menu. A new item starts in inline rename, and a
  new document opens in the writing region.
* Rename inline, and delete after a confirmation that says how many items a
  folder deletion removes.
* Open a document by selecting it, highlight the open document, and expand
  its ancestors when it is opened by URL.
* Build the tree on React Aria's `Tree`, which follows the WAI-ARIA treegrid
  pattern: `treegrid` and `row` roles, one tab stop with roving focus, arrow
  keys to move focus and to expand or collapse folders, `Home` and `End`, and
  `Enter` to open a document.
* Apply changes optimistically, roll back on failure, and show failures by
  their problem `code` without blocking the page.
* Give each browser test run a temporary data folder, and add browser tests
  for each behavior above.

## Acceptance criteria

* [ ] A writer can build a synthetic three-level tree of folders and
  documents from the navigator alone, and it survives a reload.
* [ ] Collapsing a folder hides its whole subtree, and expanding it restores
  each descendant's previous state.
* [ ] A failed rename or delete restores the tree and shows a message.
* [ ] A writer can move through the tree, expand and collapse folders, and
  open a document with the keyboard alone.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Build the workspace shell](./0020-workspace-shell.md)
* [Add browser end-to-end tests to the gate](./0021-browser-tests.md)
