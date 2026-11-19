---
title: Establish the service subsystem foundation
description: Decide the service's core architecture and create service/ with a pinned toolchain, a verified API contract, and its validation phase.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - service
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want a minimal, validated `service/`
folder with its own guide and checks so that service features start from the
boundaries and tooling that
[ADR 0001](../adrs/0001-monorepo-structure.md) set out.

## Context

ADR 0001 places the service's manifest, lockfile, toolchain pin, API contract,
configuration example, prompts, and evaluation cases inside `service/`, and
assigns them to the service's first deliverable. It leaves the HTTP framework,
the crate layout, and whether the OpenAPI document is hand-written or emitted
from code to a later service ADR.

## Scope

* Record a service architecture ADR covering the HTTP framework, crate layout,
  and how the OpenAPI document is produced and verified.
* Confirm whether Cargo must use an organizational registry proxy and
  configure it before adding any crate.
* Create `service/` with `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, a
  health endpoint on loopback port 8080, and an `.env.example` with no real
  values.
* Commit the OpenAPI document as the contract of record, covering the health
  endpoint.
* Add a `service` phase to `tools/check` running formatting, lint, build,
  tests, and a contract freshness check.
* Apply the root guide's "Adding a subsystem" checklist, including
  `service/README.md`, `service/AGENTS.md` with Governing decisions and exact
  commands, the container toolchain, and a `cargo` Dependabot entry.
* Leave `service/prompts/` and `service/evals/` to the first pair-writing
  agent story rather than creating them empty.

## Acceptance criteria

* [ ] The service ADR is accepted and listed in the ADR index.
* [ ] Following `service/README.md`, a request to the health endpoint on
  `127.0.0.1:8080` succeeds on a host and in the development container.
* [ ] Changing the health endpoint without updating the contract makes
  `tools/check` exit 1 with a message naming the contract.
* [ ] A formatting or failing-test change in `service/` makes `tools/check`
  exit 1, and CI reports `CI result` as failed.
* [ ] The root guides list `service/` as existing and link its guide.

## Prerequisites

* [Configure repository governance on GitHub](./0004-repository-governance.md)
