---
title: Record the agent conversations ADR
description: Decide how the service keeps the pair writer's conversations and living artifacts, ties them to the versions of text they discuss, and exposes them so writers can revive, view, correct, and audit them later.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want how the pair writer's conversations
are stored, linked to the text they discuss, and exposed through the API
decided before the agent stories build them so that the experience ADR's
journeys for returning to, reviving, and auditing conversations work long
after the text has moved on.

## Context

[ADR 0012](../adrs/0012-pair-writing-experience.md) decides that writers
work in chat threads in the `Chat` tab, each belonging to a document, with
one thread per finding they discuss. Every reply and finding records what it
read, and each document source reopens exactly as read, even after the
thread continues against the current draft. A deleted document's threads
stay, marked, until the writer deletes them, and deleting a thread removes
everything it recorded without touching documents. Findings persist with
their quoted text, and dismissals with their agent and exact text. Its
[requirements on this ADR](../adrs/0012-pair-writing-experience.md#agent-conversations-adr-backlog-37)
list what must be stored. This decision chooses the data model and storage
that make those journeys work.

[Backlog 60](./0060-scripted-chat-tab.md) holds the `Chat` tab's threads,
and what each turn read, in browser memory and sends each turn to a
provisional, stateless endpoint that stores nothing, so a reload clears
them.

One idea, recorded here as an option to weigh rather than a decision: each
conversation is a thread the service stores, and each message points to the
version or snapshot of the text it discussed. Because the service owns the
threads, it can run background reviews as conversations of their own and
keep them for the writer to read later.

The [agent architecture ADR](./0010-agent-architecture-adr.md) decides where
the agent runs, how background reviews execute, and how agents chain.
[ADR 0011](../adrs/0011-background-agents-ux.md) adds book-scoped living
artifacts (story notes, timeline, reverse outline, open threads,
per-chapter reader reaction, and the writer's own rules) plus recursive
session recaps (workspace root, directory trees at any depth, and files), which the agent keeps
current, other agents read, and the writer corrects; they need storage as
durable as conversations.
[ADR 0005](../adrs/0005-workspace-model.md) fixes the workspace model and
[ADR 0006](../adrs/0006-storage-architecture.md) the storage backends and
copy command that stored conversations must fit. The
[change control ADR](./0027-change-control-adr.md) decides commits and any
automatic snapshots, which conversations might point to, and
[ADR 0004](../adrs/0004-api-conventions.md) sets the conventions for any new
resources.

## Scope

* Model threads and their turns as ADR 0012 requires: thread ID, title,
  document, optional `findingId` link (supporting idempotent `Answer in
  Chat` and `Discuss in Chat` handoffs), last activity and unread state,
  who or what started each turn, each turn's selection and added
  documents, and turn status (including `Stopped` and failed turns).
* Compare at least three models: conversations kept only in the browser;
  conversations stored by the service with excerpts of the text copied in;
  and conversations stored by the service whose messages point to versioned
  immutable snapshots of the text they discussed.
* Decide how each turn and finding records what it read, so its `What it
  read` sources and the revival banner's `View text then` reopen that text
  exactly as read after the document is edited, renamed, moved, or deleted,
  and after the thread continues on a newer draft, storing each distinct
  version of a document once where possible.
* Reconcile with the change control ADR: whether conversations point to its
  commits, to lighter content-addressed snapshots taken for the agent, or
  to stored excerpts. The change control ADR comes later, so choose a
  reference that works without it, and state what that ADR must preserve.
* Model living artifacts scoped to the top-level folder (book) subtree:
  their entries, the passages each entry cites, `Extracted` versus `Edited
  by you` provenance (with `Revert to extracted`), deleted-entry
  suppression, `Intentionally open` thread states, per-chapter reader
  reactions, the writer's own rules, active findings with their quoted
  text, dismissals keyed by agent and exact passage text, lightweight
  session-change records for ADR 0011's file
  recaps and ancestor-directory rollups through the workspace root without
  duplicate activity, and how an entry is marked stale when its passages
  change.
* Decide whether a follow-up in a revived thread, after the `Continuing
  against the current draft` divider, also tells the agent what changed
  since the earlier turns, beyond the current text and earlier turns
  ADR 0012 has it read.
* Decide what each turn and finding records for ADR 0012's `What it read`
  disclosure and audit record: the sources read (document versions,
  selection, added documents, and living artifacts), why it ran, the model,
  and the prompt version and digest, plus timing and token use for the
  audit record alone.
* Decide where conversations and living artifacts persist in every planned
  backend, whether they live in the workspace and travel with ADR 0006's
  copy command, and whether commits include them.
* Define the API resources for threads, turns, the text they read,
  findings and dismissals, and living artifacts, including listing by
  document or workspace, pagination, permanent thread deletion that removes
  what the thread recorded without touching documents, corrections, and
  streaming, under ADR 0004.
* Decide how deletion and retention work, including keeping a deleted
  document's threads, marked, as ADR 0012 decides, how conversations are
  exported, and that no conversation text appears in logs, since
  conversations hold manuscript text.
* Amend ADR 0005 and ADR 0006 where the decision departs from them, revise
  backlog 12, 34, 35, 36, 49, and 50 to the chosen model, and add stories
  for work they do not cover.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR names the conversation model and the alternatives weighed
  against it, including the three models above.
* [ ] The ADR states how a message refers to the text it discussed, and how
  that reference survives edits, moves, and deletion.
* [ ] The ADR states the audit record, storage in every planned backend, the
  API resources, and retention and deletion, for conversations and living
  artifacts.
* [ ] Each conversation journey in the experience ADR maps to the model and
  resources the ADR defines.
* [ ] Backlog 12, 34, 35, 36, 49, and 50 match the decision, and any new
  stories are in the backlog index.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)
