---
title: Track open threads and keep a reverse outline
description: Maintain a list of open threads and a reverse outline of the writer's scenes in the background, and show them beside the navigator.
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

The [background agents ADR](./0047-background-agents-ux-adr.md) decides the
shapes, triggers, and surfaces of open threads and the reverse outline, and
[backlog 48](./0048-background-agent-evals.md) measures them. They are living
artifacts like the story bible from
[backlog 49](./0049-story-bible-continuity.md), and reuse its storage,
incremental updates, and corrections.

## Scope

* Summarize each scene's goal and what changes in it, and maintain the
  reverse outline across the workspace as documents change.
* Track setups and payoffs, such as an object introduced and never used, and
  list open threads with their passages.
* Show the reverse outline and open threads in the webapp, linked to their
  passages and to the navigator, keyboard operable and accessible, and let
  the writer correct an entry or mark a thread as intentionally open.
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

* [Keep a story bible and check continuity](./0049-story-bible-continuity.md)
