---
title: Record the service storage ADR
description: Decide the service's storage engine, schema ownership, and migrations before any story persists text.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a contributor or coding agent, I want the service's storage engine, schema
ownership, and migration approach decided and accepted before any story
persists text so that the storage crate implements a deliberate choice rather
than justifying one after the fact.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md#context) makes text storage a
service responsibility and leaves the storage engine to a later ADR.
[ADR 0002](../adrs/0002-service-architecture.md) lists "Storage engine, schema
ownership, and migrations" as a follow-up decision. It expects a storage crate
below `writer-api` shaped by this ADR, and requires blocking work to run
through `spawn_blocking` behind a bounded permit. An earlier project's
[SQLite decision](../previous-work/0001-api-runtime-and-sqlite.md) is
reference material, not a validated choice for Writer.

## Scope

* Choose the storage engine and access library, and compare at least one
  alternative.
* Decide which crate owns the schema and how migrations are written, applied,
  and tested.
* Decide where the service keeps its data by default, keeping real
  manuscripts out of the repository as ADR 0001's safety rules require.
* Decide how tests and fixtures get isolated, synthetic data.
* Name the storage crate's responsibility and its place in ADR 0002's
  dependency direction.
* Add the ADR to the ADR index with `service` in its `subsystems` field.
* Keep any prototype used to inform the decision out of the repository.

## Acceptance criteria

* [ ] The storage ADR is accepted and listed in the ADR index.
* [ ] The ADR names the storage engine, access library, schema owner, and
  migration approach, and records the alternatives weighed against them.
* [ ] The ADR states the default data location and confirms it is outside
  version control.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
