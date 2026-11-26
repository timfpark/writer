---
title: Recap the last session when Writer opens
description: Show a prepared recap of where the writer left off, what changed, and a suggested next step at the workspace root, on folder selection, and when returning to a document from an earlier session.
author: Tim Park
ms.date: 2026-11-25
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

[ADR 0011](../adrs/0011-background-agents-ux.md) scopes `Session recap` to
three levels: opening the workspace root with no document loaded shows a
workspace recap grouped by top-level folder, selecting a folder shows a
subtree recap of recent activity in that book, and returning to a document
not visited since an earlier session shows a compact, non-modal banner that
clears the instant the writer types. [Backlog 48](./0048-background-agent-evals.md)
measures it. Knowing
what changed needs a record of the last session: the change control work
from [backlog 29](./0029-service-history.md) provides history if it has
landed, and otherwise the recap uses what the service already knows, such as
which documents were saved, together with the reverse outline and open
threads from [backlog 50](./0050-threads-and-outline.md) when present. The
pair writer from [backlog 34](./0034-assistant-pane-agent.md) provides the
agent the recap uses, and background review from
[backlog 35](./0035-service-background-review.md) provides the background
work that prepares it. Turning the recap off for part or all of the
workspace comes with [backlog 54](./0054-agent-settings-tree.md).

## Scope

* Record lightweight session-change metadata per workspace, folder subtree,
  and document, as ADR 0011 and the conversations ADR decide, without
  storing more text than the workspace already holds.
* Prepare workspace, folder, and document recaps in the background on idle,
  reusing reverse outline and open threads when available, so opening
  Writer or switching folders is never delayed.
* Show the recap at all three scopes as ADR 0011 decides: on the workspace
  root when no document is loaded, when selecting a folder in the
  navigator, and as a non-modal dismissible banner when returning to a
  document from an earlier session (cleared automatically on typing),
  linked to documents and passages, keyboard operable and accessible.
* Tune the recap prompt on backlog 48's cases, as backlog 35 tunes its
  agents, and amend [ADR 0010](../adrs/0010-pair-writing-models.md) with the
  chosen prompt. Add the prompt and cases, and extend the fake provider.

## Acceptance criteria

* [ ] After a synthetic session across two books, opening the workspace
  root shows a workspace recap, clicking a folder shows that subtree's
  recap, and reopening a document from an earlier session shows a document
  recap banner that clears on typing.
* [ ] Opening Writer is no slower with the recap on.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)
* [Review documents in the background in the service](./0035-service-background-review.md)
