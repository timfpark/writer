---
title: Keep a story bible and check continuity
description: Maintain a story bible and timeline from the writer's documents in the background, let the writer read and correct them, and flag contradictions against them.
author: Tim Park
ms.date: 2026-11-24
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer of long work, I want the pair writer to keep track of my
characters, places, objects, and timeline, and tell me when my text
contradicts them, so that I catch continuity errors without keeping notes
myself.

## Context

The [background tasks ADR](./0047-background-tasks-ux-adr.md) decides the
story bible's, timeline's, and continuity check's shapes, triggers, and
surfaces, and [backlog 48](./0048-background-task-evals.md) measures whether
local models can produce them and with which prompts. The service's
background review from [backlog 35](./0035-service-background-review.md) and
the findings view from [backlog 36](./0036-background-findings-view.md)
provide the review plumbing and the way findings appear. The agent and
conversations ADRs decide where living artifacts are stored.

## Scope

* Extract story bible entries and timeline events from each document on the
  background tasks ADR's trigger, each citing the passages it came from, and
  update only what changed.
* Store the story bible and timeline as the agent and conversations ADRs
  decide, and expose them through the API under
  [ADR 0004](../adrs/0004-api-conventions.md).
* Show the story bible and timeline in the webapp, keyboard operable and
  accessible, and let the writer correct or delete an entry so later
  extractions keep the correction.
* Check new and changed text against the story bible and timeline, and raise
  continuity findings that cite both passages, through backlog 36's view.
* Add the prompts and evaluation cases backlog 48 chose, and extend the fake
  provider for tests.

## Acceptance criteria

* [ ] For a synthetic manuscript, the story bible and timeline list the
  expected entries, each linked to its passages.
* [ ] A contradiction planted in a new chapter is flagged with both passages.
* [ ] A writer's correction to an entry survives later extractions.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Review documents in the background in the service](./0035-service-background-review.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
* [Turn background agents on and off across the workspace tree](./0054-agent-settings-tree.md)
