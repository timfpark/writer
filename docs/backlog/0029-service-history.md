---
title: Record and restore commits in the service
description: Add committed history to the storage interface and every built backend, and expose commits, historical reads, and restore through the API contract.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a writer, I want to record the state of my workspace as a commit, read any
earlier commit, and restore my workspace or one document from it so that no
version of my work is ever out of reach.

## Context

The [change control ADR](./0027-change-control-adr.md) fixes the commit
model, when commits happen, and how each backend stores them.
[ADR 0005](../adrs/0005-workspace-model.md#attaching-version-history-later)
fixes the API's additive shape and the restore behavior open clients rely
on. [ADR 0004](../adrs/0004-api-conventions.md) sets the conventions the new
endpoints follow, with the pagination scheme the change control ADR chooses.
If building reveals a flaw in these decisions, amend them in the same pull
request.

## Scope

* Add commit operations to the storage interface: record a commit, list
  commits, read a commit's tree and a document's content at a commit, and
  restore the workspace or one document from a commit.
* Add conformance cases: a restore returns the earlier tree and content,
  unchanged content is stored once, history follows an item across rename
  and move, a deleted item is recoverable, and an interrupted commit leaves
  history unchanged.
* Implement history in every backend built so far, including automatic
  snapshots if the ADR adopts them.
* Add the `commits` endpoints to `writer-api`, test every documented status
  through the router, and regenerate `service/openapi.json`.
* Extend the `service/README.md` walkthrough to commit, change, and restore
  synthetic documents with `curl`.

## Acceptance criteria

* [ ] The conformance suite, with the new cases, passes against every built
  backend.
* [ ] Following the walkthrough restores a synthetic document's earlier text,
  and a save based on its old revision returns `409`.
* [ ] No commit message, title, or content appears in a log line or error
  response, and a test with a synthetic marker proves it.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Record the change control ADR](./0027-change-control-adr.md)
