---
title: Record the change control ADR
description: Decide how Writer records committed versions of the workspace, when commits happen, how history is stored in every backend, and how writers restore and measure their work over time.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want the history model decided and
accepted before any history is built so that writers can roll back to and
compare earlier states of their work, and see how much they wrote over time,
in every storage backend.

## Context

The [README](../../README.md#product-direction) promises change control in
the style of Git, where a writer commits a set of changes as one atomic
revision and can view or roll back to earlier states.
[ADR 0005](../adrs/0005-workspace-model.md#attaching-version-history-later)
fixes the attachment points: commits are an immutable sequence, each
recording the whole working state keyed by item identifier, with a commit
identifier, parent, message, and time; the API grows additively with a
`commits` collection and restore; and revisions stay working-state tokens.
[ADR 0006](../adrs/0006-storage-architecture.md#committed-revisions-later)
sketches one design per backend, a Git repository at the filesystem
workspace root and `commits` tables in SQL, and leaves moving history
between backends to this decision. [ADR 0004](../adrs/0004-api-conventions.md)
defers its pagination scheme until the commit list, the first unbounded
collection, exists.

Autosave replaces content in place, so history only sees what a commit
captures. Measuring progress over time therefore depends on when commits
happen, not only on how they are stored.

## Scope

* Choose the commit model, comparing at least a Writer-owned,
  content-addressed hash tree shared by every backend, in which each folder's
  hash covers its children's identifiers, kinds, titles, positions, and
  content hashes and a commit's identifier covers its root, parent, and
  metadata, against ADR 0006's sketch of Git for the filesystem backend and
  tables for SQL. Decide whether Git remains an export format either way.
* Decide when commits happen: explicit commits by the writer, automatic
  snapshots on idle, interval, or end of session, or both; how automatic
  snapshots relate to the autosave timing from the
  [editor ADR](../adrs/0008-editor.md#autosave-timing-and-flush-events); and whether automatic snapshots are
  pruned or squashed.
* Define restoring the whole workspace and a single document, recovering a
  deleted item from a commit, and the client behavior ADR 0005 requires when
  a restore changes an open document.
* Define how each backend stores commits durably and atomically, how unchanged
  content and subtrees are shared between commits, and how revisions relate to
  content keys.
* Decide how history moves between backends, extending ADR 0006's copy
  command, and whether the SQLite backend must precede history.
* Choose ADR 0004's pagination scheme for the commit list.
* Define the measures that progress views report, such as words and
  characters added and removed per document and folder, how Markdown markup
  is counted, and whether measures are stored per commit or computed from
  diffs.
* Decide whether to follow items renamed or moved outside Writer, which
  otherwise restart their history under a new identifier.
* Amend ADR 0005 and ADR 0006 where the decision departs from them, and add
  the ADR to the index with `service` and `webapp` in its `subsystems` field.

## Acceptance criteria

* [ ] The ADR is accepted and listed in the ADR index.
* [ ] The ADR names the commit model, its on-disk and in-database forms for
  every planned backend, and the alternatives weighed against it.
* [ ] The ADR states when commits happen and how automatic snapshots, if
  any, are retained.
* [ ] The ADR states restore semantics, history migration between backends,
  the commit list's pagination scheme, and the progress measures.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Build workspace storage with the filesystem backend](./0018-workspace-storage.md)
* [Serve the workspace API](./0019-workspace-api.md)
