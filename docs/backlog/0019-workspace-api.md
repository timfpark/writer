---
title: Serve the workspace API
description: Expose the workspace model through versioned endpoints in writer-api, with problem details errors, router tests, and a regenerated contract.
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a client developer, I want endpoints that list, create, rename, move,
reorder, read, save, and delete folders and documents so that the webapp
manages the workspace only through the service's contract.

## Context

[ADR 0005](../adrs/0005-workspace-model.md#operations) defines the operations, their
paths and bodies, and the conflict response for stale writes.
[ADR 0004](../adrs/0004-api-conventions.md) sets paths, field casing,
problem details errors, operation IDs, and tags, and forbids manuscript text in
paths, query strings, error details, and logs.
[ADR 0002](../adrs/0002-service-architecture.md) requires router tests for
every documented response and a fresh `service/openapi.json`.
Backlog 18, the workspace storage story, built the storage the handlers call:
[writer-storage](../../service/crates/writer-storage/)'s `WorkspaceStore`,
which `writer-server` already opens at startup, and the
[writer-domain](../../service/crates/writer-domain/) types and errors that
transport types map to.

## Scope

* Add the workspace operations to `writer-api`, mapping transport types to
  domain types and storage errors to `Problem` responses, including `404`,
  `409`, `413`, and `422`.
* Pass the store `writer-server` opens at startup to `writer_api::router`,
  and run `writer-api`'s router tests against the filesystem backend in a
  temporary directory.
* Test every documented status through the router, and assert that a
  synthetic marker sent in a document body appears in no error response and
  no log line.
* Regenerate `service/openapi.json`, and keep the conventions test passing.
* Add a walkthrough to `service/README.md` that creates, saves, renames,
  moves, and deletes synthetic documents with `curl`.

## Acceptance criteria

* [ ] Following the `service/README.md` walkthrough on a host and in the
  development container changes the data folder as each step describes.
* [ ] Saving with a stale revision returns `409` with code `conflict`, and
  the stored content is unchanged.
* [ ] Changing an endpoint without regenerating the contract makes
  `tools/check` exit 1 with a message naming `service/openapi.json`.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
