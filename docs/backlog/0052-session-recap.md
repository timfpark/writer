---
title: Recap the last session when Writer opens
description: When the writer returns, show where they left off, what changed in their last session, and a suggested next step.
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

As a writer returning to my work, I want a short recap of where I left off,
what I changed last time, and a suggested next step so that I can pick up the
thread quickly.

## Context

The [background agents ADR](./0047-background-agents-ux-adr.md) decides what
the recap holds, when it appears, and how the writer dismisses it, and
[backlog 48](./0048-background-agent-evals.md) measures it. Knowing
what changed needs a record of the last session: the change control work
from [backlog 29](./0029-service-history.md) provides history if it has
landed, and otherwise the recap uses what the service already knows, such as
which documents were saved. The pair writer from
[backlog 34](./0034-assistant-pane-agent.md) provides the agent the recap
uses, and background review from
[backlog 35](./0035-service-background-review.md) provides the background
work that prepares it. Turning the recap off for part or all of the
workspace comes with [backlog 54](./0054-agent-settings-tree.md).

## Scope

* Record what a session changed, as the background agents ADR decides,
  without storing more text than the workspace already holds.
* Prepare the recap in the background, on backlog 35's background work,
  before the writer returns, so opening Writer is not delayed.
* Show the recap on opening Writer as the ADR decides, linked to the
  documents and passages it mentions, keyboard operable and accessible, and
  let the writer dismiss it.
* Tune the recap prompt on backlog 48's cases, as backlog 35 tunes its
  agents, and amend [ADR 0010](../adrs/0010-pair-writing-models.md) with the
  chosen prompt. Add the prompt and cases, and extend the fake provider.

## Acceptance criteria

* [ ] After a synthetic session, reopening Writer shows a recap that names
  the documents changed and links to where the writer left off.
* [ ] Opening Writer is no slower with the recap on.
* [ ] No document text appears in a log line or error response.
* [ ] `tools/check` exits 0.

## Prerequisites

* [Connect the assistant pane to the pair writer](./0034-assistant-pane-agent.md)
* [Review documents in the background in the service](./0035-service-background-review.md)
