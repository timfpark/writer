---
title: Architecture Decision Records
description: Index of architectural decisions for the portfolio service and its client subsystems
author: Tim Park
ms.date: 2026-11-18
ms.topic: reference
keywords: [rust, adr, architecture]
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
affect only one subsystem. Each record lists the subsystems whose code or
clients must follow it in its `subsystems` frontmatter, using the folder names
`service`, `cli`, `webapp`, and `agent`. Each subsystem's `AGENTS.md` links the
records that name it in a Governing decisions section, as
[ADR 0010](./0010-monorepo-layout-and-subsystem-boundaries.md#documentation-and-planning)
describes.

## Records

| ADR                                                                    | Title                                                 | Status   | Date       |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | -------- | ---------- |
| [0001](./0001-example.md)                               | Example (delete with first actual ADR)                | Accepted | 2026-10-15 |