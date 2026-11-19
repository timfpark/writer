---
title: Backlog
description: Prioritized index of planned work for the writer service and clients
author: Tim Park
ms.date: 2026-11-19
ms.topic: reference
keywords:
  - backlog
  - service
  - cli
  - webapp
  - agent
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
  decision it governs, and the Subsystems column repeats that list.
* When a work item is finished, delete its row and its document, update the
  prerequisites of the items that waited on it, and reorder the backlog.

## Backlog

| #   | Work item                                                            | Subsystems            | Outcome                                                                  | Prerequisite   |
|-----|----------------------------------------------------------------------|-----------------------|--------------------------------------------------------------------------|----------------|
| 1   | [Decide the monorepo foundation](./0001-monorepo-foundation.md)      | `service`, `webapp`   | ADR 0001 defines boundaries, agent navigation, and the tooling baseline. | None           |
