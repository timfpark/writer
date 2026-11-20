---
title: Record the service storage ADR
description: Decide the storage interface, the mirrored filesystem backend that implements it first, and the path to SQLite and PostgreSQL, before any story persists text.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want the service's storage interface, its
first backend, and the path to later backends decided and accepted before any
story persists text so that the storage crate implements a deliberate choice
rather than justifying one after the fact.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md#context) makes text storage a
service responsibility and leaves the storage engine to a later ADR.
[ADR 0002](../adrs/0002-service-architecture.md) lists "Storage engine, schema
ownership, and migrations" as a follow-up decision. It expects a storage crate
below `writer-api` shaped by this ADR, and requires blocking work to run
through `spawn_blocking` behind a bounded permit.

The [README](../../README.md#product-direction) sets the direction: storage
sits behind interchangeable backends, starting with plain files, then SQLite,
then PostgreSQL. The filesystem backend mirrors the workspace tree, with
folders as directories and documents as `.md` files, so the workspace stays
readable and editable with other tools. Manual ordering of siblings and
identifiers that survive rename and move therefore need a home outside the
file names. [ADR 0005](../adrs/0005-workspace-model.md) defines the model
this storage persists, its limits, and the revision rule for stale writes,
and its [follow-up decisions](../adrs/0005-workspace-model.md#follow-up-decisions)
list what it leaves to storage. An earlier project chose SQLite through SQLx; treat
that as input for the SQL backends, not a validated choice for Writer.

## Scope

* Define the storage interface the API depends on, independent of any
  backend, and a conformance test suite that every backend must pass.
* Design the filesystem backend:
  * Map titles to file and directory names, covering characters invalid on
    Linux, macOS, or Windows, case-insensitive file systems, and collisions.
  * Decide where identifiers and manual order live, comparing Markdown front
    matter, a sidecar file per folder, and one workspace index.
  * Write atomically, so a crash leaves either the old or the new content.
  * Decide how edits made outside Writer while the service runs are detected
    and how revision tokens are derived, such as from a content hash.
* Decide how one service process serializes writes, and confirm file I/O runs
  through `spawn_blocking` as ADR 0002 requires.
* Lay out the path to SQLite and PostgreSQL backends: the access library, the
  crate that owns the schema, how migrations are written, applied, and tested,
  and how a workspace moves between backends. Do not build them.
* Decide how configuration selects a backend and its location.
* Decide the default data location, outside version control, and the
  development default, such as a folder under the ignored `.local/`.
* Note how each backend could hold committed revisions for the later change
  control feature, such as a Git repository beside the files or history
  tables, without designing that feature.
* Decide how tests get isolated, synthetic data.
* Name the storage crate's responsibility and its place in ADR 0002's
  dependency direction.
* Add the ADR to the ADR index with `service` in its `subsystems` field, and
  keep any prototype used to inform the decision out of the repository.

## Acceptance criteria

* [ ] The storage ADR is accepted and listed in the ADR index.
* [ ] The ADR defines the storage interface and the conformance suite every
  backend passes.
* [ ] The ADR specifies the filesystem backend's on-disk layout, naming
  rules, identifier and order storage, atomic writes, and handling of
  external edits, and records the alternatives weighed against them.
* [ ] The ADR names the access library, schema owner, and migration approach
  for the SQL backends.
* [ ] The ADR states the default data location and confirms it is outside
  version control.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
