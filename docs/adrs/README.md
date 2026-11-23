---
title: Architecture Decision Records
description: Index of architectural decisions for the Writer service and its clients
author: Tim Park
ms.date: 2026-11-20
ms.topic: reference
keywords:
  - adr
  - architecture
estimated_reading_time: 2
---

## Purpose

Architecture decision records capture consequential technical choices, the
alternatives weighed against them, and the trade-offs accepted. An ADR explains
why the application is built the way it is, so a later reader can tell a
deliberate decision from an accident.

Decisions that have not been made yet carry a story in the
[backlog](../backlog/README.md), alongside the delivery work they unblock.

Every subsystem shares this log and its numbering, including decisions that
affect only one subsystem. ADR and backlog numbers are independent. Each record
starts with a `Decision summary` so contributors and coding agents can read the
active rules without paging through rejected options, and lists the subsystems
it governs in its `subsystems` frontmatter (`service`, `webapp`, `evals`, or
`repository`), repeated in the `Subsystems` column below. Each subsystem's
`AGENTS.md` summarizes the active operational rules and links the records that
name it in a Governing decisions section, as
[ADR 0001](./0001-monorepo-structure.md#agent-discoverability) describes.

## Records

| ADR                                    | Title                                                            | Subsystems                                 | Summary                                                                                                                                                      | Status   |
|----------------------------------------|------------------------------------------------------------------|--------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| [0001](./0001-monorepo-structure.md)   | Monorepo structure, agent navigation, and tooling baseline       | `repository`, `service`, `webapp`, `evals` | Top-level `service/`, `webapp/`, and `evals/` folders, OpenAPI boundary, `AGENTS.md` hierarchy, and `tools/check`.                                           | Accepted |
| [0002](./0002-service-architecture.md) | Service HTTP framework, crate layout, and API contract           | `service`                                  | Axum 0.8 on Tokio, downward-only workspace crates, and utoipa OpenAPI 3.1 at `service/openapi.json`.                                                         | Accepted |
| [0003](./0003-webapp-architecture.md)  | Webapp build tool, API client, and development server            | `webapp`, `service`                        | React 19 + Vite 8 on `:5180` proxying `/api/` to `:8888`, `openapi-typescript`/`openapi-fetch`, Oxlint, Vitest.                                              | Accepted |
| [0004](./0004-api-conventions.md)      | API versioning, naming, errors, and streaming conventions        | `service`, `webapp`                        | `/api/v1/` routes, camelCase JSON, strict nullability, RFC 9457 `Problem` errors, and SSE framing.                                                           | Accepted |
| [0005](./0005-workspace-model.md)      | Workspace model, autosave, and API                               | `service`, `webapp`                        | Folder and document tree, client UUIDs, bounded whole-tree read, `PUT` sub-resources, revision-checked saves.                                                | Accepted |
| [0006](./0006-storage-architecture.md) | Storage interface, filesystem backend, and SQL path              | `service`                                  | `WorkspaceStore` and conformance suite, `.md` files with a `.writer/` index, content-hash revisions, SQLx path.                                              | Accepted |
| [0007](./0007-webapp-interface.md)     | Webapp styling, typefaces, components, routing, and server state | `webapp`                                   | Typed CSS Modules, light and dark tokens, Newsreader and Inter, React Aria, TanStack Router and Query, IndexedDB.                                            | Accepted |
| [0008](./0008-editor.md)               | Editor, Markdown subset, round trip, and autosave timing         | `webapp`                                   | Tiptap 3 on ProseMirror, micromark bridge, raw source for other Markdown, byte-exact saves, 1 s and 5 s autosave, `Enter` line breaks, markers at the caret. | Accepted |
| [0009](./0009-browser-tests.md)        | Browser end-to-end and accessibility tests                       | `webapp`, `repository`                     | Playwright and axe-core in `webapp/e2e/` on three engines and iPad WebKit, real service, `browser` gate phase.                                               | Accepted |
| [0010](./0010-pair-writing-models.md)  | Local models for pair writing                                    | `service`, `evals`, `repository`           | Pending: local Ollama models measured with the committed `evals/` harness.                                                                                   | Proposed |
