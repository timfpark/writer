---
title: Record the API conventions ADR
description: Decide API versioning, path and field naming, and error payloads before the service creates its first route.
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 3
---

## Story

As a contributor or coding agent, I want the API's versioning, naming, and
error conventions decided and accepted before the service creates its first
route so that the health endpoint and every later route follow one deliberate
scheme instead of setting precedent by accident.

## Context

[ADR 0002](../adrs/0002-service-architecture.md) lists "API conventions: paths
and versioning, error payloads, pagination, and idempotency" as a follow-up
decision. It notes that other clients beyond the webapp may come later.
[ADR 0003](../adrs/0003-webapp-architecture.md#development-server-and-service-access)
puts every API route under `/api/`, has the development server proxy that
prefix without rewriting paths, and leaves "versioning and naming below
`/api/`" to this decision. It names the prefix, decided before these
conventions, as a risk.

Today the service and webapp ship from one commit and one gate, and a stale
generated client fails `tools/check`. A versioning scheme protects clients
released separately from the service, which do not exist yet but may later.
Field casing and error shapes reach the webapp as generated TypeScript types,
so changing them after routes exist touches both subsystems.

[Backlog 6](./0006-service-foundation.md) creates the first route, and
[backlog 12](./0012-first-pair-writing-agent.md) adds the first endpoint with
real request, response, and error bodies. Both follow what this ADR decides.

## Scope

* Decide whether and how the API is versioned, comparing at least no version,
  a path segment such as `/api/v1/`, and a header or media type. State what
  counts as a breaking change and what triggers a new version.
* Decide path naming below `/api/`: resource nouns, case, path parameters,
  nesting, and the health endpoint's path.
* Decide JSON field casing and how optional and absent fields appear, and
  confirm the result in the types openapi-typescript generates.
* Decide the error payload, for example RFC 9457 problem details or a custom
  shape. Cover how status codes map to error kinds and how errors appear in
  `service/openapi.json`.
* Decide operation ID and tag conventions in the contract.
* Decide how errors and the end of a stream are signaled on an SSE endpoint,
  or state which later story decides it.
* Decide pagination and idempotency now, or record each as deferred with the
  trigger that reopens it.
* Add a note to ADR 0002's Status section, the way ADR 0003 settled
  cross-origin access, recording that this ADR resolves the API conventions
  follow-up.
* Add the ADR to the ADR index with `service` and `webapp` in its
  `subsystems` field.
* Keep any prototype used to inform the decision out of the repository.

## Acceptance criteria

* [ ] The API conventions ADR is accepted and listed in the ADR index.
* [ ] The ADR states the versioning scheme, its breaking-change rule, and the
  alternatives weighed against it.
* [ ] The ADR names the health endpoint's full path and gives a path, field,
  and error example that backlog 6 and 12 can follow.
* [ ] ADR 0002 points to the new ADR for its API conventions follow-up.
* [ ] `tools/check` exits 0.

## Prerequisites

None.
