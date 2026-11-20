---
title: Backlog
description: Prioritized index of planned work for the Writer service and clients
author: Tim Park
ms.date: 2026-11-20
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

| #  | Work item                                                                             | Subsystems             | Outcome                                                                        | Prerequisite |
|----|---------------------------------------------------------------------------------------|------------------------|--------------------------------------------------------------------------------|--------------|
| 7  | [Establish the webapp subsystem foundation](./0007-webapp-foundation.md)              | `webapp`               | `webapp/` shows service health through a generated, verified client.           | None         |
| 15 | [Record the workspace model and API ADR](./0015-workspace-model-adr.md)               | `service`, `webapp`    | An accepted ADR fixes folders, documents, ordering, autosave, and their API.   | None         |
| 11 | [Record the service storage ADR](./0011-storage-architecture-adr.md)                  | `service`              | An accepted ADR fixes the storage interface, filesystem backend, and SQL path. | 15           |
| 16 | [Record the webapp interface foundation ADR](./0016-webapp-interface-adr.md)          | `webapp`               | An accepted ADR fixes styling, typefaces, primitives, routing, and caching.    | None         |
| 17 | [Record the editor ADR](./0017-editor-adr.md)                                         | `webapp`               | An accepted ADR fixes the editor, Markdown subset, and autosave timing.        | 11, 15       |
| 18 | [Build workspace storage with the filesystem backend](./0018-workspace-storage.md)    | `service`              | Folders and documents persist as directories and `.md` files on disk.          | 11, 15       |
| 19 | [Serve the workspace API](./0019-workspace-api.md)                                    | `service`              | The contract lists, creates, saves, moves, and deletes workspace items.        | 18           |
| 20 | [Build the workspace shell](./0020-workspace-shell.md)                                | `webapp`               | The webapp shows a header, collapsible side panes, and a writing region.       | 7, 16        |
| 21 | [Add browser end-to-end tests to the gate](./0021-browser-tests.md)                   | `webapp`, `repository` | Browser and accessibility tests drive the webapp against a real service.       | 20           |
| 22 | [Navigate and organize the workspace tree](./0022-workspace-navigator.md)             | `webapp`               | The navigator shows, folds, creates, renames, deletes, and opens items.        | 19, 20, 21   |
| 23 | [Write in the editing surface with autosave](./0023-writing-surface.md)               | `webapp`               | Writers edit documents and titles, and every change saves itself.              | 17, 22       |
| 24 | [Move and reorder items with drag and drop](./0024-tree-drag-and-drop.md)             | `webapp`               | Writers move and reorder items by dragging or with a menu.                     | 22           |
| 25 | [Prototype the assistant pane](./0025-assistant-pane.md)                              | `webapp`               | The right pane holds a stubbed conversation ready for the agent.               | 20           |
| 26 | [Make the workspace fully keyboard operable](./0026-keyboard-accessibility.md)        | `webapp`               | Every workspace operation works from the keyboard and passes checks.           | 22, 24       |
| 10 | [Record the pair-writing agent architecture ADR](./0010-agent-architecture-adr.md)    | `service`              | An accepted ADR fixes the agent framework, provider, prompts, and evals.       | None         |
| 12 | [Deliver the first pair-writing agent capability](./0012-first-pair-writing-agent.md) | `service`              | The service returns pair-writer questions backed by prompts and evals.         | 10           |

[ADR 0002](../adrs/0002-service-architecture.md),
[ADR 0003](../adrs/0003-webapp-architecture.md), and
[ADR 0004](../adrs/0004-api-conventions.md) record the service and webapp
architecture and the API conventions. The service foundation (item 6) built
`service/` on them, and item 7 builds `webapp/` the same way, applying the
[Adding a subsystem](../adrs/0001-monorepo-structure.md#adding-a-subsystem)
checklist in ADR 0001.

Items 15 through 26 deliver the first release, the writing workspace the
[README](../../README.md#product-direction) describes. Its decisions come
first: item 15 fixes the workspace model and API, item 11 the storage that
persists it, item 16 the interface foundation, and item 17 the editor, which
must respect both the model and the storage format. The service then stores
and serves the workspace (18 and 19) while the webapp builds its shell (20)
and browser tests against it (21). The keyboard-navigable navigator (22) and
the writing surface (23) together make the first usable release. Drag and
drop (24), the assistant pane prototype (25), and the remaining keyboard
shortcuts (26) complete it.

The pair-writing agent follows the workspace. Item 10 records the agent
decision before item 12 creates `service/prompts/` and `service/evals/`.
