---
title: Record the agent conversations ADR
description: Decide how the pair writer's conversations are kept, tied to the versions of text they discuss, shown as separate chats, and revived, viewed, or audited later.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want how the pair writer's conversations
are kept, linked to the text they discuss, and shown to the writer decided
before the agent stories build them so that writers can return to, review,
and audit any conversation, including those the agent started on its own,
long after the text has moved on.

## Context

Backlog 25 holds the assistant pane's single conversation in browser memory,
as [conversation.ts](../../webapp/src/workspace/conversation.ts) shows: it is
never sent to the service or saved, and a reload clears it. That suffices
for a stub but not for an agent that also works in the background, where
the writer may be away when a review finishes and reads its findings later.

One idea, recorded here as an option to weigh rather than a decision: each
conversation is a thread the service stores, and each message points to the
version or snapshot of the text it discussed. Writers could then revive,
view, or audit a conversation later, and move between conversations the way
coding assistants keep separate chats. Because the service owns the
threads, it can run background reviews as conversations of their own, which
appear as independent chats in the webapp.

The [agent ADR](./0010-agent-architecture-adr.md) decides where the agent
runs, what context each request carries, the kinds of finding, and what
triggers background review. [ADR 0005](../adrs/0005-workspace-model.md)
fixes the workspace model and [ADR 0006](../adrs/0006-storage-architecture.md)
the storage backends and copy command that stored conversations must fit.
The [change control ADR](./0027-change-control-adr.md) decides commits and
any automatic snapshots, which conversations might point to, and
[ADR 0004](../adrs/0004-api-conventions.md) sets the conventions for any new
resources.

## Scope

* Define a conversation: who starts it, the writer or a background review;
  what it concerns, such as a document, a passage, a selection, or a folder;
  and its lifecycle, such as open, resolved, archived, and deleted.
* Compare at least three models: conversations kept only in the browser;
  conversations stored by the service with excerpts of the text copied in;
  and conversations stored by the service whose messages point to versioned
  snapshots of the text they discussed.
* Decide how a message records the text it discussed, and how that record
  stays readable when the document is edited, renamed, moved, or deleted.
* Reconcile with the change control ADR: whether conversations point to its
  commits, to lighter snapshots taken for the agent, or to stored excerpts,
  and whether they can ship before backlog 29 builds history.
* Decide how a writer revives a conversation: continuing against the current
  text or the version it discussed, and how the agent learns what changed in
  between.
* Decide how a writer views a past conversation beside the text as it was,
  and compares that version with the current text.
* Decide how background reviews appear: each as its own conversation,
  grouped per document, or as findings in one list; how unread results
  signal without interrupting writing; and how the writer answers a question
  the agent raised.
* Decide how a writer moves between conversations: listing, filtering by
  document, searching, and whether a conversation can branch from an earlier
  message.
* Decide what each agent turn records for audit, such as the prompt version,
  provider and model, the context sent, timing, and token use, so a writer
  or contributor can see why the agent said what it did.
* Decide where conversations persist in every planned backend, whether they
  live in the workspace and travel with ADR 0006's copy command, and whether
  commits include them.
* Define the API resources for conversations and messages, including
  pagination and streaming, under ADR 0004.
* Decide retention and privacy: conversations hold manuscript text, so
  define deleting one conversation or all of them, what happens to a deleted
  document's conversations, export, and that no conversation text appears in
  logs.
* Amend ADR 0005 and ADR 0006 where the decision departs from them, revise
  backlog 12, 34, 35, and 36 to the chosen model, and add stories for work
  they do not cover, such as a conversation list.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR names the conversation model and the alternatives weighed
  against it, including the three models above.
* [ ] The ADR states how a message refers to the text it discussed, and how
  reviving and viewing a conversation work after that text changes or is
  deleted.
* [ ] The ADR states how background reviews appear and how writers move
  between conversations.
* [ ] The ADR states the audit record, storage in every planned backend, the
  API resources, and retention and deletion.
* [ ] Backlog 12, 34, 35, and 36 match the decision, and any new stories are
  in the backlog index.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
