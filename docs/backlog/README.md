---
title: Backlog
description: Prioritized index of planned work for the Writer service and clients
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
keywords:
  - backlog
  - service
  - webapp
estimated_reading_time: 2
---

## Managing the backlog

Every subsystem shares one backlog of delivery stories and open decisions.

* Keep this index sparse. Give each work item one row with a short outcome
  and its prerequisite items. Put scope, rationale, context, and links to
  decisions in the work-item document, never in this file.
* Row order is delivery priority. Independent items can proceed in
  parallel. An item already under way starts its outcome with "In
  progress:". A blocked item starts it with "Blocked:" and sits below the
  ready work.
* Prioritize defects, missing results, and misleading behavior in delivered
  views, together with their prerequisites, before new capabilities.
* Item numbers are stable identities. Give a new item the next unused number.
* A work item's `subsystems` frontmatter lists the folders it changes or the
  decision it governs (`service`, `webapp`, or `repository` for
  repository-wide tooling and process), and the Subsystems column repeats that
  list.
* When a work item is finished, delete its row and its document, update the
  prerequisites of the items that waited on it, and reorder the backlog.

## Backlog

| #  | Work item                                                                             | Subsystems          | Outcome                                                                         | Prerequisite |
|----|---------------------------------------------------------------------------------------|---------------------|---------------------------------------------------------------------------------|--------------|
| 14 | [Add dependency review to pull request CI](./0014-dependency-review.md)               | `repository`        | Pull requests fail CI when a lockfile change introduces a known vulnerability.  | None         |
| 13 | [Record the API conventions ADR](./0013-api-conventions-adr.md)                       | `service`, `webapp` | An accepted ADR fixes API versioning, path and field naming, and errors.        | None         |
| 6  | [Establish the service subsystem foundation](./0006-service-foundation.md)            | `service`           | `service/` serves a health endpoint behind a verified contract and phase.       | 13           |
| 7  | [Establish the webapp subsystem foundation](./0007-webapp-foundation.md)              | `webapp`            | `webapp/` shows service health through a generated, verified client.            | 6            |
| 10 | [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)    | `service`           | An accepted ADR fixes the agent framework, provider, prompts, and evals.        | None         |
| 12 | [Deliver the first pair-writing agent capability](./0012-first-pair-writing-agent.md) | `service`           | The service returns pair-writer questions backed by prompts and evals.          | 6, 10        |
| 11 | [Record the service storage ADR](./0011-storage-architecture-adr.md)                  | `service`           | An accepted ADR fixes the storage engine, schema owner, and migrations.         | None         |

[ADR 0002](../adrs/0002-service-architecture.md) and
[ADR 0003](../adrs/0003-webapp-architecture.md) record the service and webapp
architecture before any subsystem code exists. Item 13 records the API
conventions those decisions leave open before item 6 creates the first route.
Items 6 and 7 build on those decisions and apply the "Adding a subsystem"
checklist in the [agent guide](../../AGENTS.md#adding-a-subsystem). Item 10
likewise records the agent decision before item 12 creates `service/prompts/`
and `service/evals/`, and item 11 records the storage decision before any
story persists text.
