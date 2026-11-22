---
title: Make the workspace fully keyboard operable
description: Operate the navigator tree, panes, and editor entirely from the keyboard, and hold the workspace to automated accessibility checks.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer who keeps my hands on the keyboard, or relies on assistive
technology, I want to move through the tree, the panes, and the document
without a pointer so that organizing and writing never slow me down.

## Context

Backlog 22 built the navigator on the
WAI-ARIA treegrid pattern, with arrow keys, `Home`, `End`, and `Enter`, and
backlog 24 added drag and drop with move commands in each row's menu. The
remaining shortcuts were left out of those stories so the navigator could
ship sooner. [ADR 0009](../adrs/0009-browser-tests.md) supplies automated
accessibility checks.

## Scope

* Complete the WAI-ARIA treegrid pattern in the navigator with type-ahead, `F2`
  to rename, `Delete` to delete, and keyboard access to the context menu's
  create and move actions.
* Add shortcuts that move focus between the navigator, the writing surface,
  and the assistant, and return focus sensibly when a pane collapses.
* Add a shortcut reference reachable from the header, including the writing
  surface's `Enter`, `Shift+Enter`, and marker keys that `webapp/README.md`
  lists.
* Extend browser tests to keyboard-only paths, with no serious automated
  accessibility violations.
* Record a manual screen reader check in `webapp/README.md`.

## Acceptance criteria

* [ ] Every navigator operation, including moving items, works without a
  pointer.
* [ ] The automated accessibility check reports no serious or critical
  violations on the workspace.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
