---
title: Move and reorder items with drag and drop
description: Let writers drag documents and folders into other folders and reorder siblings in the navigator, with a non-dragging alternative.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want to drag documents and folders to a new place in the tree
and arrange siblings in my own order so that the navigator reflects how I
think about my projects.

## Context

[Backlog 19](./0019-workspace-api.md) serves move and reorder, and
[backlog 15](./0015-workspace-model-adr.md) defines their rules, including
rejecting a folder moved into its own subtree.
[Backlog 16](./0016-webapp-interface-adr.md) chooses the drag-and-drop
approach and its non-dragging alternative, which WCAG 2.2's dragging
movements criterion requires. [Backlog 22](./0022-workspace-navigator.md)
builds the tree.

## Scope

* Drag a document or folder into another folder, to the top level, or
  between siblings, with indicators for before, after, and inside.
* Expand a collapsed folder after hovering over it during a drag, and scroll
  the pane near its edges.
* Refuse drops into an item's own subtree, and handle the service's
  rejection if one gets through.
* Offer the same moves without dragging, such as move up, move down, and a
  move-to dialog from the context menu.
* Apply moves optimistically and roll back on failure.
* Add browser tests for dragging, the non-dragging alternative, and a
  refused drop.

## Acceptance criteria

* [ ] A reordered folder keeps its order after a reload.
* [ ] Moving a document changes its location in the data folder.
* [ ] Every move a pointer can make is also possible without dragging.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Navigate and organize the workspace tree](./0022-workspace-navigator.md)
