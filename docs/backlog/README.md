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

| #  | Work item                                                                             | Subsystems   | Outcome                                                                     | Prerequisite |
|----|---------------------------------------------------------------------------------------|--------------|-----------------------------------------------------------------------------|--------------|
| 3  | [Run the validation gate in GitHub Actions](./0003-continuous-integration.md)         | `repository` | Pull requests and `main` run `tools/check` behind one required `CI result`. | None         |
| 4  | [Configure repository governance on GitHub](./0004-repository-governance.md)          | `repository` | Dependabot, a PR template, branch protection, and secret scanning are live. | 3            |
| 5  | [Add Markdown style lint to the validation gate](./0005-markdown-style-lint.md)       | `repository` | `tools/check` reports Markdown style violations with file and line.         | 4            |
| 9  | [Record the webapp architecture ADR](./0009-webapp-architecture-adr.md)               | `webapp`     | An accepted ADR fixes the webapp build tool, client generator, and port.    | None         |
| 6  | [Establish the service subsystem foundation](./0006-service-foundation.md)            | `service`    | `service/` serves a health endpoint behind a verified contract and phase.   | 4            |
| 7  | [Establish the webapp subsystem foundation](./0007-webapp-foundation.md)              | `webapp`     | `webapp/` shows service health through a generated, verified client.        | 6, 9         |
| 10 | [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)    | `service`    | An accepted ADR fixes the agent framework, provider, prompts, and evals.    | None         |
| 12 | [Deliver the first pair-writing agent capability](./0012-first-pair-writing-agent.md) | `service`    | The service returns pair-writer questions backed by prompts and evals.      | 6, 10        |
| 11 | [Record the service storage ADR](./0011-storage-architecture-adr.md)                  | `service`    | An accepted ADR fixes the storage engine, schema owner, and migrations.     | None         |

Item 9 records the webapp architecture ADR before any webapp code exists;
[ADR 0002](../adrs/0002-service-architecture.md) already records the service's.
Items 6 and 7 build on those decisions and apply the "Adding a subsystem"
checklist in the [agent guide](../../AGENTS.md#adding-a-subsystem). Item 10
likewise records the agent decision before item 12 creates `service/prompts/`
and `service/evals/`, and item 11 records the storage decision before any
story persists text.
