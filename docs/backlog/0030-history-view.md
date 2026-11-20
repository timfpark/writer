---
title: Browse, compare, and restore history in the webapp
description: Let writers commit their work, browse the commit list, read and compare earlier versions, and restore a document or the whole workspace.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want to commit my work with a message, look back through my
commits, see what changed in a document, and roll back to an earlier version
so that I can experiment freely without fear of losing a draft.

## Context

[Backlog 29](./0029-service-history.md) exposes commits, historical reads,
and restore through the contract. The
[change control ADR](./0027-change-control-adr.md) decides whether writers
commit explicitly, whether automatic snapshots appear in the list, and the
commit list's pagination.
[ADR 0005](../adrs/0005-workspace-model.md#attaching-version-history-later)
requires that a restore never silently discards unsaved text, and
[ADR 0007](../adrs/0007-webapp-interface.md) sets the interface foundation
the view builds on.

## Scope

* Regenerate the webapp's API client from the updated contract.
* Commit the working state with a message, and show whether it differs from
  the latest commit.
* List commits page by page, and read the tree and any document at a commit
  without editing it.
* Compare a document between two commits, or between a commit and the
  working state.
* Restore one document or the whole workspace after a confirmation, and
  recover open documents through ADR 0005's conflict flow.
* Make every history action operable from the keyboard, and cover the flow
  with browser and accessibility tests against a real service.

## Acceptance criteria

* [ ] A writer commits a synthetic workspace, edits and deletes items, and
  restores both the edited text and the deleted item from the commit.
* [ ] Restoring a document that is open with unsaved changes keeps those
  changes recoverable rather than discarding them.
* [ ] The browser and accessibility tests pass in `tools/check`.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Add browser end-to-end tests to the gate](./0021-browser-tests.md)
* [Navigate and organize the workspace tree](./0022-workspace-navigator.md)
* [Write in the editing surface with autosave](./0023-writing-surface.md)
* [Record and restore commits in the service](./0029-service-history.md)
