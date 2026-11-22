---
title: Show background findings in the webapp
description: Request background reviews while the writer works and show suggestions, questions, and disconnects beside the text without interrupting writing.
author: Tim Park
ms.date: 2026-11-22
ms.topic: reference
subsystems:
  - webapp
estimated_reading_time: 2
---

## Story

As a writer, I want the pair writer's suggestions, questions, and noticed
disconnects to appear beside my text while I write, without interrupting
me, so that I can pick them up when I pause and follow them to the passages
they concern.

## Context

[Backlog 35](./0035-service-background-review.md) returns findings anchored
to passages, and [backlog 34](./0034-assistant-pane-agent.md) connects the
assistant pane to the service. The
[agent ADR](./0010-agent-architecture-adr.md) decides what triggers a
review, how findings are dismissed, and how the writer turns background
review on and off. The
[conversations ADR](./0037-agent-conversations-adr.md) decides whether
findings appear as conversations of their own or in a separate list.
[ADR 0008](../adrs/0008-editor.md) sets the editor that highlights passages,
and [responsiveness.spec.ts](../../webapp/e2e/responsiveness.spec.ts) guards
typing latency, which a review must never degrade.

## Scope

* Regenerate the webapp's API client from the updated contract.
* Request reviews on the trigger the agent ADR decides, never while the
  writer is typing, and cancel a review whose text has since changed.
* Show findings where the conversations ADR decides, marked by kind and
  distinct from replies, and let the writer answer a question from the agent.
* Highlight a finding's passage in the editor and scroll to it when the
  writer selects the finding, and mark or remove a finding whose passage has
  changed.
* Dismiss a finding so that it does not return.
* Add the setting that turns background review on and off, with the ADR's
  default, and send no text for review while it is off.
* Signal new findings while the assistant pane is collapsed or covering the
  page, without opening it or moving focus.
* Make every action operable from the keyboard, announce new findings
  politely to assistive technology, and cover the flow with browser and
  accessibility tests against a real service using the fake provider.

## Acceptance criteria

* [ ] A writer types into a synthetic document, pauses, and sees a
  suggestion, a question, and a disconnect; selecting each highlights its
  passage.
* [ ] Continuous typing starts no review, and editing a finding's passage
  marks or removes that finding.
* [ ] With background review off, a browser test confirms no review request
  leaves the webapp.
* [ ] The responsiveness tests pass while a review is in flight.
* [ ] The browser and accessibility tests pass in `tools/check`.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)
* [Review documents in the background in the service](./0035-service-background-review.md)
