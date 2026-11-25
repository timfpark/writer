---
title: Show background findings in the webapp
description: Request background reviews while the writer works and show the background agents' findings beside the text without interrupting writing.
author: Tim Park
ms.date: 2026-11-25
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want the pair writer's findings, such as weak prose, slips in
point of view, and questions about where the text could go, to appear beside
my text while I write, without interrupting me, so that I can pick them up
when I pause and follow them to the passages they concern.

## Context

[Backlog 35](./0035-service-background-review.md) returns findings anchored
to passages, and [backlog 34](./0034-assistant-pane-agent.md) connects the
assistant pane to the service. The
[background agents ADR](./0047-background-agents-ux-adr.md) decides which
agents ship, their triggers, where each appears, how much it may interrupt,
and whether the writer can pause background work. The
[experience ADR](./0038-pair-writing-experience-adr.md) decides how findings
are dismissed, what happens to a finding whose passage changed, and how
unread results signal. The [agent ADR](./0010-agent-architecture-adr.md)
decides how reviews start and how findings reach the webapp.
[ADR 0008](../adrs/0008-editor.md) sets the editor that highlights passages,
and [responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts) guards
typing latency, which a review must never degrade.

## Scope

* Regenerate the webapp's API client from the updated contract.
* Request reviews as the background agents and agent ADRs decide, never
  while the writer is typing, and cancel a review whose text has since
  changed.
* Show findings where the background agents ADR decides, marked by agent and
  distinct from replies, and let the writer answer a question from the agent.
* Highlight a finding's passage in the editor and scroll to it when the
  writer selects the finding, and mark or remove a finding whose passage has
  changed.
* Dismiss a finding so that it does not return.
* Add the pause the background agents ADR decides, if any, and send no text
  for review while background work is paused.
* Signal new findings while the assistant pane is collapsed or covering the
  page, without opening it or moving focus.
* Make every action operable from the keyboard, announce new findings
  politely to assistive technology, and cover the flow with browser and
  accessibility tests against a real service using the fake provider.

## Acceptance criteria

* [ ] A writer types into a synthetic document, pauses, and sees a finding
  from each agent backlog 35 ships; selecting each highlights its passage.
* [ ] Continuous typing starts no review, and editing a finding's passage
  behaves as the experience ADR describes.
* [ ] With background work paused, if the background agents ADR allows it, a
  browser test confirms no review request leaves the webapp.
* [ ] The responsiveness tests pass while a review is in flight.
* [ ] The browser and accessibility tests pass in `tools/check`.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)
* [Review documents in the background in the service](./0035-service-background-review.md)
