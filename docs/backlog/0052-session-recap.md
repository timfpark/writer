---
title: Recap the last session when Writer opens
description: Show prepared recaps across all root folders at the workspace root, for any directory tree at any depth, and for each file when returning from an earlier session.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
  - evals
estimated_reading_time: 2
---

## Story

As a writer returning to my work, I want a short recap of where I left off,
what I changed last time, and a suggested next step so that I can pick up the
thread quickly.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) scopes `Session recap`
recursively across N levels: the workspace root shows recaps across all
root folders and their descendants, selecting any directory shows only
that directory's tree, and selecting a file shows only that file's recap.
There is no fixed directory depth or required book / chapter layout.
Returning to a document not visited since an earlier session shows a
compact, non-modal banner that clears the instant the writer types.
[Backlog 63](./0063-remaining-background-agent-evals.md)
measures it. Knowing
what changed needs a record of the last session: the change control work
from [backlog 29](./0029-service-history.md) provides history if it has
landed, and otherwise the recap uses what the service already knows, such as
which documents were saved, together with the reverse outline and open
threads from [backlog 50](./0050-threads-and-outline.md) when present. The
pair writer from backlog 61 provides the
agent the recap uses, and background review from
[backlog 35](./0035-service-background-review.md) provides the background
work that prepares it. Turning the recap off for part or all of the
workspace comes with [backlog 54](./0054-agent-settings-tree.md).

## Scope

* Record lightweight session-change metadata per file, directory tree at any
  depth, and workspace, as ADR 0011 and the conversations ADR decide, without
  storing more text than the workspace already holds.
* Prepare file recaps in the background on idle, rolling up activity through
  every ancestor directory to the workspace root without duplicate entries.
  Reuse reverse outline and open threads when available; opening Writer
  or navigating the tree never waits on a model call.
* Show the workspace recap grouped across all root folders, including
  descendant activity and any files directly under the root. Show any
  selected directory's whole tree, including its direct files and nested
  directories, with no sibling or ancestor activity leaking into it.
* Show only the selected file's recap as a non-modal dismissible banner when
  returning from an earlier session (cleared automatically on typing,
  never repeated during rapid same-session switching). Link recaps to
  files and passages and keep navigation keyboard operable and accessible.
* Refresh only the changed file's recap and its ancestor rollups. Show an
  explicit no-previous-activity state for trees or files without a recap,
  never a recap borrowed from another scope.
* Tune the recap prompt on backlog 63's cases, as backlog 35 tunes its
  agents, and amend [ADR 0010](../adrs/0010-pair-writing-models.md) with the
  chosen prompt. Add the prompt and cases, and extend the fake provider.

## Acceptance criteria

* [ ] After a synthetic session across two root folders with at least four
  nested directory levels, the workspace root includes activity across
  both trees, grouped by root folder. Every directory selection shows all
  and only that directory's descendant activity, including direct files,
  without duplicate entries or a hard-coded depth limit.
* [ ] Reopening any file from an earlier session shows only that file's
  recap, not its siblings' or ancestors' activity; the banner clears on
  typing and does not repeat on rapid same-session switching.
* [ ] Direct workspace-root files are included, empty trees show no previous
  activity, and a file change refreshes its ancestor rollups without
  changing unrelated trees.
* [ ] Opening Writer is no slower with the recap on.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Review documents in the background in the service](./0035-service-background-review.md)
* [Measure the remaining background agents](./0063-remaining-background-agent-evals.md)
