---
title: Track open threads and keep a reverse outline
description: Maintain a list of open threads and a reverse outline of the writer's scenes in the background, and show them in the Reference tab with full-width expand.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - service
  - webapp
  - evals
estimated_reading_time: 2
---

## Story

As a writer, I want to see what each scene does and which setups I have not
paid off so that I can shape the structure of my work without rereading it.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) defines the chapter-settled
triggers and `Reference` tab surface (with full-width `Expand` for wide
scene tables) for open threads and the reverse outline, and
[backlog 48](./0048-background-agent-evals.md) measures them. They are
book-scoped living artifacts like story notes from
[backlog 49](./0049-story-notes-continuity.md), and reuse their storage,
incremental updates, and corrections.

## Scope

* Summarize each scene's goal and what changes in it, and maintain the
  reverse outline across the workspace as documents change.
* Track setups and payoffs, such as an object introduced and never used, and
  list open threads with their passages.
* Show the reverse outline and open threads in the Assistant pane's
  `Reference` tab (scoped to the active book subtree, with `Expand` to a
  full-width view in the center region), linked to their passages, keyboard
  operable and accessible, and let the writer edit an entry or mark a
  thread as `Intentionally open`.
* Tune the reverse outline and open threads prompts on backlog 48's cases,
  as backlog 35 tunes its agents, and amend
  [ADR 0010](../adrs/0010-pair-writing-models.md) with the chosen prompts.
  Add the prompts and cases, and extend the fake provider for tests.

## Acceptance criteria

* [ ] For a synthetic manuscript, the reverse outline summarizes every scene
  and the open threads include each planted setup without a payoff.
* [ ] A thread the writer marks as intentionally open stays closed after
  later updates.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Keep story notes and check continuity](./0049-story-notes-continuity.md)
