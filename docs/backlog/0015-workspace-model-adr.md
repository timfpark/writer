---
title: Record the workspace model and API ADR
description: Decide the folder and document model, its identifiers, ordering, and autosave semantics, and the API that reads and changes them, before storage or interface code exists.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want the workspace's folders, documents,
hierarchy, order, and content, and the API that reads and changes them,
decided and accepted before storage or interface code exists so that every
storage backend and the webapp build against one model.

## Context

The [README](../../README.md#product-direction) sets the first release's
direction: a hierarchical navigator of folders and documents, a writing
surface, transparent autosave, and storage behind interchangeable backends.
Documents are Markdown, edited in a rich-text surface. The navigator creates,
renames, deletes, moves, and manually reorders folders and documents at any
level.

[ADR 0002](../adrs/0002-service-architecture.md#crate-layout) expects a pure
domain crate below `writer-api`. [ADR 0004](../adrs/0004-api-conventions.md)
sets paths, fields, and errors, and its
[deferred decisions](../adrs/0004-api-conventions.md#deferred-decisions) each
reopen with this work: renaming and moving are the first partial updates,
creating a document is the first `POST` that creates durable state, and the
workspace tree is the first collection whose size the service does not bound.

The workspace is mutable state for now. A later release adds change control in
the style of Git: the user commits a set of changes as one atomic revision and
can view or roll back to earlier states. This ADR leaves room for that without
designing it.

## Scope

* Define folders and documents: nesting rules, whether they share one sibling
  order, title rules (length, allowed characters, and whether siblings may
  share a title), and opaque identifiers that survive rename and move.
* Fix the content format as UTF-8 Markdown, leaving the supported subset to
  the [editor ADR](./0017-editor-adr.md), and set the maximum document size
  the service accepts.
* Decide how the client reads the hierarchy, whole tree or per folder, and
  either bound its size or choose the pagination scheme ADR 0004 defers.
* Define create, read, rename, move, reorder, delete, and content replacement
  operations with paths, operation IDs, bodies, and examples. Decide whether
  deleting a folder is recursive and whether deletion is permanent or moves
  items to a trash.
* Choose between `PATCH` and dedicated operations for rename, move, and
  reorder, and record the partial update rule if `PATCH` is chosen.
* Decide idempotency for creation, such as client-generated identifiers with
  `PUT` or an `Idempotency-Key` header.
* Define autosave semantics: what each save sends, the revision token that
  detects a stale write, how the client presents it, the `409 conflict`
  response, and how the client recovers without losing text.
* Describe how committed revisions, history, and rollback would attach to
  this model later without breaking `v1`, separating the mutable working
  state from committed history. Do not design that feature in full.
* Name the domain crate and its place in ADR 0002's dependency direction.
* Amend ADR 0004's deferred decisions that this record settles, and add the
  ADR to the index with `service` and `webapp` in its `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR lists every workspace operation with its path, operation ID,
  bodies, error statuses, and an example that follows ADR 0004.
* [ ] Partial updates, idempotency, and pagination are each settled or
  bounded, and ADR 0004 records the outcome.
* [ ] The ADR states the stale-write rule, the conflict response, and the
  client's recovery path.
* [ ] The ADR explains how version history would attach to the model later.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
