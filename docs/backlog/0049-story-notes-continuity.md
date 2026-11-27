---
title: Keep story notes and check continuity
description: Maintain story notes and a timeline from the writer's documents in the background, let the writer read and correct them, and flag contradictions against them.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
  - evals
estimated_reading_time: 2
---

## Story

As a writer of long work, I want the pair writer to keep track of my
characters, places, objects, and timeline, and tell me when my text
contradicts them, so that I catch continuity errors without keeping notes
myself.

## Context

[ADR 0011](../adrs/0011-background-agents-ux.md) defines story notes',
timeline's, and continuity check's shapes, chapter-settled triggers,
book-scoped `Reference` tab with full-width `Expand`, plain `Save` with
`Edited by you` provenance and `Revert to extracted`, and immediate
downstream continuity re-evaluation. [Backlog 56](./0056-story-notes-continuity-test.md) tested the
story notes and continuity chain on local models, and
[backlog 48](./0048-background-agent-evals.md) added cases and a first
prompt for the timeline. The service's
background review from [backlog 35](./0035-service-background-review.md) and
the findings view from [backlog 36](./0036-background-findings-view.md)
provide the review plumbing and the way findings appear. The agent and
conversations ADRs decide how agents chain and where living artifacts are
stored.

## Scope

* Extract story notes entries and timeline events from each document on the
  background agents ADR's trigger, each citing the passages it came from, and
  update only what changed.
* Store story notes and the timeline as the agent and conversations ADRs
  decide, and expose them through the API under
  [ADR 0004](../adrs/0004-api-conventions.md).
* Add the Assistant pane's `Reference` tab and show story notes and the
  timeline in it (scoped to the active book subtree, with an `Expand` action
  for full-width tables in the center region), keyboard operable and
  accessible, and let the writer edit (`Save` -> `Edited by you`), `Revert
  to extracted`, or delete an entry so later extractions keep the
  correction and immediately re-evaluate continuity findings.
* Add the active book's story notes and timeline to what each `Chat` turn
  reads, the reading shown above the composer, and the `What it read`
  sources, as
  [ADR 0012](../adrs/0012-pair-writing-experience.md#what-the-agent-reads)
  decides, so a conversation knows other chapters' facts without rereading
  them.
* Check new and changed text against story notes and the timeline, and raise
  continuity findings that cite both passages, through backlog 36's view.
* Tune the extraction, timeline, and continuity prompts on the cases from
  backlog 56 and backlog 48, as backlog 35 tunes its agents, and amend
  [ADR 0010](../adrs/0010-pair-writing-models.md) with the chosen prompts.
  Add the prompts and cases, and extend the fake provider for tests.

## Acceptance criteria

* [ ] For a synthetic manuscript, story notes and the timeline list the
  expected entries, each linked to its passages.
* [ ] A contradiction planted in a new chapter is flagged with both passages.
* [ ] A writer's correction to an entry survives later extractions.
* [ ] A chat message about one chapter carries the active book's story notes
  and timeline, and `What it read` lists them.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Review documents in the background in the service](./0035-service-background-review.md)
* [Show background findings in the webapp](./0036-background-findings-view.md)
