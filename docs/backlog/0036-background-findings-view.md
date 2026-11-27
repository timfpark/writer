---
title: Show background findings in the webapp
description: Replace backlog 62's scripted findings with the service's background review, restore findings when a document opens, keep dismissals and Chat handoffs across reloads, and follow the battery policy, without interrupting writing.
author: Tim Park
ms.date: 2026-11-27
ms.topic: reference
subsystems:
  - service
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want the pair writer's findings, such as weak prose, slips in
point of view, and questions about where the text could go, to appear beside
my text while I write, without interrupting me, so that I can pick them up
when I pause and follow them to the passages they concern.

## Context

[Backlog 62](./0062-scripted-findings-tab.md) builds the `Findings` tab,
passage underlines, the edit-versus-delete lifecycle, `Discuss in Chat` and
`Answer in Chat` handoffs, `Pause`, and the collapsed badge against
scripted findings. [Backlog 35](./0035-service-background-review.md)
returns real findings anchored to passages, and
[backlog 34](./0034-assistant-pane-agent.md) keeps chat threads across
sessions. [ADR 0011](../adrs/0011-background-agents-ux.md) picks the five
pause-triggered agents, the battery cadence, and low-battery auto-pause
with `Resume anyway`. [ADR 0012](../adrs/0012-pair-writing-experience.md)
restores a document's active findings when it opens without waiting for a
model, keeps a dismissed finding hidden while its text is unchanged, and
resumes an existing handoff thread rather than starting another. The
[agent ADR](./0010-agent-architecture-adr.md) decides how reviews start and
how findings reach the webapp, and
[responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts) guards
typing latency, which a review must never degrade.

## Scope

* Move the webapp onto the review endpoint or stream backlog 35 adds,
  requesting reviews as the agent ADR decides and replacing backlog 62's
  provisional trigger, transport, and anchors where they differ, never
  while the writer is typing, and cancel a review whose text has since
  changed.
* Remove backlog 62's provisional review endpoint once nothing uses it,
  unless the agent ADR keeps it, and regenerate `service/openapi.json` and
  the webapp's client.
* Show the findings of each agent backlog 35 ships in place of the scripted
  findings, with their `What it read` disclosures.
* Restore a document's active findings and underlines when it opens,
  without waiting for a model call.
* Dismiss a finding so that it does not return for unchanged text, across
  reloads.
* Keep `Discuss in Chat` and `Answer in Chat` resuming the same thread
  across reloads through its finding link.
* Follow ADR 0011's battery cadence from the power state the service
  reports, and show low-battery auto-pause with `Resume anyway`, sending no
  text for review while paused and keeping `Chat` available.
* Make every new action operable from the keyboard, and cover the flow with
  browser and accessibility tests against a real service using the scripted
  provider.

## Acceptance criteria

* [ ] A writer types into a synthetic document, pauses, and sees a finding
  from each agent backlog 35 ships; selecting each highlights its passage.
* [ ] Reopening a document restores its active findings and underlines
  without a model call, and a dismissed finding stays dismissed after a
  reload.
* [ ] With background work paused or auto-paused on low battery, a browser
  test confirms no review request leaves the webapp.
* [ ] The responsiveness tests pass while a review is in flight.
* [ ] The browser and accessibility tests pass in `tools/check`.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Keep chat threads across sessions in the assistant pane](./0034-assistant-pane-agent.md)
* [Review documents in the background in the service](./0035-service-background-review.md)
* [Try the Findings tab against scripted findings](./0062-scripted-findings-tab.md)
