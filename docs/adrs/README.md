---
title: Architecture Decision Records
description: Index of architectural decisions for the Writer service and its clients
author: Tim Park
ms.date: 2026-11-19
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
lists the subsystems whose code or clients must follow it in its `subsystems`
frontmatter, using the folder names `service` and `webapp`, or `repository` for
repository-wide tooling and process. Each subsystem's `AGENTS.md` links the
records that name it in a Governing decisions section, as
[ADR 0001](./0001-monorepo-structure.md#agent-discoverability) describes.

## Records

| ADR                                    | Title                                                      | Status   | Date       |
|----------------------------------------|------------------------------------------------------------|----------|------------|
| [0001](./0001-monorepo-structure.md)   | Monorepo structure, agent navigation, and tooling baseline | Accepted | 2026-11-19 |
| [0002](./0002-service-architecture.md) | Service HTTP framework, crate layout, and API contract     | Accepted | 2026-11-19 |
| [0003](./0003-webapp-architecture.md)  | Webapp build tool, API client, and development server      | Accepted | 2026-11-19 |
