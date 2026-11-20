---
title: Build workspace storage with the filesystem backend
description: Add the domain and storage crates, implement the storage interface with the mirrored filesystem backend, and prove it with the backend conformance suite.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 3
---

## Story

As a writer, I want my folders and documents kept as ordinary directories and
Markdown files on my own machine so that my work is durable, readable with
other tools, and never locked inside Writer.

## Context

[Backlog 15](./0015-workspace-model-adr.md) defines the workspace model and
names the domain crate. [Backlog 11](./0011-storage-architecture-adr.md)
defines the storage interface, the conformance suite, and the filesystem
backend's layout, naming, identifier and order storage, atomic writes, and
handling of external edits. [ADR 0002](../adrs/0002-service-architecture.md#crate-layout)
places both crates below `writer-api`, free of axum, Tower, and utoipa types,
and [its request execution rules](../adrs/0002-service-architecture.md#request-execution)
run blocking file I/O through `spawn_blocking` behind a bounded permit. If
building reveals a flaw in either ADR, amend it in the same pull request.

## Scope

* Add the domain crate with the workspace types and rules, tested without a
  runtime or HTTP.
* Add the storage crate with the storage interface and the filesystem
  backend, covering create, read, list, rename, move, reorder, delete, and
  content replacement with stale-write detection.
* Write the conformance suite so it runs against any backend, and run it
  against the filesystem backend in temporary directories with synthetic
  text.
* Test the filesystem backend's own rules: invalid and colliding names,
  case-insensitive file systems, atomic replacement, and a file changed
  outside Writer.
* Add the data location setting to `service/.env.example`, and create the
  data folder on first use.
* Update `service/README.md` with where data lives and how to back it up, and
  `service/AGENTS.md` with the new crates and their responsibilities.

## Acceptance criteria

* [ ] The conformance suite passes against the filesystem backend.
* [ ] After a synthetic workspace is created through the storage interface,
  the data folder shows one directory per folder and one `.md` file per
  document, named after their titles.
* [ ] An interrupted write leaves the previous content intact, and a test
  proves it.
* [ ] A write based on a stale revision is rejected rather than overwriting
  newer content.
* [ ] `tools/check` exits 0 and leaves no files outside temporary
  directories.

## Prerequisites

* [Record the service storage ADR](./0011-storage-architecture-adr.md)
* [Record the workspace model and API ADR](./0015-workspace-model-adr.md)
