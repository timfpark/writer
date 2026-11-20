---
title: Build the SQLite backend and copy command
description: Add the writer-storage-sql crate with the SQLite backend, its first migration, backend selection, the bulk import operation, and a command that copies a workspace between backends.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a writer, I want to keep my workspace in a single SQLite database and move
it between storage backends without losing identifiers, order, or content so
that the storage choice never traps my work.

## Context

[ADR 0006](../adrs/0006-storage-architecture.md#sql-backends) fixes the SQL
path: SQLx 0.9 in a `writer-storage-sql` crate (planned), forward-only
migrations per dialect embedded with `sqlx::migrate!`, runtime-checked
queries, WAL mode with `synchronous = FULL`, and a committed schema snapshot.
Its [moving between backends](../adrs/0006-storage-architecture.md#moving-between-backends)
section defines the copy command and the bulk import operation, and its
configuration section plans `WRITER_STORAGE`. The
[change control ADR](./0027-change-control-adr.md) may require this backend
before history if it chooses one history format for every backend. If
building reveals a flaw in ADR 0006, amend it in the same pull request.

## Scope

* Add the `writer-storage-sql` crate with the SQLite backend, its first
  migration, and the committed schema snapshot test.
* Add the bulk import operation to the storage interface, with conformance
  cases, and implement it in both backends.
* Add `WRITER_STORAGE` to `writer-server` and `service/.env.example`, and
  open the configured backend at startup.
* Add the copy command, which verifies the destination's tree and every
  revision against the source and never changes the source.
* Update `.devcontainer/` if the bundled SQLite build needs a tool it lacks.
* Update `service/README.md` and `service/AGENTS.md` with the new crate,
  setting, command, and how to back up and upgrade a database.

## Acceptance criteria

* [ ] The conformance suite passes against the SQLite backend.
* [ ] Copying a synthetic workspace from the filesystem backend to SQLite and
  back yields identical identifiers, titles, order, content, and revisions.
* [ ] Editing an applied migration makes the backend refuse to open, and a
  test proves it.
* [ ] `tools/check` exits 0 and leaves no files outside temporary
  directories.

## Prerequisites

* [Build workspace storage with the filesystem backend](./0018-workspace-storage.md)
