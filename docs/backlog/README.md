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

| # | Work item                                                                       | Subsystems   | Outcome                                                                     | Prerequisite |
|---|---------------------------------------------------------------------------------|--------------|-----------------------------------------------------------------------------|--------------|
| 2 | [Add a reproducible development container](./0002-development-container.md)     | `repository` | `tools/check` passes in a pinned, non-root container with every toolchain.  | None         |
| 3 | [Run the validation gate in GitHub Actions](./0003-continuous-integration.md)   | `repository` | Pull requests and `main` run `tools/check` behind one required `CI result`. | 2            |
| 4 | [Configure repository governance on GitHub](./0004-repository-governance.md)    | `repository` | Dependabot, a PR template, branch protection, and secret scanning are live. | 3            |
| 5 | [Add Markdown style lint to the validation gate](./0005-markdown-style-lint.md) | `repository` | `tools/check` reports Markdown style violations with file and line.         | 2, 4         |
| 6 | [Establish the service subsystem foundation](./0006-service-foundation.md)      | `service`    | `service/` serves a health endpoint behind a verified contract and phase.   | 4            |
| 7 | [Establish the webapp subsystem foundation](./0007-webapp-foundation.md)        | `webapp`     | `webapp/` shows service health through a generated, verified client.        | 6            |

Items 6 and 7 each record their subsystem's architecture ADR before building,
and apply the "Adding a subsystem" checklist in the
[agent guide](../../AGENTS.md#adding-a-subsystem).
