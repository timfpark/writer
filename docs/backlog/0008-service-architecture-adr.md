---
title: Record the service architecture ADR
description: Decide the service's HTTP framework, async runtime, crate layout, and OpenAPI contract production before service/ is built.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 2
---

## Story

As a contributor or coding agent, I want the service's core architecture
decided and accepted before any service code exists so that the service
foundation implements a deliberate choice rather than justifying one after the
fact.

## Context

[ADR 0001](../adrs/0001-monorepo-structure.md) requires a Cargo workspace
inside `service/` with focused internal crates under `service/crates/`. It
leaves the HTTP framework, crate responsibilities and dependencies, and whether
the OpenAPI document is hand-written or emitted from code to a later service
ADR. [Backlog 6](./0006-service-foundation.md) builds what this ADR decides,
and [backlog 9](./0009-webapp-architecture-adr.md) picks a client generator
that must support the contract this ADR produces.

## Scope

* Choose the HTTP framework and async runtime, such as axum on Tokio, and
  compare them with at least one alternative.
* Define the first internal crates under `service/crates/`, each crate's
  responsibility, and the allowed dependency direction between them.
* Decide whether the OpenAPI document is hand-written or emitted from code,
  which OpenAPI version it targets, and how `tools/check` detects a contract
  that no longer matches the code.
* Add the ADR to the ADR index with `service` in its `subsystems` field.
* Keep any prototype used to inform the decision out of the repository.

## Acceptance criteria

* [ ] The service ADR is accepted and listed in the ADR index.
* [ ] The ADR names the HTTP framework and async runtime and records the
  alternatives weighed against them.
* [ ] The ADR lists the initial crates, their responsibilities, and their
  dependency direction.
* [ ] The ADR states how the OpenAPI document is produced, its OpenAPI version,
  and how its freshness is verified.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
